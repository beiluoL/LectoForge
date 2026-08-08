/**
 * 收集箱（Inbox）核心服务 —— 「极速输入，先积累再沉淀」闭环的数据层。
 *
 * 存储复用既有 wb_capture 表。对外状态收敛为小写三态：
 *   unprocessed / archived / trashed  ←→  DB: INBOX / (PROCESSED|ARCHIVED) / TRASHED
 *
 * ⚠️ 红线：映射只允许存在于本文件的 toStatusVo / toStatusDb。
 * /api/workbench/captures 走的是**大写原状态**（见 captureService），
 * 两套契约互斥，严禁试图统一大小写——一旦合并，历史数据会大面积「状态丢失」。
 *
 * ⚠️ better-sqlite3 为同步 API：本文件中所有 db.* 调用均不得改写为 async/await。
 * 仅涉及磁盘 vault 写入的 processItem 因 lib/vault 本身是异步而声明为 async。
 */
import { and, asc, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';

import { CURRENT_USER, db, nowIso } from '../db';
import { wbCapture, wbNote, wbPalace, wbPalaceLoci, wbStory } from '../db/schema';
import { resolvePage } from '../lib/pagination';
import { assertSafeName, createNote, ensureMdExt, getRootDir, writeNote, VaultError } from '../lib/vault';
import type { PageQuery } from '../types/pagination';
import type {
  BatchResultVO,
  BatchTarget,
  CreateInboxDTO,
  InboxItemVO,
  InboxStatusVo,
  InboxType,
  ListInboxQuery,
  ProcessInput,
  ProcessOutcome,
  ProcessResultVO,
  UpdateInboxDTO,
} from '../types/inbox';

type CaptureRow = typeof wbCapture.$inferSelect;

/** 收集项类型白名单。audio / file 为「富媒体扩展」新增，历史数据仍是 text|link|image */
const INBOX_TYPES: readonly string[] = ['text', 'link', 'image', 'audio', 'file'];

// ===================== 状态与字段映射 =====================

/**
 * DB 大写状态 → 对外小写三态（读方向，**四值收敛为三值**）。
 *
 * 映射表：
 * | DB 值                  | VO 值         | 说明                              |
 * |------------------------|---------------|-----------------------------------|
 * | `TRASHED`              | `trashed`     | 软删除，回收站可恢复              |
 * | `ARCHIVED`             | `archived`    | 新闭环：已沉淀归档                |
 * | `PROCESSED`            | `archived`    | 旧闭环遗留值，语义等同归档        |
 * | `INBOX` / null / 其它  | `unprocessed` | 兜底，脏数据一律当待处理，不丢条目 |
 *
 * ⚠️ **本映射不可逆**：`PROCESSED` 与 `ARCHIVED` 都收敛到 `archived`，
 * 而 toStatusDb('archived') 只会回写 `ARCHIVED`。因此任何「读出 VO → 原样写回 DB」
 * 的链路都会把历史 `PROCESSED` 静默改写成 `ARCHIVED`。更新逻辑必须遵守：
 * **b.status 未显式传值时保留 ex.status 原值**（见 updateItem 的 `?? ex.status`），
 * 绝不能用 `toStatusDb(toStatusVo(row.status))` 做 round-trip。
 *
 * @param dbStatus 数据库 `wb_capture.status` 原值，允许 null（老行未写状态）
 * @returns 对外小写三态之一，永不抛错、永不返回 undefined
 */
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

/**
 * 对外小写三态 → DB 大写状态（写方向，严格三对三）。
 *
 * 与 toStatusVo 的关键差异：**非法值返回 `null` 而不是兜底为 `INBOX`**。
 * 这是刻意设计——写路径上「认不出的状态」必须由调用方决定语义：
 *   - updateItem 用 `toStatusDb(b.status) ?? ex.status` → 保留原状态，避免误改；
 *   - listByStatus 用 `toStatusDb(status) ?? 'INBOX'` → 查询场景回退到收件箱。
 * 若这里直接兜底成 `INBOX`，一次带脏 status 的 PATCH 就会把归档条目"复活"回收件箱。
 *
 * @param voStatus 对外小写状态；传 undefined 表示「本次不改状态」
 * @returns 对应的 DB 大写状态；`undefined` 或无法识别的值一律返回 `null`（由调用方兜底）
 */
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
  if (INBOX_TYPES.includes(t)) return t as InboxType;
  if (t === 'web' || sourceUrl) return 'link';
  return 'text';
}

/** tags 在库里以 JSON 字符串存储；兼容历史逗号分隔与空值 */
export function parseTags(raw: string | null): string[] {
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
function toVo(r: CaptureRow): InboxItemVO {
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

// ===================== 时间窗口 =====================

/**
 * 本地「今天 00:00」对应的 ISO 串（createdAt 存的是 ISO/UTC，可直接字典序比较）。
 * 列表过滤与去重回溯窗口共用，导出以免两处各写一份产生漂移。
 */
export function localDayStartIso(offsetDays = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString();
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

/**
 * 把一条收集项落成康奈尔笔记（wb_note）：内容进 noteColumn，线索/总结留空待用户填，
 * captureId 回链原收集项。单条沉淀与批量沉淀共用，避免两处字段写法漂移。
 */
function insertCornellNote(item: CaptureRow, now: string) {
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
function buildDocMarkdown(item: CaptureRow): string {
  const lines = [`# ${item.title}`, ''];
  if (item.content) lines.push(String(item.content), '');
  if (item.sourceUrl) lines.push(`> 来源：[${item.sourceUrl}](${item.sourceUrl})`, '');
  const tags = parseTags(item.tags);
  if (tags.length) lines.push(tags.map((t) => `#${t}`).join(' '), '');
  lines.push(`<sub>由收集箱沉淀于 ${new Date().toLocaleString('zh-CN')}</sub>`, '');
  return lines.join('\n');
}

/** 读取当前用户名下的收集项；不存在返回 undefined */
function findRow(id: number): CaptureRow | undefined {
  return db
    .select()
    .from(wbCapture)
    .where(and(eq(wbCapture.id, id), eq(wbCapture.userId, CURRENT_USER)))
    .get();
}

// ===================== 查询 =====================

/**
 * 全部「未处理」条目；默认星标→时间倒序，ascSort 时按创建时间升序（收件箱积压视图用）。
 * filter=today|week|untagged 的过滤在 SQL 层完成，前端只需切 tab。
 */
/**
 * 分页列出「未处理」条目。
 *
 * @param q.ascSort true = 按创建时间升序（收件箱积压视图，先看最老的）；
 *                  false = 星标优先、再按时间倒序（默认收集箱视图）
 * @param q.filter  today / week / untagged 的过滤全部下推到 SQL，前端只切 tab 不做二次过滤
 * @param q         同时接受 page/pageSize 或 limit/offset；缺省时由 resolvePage 兜底上限
 * @returns 当前页的 InboxItemVO 数组（status 已由 toStatusVo 转成小写三态）
 */
export function listUnprocessed(q: ListInboxQuery): InboxItemVO[] {
  const conds: SQL[] = [eq(wbCapture.userId, CURRENT_USER), eq(wbCapture.status, 'INBOX')];
  if (q.filter === 'today') conds.push(gte(wbCapture.createdAt, localDayStartIso(0)));
  else if (q.filter === 'week') conds.push(gte(wbCapture.createdAt, localDayStartIso(6)));
  else if (q.filter === 'untagged') {
    conds.push(sql`(${wbCapture.tags} IS NULL OR TRIM(${wbCapture.tags}) IN ('', '[]'))`);
  }

  const { limit, offset } = resolvePage(q);
  return db
    .select()
    .from(wbCapture)
    .where(and(...conds))
    .orderBy(q.ascSort ? asc(wbCapture.createdAt) : desc(wbCapture.starred), desc(wbCapture.createdAt))
    .limit(limit)
    .offset(offset)
    .all()
    .map(toVo);
}

/**
 * 回收站 / 归档分页查询。
 *
 * @param status 对外小写三态（unprocessed|archived|trashed）；非法值或缺省一律回退 INBOX。
 *               注意这里传入的是**小写 VO 契约**，内部经 toStatusDb 转成 DB 大写枚举，
 *               不可直接把大写值透传进来，否则会绕过双契约映射造成状态错配。
 * @param page   分页参数，可省略；省略时按 DEFAULT_PAGE_SIZE 兜底
 * @returns 当前页的 InboxItemVO 数组，按创建时间倒序
 */
export function listByStatus(status: string | undefined, page?: PageQuery): InboxItemVO[] {
  const dbStatus = toStatusDb(status) ?? 'INBOX';
  const { limit, offset } = resolvePage(page);
  return db
    .select()
    .from(wbCapture)
    .where(and(eq(wbCapture.userId, CURRENT_USER), eq(wbCapture.status, dbStatus)))
    .orderBy(desc(wbCapture.createdAt))
    .limit(limit)
    .offset(offset)
    .all()
    .map(toVo);
}

// ===================== 写入 =====================

/** 新建一条收集项。标题推导：显式 title > 内容首行 > 域名 > 「无标题速记」 */
export function createItem(b: CreateInboxDTO): InboxItemVO {
  const sourceUrl: string = (b.sourceUrl || '').trim();
  const content: string = (b.content ?? '').toString();
  // 类型：显式 type 优先，否则 sourceUrl 有值即 link
  const type: InboxType = INBOX_TYPES.includes(b.type ?? '')
    ? (b.type as InboxType)
    : sourceUrl
      ? 'link'
      : 'text';
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
  return toVo(row);
}

/** 更新：内容 / 标题 / 标签 / 星标 / 状态（小写三态自动映射为 DB 大写）。不存在返回 null */
export function updateItem(id: number, b: UpdateInboxDTO): InboxItemVO | null {
  const ex = findRow(id);
  if (!ex) return null;

  const nextStatus = toStatusDb(b.status) ?? ex.status;
  db.update(wbCapture)
    .set({
      title: b.title !== undefined ? String(b.title).trim() || ex.title : ex.title,
      content: b.content !== undefined ? String(b.content) : ex.content,
      sourceUrl: b.sourceUrl !== undefined ? String(b.sourceUrl).trim() || null : ex.sourceUrl,
      sourceType: INBOX_TYPES.includes(b.type ?? '') ? (b.type as string) : ex.sourceType,
      coverImage: b.coverImage !== undefined ? String(b.coverImage).trim() || null : ex.coverImage,
      tags: b.tags !== undefined ? serializeTags(b.tags) : ex.tags,
      starred: b.starred !== undefined ? (b.starred ? 1 : 0) : ex.starred,
      status: nextStatus,
      updatedAt: nowIso(),
    })
    .where(eq(wbCapture.id, id))
    .run();
  const updated = db.select().from(wbCapture).where(eq(wbCapture.id, id)).get();
  return updated ? toVo(updated) : null;
}

/** 软删除：移入回收站（status=TRASHED），保留数据可恢复。false 表示条目不存在 */
export function trashItem(id: number): boolean {
  const ex = findRow(id);
  if (!ex) return false;
  db.update(wbCapture)
    .set({ status: 'TRASHED', updatedAt: nowIso() })
    .where(eq(wbCapture.id, id))
    .run();
  return true;
}

// ===================== 流转（沉淀） =====================

/**
 * 把收集项「沉淀」到下游：cornell / note / palace / story。
 * 成功后把收集项标记为 ARCHIVED 并记录 processedAt。
 *
 * 各类失败以可辨识联合回报，由 Controller 翻译成 404 / 400 / 409。
 */
export async function processItem(id: number, input: ProcessInput): Promise<ProcessOutcome> {
  const target = input.target;
  const item = findRow(id);
  if (!item) return { kind: 'notFound' };

  const now = nowIso();
  let result: Omit<ProcessResultVO, 'item'>;

  if (target === 'cornell') {
    // 沉淀为康奈尔笔记：内容进 noteColumn，线索/总结留空待用户填。
    const note = insertCornellNote(item, now);
    result = { target: 'cornell', noteId: note.id, title: item.title };
  } else if (target === 'note') {
    // 沉淀为文档库文档：往磁盘 vault 写一个 .md 文件。
    if (!getRootDir()) return { kind: 'vaultNotReady' };

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
    const palaceId = Number(input.palaceId);
    if (!palaceId || Number.isNaN(palaceId)) return { kind: 'palaceIdRequired' };
    const palace = db.select().from(wbPalace).where(eq(wbPalace.id, palaceId)).get();
    if (!palace) return { kind: 'palaceNotFound' };

    const lociId = Number(input.lociId ?? 0) || 0;
    let finalLociId = lociId;
    if (lociId) {
      // 追加到已有位点：把收集内容拼到 knowledgePoint 末尾（保留原内容）
      const exLoci = db.select().from(wbPalaceLoci).where(eq(wbPalaceLoci.id, lociId)).get();
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
        .get();
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
    return { kind: 'invalidTarget' };
  }

  // 标记归档 + 流转时间
  db.update(wbCapture)
    .set({ status: 'ARCHIVED', processedAt: now, updatedAt: now })
    .where(eq(wbCapture.id, id))
    .run();

  const refreshed = db.select().from(wbCapture).where(eq(wbCapture.id, id)).get() as CaptureRow;
  return { kind: 'ok', data: { ...result, item: toVo(refreshed) } };
}

// ===================== 批量处理 =====================

/**
 * 批量归档 / 删除 / 沉淀为康奈尔笔记。
 *
 * 用 inArray 做一条 UPDATE 打包收口（而不是循环发 N 条），沉淀场景则先逐条建笔记
 * （需要各自的标题/正文），再用同一条 inArray 批量改状态。
 *
 * 所有 id 都会先按 userId 过滤一遍，越权 id 静默忽略并在 skipped 里回报，
 * 不因为个别脏 id 让整批失败（前端批量操作最怕「全有或全无」）。
 */
export function batchProcess(ids: number[], target: BatchTarget): BatchResultVO {
  const rows = db
    .select()
    .from(wbCapture)
    .where(and(eq(wbCapture.userId, CURRENT_USER), inArray(wbCapture.id, ids)))
    .all();
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
}
