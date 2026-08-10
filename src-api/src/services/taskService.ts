/* 任务清单（Things 3 模型）业务层
 *
 * 职责边界（与项目三层架构一致）：
 * - routes/tasks.ts              只声明 HTTP 契约（路径 + 方法）；
 * - controllers/taskController.ts 只做 HTTP 层（参数收口 + 错误 → 状态码）；
 * - 本文件是唯一承载业务逻辑的地方（SQL、状态机、树拼装）。
 *
 * 🔴 同步 API 红线：better-sqlite3 是**同步**驱动，
 *    `db.select()...all()` / `.get()` / `.run()` 全部**不加 await**。
 *    加了 await 不报错但会把同步值包成 Promise，类型能过、运行时静默出错。
 *
 * 🔴 性能红线：列表接口最多两条 SQL（父任务一条 + 子任务一条 IN 查询）。
 *    绝不允许「每个父任务再查一次子任务」的 N+1。
 */
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';

import { db, CURRENT_USER, nowIso } from '../db';
import { wbTask } from '../db/schema';
import { resolvePage } from '../lib/pagination';
import type {
  ListTasksQuery,
  TaskCounters,
  TaskCreateInput,
  TaskNode,
  TaskRow,
  TaskStatus,
  TaskToggleResult,
  TaskUpdateInput,
} from '../types/task';

/* ------------------------------------------------------------------ *
 * 常量与小工具
 * ------------------------------------------------------------------ */

/** 合法状态枚举（types/ 层禁运行时值，所以数组落在 Service） */
const VALID_STATUS: TaskStatus[] = ['inbox', 'today', 'upcoming', 'someday', 'logbook', 'completed'];

/** 已归档语义的两个状态：读日志本时要一起捞（历史数据可能是 'completed'） */
const ARCHIVED_STATUS: TaskStatus[] = ['logbook', 'completed'];

const MAX_TITLE = 200;

/** 本机时区 YYYY-MM-DD（绝不用 toISOString 的 UTC 日，会在晚 8 点后整体偏一天） */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 标题清洗：去空白 + 非空 + 长度上限（防一条 10 万字标题撑爆卡片） */
function normalizeTitle(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new Error('任务标题不能为空');
  if (s.length > MAX_TITLE) throw new Error(`任务标题过长（上限 ${MAX_TITLE} 字）`);
  return s;
}

/** 空串一律存 null，避免库里同时存在 '' 和 NULL 两种「没有值」 */
function nullable(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** 日期清洗：只接受 YYYY-MM-DD，非法值直接抛（由 controller 翻 400，不静默落脏数据） */
function normalizeDate(v: unknown): string | null {
  const s = nullable(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('日期格式非法，应为 YYYY-MM-DD');
  return s;
}

function assertStatus(v: unknown): TaskStatus {
  if (typeof v === 'string' && (VALID_STATUS as string[]).includes(v)) return v as TaskStatus;
  throw new Error(`任务状态非法，仅接受：${VALID_STATUS.join(' / ')}`);
}

function toId(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/**
 * 状态回推：给定「什么时候做」，算出这条任务该待在哪个智能列表。
 *
 * 唯一使用场景是**取消勾选**——任务从日志本里被捞回来时，它原来在哪个筐已经
 * 无从得知（我们不存历史状态），只能按日期重新判定。规则与迁移脚本保持一致：
 *   没日期 → inbox；今天或已过期 → today；未来 → upcoming。
 * 这条规则只允许在这里出现一次，前端不得再算一遍，否则两侧必然漂移。
 */
function deriveStatus(targetDate: string | null): TaskStatus {
  if (!targetDate) return 'inbox';
  return targetDate > todayKey() ? 'upcoming' : 'today';
}

/* ------------------------------------------------------------------ *
 * 过期任务上浮
 * ------------------------------------------------------------------ */

/**
 * 把「排在过去、却还没做完」的 upcoming 任务批量挪进 today。
 *
 * 为什么要有这一步：用户上周四排了一件事，周五没开机，周一打开应用——
 * 如果只按 `status = 'today'` 查，这条任务会永远躺在 upcoming 里没人看见，
 * 等于静默丢任务。Things 3 的行为是让它浮到「今天」持续催办，这里对齐。
 *
 * 实现成**一条 UPDATE**（走 idx_wb_task_status + target_date 比较），
 * 而不是查出来再逐条改；每次读列表前调一次，开销可以忽略。
 */
function promoteOverdue(userId: number): void {
  db.update(wbTask)
    .set({ status: 'today', updatedAt: nowIso() })
    .where(
      and(
        eq(wbTask.userId, userId),
        eq(wbTask.status, 'upcoming'),
        eq(wbTask.completed, 0),
        sql`${wbTask.targetDate} IS NOT NULL AND ${wbTask.targetDate} <= ${todayKey()}`,
      ),
    )
    .run();
}

/* ------------------------------------------------------------------ *
 * 查询
 * ------------------------------------------------------------------ */

/**
 * 列表查询：先取父任务（分页在父任务维度生效），再一条 IN 查询把子任务全捞回来。
 *
 * 子任务**不参与状态过滤**：Checklist 项属于父任务，父任务出现在「今天」，
 * 它的子项就该跟着一起显示，哪怕子项自己的 status 还是 inbox。
 */
export function listTasks(query: ListTasksQuery = {}): TaskNode[] {
  const userId = CURRENT_USER;
  promoteOverdue(userId);

  const { limit, offset } = resolvePage(query);
  const conds = [eq(wbTask.userId, userId), isNull(wbTask.parentTaskId)];

  const listId = toId(query.list_id);
  if (listId !== null) conds.push(eq(wbTask.listId, listId));

  const status = typeof query.status === 'string' && query.status ? assertStatus(query.status) : null;
  const includeDone =
    query.include_completed === true || query.include_completed === 1 || query.include_completed === '1';

  if (status === 'today') {
    /* 「今天」是唯一一个**保留当天已完成项**的视图。
     *
     * 勾完就立刻消失看似干净，实际很难受：用户失手点错想撤销时目标已经不见了，
     * 而且「今天做了几件」这个进度条会永远显示 0/N（分子刚加一，分母就减一）。
     * Things 3 的做法是让当天完成的条目留在原位、加删除线，隔天自动沉入日志本，
     * 这里对齐：completed=1 且 target_date 就是今天的，一并捞出来。 */
    conds.push(
      sql`(
        (${wbTask.status} = 'today' and ${wbTask.completed} = 0)
        or (${wbTask.completed} = 1 and ${wbTask.targetDate} = ${todayKey()})
      )`,
    );
  } else if (status) {
    if (ARCHIVED_STATUS.includes(status)) {
      // 日志本：logbook / completed 两种历史写法一起收
      conds.push(inArray(wbTask.status, ARCHIVED_STATUS));
    } else {
      conds.push(eq(wbTask.status, status));
      if (!includeDone) conds.push(eq(wbTask.completed, 0));
    }
  } else if (!includeDone) {
    // 不限状态时（如按清单查看），默认只看未完成
    conds.push(eq(wbTask.completed, 0));
  }

  const keyword = nullable(query.q);
  if (keyword) {
    const kw = `%${keyword}%`;
    const fuzzy = or(like(wbTask.title, kw), like(wbTask.notes, kw));
    if (fuzzy) conds.push(fuzzy);
  }

  /* 排序按视图语义切换：
   * - 计划：按「哪天做」升序，用户要的是时间线；
   * - 日志本：按完成时刻倒序，最近做完的在最上面；
   * - 其余：手工排序位，用户拖成什么样就是什么样。 */
  const order =
    status === 'upcoming'
      ? [asc(wbTask.targetDate), asc(wbTask.sortOrder), asc(wbTask.id)]
      : status && ARCHIVED_STATUS.includes(status)
        ? [desc(wbTask.completedAt), desc(wbTask.id)]
        : [asc(wbTask.sortOrder), asc(wbTask.id)];

  const roots = db
    .select()
    .from(wbTask)
    .where(and(...conds))
    .orderBy(...order)
    .limit(limit)
    .offset(offset)
    .all() as TaskRow[];

  if (roots.length === 0) return [];

  const kids = db
    .select()
    .from(wbTask)
    .where(
      and(
        eq(wbTask.userId, userId),
        inArray(
          wbTask.parentTaskId,
          roots.map((r) => r.id),
        ),
      ),
    )
    .orderBy(asc(wbTask.sortOrder), asc(wbTask.id))
    .all() as TaskRow[];

  // O(n) 分组：先建 id → 节点 索引，再一趟把子任务塞进去，不做嵌套遍历。
  // 每个节点都保证带着 children 数组（叶节点为空），让树类型自洽、前端递归安全。
  const toNode = (row: TaskRow): TaskNode => ({ ...row, children: [] });
  const nodes = new Map<number, TaskNode>();
  const tree = roots.map((r) => {
    const node = toNode(r);
    nodes.set(r.id, node);
    return node;
  });
  kids.forEach((k) => {
    if (k.parentTaskId === null) return;
    nodes.get(k.parentTaskId)?.children.push(toNode(k));
  });

  return tree;
}

export function getTaskById(id: number): TaskRow | null {
  const row = db
    .select()
    .from(wbTask)
    .where(and(eq(wbTask.id, id), eq(wbTask.userId, CURRENT_USER)))
    .get() as TaskRow | undefined;
  return row ?? null;
}

/**
 * 侧边栏五个智能列表的徽标计数。
 *
 * 一条 GROUP BY 搞定，不允许「五个入口各查一次 count」。
 * 已完成项不计入前四个筐（勾掉的事不该继续在徽标上制造焦虑），
 * 日志本则反过来只数已完成的。
 */
export function getCounters(): TaskCounters {
  const userId = CURRENT_USER;
  promoteOverdue(userId);

  const rows = db
    .select({ status: wbTask.status, completed: wbTask.completed, n: sql<number>`count(*)` })
    .from(wbTask)
    .where(and(eq(wbTask.userId, userId), isNull(wbTask.parentTaskId)))
    .groupBy(wbTask.status, wbTask.completed)
    .all() as Array<{ status: string; completed: number; n: number }>;

  const out: TaskCounters = { inbox: 0, today: 0, upcoming: 0, someday: 0, logbook: 0 };
  rows.forEach((r) => {
    const done = Number(r.completed) === 1;
    if (done || ARCHIVED_STATUS.includes(r.status as TaskStatus)) {
      out.logbook += r.n;
      return;
    }
    if (r.status in out) out[r.status as keyof TaskCounters] += r.n;
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * 写入
 * ------------------------------------------------------------------ */

export function createTask(input: TaskCreateInput): TaskRow {
  const now = nowIso();
  const title = normalizeTitle(input.title);
  const targetDate = normalizeDate(input.targetDate);
  const dueDate = normalizeDate(input.dueDate);
  const parentTaskId = toId(input.parentTaskId);

  if (parentTaskId !== null) {
    const parent = getTaskById(parentTaskId);
    if (!parent) throw new Error('父任务不存在');
    // 只做一层：不允许拿一个子任务当爹，否则前端缩进层级会失控
    if (parent.parentTaskId !== null) throw new Error('子任务不支持再嵌套子任务');
  }

  // 未显式指定状态时按日期回推，保证「填了明天」的任务自动进「计划」
  const status = input.status ? assertStatus(input.status) : deriveStatus(targetDate);

  // 新任务默认排在同组最前（Things 3 里新建项出现在顶部），用当前最小值 - 1
  const minRow = db
    .select({ v: sql<number>`coalesce(min(${wbTask.sortOrder}), 0)` })
    .from(wbTask)
    .where(and(eq(wbTask.userId, CURRENT_USER), eq(wbTask.status, status)))
    .get() as { v: number } | undefined;

  const info = db
    .insert(wbTask)
    .values({
      userId: CURRENT_USER,
      title,
      notes: nullable(input.notes),
      status,
      completed: 0,
      listId: toId(input.listId),
      parentTaskId,
      targetDate,
      dueDate,
      completedAt: null,
      tags: nullable(input.tags),
      sortOrder: (minRow?.v ?? 0) - 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const created = getTaskById(Number(info.lastInsertRowid));
  if (!created) throw new Error('任务创建失败');
  return created;
}

export function updateTask(id: number, input: TaskUpdateInput): TaskRow {
  const existing = getTaskById(id);
  if (!existing) throw new Error('任务不存在');

  const patch: Record<string, unknown> = { updatedAt: nowIso() };

  if (input.title !== undefined) patch.title = normalizeTitle(input.title);
  if (input.notes !== undefined) patch.notes = nullable(input.notes);
  if (input.listId !== undefined) patch.listId = toId(input.listId);
  if (input.tags !== undefined) patch.tags = nullable(input.tags);
  if (input.dueDate !== undefined) patch.dueDate = normalizeDate(input.dueDate);
  if (input.sortOrder !== undefined && Number.isFinite(Number(input.sortOrder))) {
    patch.sortOrder = Math.trunc(Number(input.sortOrder));
  }

  if (input.parentTaskId !== undefined) {
    const pid = toId(input.parentTaskId);
    if (pid !== null) {
      if (pid === id) throw new Error('任务不能作为自己的父任务');
      const parent = getTaskById(pid);
      if (!parent) throw new Error('父任务不存在');
      if (parent.parentTaskId !== null) throw new Error('子任务不支持再嵌套子任务');
    }
    patch.parentTaskId = pid;
  }

  /* 改日期时联动状态：把任务从「今天」拖到下周，它就该自己走进「计划」。
   * 但如果调用方同时显式传了 status，以显式值为准（拖拽换筐的场景）。 */
  let nextTarget = existing.targetDate;
  if (input.targetDate !== undefined) {
    nextTarget = normalizeDate(input.targetDate);
    patch.targetDate = nextTarget;
    if (input.status === undefined && existing.completed === 0) {
      patch.status = deriveStatus(nextTarget);
    }
  }
  if (input.status !== undefined) patch.status = assertStatus(input.status);

  // completed 走单独入口更稳妥，但这里也兼容 PUT 直接改
  if (input.completed !== undefined) {
    const done = input.completed === true || Number(input.completed) === 1;
    patch.completed = done ? 1 : 0;
    patch.completedAt = done ? nowIso() : null;
    if (input.status === undefined) patch.status = done ? 'logbook' : deriveStatus(nextTarget);
  }

  db.update(wbTask)
    .set(patch)
    .where(and(eq(wbTask.id, id), eq(wbTask.userId, CURRENT_USER)))
    .run();

  const updated = getTaskById(id);
  if (!updated) throw new Error('任务不存在');
  return updated;
}

/**
 * 勾选 / 取消勾选。
 *
 * 服务端**读现值再翻面**，而不是让前端传目标值：两个窗口同时点同一条任务时，
 * 传目标值会互相覆盖，读现值翻面则天然收敛。
 *
 * 完成父任务会连带完成它的子任务——Things 3 的语义是「这件事整体做完了」，
 * 留几个孤儿子项挂在已完成的父任务下面既没意义也会污染计数。
 */
export function toggleComplete(id: number, force?: boolean): TaskToggleResult {
  const existing = getTaskById(id);
  if (!existing) throw new Error('任务不存在');

  const done = force === undefined ? existing.completed === 0 : force;
  const now = nowIso();
  const status: TaskStatus = done ? 'logbook' : deriveStatus(existing.targetDate);
  const completedAt = done ? now : null;

  // 事务回调必须同步（写成 async 会在首个 await 处提前提交，父子状态可能对不上）
  db.transaction((tx) => {
    tx.update(wbTask)
      .set({ completed: done ? 1 : 0, status, completedAt, updatedAt: now })
      .where(and(eq(wbTask.id, id), eq(wbTask.userId, CURRENT_USER)))
      .run();

    if (existing.parentTaskId === null) {
      tx.update(wbTask)
        .set({ completed: done ? 1 : 0, completedAt, updatedAt: now })
        .where(and(eq(wbTask.parentTaskId, id), eq(wbTask.userId, CURRENT_USER)))
        .run();
    }
  });

  return { id, completed: done ? 1 : 0, status, completedAt, updatedAt: now };
}

/** 删除任务；父任务连同其子任务一并物理删除（逻辑外键由应用层维护） */
export function deleteTask(id: number): void {
  const existing = getTaskById(id);
  if (!existing) throw new Error('任务不存在');

  db.transaction((tx) => {
    tx.delete(wbTask)
      .where(and(eq(wbTask.parentTaskId, id), eq(wbTask.userId, CURRENT_USER)))
      .run();
    tx.delete(wbTask)
      .where(and(eq(wbTask.id, id), eq(wbTask.userId, CURRENT_USER)))
      .run();
  });
}

/** 清空日志本（已完成归档项），返回删除条数 */
export function clearLogbook(): number {
  const info = db
    .delete(wbTask)
    .where(and(eq(wbTask.userId, CURRENT_USER), eq(wbTask.completed, 1)))
    .run();
  return Number(info.changes ?? 0);
}
