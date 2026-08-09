/* 四象限（艾森豪威尔矩阵）业务层
 *
 * 职责边界（与项目三层架构一致）：
 * - routes/quadrant.ts          只声明 HTTP 契约（路径 + 方法）；
 * - controllers/quadrantController.ts  只做 HTTP 层（参数收口 + 错误 → 状态码）；
 * - 本文件是唯一承载业务逻辑的地方（SQL、枚举校验、分组）。
 *
 * 🔴 性能红线：列表接口**只发一条 SQL**。
 * 绝不允许「四个象限各查一次」，更不允许把全量丢给前端让它 filter 四遍。
 * 做法是一次捞回本用户的任务，在内存里做一趟 O(n) 分桶——见 groupTasks()。
 */
import { and, asc, desc, eq } from 'drizzle-orm';

import { db, CURRENT_USER, nowIso } from '../db';
import { wbQuadrantTask } from '../db/schema';
import { resolvePage } from '../lib/pagination';
import type { PageQuery } from '../types/pagination';
import type {
  QuadrantGrouped,
  QuadrantKey,
  QuadrantTaskCreateInput,
  QuadrantTaskRow,
  QuadrantTaskUpdateInput,
  QuadrantToggleResult,
} from '../types/quadrant';

/**
 * 象限枚举值 → 响应分组键 的唯一映射表。
 *
 * 库里存连字符（业务枚举），响应用下划线（JSON 字段名）。这层转换只允许在这里
 * 出现一次：任何 controller / route / 前端再手写一遍，都会在加第五象限时漏改。
 */
const QUADRANT_KEYS: Record<QuadrantKey, keyof QuadrantGrouped> = {
  'urgent-important': 'urgent_important',
  'not-urgent-important': 'not_urgent_important',
  'urgent-not-important': 'urgent_not_important',
  'not-urgent-not-important': 'not_urgent_not_important',
};

const VALID_QUADRANTS = Object.keys(QUADRANT_KEYS) as QuadrantKey[];

const DEFAULT_QUADRANT: QuadrantKey = 'urgent-important';

/** 空的四桶骨架。即使某象限一条数据都没有，响应里也必须有这个键（前端不做兜底判空）。 */
function emptyGroups(): QuadrantGrouped {
  return {
    urgent_important: [],
    not_urgent_important: [],
    urgent_not_important: [],
    not_urgent_not_important: [],
  };
}

/** 象限值校验：非法值直接抛，由 controller 翻成 400，绝不静默落库成脏枚举 */
function assertQuadrant(v: unknown): QuadrantKey {
  if (typeof v === 'string' && (VALID_QUADRANTS as string[]).includes(v)) {
    return v as QuadrantKey;
  }
  throw new Error(`象限取值非法，仅接受：${VALID_QUADRANTS.join(' / ')}`);
}

/** 标题清洗：去空白 + 非空校验 + 长度上限（防止一条 10 万字的标题撑爆卡片） */
function normalizeTitle(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new Error('任务标题不能为空');
  if (s.length > 200) throw new Error('任务标题过长（上限 200 字）');
  return s;
}

/** 空串一律存 null，避免库里同时存在 '' 和 NULL 两种「没有值」 */
function nullable(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/* ------------------------------------------------------------------ */
/* 读                                                                  */
/* ------------------------------------------------------------------ */

export function getTaskById(id: number): QuadrantTaskRow | undefined {
  return db.select().from(wbQuadrantTask).where(eq(wbQuadrantTask.id, id)).get() as
    | QuadrantTaskRow
    | undefined;
}

/**
 * 列出本用户全部任务，**在服务端按象限分好组**返回。
 *
 * 排序口径（一次 ORDER BY 定死，前端不再排）：
 * 1) completed ASC —— 未完成永远浮在上面，已完成沉到折叠区；
 * 2) sortOrder ASC —— 手工拖拽位（暂未开放批量重排，预留）；
 * 3) createdAt DESC —— 同层级下新建的在前，符合「刚记的事最先看到」的直觉。
 *
 * limit 走全站统一的 resolvePage：即便调用方什么都不传，也有 200 条安全网，
 * 不会出现无上限全表扫描把 better-sqlite3 的同步查询卡死主线程。
 */
export function getGroupedTasks(q?: PageQuery): QuadrantGrouped {
  const { limit, offset } = resolvePage(q);

  const rows = db
    .select()
    .from(wbQuadrantTask)
    .where(eq(wbQuadrantTask.userId, CURRENT_USER))
    .orderBy(asc(wbQuadrantTask.completed), asc(wbQuadrantTask.sortOrder), desc(wbQuadrantTask.createdAt))
    .limit(limit)
    .offset(offset)
    .all() as QuadrantTaskRow[];

  return groupTasks(rows);
}

/** 单趟 O(n) 分桶。枚举脏值（历史数据 / 手改库）统一归到第一象限，不丢数据。 */
function groupTasks(rows: QuadrantTaskRow[]): QuadrantGrouped {
  const out = emptyGroups();
  for (const row of rows) {
    const key = QUADRANT_KEYS[row.quadrant] ?? QUADRANT_KEYS[DEFAULT_QUADRANT];
    out[key].push(row);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 写                                                                  */
/* ------------------------------------------------------------------ */

/** 新建任务。completed 恒为 0——「刚建就已完成」没有业务含义，不开放该入参。 */
export function createTask(input: QuadrantTaskCreateInput): QuadrantTaskRow {
  const title = normalizeTitle(input.title);
  const quadrant = input.quadrant === undefined ? DEFAULT_QUADRANT : assertQuadrant(input.quadrant);
  const now = nowIso();

  const res = db
    .insert(wbQuadrantTask)
    .values({
      userId: CURRENT_USER,
      title,
      description: nullable(input.description),
      quadrant,
      completed: 0,
      scheduledAt: nullable(input.scheduledAt),
      tags: nullable(input.tags),
      source: nullable(input.source) ?? 'manual',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const created = getTaskById(Number(res.lastInsertRowid));
  if (!created) throw new Error('任务创建失败');
  return created;
}

/** 局部更新。只有显式出现在 body 里的字段才会被写，避免「没传等于清空」。 */
export function updateTask(id: number, input: QuadrantTaskUpdateInput): QuadrantTaskRow {
  const existing = getTaskById(id);
  if (!existing) throw new Error('任务不存在');

  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  if (input.title !== undefined) patch.title = normalizeTitle(input.title);
  if (input.quadrant !== undefined) patch.quadrant = assertQuadrant(input.quadrant);
  if (input.description !== undefined) patch.description = nullable(input.description);
  if (input.scheduledAt !== undefined) patch.scheduledAt = nullable(input.scheduledAt);
  if (input.tags !== undefined) patch.tags = nullable(input.tags);
  if (input.sortOrder !== undefined) patch.sortOrder = Number(input.sortOrder) || 0;
  // 布尔与 0/1 都接受：前端可能直接把 checkbox 的 boolean 丢过来
  if (input.completed !== undefined) patch.completed = input.completed ? 1 : 0;

  db.update(wbQuadrantTask).set(patch).where(eq(wbQuadrantTask.id, id)).run();

  const updated = getTaskById(id);
  if (!updated) throw new Error('任务更新失败');
  return updated;
}

/**
 * 切换完成状态。
 *
 * 刻意做成「服务端读现值再翻面」而不是「前端传目标值」：勾选框是高频操作，
 * 两次点击可能并发到达，由服务端以库里当前值为准翻转，结果始终自洽。
 */
export function toggleTask(id: number): QuadrantToggleResult {
  const existing = getTaskById(id);
  if (!existing) throw new Error('任务不存在');

  const next = existing.completed ? 0 : 1;
  const now = nowIso();
  db.update(wbQuadrantTask)
    .set({ completed: next, updatedAt: now })
    .where(eq(wbQuadrantTask.id, id))
    .run();

  return { id, completed: next, updatedAt: now };
}

/** 物理删除。四象限任务是轻量条目，删了就是删了，不做逻辑删除墓碑。 */
export function deleteTask(id: number): { ok: true } {
  const existing = getTaskById(id);
  if (!existing) throw new Error('任务不存在');
  db.delete(wbQuadrantTask).where(eq(wbQuadrantTask.id, id)).run();
  return { ok: true };
}

/** 清空某象限的已完成项（卡片头部「...」菜单用），返回清掉的条数 */
export function clearCompleted(quadrant: unknown): { removed: number } {
  const q = assertQuadrant(quadrant);
  const res = db
    .delete(wbQuadrantTask)
    .where(
      and(
        eq(wbQuadrantTask.userId, CURRENT_USER),
        eq(wbQuadrantTask.quadrant, q),
        eq(wbQuadrantTask.completed, 1),
      ),
    )
    .run();
  return { removed: Number(res.changes ?? 0) };
}
