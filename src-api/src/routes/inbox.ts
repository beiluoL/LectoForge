/**
 * 收集箱（Inbox）路由 —— 「极速输入，先积累再沉淀」的知识闭环第一步。
 *
 * 挂载前缀：/api（见 index.ts），对外端点：
 *   GET    /api/inbox/list            拉取全部未处理条目（时间倒序）
 *   POST   /api/inbox                 新建一条（速记 / 链接 / 图片）
 *   GET|POST /api/inbox/clip          网页剪藏：抓取 title / description / og:image / 摘要
 *   PUT    /api/inbox/:id             更新内容 / 打标签 / 改状态
 *   PUT    /api/inbox/:id/process     流转：沉淀为「康奈尔笔记」或「文档库文档」
 *   DELETE /api/inbox/:id             软删除（移入回收站，status=trashed）
 *
 * 存储：复用既有 wb_capture 表（字段已与 Web 端对齐），本模块只在其上扩展
 * cover_image / processed_at 两列（迁移见 db/index.ts）。对外状态收敛为小写三态：
 *   unprocessed / archived / trashed  ←→  DB: INBOX / (PROCESSED|ARCHIVED) / TRASHED
 * 映射集中在本文件 toStatusVo / toStatusDb，勿在别处硬编码大小写。
 */
import { FastifyInstance } from 'fastify';
import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

import { db } from '../db';
import { wbCapture, wbNote } from '../db/schema';
import { CURRENT_USER, nowIso } from '../db';
import { eq, and, desc } from 'drizzle-orm';
import { assertSafeName, createNote, ensureMdExt, getRootDir, writeNote, VaultError } from '../lib/vault';

// ===================== 类型与映射 =====================

type InboxType = 'text' | 'link' | 'image';
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
  if (t === 'text' || t === 'link' || t === 'image') return t;
  if (t === 'image') return 'image';
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
async function clipUrl(rawUrl: string): Promise<ClipResult> {
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

    // 正文摘要：剔除干扰标签后取纯文本前 120 字
    $('script, style, nav, footer, header, aside, iframe, noscript, svg').remove();
    const plainText = $('body').text().replace(/\s+/g, ' ').trim();
    const snippet = plainText.slice(0, 120);

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
  /** 全部「未处理」条目，时间倒序 */
  app.get('/inbox/list', async () => {
    const rows = db
      .select()
      .from(wbCapture)
      .where(and(eq(wbCapture.userId, CURRENT_USER), eq(wbCapture.status, 'INBOX')))
      .orderBy(desc(wbCapture.starred), desc(wbCapture.createdAt))
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
    const type: InboxType = ['text', 'link', 'image'].includes(b.type)
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
        sourceType: ['text', 'link', 'image'].includes(b.type) ? b.type : ex.sourceType,
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
   * 关键流转接口：把收集项「沉淀」到下游。
   * body/query: { target: 'note' | 'cornell' }
   *   - cornell → 在 wb_note（康奈尔笔记）建一条，noteColumn = 收集内容，携带 captureId 回链
   *   - note    → 在文档库（磁盘 vault）写一个 .md 文件
   * 成功后把收集项标记为 archived，并记录 processedAt。
   */
  app.put('/inbox/:id/process', async (req, reply) => {
    const id = Number((req.params as any).id);
    const q = (req.query ?? {}) as any;
    const b = (req.body ?? {}) as any;
    const target = String(b.target || q.target || 'cornell').toLowerCase();

    const item = db
      .select()
      .from(wbCapture)
      .where(and(eq(wbCapture.id, id), eq(wbCapture.userId, CURRENT_USER)))
      .get() as any;
    if (!item) return reply.code(404).send({ message: '收集项不存在' });

    const now = nowIso();
    let result: { target: string; noteId?: number; path?: string; title: string };

    if (target === 'cornell') {
      // 沉淀为康奈尔笔记：内容进 noteColumn，线索/总结留空待用户填。
      const note = db
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
    } else {
      return reply.code(400).send({ message: 'target 仅支持 note | cornell' });
    }

    // 标记归档 + 流转时间
    db.update(wbCapture)
      .set({ status: 'ARCHIVED', processedAt: now, updatedAt: now })
      .where(eq(wbCapture.id, id))
      .run();

    return { ...result, item: toVo(db.select().from(wbCapture).where(eq(wbCapture.id, id)).get() as any) };
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
