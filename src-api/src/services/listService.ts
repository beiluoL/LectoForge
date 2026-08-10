/* 任务清单容器（清单 / 项目 / 领域）业务层
 *
 * 与 taskService 的分工：本文件只管**容器**（侧边栏里那些可折叠的条目），
 * 任务本身归 taskService。两者刻意分开，因为清单的增删改频率极低、
 * 而任务是高频写入，混在一个 Service 里会让缓存与事务边界互相牵连。
 *
 * 🔴 同步 API 红线：better-sqlite3 全同步，`.all()` / `.get()` / `.run()` 一律不加 await。
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { db, CURRENT_USER, nowIso } from '../db';
import { wbTask, wbTaskList } from '../db/schema';
import { resolvePage } from '../lib/pagination';
import type { PageQuery } from '../types/pagination';
import type { TaskListCreateInput, TaskListRow, TaskListType, TaskListUpdateInput, TaskListVO } from '../types/task';

const VALID_TYPES: TaskListType[] = ['area', 'project', 'list'];

const MAX_NAME = 80;

function normalizeName(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new Error('清单名称不能为空');
  if (s.length > MAX_NAME) throw new Error(`清单名称过长（上限 ${MAX_NAME} 字）`);
  return s;
}

function assertType(v: unknown): TaskListType {
  if (typeof v === 'string' && (VALID_TYPES as string[]).includes(v)) return v as TaskListType;
  throw new Error(`清单类型非法，仅接受：${VALID_TYPES.join(' / ')}`);
}

function toId(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/**
 * 侧边栏清单树（含任务计数）。
 *
 * 两条 SQL：清单表一条 + 任务计数一条 GROUP BY。
 * 绝不允许「每个清单再 count 一次」——侧边栏有 20 个清单就是 21 条 SQL，
 * 而这个接口每次切页面都会被调。
 */
export function listLists(query: PageQuery = {}): TaskListVO[] {
  const { limit, offset } = resolvePage(query);

  const rows = db
    .select()
    .from(wbTaskList)
    .where(eq(wbTaskList.userId, CURRENT_USER))
    .orderBy(asc(wbTaskList.sortOrder), asc(wbTaskList.id))
    .limit(limit)
    .offset(offset)
    .all() as TaskListRow[];

  if (rows.length === 0) return [];

  const stats = db
    .select({
      listId: wbTask.listId,
      total: sql<number>`count(*)`,
      open: sql<number>`sum(case when ${wbTask.completed} = 0 then 1 else 0 end)`,
    })
    .from(wbTask)
    .where(and(eq(wbTask.userId, CURRENT_USER), isNull(wbTask.parentTaskId)))
    .groupBy(wbTask.listId)
    .all() as Array<{ listId: number | null; total: number; open: number }>;

  const statOf = new Map<number, { total: number; open: number }>();
  stats.forEach((s) => {
    if (s.listId !== null) statOf.set(s.listId, { total: Number(s.total) || 0, open: Number(s.open) || 0 });
  });

  // 先全部转成 VO 并建索引，再一趟把子清单挂到父节点，O(n) 不做嵌套遍历
  const nodes = new Map<number, TaskListVO>();
  rows.forEach((r) => {
    const st = statOf.get(r.id);
    nodes.set(r.id, { ...r, openCount: st?.open ?? 0, totalCount: st?.total ?? 0, children: [] });
  });

  const roots: TaskListVO[] = [];
  nodes.forEach((node) => {
    const parent = node.parentId !== null ? nodes.get(node.parentId) : undefined;
    // 父清单被分页截断时降级为顶层，宁可平铺也不能整棵子树凭空消失
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  });

  return roots;
}

export function getListById(id: number): TaskListRow | null {
  const row = db
    .select()
    .from(wbTaskList)
    .where(and(eq(wbTaskList.id, id), eq(wbTaskList.userId, CURRENT_USER)))
    .get() as TaskListRow | undefined;
  return row ?? null;
}

export function createList(input: TaskListCreateInput): TaskListRow {
  const now = nowIso();
  const name = normalizeName(input.name);
  const type = input.type ? assertType(input.type) : 'list';
  const parentId = toId(input.parentId);

  if (parentId !== null) {
    const parent = getListById(parentId);
    if (!parent) throw new Error('父清单不存在');
    // 只有「领域」能装东西：允许 project 下挂 list 会让侧边栏层级无限深
    if (parent.type !== 'area') throw new Error('只有「领域」类型的清单可以包含子清单');
  }

  const maxRow = db
    .select({ v: sql<number>`coalesce(max(${wbTaskList.sortOrder}), -1)` })
    .from(wbTaskList)
    .where(eq(wbTaskList.userId, CURRENT_USER))
    .get() as { v: number } | undefined;

  const info = db
    .insert(wbTaskList)
    .values({
      userId: CURRENT_USER,
      name,
      type,
      parentId,
      iconName: (typeof input.iconName === 'string' && input.iconName.trim()) || 'list',
      color: (typeof input.color === 'string' && input.color.trim()) || '#3B6FE0',
      sortOrder: (maxRow?.v ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const created = getListById(Number(info.lastInsertRowid));
  if (!created) throw new Error('清单创建失败');
  return created;
}

export function updateList(id: number, input: TaskListUpdateInput): TaskListRow {
  const existing = getListById(id);
  if (!existing) throw new Error('清单不存在');

  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  if (input.name !== undefined) patch.name = normalizeName(input.name);
  if (input.type !== undefined) patch.type = assertType(input.type);
  if (input.iconName !== undefined) patch.iconName = String(input.iconName).trim() || 'list';
  if (input.color !== undefined) patch.color = String(input.color).trim() || '#3B6FE0';
  if (input.sortOrder !== undefined && Number.isFinite(Number(input.sortOrder))) {
    patch.sortOrder = Math.trunc(Number(input.sortOrder));
  }
  if (input.parentId !== undefined) {
    const pid = toId(input.parentId);
    if (pid !== null) {
      if (pid === id) throw new Error('清单不能作为自己的父级');
      const parent = getListById(pid);
      if (!parent) throw new Error('父清单不存在');
      if (parent.type !== 'area') throw new Error('只有「领域」类型的清单可以包含子清单');
    }
    patch.parentId = pid;
  }

  db.update(wbTaskList)
    .set(patch)
    .where(and(eq(wbTaskList.id, id), eq(wbTaskList.userId, CURRENT_USER)))
    .run();

  const updated = getListById(id);
  if (!updated) throw new Error('清单不存在');
  return updated;
}

/**
 * 删除清单。
 *
 * 清单里的任务**不跟着删**，只是把 list_id 置空回落到收件箱——
 * 删一个容器就连带蒸发几十条待办，是不可接受的数据损失；
 * 子清单同理，提升为顶层而不是级联删除。
 */
export function deleteList(id: number): void {
  const existing = getListById(id);
  if (!existing) throw new Error('清单不存在');

  const now = nowIso();
  db.transaction((tx) => {
    tx.update(wbTask)
      .set({ listId: null, updatedAt: now })
      .where(and(eq(wbTask.listId, id), eq(wbTask.userId, CURRENT_USER)))
      .run();
    tx.update(wbTaskList)
      .set({ parentId: null, updatedAt: now })
      .where(and(eq(wbTaskList.parentId, id), eq(wbTaskList.userId, CURRENT_USER)))
      .run();
    tx.delete(wbTaskList)
      .where(and(eq(wbTaskList.id, id), eq(wbTaskList.userId, CURRENT_USER)))
      .run();
  });
}
