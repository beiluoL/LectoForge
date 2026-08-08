/**
 * 收集箱（Inbox）路由 —— 「极速输入，先积累再沉淀」的知识闭环第一步。
 *
 * 挂载前缀：/api（见 index.ts），对外端点：
 *   GET    /api/inbox/list            拉取全部未处理条目（时间倒序，支持 ?filter=today|week|untagged）
 *   POST   /api/inbox                 新建一条（速记 / 链接 / 图片 / 语音 / 附件）
 *   GET|POST /api/inbox/clip          网页剪藏：抓取 title / description / og:image / 摘要
 *   PUT    /api/inbox/:id             更新内容 / 打标签 / 改状态
 *   PUT    /api/inbox/:id/process     流转：沉淀为「康奈尔笔记」或「文档库文档」
 *   DELETE /api/inbox/:id             软删除（移入回收站，status=trashed）
 *   ---- 进阶能力（2026-08-08） ----
 *   POST   /api/inbox/batch/process   批量归档 / 批量删除 / 批量沉淀为康奈尔笔记
 *   POST   /api/inbox/upload/audio    语音灵感：上传录音（multipart）→ <dataDir>/uploads/audio/
 *   POST   /api/inbox/upload/asset    通用附件：上传图片 / PDF（multipart）→ <dataDir>/uploads/assets/
 *   POST   /api/inbox/duplicate-check 智能去重：与近 7 天未处理条目做编辑距离相似度比对
 *
 * 存储：复用既有 wb_capture 表（字段已与 Web 端对齐），本模块只在其上扩展
 * cover_image / processed_at 两列（迁移见 db/index.ts）。对外状态收敛为小写三态：
 *   unprocessed / archived / trashed  ←→  DB: INBOX / (PROCESSED|ARCHIVED) / TRASHED
 * 映射集中在本文件 toStatusVo / toStatusDb，勿在别处硬编码大小写。
 *
 * 上传落盘：统一走 lib/paths.ts 的 getUploadsDir()（打包后为
 * ~/Library/Application Support/com.knowflow.desktop/uploads），**绝不能**拼 src-api/ 相对路径——
 * .app 包内只读，写入会直接 EROFS。对外 URL 一律相对根路径 /uploads/xxx，
 * 由 index.ts 用 @fastify/static 同源托管（dev 走 vite proxy）。
 */
import { FastifyInstance } from 'fastify';
import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import multipart from '@fastify/multipart';
import { distance as levenshtein } from 'fastest-levenshtein';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';

import { db } from '../db';
import { wbCapture, wbNote, wbPalace, wbPalaceLoci, wbStory } from '../db/schema';
import { CURRENT_USER, nowIso } from '../db';
import { eq, and, desc, asc, gte, inArray, sql } from 'drizzle-orm';
import { assertSafeName, createNote, ensureMdExt, getRootDir, writeNote, VaultError } from '../lib/vault';
import { getUploadsDir } from '../lib/paths';

// ===================== 类型与映射 =====================

/** 收集项类型。audio / file 为「富媒体扩展」新增，历史数据仍是 text|link|image */
type InboxType = 'text' | 'link' | 'image' | 'audio' | 'file';
const INBOX_TYPES: InboxType[] = ['text', 'link', 'image', 'audio', 'file'];
type InboxStatusVo = 'unprocessed' | 'archived' | 'trashed';

/** DB 大写状态 → 对外小写三态 */
function toStatusVo(dbStatus: string | null): InboxStatusVo {
  switch ((dbStatus || 'INBOX').toUpperCase()) {
    case 'TRASHED':
      return 'trashed';
    case 'ARCHIVED':
    case 'PROCESSED': // 旧闭环里「已整理」也视为归档
      return 'archived';
    default:
      return 'unprocessed';
  }
}

/** 对外小写三态 → DB 大写状态 */
function toStatusDb(voStatus: string | undefined): string | null {
  if (!voStatus) return null;
  switch (voStatus.toLowerCase()) {
    case 'archived':
      return 'ARCHIVED';
    case 'trashed':
      return 'TRASHED';
    case 'unprocessed':
      return 'INBOX';
    default:
      return null;
  }
}

/** 归一化条目类型：优先用显式 type，否则按 sourceUrl / 旧 sourceType 推断 */
function toType(sourceType: string | null, sourceUrl: string | null): InboxType {
  const t = (sourceType || '').toLowerCase();
  if ((INBOX_TYPES as readonly string[]).includes(t)) return t as InboxType;
  if (t === 'web' || sourceUrl) return 'link';
  return 'text';
}

/** tags 在库里以 JSON 字符串存储；兼容历史逗号分隔与空值 */
function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  const s = raw.trim();
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr.map((x) => String(x)).filter(Boolean);
  } catch {
    /* fall through：按逗号 / 顿号切分 */
  }
  return s
    .split(/[,，、]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function serializeTags(tags: unknown): string | null {
  if (!Array.isArray(tags)) return null;
  const clean = tags.map((x) => String(x).trim()).filter(Boolean);
  return clean.length ? JSON.stringify(clean) : JSON.stringify([]);
}

/** 行 → 前端 InboxItem VO（字段与前端 api/inbox.ts InboxItem 一一对应） */
function toVo(r: any) {
  return {
    id: r.id,
    type: toType(r.sourceType, r.sourceUrl),
    title: r.title,
    content: r.content ?? '',
    sourceUrl: r.sourceUrl ?? '',
    coverImage: r.coverImage ?? '',
    tags: parseTags(r.tags),
    status: toStatusVo(r.status),
    starred: r.starred ? 1 : 0,
    createdAt: r.createdAt,
    processedAt: r.processedAt ?? null,
  };
}

// ===================== 网页剪藏 =====================

interface ClipResult {
  title: string;
  description: string;
  image: string | null;
  url: string;
  snippet: string;
  /** true 表示真实抓取成功；false 表示走了兜底（网络失败 / 非法 URL） */
  ok: boolean;
}

/** 把相对图片地址补成绝对地址（favicon 常见 /favicon.ico 这类相对路径） */
function absolutize(image: string | null | undefined, base: string): string | null {
  if (!image) return null;
  try {
    return new URL(image, base).href;
  } catch {
    return image;
  }
}

/**
 * 真实抓取网页元数据：axios（伪装 UA + 10s 超时 + arraybuffer）→ iconv 解码（应对 GBK）
 * → cheerio 解析 og / title / description / 正文摘要。任何异常都优雅降级，绝不抛 500。
 */
async function clipUrl(rawUrl: string, snippetLen = 120): Promise<ClipResult> {
  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return { title: '无效的链接', description: '请检查网址格式是否正确', image: null, url: rawUrl, snippet: '', ok: false };
  }

  try {
    const resp = await axios({
      method: 'get',
      url: targetUrl.href,
      timeout: 10000,
      responseType: 'arraybuffer',
      maxContentLength: 5 * 1024 * 1024, // 5MB 上限，防超大页面撑爆内存
      decompress: true,
      // 允许自签名 / 重定向；只读元数据，安全影响可控
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
    });

    // 解码：优先 header charset，其次 <meta charset>，默认 utf-8
    const contentType = String(resp.headers['content-type'] || '');
    let encoding = (contentType.match(/charset=([^;]+)/i)?.[1] || '').toLowerCase().trim();
    const buf = Buffer.from(resp.data);
    if (!encoding) {
      const head = buf.slice(0, 1024).toString('latin1');
      encoding = (head.match(/charset=["']?([\w-]+)/i)?.[1] || 'utf-8').toLowerCase();
    }
    if (encoding === 'gb2312' || encoding === 'gbk' || encoding === 'gb18030') encoding = 'gbk';
    if (!iconv.encodingExists(encoding)) encoding = 'utf-8';
    const html = iconv.decode(buf, encoding);

    const $ = cheerio.load(html);
    const title =
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('title').first().text().trim() ||
      targetUrl.hostname;
    const description =
      $('meta[property="og:description"]').attr('content')?.trim() ||
      $('meta[name="description"]').attr('content')?.trim() ||
      '';
    const image = absolutize(
      $('meta[property="og:image"]').attr('content') ||
        $('link[rel="icon"]').attr('href') ||
        $('link[rel="shortcut icon"]').attr('href') ||
        null,
      targetUrl.href,
    );

    // 正文摘要：剔除干扰标签后取纯文本前 snippetLen 字（clip 默认 120，metadata 取 200）
    $('script, style, nav, footer, header, aside, iframe, noscript, svg').remove();
    const plainText = $('body').text().replace(/\s+/g, ' ').trim();
    const snippet = plainText.slice(0, snippetLen);

    return { title, description, image, url: targetUrl.href, snippet, ok: true };
  } catch (error: any) {
    // 兜底：任何失败都返回可用结构，让前端 UI 照常填充（标题回退为域名）
    let msg = '页面抓取失败，可稍后重试或手动填写';
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') msg = '请求超时，请稍后重试';
      else if (error.response?.status === 404) msg = '目标页面不存在 (404)';
      else if (error.response?.status) msg = `访问失败 (${error.response.status})`;
    }
    return { title: targetUrl.hostname, description: msg, image: null, url: targetUrl.href, snippet: '', ok: false };
  }
}

// ===================== 流转辅助 =====================

/** 把标题清洗成合法文件名；非法字符替换为空格，超长截断，空则回退 */
function toSafeFileName(title: string): string {
  const cleaned = (title || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80);
  return cleaned || '未命名收集';
}

// ===================== 附件上传（语音 / 图片 / PDF） =====================

/** 上传子目录：语音走 audio/，其余通用附件走 assets/ */
type UploadKind = 'audio' | 'assets';

/** 单文件体积上限 25MB —— 语音灵感与截图都远小于此，超出多半是误传大文件 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** 允许的扩展名白名单（按用途分组，避免把可执行文件写进数据目录） */
const ALLOWED_EXT: Record<UploadKind, string[]> = {
  audio: ['.webm', '.wav', '.mp3', '.m4a', '.ogg', '.oga', '.mp4', '.aac'],
  assets: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.pdf', '.txt', '.md'],
};

/** MIME → 扩展名兜底（MediaRecorder 产出的 Blob 常常没有文件名） */
const MIME_EXT: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'video/webm': '.webm', // Chrome 的 MediaRecorder 有时把纯音频标成 video/webm
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
};

/**
 * 由「原始文件名 + MIME」推断一个安全扩展名。
 * 只信任白名单内的扩展名，其余一律按 MIME 映射，都拿不到就退回 kind 的默认值。
 */
function safeExt(kind: UploadKind, filename: string | undefined, mimetype: string | undefined): string {
  const raw = path.extname(filename || '').toLowerCase();
  if (raw && ALLOWED_EXT[kind].includes(raw)) return raw;
  const byMime = MIME_EXT[(mimetype || '').toLowerCase().split(';')[0].trim()];
  if (byMime && ALLOWED_EXT[kind].includes(byMime)) return byMime;
  return kind === 'audio' ? '.webm' : '.png';
}

/** 生成不会撞名、也不含用户可控路径片段的文件名：<yyyyMMdd>-<8位随机>.<ext> */
function makeStoredName(ext: string): string {
  const d = new Date();
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${day}-${crypto.randomBytes(4).toString('hex')}${ext}`;
}

/** 上传结果 VO（前端据 url 拼 Markdown / 存 sourceUrl） */
interface UploadResult {
  url: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  kind: UploadKind;
}

/**
 * 把 multipart 请求里的第一个文件落盘到 <dataDir>/uploads/<kind>/。
 * 用流式 pipeline 写入，避免大文件整个读进内存；超限时删掉半截文件再报错。
 */
async function saveUploadedFile(req: any, kind: UploadKind): Promise<UploadResult> {
  const part = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  if (!part) throw Object.assign(new Error('没有收到文件（字段名任意，但必须是 multipart 文件字段）'), { statusCode: 400 });

  const ext = safeExt(kind, part.filename, part.mimetype);
  const dir = path.join(getUploadsDir(), kind);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = makeStoredName(ext);
  const absPath = path.join(dir, fileName);

  try {
    await pipeline(part.file, fs.createWriteStream(absPath));
  } catch (e) {
    fs.rmSync(absPath, { force: true });
    throw e;
  }
  // @fastify/multipart 在超限时不会抛错，而是把 truncated 置为 true，需要显式检查
  if ((part.file as any).truncated) {
    fs.rmSync(absPath, { force: true });
    throw Object.assign(new Error(`文件超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 上限`), { statusCode: 413 });
  }

  const size = fs.statSync(absPath).size;
  return {
    url: `/uploads/${kind}/${fileName}`,
    fileName,
    originalName: part.filename || fileName,
    mimeType: part.mimetype || 'application/octet-stream',
    size,
    kind,
  };
}

// ===================== 智能去重 =====================

/** 相似度判重阈值：> 0.8 视为重复（与前端提示文案一致） */
const DUP_THRESHOLD = 0.8;
/** 去重回溯窗口：只跟最近 7 天的未处理条目比，超出这个窗口的「旧灵感」不打扰用户 */
const DUP_LOOKBACK_DAYS = 7;
/** 短于该长度的内容不参与相似度判重（「好」「TODO」这类极短文本必然互相高相似，纯噪音） */
const DUP_MIN_LEN = 8;

/** 判重前的文本归一化：去 Markdown 空白/标点噪音，统一小写，避免格式差异干扰编辑距离 */
function normalizeForDup(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ') // URL 单独比对，不混进正文相似度
    .replace(/[\s\u3000]+/g, '')
    .replace(/[。，、；：！？,.;:!?"'“”‘’()（）\[\]【】]/g, '');
}

/** 归一化 URL：去掉协议差异、末尾斜杠与常见追踪参数，让同一篇文章的不同分享链接能对上 */
function normalizeUrl(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'from', 'spm'].forEach((k) =>
      u.searchParams.delete(k),
    );
    const qs = u.searchParams.toString();
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${qs ? `?${qs}` : ''}`.toLowerCase();
  } catch {
    return s.toLowerCase().replace(/\/+$/, '');
  }
}

/** 归一化编辑距离相似度：1 - distance / max(len)，取值 [0,1] */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  // 长度差距过大时直接判为不相似，省掉一次 O(n*m) 计算（编辑距离下界即长度差）
  if (Math.abs(a.length - b.length) / max > 1 - DUP_THRESHOLD) return 0;
  return 1 - levenshtein(a, b) / max;
}

// ===================== 列表过滤 =====================

type InboxFilter = 'all' | 'today' | 'week' | 'untagged';

/** 本地「今天 00:00」对应的 ISO 串（createdAt 存的是 ISO/UTC，可直接字典序比较） */
function localDayStartIso(offsetDays = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString();
}

/**
 * 把一条收集项落成康奈尔笔记（wb_note）：内容进 noteColumn，线索/总结留空待用户填，
 * captureId 回链原收集项。单条沉淀与批量沉淀共用，避免两处字段写法漂移。
 */
function insertCornellNote(item: any, now: string) {
  return db
    .insert(wbNote)
    .values({
      userId: CURRENT_USER,
      captureId: item.id,
      categoryId: item.categoryId ?? null,
      title: item.title,
      cueColumn: '',
      noteColumn: item.content || '',
      summaryColumn: item.sourceUrl ? `来源：${item.sourceUrl}` : '',
      tags: item.tags ?? null,
      mastery: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

/** 组装沉淀到文档库的 Markdown 正文 */
function buildDocMarkdown(item: any): string {
  const lines = [`# ${item.title}`, ''];
  if (item.content) lines.push(String(item.content), '');
  if (item.sourceUrl) lines.push(`> 来源：[${item.sourceUrl}](${item.sourceUrl})`, '');
  const tags = parseTags(item.tags);
  if (tags.length) lines.push(tags.map((t) => `#${t}`).join(' '), '');
  lines.push(`<sub>由收集箱沉淀于 ${new Date().toLocaleString('zh-CN')}</sub>`, '');
  return lines.join('\n');
}

// ===================== 路由 =====================

export default async function inboxRoutes(app: FastifyInstance) {
  /* multipart 只在本插件作用域内注册（Fastify 插件天然封装），
   * 不污染其它路由的 body 解析；上限与 saveUploadedFile 中保持一致。 */
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 8 },
  });

  /**
   * 全部「未处理」条目；默认星标→时间倒序，?sort=asc 时按创建时间升序（收件箱积压视图用）。
   * ?filter=today|week|untagged 做智能过滤：
   *   today    —— 今天（本地 0 点起）创建的
   *   week     —— 近 7 天创建的
   *   untagged —— 还没打过标签的（tags 为空 / null / 空数组字面量）
   * 过滤在 SQL 层完成，前端只需切 tab，不必自己筛数组。
   */
  app.get('/inbox/list', async (req) => {
    const q = (req.query ?? {}) as any;
    const ascSort = String(q.sort || '').toLowerCase() === 'asc';
    const filter = String(q.filter || 'all').toLowerCase() as InboxFilter;

    const conds: any[] = [eq(wbCapture.userId, CURRENT_USER), eq(wbCapture.status, 'INBOX')];
    if (filter === 'today') conds.push(gte(wbCapture.createdAt, localDayStartIso(0)));
    else if (filter === 'week') conds.push(gte(wbCapture.createdAt, localDayStartIso(6)));
    else if (filter === 'untagged') {
      conds.push(sql`(${wbCapture.tags} IS NULL OR TRIM(${wbCapture.tags}) IN ('', '[]'))`);
    }

    const rows = db
      .select()
      .from(wbCapture)
      .where(and(...conds))
      .orderBy(ascSort ? asc(wbCapture.createdAt) : desc(wbCapture.starred), desc(wbCapture.createdAt))
      .all();
    return rows.map(toVo);
  });

  /** 回收站 / 归档查询：GET /api/inbox?status=archived|trashed|unprocessed（列表页可选用） */
  app.get('/inbox', async (req) => {
    const q = req.query as any;
    const dbStatus = toStatusDb(q.status) ?? 'INBOX';
    const rows = db
      .select()
      .from(wbCapture)
      .where(and(eq(wbCapture.userId, CURRENT_USER), eq(wbCapture.status, dbStatus)))
      .orderBy(desc(wbCapture.createdAt))
      .all();
    return rows.map(toVo);
  });

  /** 新建一条收集项 */
  app.post('/inbox', async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const sourceUrl: string = (b.sourceUrl || '').trim();
    const content: string = (b.content ?? '').toString();
    // 类型：显式 type 优先，否则 sourceUrl 有值即 link
    const type: InboxType = INBOX_TYPES.includes(b.type)
      ? b.type
      : sourceUrl
        ? 'link'
        : 'text';
    // 标题：显式 title > 内容首行 > 域名 > 「无标题速记」
    let title: string = (b.title || '').trim();
    if (!title) {
      const firstLine = content.split('\n').map((s: string) => s.trim()).find(Boolean);
      if (firstLine) title = firstLine.slice(0, 80);
      else if (sourceUrl) {
        try {
          title = new URL(sourceUrl).hostname;
        } catch {
          title = sourceUrl.slice(0, 80);
        }
      } else title = '无标题速记';
    }
    const now = nowIso();
    const row = db
      .insert(wbCapture)
      .values({
        userId: CURRENT_USER,
        title,
        content: content || null,
        sourceType: type,
        sourceUrl: sourceUrl || null,
        coverImage: (b.coverImage || '').trim() || null,
        tags: serializeTags(b.tags),
        status: 'INBOX',
        starred: b.starred ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return reply.code(201).send(toVo(row));
  });

  /**
   * 网页剪藏。兼容两种调用：
   *   GET  /api/inbox/clip?url=xxx  （或 ?sourceUrl=xxx）
   *   POST /api/inbox/clip  body { url } 或 { sourceUrl }
   * 始终返回 200 结构，前端据 ok 字段决定提示语气。
   */
  const clipHandler = async (req: any) => {
    const q = (req.query ?? {}) as any;
    const b = (req.body ?? {}) as any;
    const url: string = (q.url || q.sourceUrl || b.url || b.sourceUrl || '').toString().trim();
    if (!url) return { title: '', description: 'URL 不能为空', image: null, url: '', snippet: '', ok: false };
    return clipUrl(url);
  };
  app.get('/inbox/clip', clipHandler);
  app.post('/inbox/clip', clipHandler);

  /**
   * 网页元数据抓取（智能爬取 / 剪藏增强 B）。兼容 GET（?url=）与 POST（{ url }）。
   * 与 /clip 同源：axios + 伪装 UA + GBK 解码 + 优雅降级；失败时仍返回 200 且 ok=false，
   * 绝不抛 500 阻断用户手动录入。摘要取前 200 字（比 /clip 的 120 更长，便于「摘录初稿」）。
   */
  const metadataHandler = async (req: any) => {
    const q = (req.query ?? {}) as any;
    const b = (req.body ?? {}) as any;
    const url: string = (q.url || q.sourceUrl || b.url || b.sourceUrl || '').toString().trim();
    if (!url) return { title: '', description: 'URL 不能为空', image: null, url: '', snippet: '', ok: false };
    return clipUrl(url, 200);
  };
  app.get('/inbox/metadata', metadataHandler);
  app.post('/inbox/metadata', metadataHandler);

  /** 更新：内容 / 标题 / 标签 / 星标 / 状态（小写三态自动映射为 DB 大写） */
  app.put('/inbox/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const b = (req.body ?? {}) as any;
    const ex = db
      .select()
      .from(wbCapture)
      .where(and(eq(wbCapture.id, id), eq(wbCapture.userId, CURRENT_USER)))
      .get() as any;
    if (!ex) return reply.code(404).send({ message: '收集项不存在' });

    const nextStatus = toStatusDb(b.status) ?? ex.status;
    db.update(wbCapture)
      .set({
        title: b.title !== undefined ? String(b.title).trim() || ex.title : ex.title,
        content: b.content !== undefined ? String(b.content) : ex.content,
        sourceUrl: b.sourceUrl !== undefined ? String(b.sourceUrl).trim() || null : ex.sourceUrl,
        sourceType: INBOX_TYPES.includes(b.type) ? b.type : ex.sourceType,
        coverImage: b.coverImage !== undefined ? String(b.coverImage).trim() || null : ex.coverImage,
        tags: b.tags !== undefined ? serializeTags(b.tags) : ex.tags,
        starred: b.starred !== undefined ? (b.starred ? 1 : 0) : ex.starred,
        status: nextStatus,
        updatedAt: nowIso(),
      })
      .where(eq(wbCapture.id, id))
      .run();
    return toVo(db.select().from(wbCapture).where(eq(wbCapture.id, id)).get() as any);
  });

  /**
   * 关键流转接口：把收集项「沉淀」到下游（智能路由 C）。
   * body/query: { target | targetType: 'note' | 'cornell' | 'palace' | 'story' }
   *   - cornell → 在 wb_note（康奈尔笔记）建一条，noteColumn = 收集内容，携带 captureId 回链
   *   - note    → 在文档库（磁盘 vault）写一个 .md 文件
   *   - palace  → 在指定记忆宫殿（palaceId）新建/追加一个位点（wb_palace_loci），knowledgePoint = 收集内容
   *   - story   → 在费曼故事（wb_story）建一条 DRAFT 草稿，content = 收集内容
   * 成功后把收集项标记为 archived，并记录 processedAt。
   */
  app.put('/inbox/:id/process', async (req, reply) => {
    const id = Number((req.params as any).id);
    const q = (req.query ?? {}) as any;
    const b = (req.body ?? {}) as any;
    // 兼容 spec 的 targetType 命名与既有 target 命名
    const target = String(b.targetType || b.target || q.targetType || q.target || 'cornell').toLowerCase();

    const item = db
      .select()
      .from(wbCapture)
      .where(and(eq(wbCapture.id, id), eq(wbCapture.userId, CURRENT_USER)))
      .get() as any;
    if (!item) return reply.code(404).send({ message: '收集项不存在' });

    const now = nowIso();
    let result: { target: string; noteId?: number; path?: string; palaceId?: number; lociId?: number; storyId?: number; title: string };

    if (target === 'cornell') {
      // 沉淀为康奈尔笔记：内容进 noteColumn，线索/总结留空待用户填。
      const note = insertCornellNote(item, now);
      result = { target: 'cornell', noteId: note.id, title: item.title };
    } else if (target === 'note') {
      // 沉淀为文档库文档：往磁盘 vault 写一个 .md 文件。
      if (!getRootDir()) {
        return reply
          .code(409)
          .send({ message: '尚未选择文档库目录，请先在「文档库」中选择本地文件夹后再沉淀为文档' });
      }
      const markdown = buildDocMarkdown(item);
      let fileName = ensureMdExt(assertSafeName(toSafeFileName(item.title)));
      let node;
      try {
        node = await createNote('', fileName);
      } catch (e) {
        // 同名冲突：追加短时间戳后重试一次
        if (e instanceof VaultError && e.statusCode === 409) {
          fileName = ensureMdExt(assertSafeName(`${toSafeFileName(item.title)}-${Date.now().toString(36)}`));
          node = await createNote('', fileName);
        } else {
          throw e;
        }
      }
      await writeNote(node.id, markdown);
      result = { target: 'note', path: node.id, title: item.title };
    } else if (target === 'palace') {
      // 沉淀到记忆宫殿：必须指定 palaceId；lociId 可选——有则把内容追加到位点，无则新建位点。
      const palaceId = Number(b.palaceId ?? q.palaceId);
      if (!palaceId || Number.isNaN(palaceId)) {
        return reply.code(400).send({ message: '流转到记忆宫殿需要 palaceId' });
      }
      const palace = db.select().from(wbPalace).where(eq(wbPalace.id, palaceId)).get() as any;
      if (!palace) return reply.code(404).send({ message: '记忆宫殿不存在' });

      const lociId = Number(b.lociId ?? q.lociId ?? 0) || 0;
      let finalLociId = lociId;
      if (lociId) {
        // 追加到已有位点：把收集内容拼到 knowledgePoint 末尾（保留原内容）
        const exLoci = db.select().from(wbPalaceLoci).where(eq(wbPalaceLoci.id, lociId)).get() as any;
        const kp = [exLoci?.knowledgePoint, item.content].filter(Boolean).join('\n\n');
        db.update(wbPalaceLoci)
          .set({ knowledgePoint: kp || null, captureId: item.id, updatedAt: now })
          .where(eq(wbPalaceLoci.id, lociId))
          .run();
      } else {
        // 新建位点：名称取收集标题，知识点取收集内容，sortOrder 排到末尾
        const maxIdx = db
          .select({ m: sql<number>`COALESCE(MAX(${wbPalaceLoci.sortOrder}), -1)` })
          .from(wbPalaceLoci)
          .where(eq(wbPalaceLoci.palaceId, palaceId))
          .get() as any;
        const loci = db
          .insert(wbPalaceLoci)
          .values({
            palaceId,
            userId: CURRENT_USER,
            name: item.title,
            knowledgePoint: item.content || null,
            captureId: item.id,
            sortOrder: (maxIdx?.m ?? -1) + 1,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        finalLociId = loci.id;
      }
      result = { target: 'palace', palaceId, lociId: finalLociId, title: item.title };
    } else if (target === 'story') {
      // 沉淀为费曼故事草稿：content 直接进正文，其他留空待用户补全
      const story = db
        .insert(wbStory)
        .values({
          userId: CURRENT_USER,
          captureId: item.id,
          title: item.title,
          content: item.content || '',
          status: 'DRAFT',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      result = { target: 'story', storyId: story.id, title: item.title };
    } else {
      return reply.code(400).send({ message: 'target 仅支持 note | cornell | palace | story' });
    }

    // 标记归档 + 流转时间
    db.update(wbCapture)
      .set({ status: 'ARCHIVED', processedAt: now, updatedAt: now })
      .where(eq(wbCapture.id, id))
      .run();

    return { ...result, item: toVo(db.select().from(wbCapture).where(eq(wbCapture.id, id)).get() as any) };
  });

  /**
   * 批量处理（进阶一）：一次性归档 / 删除 / 沉淀为康奈尔笔记。
   *
   * body: { ids: number[], target: 'archive' | 'delete' | 'cornell' }
   * 用 Drizzle 的 inArray 做一条 UPDATE 打包收口（而不是循环发 N 条），
   * 沉淀场景则先逐条建笔记（需要各自的标题/正文），再用同一条 inArray 批量改状态。
   *
   * 所有 id 都会先按 userId 过滤一遍，越权 id 静默忽略并在 skipped 里回报，
   * 不因为个别脏 id 让整批失败（前端批量操作最怕「全有或全无」）。
   */
  app.post('/inbox/batch/process', async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const target = String(b.target || b.targetType || '').toLowerCase();
    if (!['archive', 'delete', 'cornell'].includes(target)) {
      return reply.code(400).send({ message: 'target 仅支持 archive | delete | cornell' });
    }

    const ids = Array.from(
      new Set(
        (Array.isArray(b.ids) ? b.ids : [])
          .map((x: any) => Number(x))
          .filter((n: number) => Number.isInteger(n) && n > 0),
      ),
    ) as number[];
    if (!ids.length) return reply.code(400).send({ message: 'ids 不能为空' });

    // 只取当前用户名下真实存在的条目；其余算 skipped
    const rows = db
      .select()
      .from(wbCapture)
      .where(and(eq(wbCapture.userId, CURRENT_USER), inArray(wbCapture.id, ids)))
      .all() as any[];
    const validIds = rows.map((r) => r.id);
    const skipped = ids.filter((id) => !validIds.includes(id));
    if (!validIds.length) {
      return { target, processed: 0, ids: [], skipped, noteIds: [] };
    }

    const now = nowIso();
    const noteIds: number[] = [];

    if (target === 'delete') {
      db.update(wbCapture)
        .set({ status: 'TRASHED', updatedAt: now })
        .where(inArray(wbCapture.id, validIds))
        .run();
    } else {
      if (target === 'cornell') {
        for (const item of rows) noteIds.push(insertCornellNote(item, now).id);
      }
      db.update(wbCapture)
        .set({ status: 'ARCHIVED', processedAt: now, updatedAt: now })
        .where(inArray(wbCapture.id, validIds))
        .run();
    }

    return { target, processed: validIds.length, ids: validIds, skipped, noteIds };
  });

  /**
   * 语音灵感上传（进阶二）：接收 MediaRecorder 产出的 webm/wav Blob，
   * 落到 <dataDir>/uploads/audio/，返回同源可播放的相对 URL。
   * 这里只负责存文件，不落库——前端拿到 url 后再调 POST /api/inbox 建条目（type=audio）。
   */
  app.post('/inbox/upload/audio', async (req, reply) => {
    try {
      return await saveUploadedFile(req, 'audio');
    } catch (e: any) {
      return reply.code(e?.statusCode || 400).send({ message: e?.message || '录音上传失败' });
    }
  });

  /**
   * 通用附件上传（进阶四）：图片 / PDF 等，落到 <dataDir>/uploads/assets/。
   * 前端拿到 url 后自行在正文里拼 `![说明](url)`（图片）或 `[文件名](url)`（其它）。
   */
  app.post('/inbox/upload/asset', async (req, reply) => {
    try {
      return await saveUploadedFile(req, 'assets');
    } catch (e: any) {
      return reply.code(e?.statusCode || 400).send({ message: e?.message || '附件上传失败' });
    }
  });

  /**
   * 智能去重检测（进阶三）：body { content?, sourceUrl? }。
   *
   * 判重口径（命中任一即算重复）：
   *   1) sourceUrl 归一化后完全一致（去协议 / www / 末尾斜杠 / utm 追踪参数）；
   *   2) 正文归一化后与近 7 天未处理条目的相似度 > 0.8（fastest-levenshtein 编辑距离）。
   *
   * 永远返回 200：判重是「提醒」而非「拦截」，任何异常都应降级为「不重复」，
   * 绝不能因为判重失败挡住用户记录灵感。
   */
  app.post('/inbox/duplicate-check', async (req) => {
    const b = (req.body ?? {}) as any;
    const content = String(b.content ?? '').trim();
    const sourceUrl = String(b.sourceUrl ?? '').trim();
    const excludeId = Number(b.excludeId ?? 0) || 0;
    const miss = { isDuplicate: false as const, similarity: 0, reason: 'none' as const };
    if (!content && !sourceUrl) return miss;

    try {
      const since = localDayStartIso(DUP_LOOKBACK_DAYS - 1);
      const rows = db
        .select({
          id: wbCapture.id,
          title: wbCapture.title,
          content: wbCapture.content,
          sourceUrl: wbCapture.sourceUrl,
          createdAt: wbCapture.createdAt,
        })
        .from(wbCapture)
        .where(
          and(
            eq(wbCapture.userId, CURRENT_USER),
            eq(wbCapture.status, 'INBOX'),
            gte(wbCapture.createdAt, since),
          ),
        )
        .orderBy(desc(wbCapture.createdAt))
        .limit(200) // 近 7 天的收集量级远小于此，加个天花板防极端情况下 O(n·m) 爆炸
        .all() as any[];

      // 1) URL 完全一致优先（比正文相似度更硬的证据）
      const urlKey = normalizeUrl(sourceUrl);
      if (urlKey) {
        const hit = rows.find((r) => r.id !== excludeId && normalizeUrl(r.sourceUrl || '') === urlKey);
        if (hit) {
          return {
            isDuplicate: true,
            existingId: hit.id,
            existingTitle: hit.title,
            existingCreatedAt: hit.createdAt,
            similarity: 1,
            reason: 'url' as const,
          };
        }
      }

      // 2) 正文相似度
      const base = normalizeForDup(content);
      if (base.length >= DUP_MIN_LEN) {
        let best: { row: any; score: number } | null = null;
        for (const r of rows) {
          if (r.id === excludeId) continue;
          const other = normalizeForDup(r.content || r.title || '');
          if (other.length < DUP_MIN_LEN) continue;
          const score = similarity(base, other);
          if (!best || score > best.score) best = { row: r, score };
        }
        if (best && best.score > DUP_THRESHOLD) {
          return {
            isDuplicate: true,
            existingId: best.row.id,
            existingTitle: best.row.title,
            existingCreatedAt: best.row.createdAt,
            similarity: Number(best.score.toFixed(3)),
            reason: 'content' as const,
          };
        }
      }
      return miss;
    } catch {
      // 判重失败一律当作「不重复」，绝不阻断输入
      return miss;
    }
  });

  /** 软删除：移入回收站（status=trashed），保留数据可恢复；非物理删除 */
  app.delete('/inbox/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const ex = db
      .select()
      .from(wbCapture)
      .where(and(eq(wbCapture.id, id), eq(wbCapture.userId, CURRENT_USER)))
      .get() as any;
    if (!ex) return reply.code(404).send({ message: '收集项不存在' });
    db.update(wbCapture)
      .set({ status: 'TRASHED', updatedAt: nowIso() })
      .where(eq(wbCapture.id, id))
      .run();
    return reply.code(204).send();
  });
}
