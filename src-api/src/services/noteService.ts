import { and, desc, eq, inArray, like, lte, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { CURRENT_USER, db, nowIso, sqlite } from '../db';
import { wbCapture, wbNote } from '../db/schema';
import { NOTES_PAGE_SIZE, resolvePage } from '../lib/pagination';
import type {
  BacklinkVO,
  CreateNoteDTO,
  ListNoteQuery,
  NoteStatsVO,
  NoteVO,
  ResolveNoteVO,
  TagCountVO,
  UpdateNoteDTO,
} from '../types/note';

type NoteRow = typeof wbNote.$inferSelect;

/* =====================================================================
 * 标签聚合：全部在 SQL 内完成，绝不把整表捞进 Node 再 split
 * =====================================================================
 *
 * wb_note.tags 有两种历史格式并存（见前端 store 的 parseTags 注释）：
 *   - JSON 数组字符串：["灵感","分布式"]   ← 收集箱「一键沉淀」写入
 *   - 逗号分隔：       灵感,分布式          ← 笔记编辑页写入
 * 所以聚合要两条支路各自展开再 UNION：
 *   - JSON 支路：json_each() 展开数组元素（SQLite 内置 JSON1，已在本机 3.49.2 验证可用）；
 *   - CSV  支路：递归 CTE 用 instr/substr 逐段切分。
 * 两支都在数据库里 GROUP BY 出结果，几千条笔记也只回传标签维度的几十行，
 * 不会像「Node 内存里手动 split 统计」那样把全表正文都拉进进程。
 *
 * 复用方式：这段 CTE 既供标签云做计数，也供「按标签筛笔记」反查 id，
 * 保证「标签云上显示的数量」与「点进去筛出的条数」永远一致。
 */
const TAG_CTE = `
WITH RECURSIVE
  csv_src(id, rest) AS (
    SELECT id, tags || ',' FROM wb_note
    WHERE user_id = @uid AND tags IS NOT NULL AND trim(tags) <> '' AND substr(trim(tags), 1, 1) <> '['
  ),
  csv_split(id, tag, rest) AS (
    SELECT id, '', rest FROM csv_src
    UNION ALL
    SELECT id, substr(rest, 1, instr(rest, ',') - 1), substr(rest, instr(rest, ',') + 1)
    FROM csv_split WHERE rest <> ''
  ),
  csv_tags(id, name) AS (SELECT id, trim(tag) FROM csv_split WHERE trim(tag) <> ''),
  json_src(id, tags) AS (
    SELECT id, tags FROM wb_note
    WHERE user_id = @uid AND tags IS NOT NULL AND substr(trim(tags), 1, 1) = '[' AND json_valid(tags)
  ),
  json_tags(id, name) AS (
    SELECT j.id, trim(je.value) FROM json_src j, json_each(j.tags) je WHERE trim(je.value) <> ''
  ),
  all_tags(id, name) AS (SELECT id, name FROM csv_tags UNION ALL SELECT id, name FROM json_tags)
`;

/** 标签云：[{ name, count }]，按热度倒序 */
const SQL_TAG_COUNTS = `${TAG_CTE}
SELECT name, COUNT(DISTINCT id) AS count FROM all_tags
GROUP BY name ORDER BY count DESC, name ASC;`;

/** 精确命中某标签的笔记 id（整段相等比较，"AI" 不会误命中 "AIGC"） */
const SQL_IDS_BY_TAG = `${TAG_CTE}
SELECT DISTINCT id FROM all_tags WHERE name = @tag;`;

/** LIKE 通配符转义：标题里出现 % 或 _ 时不能被当成通配符，统一走 ESCAPE '\' */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** 去标签 + 压缩空白：正文可能是 contenteditable 产出的富文本 */
function toPlain(s?: string | null): string {
  return (s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 截取双链命中处前后各 60 字作为摘要，让用户一眼看出「在哪被引用」 */
function buildExcerpt(text: string, title: string): string {
  const plain = toPlain(text);
  const idx = plain.indexOf(`[[${title}`);
  if (idx === -1) return plain.slice(0, 140);
  const start = Math.max(0, idx - 60);
  const end = Math.min(plain.length, idx + title.length + 80);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
}

function toVO(r: NoteRow): NoteVO {
  return {
    id: r.id,
    userId: r.userId,
    captureId: r.captureId,
    categoryId: r.categoryId,
    title: r.title,
    cueColumn: r.cueColumn,
    noteColumn: r.noteColumn,
    summaryColumn: r.summaryColumn,
    tags: r.tags,
    mastery: r.mastery,
    // SRS 排程字段：列表页据此渲染「需复习」徽章与下次复习时间，
    // 与 /api/reviews/*（新复习系统）读写同一批列，保持单一事实源。
    dueDate: r.dueDate,
    easeFactor: r.easeFactor,
    repetitions: r.repetitions,
    intervalDay: r.intervalDay,
    lapseCount: r.lapseCount,
    reviewCount: r.reviewCount,
    lastReviewedAt: r.lastReviewedAt,
    createTime: r.createdAt,
    updateTime: r.updatedAt,
  };
}

/** 整理笔记时把来源收集箱流转为「已整理」(PROCESSED)。 */
function markCaptureProcessed(captureId: number): void {
  const c = db.select().from(wbCapture).where(eq(wbCapture.id, captureId)).get();
  if (c && c.status !== 'ARCHIVED') {
    db.update(wbCapture).set({ status: 'PROCESSED', updatedAt: nowIso() }).where(eq(wbCapture.id, captureId)).run();
  }
}

/**
 * 拼装笔记检索的 WHERE 条件集合（分页以外的全部筛选）。
 *
 * 抽成独立函数、而不是在 listNotes 里就地写，是因为「列表」和「头部统计」
 * 必须共用同一套条件：一旦两处各拼一份，迟早会漂移成
 * 「顶上写着共 500 则、列表却只筛出 3 条」这种自相矛盾的界面。
 * 现在任何筛选条件的增改都只有这一个落点。
 *
 * @returns 条件数组；返回 `null` 表示标签命中空集，调用方应直接短路成空结果
 */
function buildNoteConds(q: ListNoteQuery): SQL[] | null {
  const conds: SQL[] = [eq(wbNote.userId, CURRENT_USER)];
  if (q.captureId !== undefined) conds.push(eq(wbNote.captureId, q.captureId));
  if (q.categoryId !== undefined) conds.push(eq(wbNote.categoryId, q.categoryId));
  // 关键词跨「标题 + 康奈尔三栏」检索：wb_note 没有单一 content 列，
  // 正文散在 cue/note/summary 三列，只搜标题会让用户以为笔记丢了。
  if (q.keyword) {
    const kw = `%${q.keyword}%`;
    conds.push(
      or(
        like(wbNote.title, kw),
        like(wbNote.cueColumn, kw),
        like(wbNote.noteColumn, kw),
        like(wbNote.summaryColumn, kw),
      ) as SQL,
    );
  }

  // —— 标签云联动：先用 CTE 在 SQL 里精确反查 id 集合，再交给主查询过滤 ——
  const tag = (q.tag ?? '').trim();
  if (tag) {
    const ids = (sqlite.prepare(SQL_IDS_BY_TAG).all({ uid: CURRENT_USER, tag }) as { id: number }[]).map((r) => r.id);
    // 空集合直接短路：inArray([]) 在部分驱动下会生成非法 SQL
    if (!ids.length) return null;
    conds.push(inArray(wbNote.id, ids));
  }

  // —— 智慧筛选器 ——
  // masteryLte：找出「掌握度还很低、该重点攻克」的笔记
  if (q.masteryLte !== undefined) conds.push(lte(wbNote.mastery, q.masteryLte));
  // hasSummary=false：总结栏为空 = 康奈尔笔记没闭环，属于「半成品」待补
  if (q.hasSummary !== undefined) {
    conds.push(
      q.hasSummary
        ? sql`trim(${wbNote.summaryColumn}) <> ''`
        : sql`trim(coalesce(${wbNote.summaryColumn}, '')) = ''`,
    );
  }
  return conds;
}

/**
 * 分页检索康奈尔笔记。
 *
 * wb_note 是本应用增长最快的业务表，且行内含 cue/note/summary 三段长文本，
 * 全量返回时序列化开销远大于普通表——这是必须分页的首要理由。
 *
 * 默认页大小取 NOTES_PAGE_SIZE（30）而非全局 DEFAULT_PAGE_SIZE（200）：
 * 列表页已改成滚动加载，能自行按需翻页，不再需要「一次拿全量」的兜底。
 *
 * @param q 过滤条件（captureId/categoryId/keyword/tag/masteryLte/hasSummary）+ 分页参数
 * @returns 当前页笔记 VO 数组，按 updatedAt 倒序；tag 命中空集时直接返回 []
 */
export function listNotes(q: ListNoteQuery): NoteVO[] {
  const conds = buildNoteConds(q);
  if (!conds) return [];

  const { limit, offset } = resolvePage(q, NOTES_PAGE_SIZE);
  const rows = db
    .select()
    .from(wbNote)
    .where(and(...conds))
    .orderBy(desc(wbNote.updatedAt))
    .limit(limit)
    .offset(offset)
    .all();
  return rows.map(toVO);
}

/**
 * 笔记列表页头部统计（总数 / 待复习 / 待首复习 / 平均掌握度）。
 *
 * 与 listNotes 共用 buildNoteConds，但**不分页**——统计的语义就是
 * 「当前筛选条件下的全量口径」，随滚动变化的数字是错的。
 *
 * 全部用 SQL 聚合算，一行结果回传，比过去「拉全表进 Node 再 reduce」
 * 既准确又便宜（不再把 cue/note/summary 三段长文本读进内存）。
 *
 * 到期判定与前端 getNoteSrsState 严格对齐：
 * - unreviewed：reviewCount = 0（从未复习，属「首学」不打红标）
 * - due       ：reviewCount > 0 且 dueDate <= 今天 23:59:59
 * dueDate 全链路由 `toISOString()` 写入，格式恒定，所以字典序比较即时序比较。
 */
export function getNoteStats(q: ListNoteQuery): NoteStatsVO {
  const conds = buildNoteConds(q);
  if (!conds) return { total: 0, due: 0, unreviewed: 0, avgMastery: 0 };

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const eod = endOfToday.toISOString();

  // sum(...) 在空结果集上返回 NULL，一律 coalesce 兜 0，避免 VO 出现 null
  const row = db
    .select({
      total: sql<number>`count(*)`,
      due: sql<number>`coalesce(sum(case when ${wbNote.reviewCount} > 0 and ${wbNote.dueDate} <= ${eod} then 1 else 0 end), 0)`,
      unreviewed: sql<number>`coalesce(sum(case when coalesce(${wbNote.reviewCount}, 0) = 0 then 1 else 0 end), 0)`,
      avgMastery: sql<number>`coalesce(avg(${wbNote.mastery}), 0)`,
    })
    .from(wbNote)
    .where(and(...conds))
    .get();

  return {
    total: Number(row?.total ?? 0),
    due: Number(row?.due ?? 0),
    unreviewed: Number(row?.unreviewed ?? 0),
    avgMastery: Math.round(Number(row?.avgMastery ?? 0)),
  };
}

/** 标签聚合（标签云数据源）。 */
export function listTagCounts(): TagCountVO[] {
  return sqlite.prepare(SQL_TAG_COUNTS).all({ uid: CURRENT_USER }) as TagCountVO[];
}

export function findNote(id: number): NoteVO | null {
  const row = db.select().from(wbNote).where(eq(wbNote.id, id)).get();
  return row ? toVO(row) : null;
}

/**
 * 反向引用（Backlinks）：谁引用了我。
 *
 * 在其它笔记的三栏正文里搜 [[本笔记标题]]，三种写法都要命中：
 *   [[标题]] / [[标题|别名]] / [[标题#小节]]
 * LIKE 没有 alternation，所以拆成三个模式 OR；标题里的 % 与 _ 先转义，
 * 再用 ESCAPE '\' 声明转义符，避免标题含通配符时把全表都匹配出来。
 *
 * @returns null 表示笔记本身不存在（由 Controller 转 404）
 */
export function listBacklinks(id: number): BacklinkVO[] | null {
  const self = db.select().from(wbNote).where(eq(wbNote.id, id)).get();
  if (!self) return null;

  const title = String(self.title || '').trim();
  if (!title) return [];

  const esc = escapeLike(title);
  const patterns = [`%[[${esc}]]%`, `%[[${esc}|%`, `%[[${esc}#%`];
  const colMatches = (col: AnyColumn) => patterns.map((p) => sql`${col} LIKE ${p} ESCAPE '\\'`);

  const rows = db
    .select()
    .from(wbNote)
    .where(
      and(
        eq(wbNote.userId, CURRENT_USER),
        sql`${wbNote.id} <> ${id}`, // 自引用不算反向引用
        or(...colMatches(wbNote.noteColumn), ...colMatches(wbNote.cueColumn), ...colMatches(wbNote.summaryColumn)),
      ),
    )
    .orderBy(desc(wbNote.updatedAt))
    .all();

  return rows.map((r) => {
    // 摘要优先取真正出现双链的那一栏，否则用户看不出引用上下文
    const hit = [r.noteColumn, r.cueColumn, r.summaryColumn].find((c) => (c || '').includes(`[[${title}`));
    return { id: r.id, title: r.title, excerpt: buildExcerpt(hit || r.noteColumn, title) };
  });
}

/**
 * 双链解析：[[标题]] → 笔记 id。
 *
 * 为什么不复用列表的 keyword：keyword 是三栏模糊搜索，
 * 「Vue」会同时命中正文里提到 Vue 的一堆笔记，点一下双链跳错地方比不跳更糟。
 * 这里走标题精确匹配（大小写不敏感），命中不了就返回 exists:false，
 * 前端据此把该双链渲染成「未创建」样式并提供「新建同名笔记」入口。
 */
export function resolveNoteByTitle(raw: string): ResolveNoteVO {
  // 兼容 [[标题|别名]] 与 [[标题#小节]]：锚点与别名不参与匹配
  const title = raw.split('|')[0].split('#')[0].trim();
  if (!title) return { exists: false, id: null, title: '' };
  const row = db
    .select({ id: wbNote.id, title: wbNote.title })
    .from(wbNote)
    .where(and(eq(wbNote.userId, CURRENT_USER), sql`lower(trim(${wbNote.title})) = lower(${title})`))
    .orderBy(desc(wbNote.updatedAt))
    .get();
  return row ? { exists: true, id: row.id, title: row.title } : { exists: false, id: null, title };
}

/** @returns 新建笔记的自增 id */
export function createNote(b: CreateNoteDTO): number {
  const now = nowIso();
  const row = db
    .insert(wbNote)
    .values({
      userId: CURRENT_USER,
      captureId: b.captureId ?? null,
      categoryId: b.categoryId ?? null,
      title: b.title,
      cueColumn: b.cueColumn ?? '',
      noteColumn: b.noteColumn ?? '',
      summaryColumn: b.summaryColumn ?? '',
      tags: b.tags ?? null,
      mastery: b.mastery ?? 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  if (b.captureId != null) markCaptureProcessed(Number(b.captureId));
  return row.id;
}

/** @returns null 表示笔记不存在（由 Controller 转 404） */
export function updateNote(id: number, b: UpdateNoteDTO): NoteVO | null {
  const ex = db.select().from(wbNote).where(eq(wbNote.id, id)).get();
  if (!ex) return null;
  db.update(wbNote)
    .set({
      captureId: b.captureId !== undefined ? b.captureId : ex.captureId,
      categoryId: b.categoryId !== undefined ? b.categoryId : ex.categoryId,
      title: b.title ?? ex.title,
      cueColumn: b.cueColumn ?? ex.cueColumn,
      noteColumn: b.noteColumn ?? ex.noteColumn,
      summaryColumn: b.summaryColumn ?? ex.summaryColumn,
      tags: b.tags !== undefined ? b.tags : ex.tags,
      mastery: b.mastery !== undefined ? b.mastery : ex.mastery,
      updatedAt: nowIso(),
    })
    .where(eq(wbNote.id, id))
    .run();
  if (b.captureId != null) markCaptureProcessed(Number(b.captureId));
  return toVO(db.select().from(wbNote).where(eq(wbNote.id, id)).get() as NoteRow);
}

export function deleteNote(id: number): void {
  db.delete(wbNote).where(eq(wbNote.id, id)).run();
}
