/* 日程计划业务层
 *
 * 职责边界（与 routes/schedule.ts、controllers/scheduleController.ts 严格分层）：
 * - 模板 CRUD（wb_task_template）
 * - 当日任务 CRUD（wb_daily_task）
 * - 重复规则推算（shouldGenerateToday）：按模板 created_at 作为锚点，实时判断某日期是否应出现该重复任务
 *
 * 时区口径（与 wb_pomodoro_log 一致）：库里日期一律以本机时区 YYYY-MM-DD 字符串存储，
 * 所有日期运算在 Node 层用本地年月日做，绝不调用 toISOString（那是 UTC 日，会跨时区错位）。
 *
 * ⚠️ 红线：better-sqlite3 是同步 API，本文件所有 db.* 调用均**禁止 async/await**，
 * 事务也用 db.transaction（better-sqlite3 同步回调），与 pomodoroService 同口径。
 */
import { and, asc, eq } from 'drizzle-orm';

import { db, CURRENT_USER, nowIso } from '../db';
import { wbDailyTask, wbTaskTemplate } from '../db/schema';
import type {
  DailyTaskVO,
  GenerateResult,
  RepeatRule,
  TaskTemplateVO,
  TemplateTask,
  UpdateDailyTaskDTO,
} from '../types/schedule';

/* ===========================================================================
 * 日期工具（本机时区，零 TZ 依赖）
 * ======================================================================== */

/** 本机时区下的 YYYY-MM-DD（图表/任务分桶键；绝不用 toISOString） */
export function todayKey(): string {
  const d = new Date();
  return dateToKey(d);
}

/** Date → 'YYYY-MM-DD'（用本地年月日拼，避免 toISOString 的 UTC 偏移） */
function dateToKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 'YYYY-MM-DD' → Date（本地零点），挡住非法串返回 null */
function keyToDate(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  // 再校验回写，挡掉 2 月 30 日这类非法日期被浏览器悄悄规整成 3 月的情况
  if (dt.getFullYear() !== y || dt.getMonth() + 1 !== mo || dt.getDate() !== d) return null;
  return dt;
}

/** 把 'YYYY-MM-DD' 映射到「自纪元起的天数整数」，用 UTC 构造但喂本地分量，结果稳定可相减 */
function dayNumber(key: string): number {
  const d = keyToDate(key);
  if (!d) return NaN;
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/* ===========================================================================
 * 重复规则：归一化 + 命中判断
 * ======================================================================== */

/**
 * 把模板任务里的 repeat 写法归一化为 RepeatRule 对象。
 * - repeatRule 显式对象优先；
 * - 兼容简化写法 repeat:'DAILY'/'WEEKLY'/'MONTHLY'（模块一示例）；
 * - 都没有 → null（非重复，仅生成一次）。
 */
export function normalizeRepeat(t: TemplateTask): RepeatRule | null {
  if (t.repeatRule && typeof t.repeatRule === 'object' && 'type' in t.repeatRule) {
    return t.repeatRule;
  }
  if (t.repeat === 'DAILY') return { type: 'daily', interval: 1 };
  if (t.repeat === 'WEEKLY') return { type: 'weekly', days: [1, 2, 3, 4, 5] }; // 默认工作日
  if (t.repeat === 'MONTHLY') return { type: 'monthly', day: 1 };
  return null;
}

/**
 * 判断某重复规则在 targetDate 是否应出现。
 * anchorDate 是规则的「首个出现日」（本模块用模板 created_at 的日期），daily 类型据此推算间隔。
 *
 * - daily：  (targetDate - anchorDate) 的天数差 >= 0 且能被 interval 整除；
 * - weekly： targetDate 的星期几 ∈ rule.days（0-6）；
 * - monthly：targetDate 的「日」 === rule.day（超出当月天数则该月不出现）。
 */
export function shouldGenerateToday(rule: RepeatRule, targetDate: string, anchorDate: string): boolean {
  const target = keyToDate(targetDate);
  if (!target) return false;

  switch (rule.type) {
    case 'daily': {
      const interval = Math.max(1, Math.floor(rule.interval || 1));
      const diff = dayNumber(targetDate) - dayNumber(anchorDate);
      return diff >= 0 && diff % interval === 0;
    }
    case 'weekly': {
      const dow = target.getDay(); // 0-6
      return rule.days.includes(dow);
    }
    case 'monthly': {
      return target.getDate() === rule.day;
    }
    default:
      return false;
  }
}

/* ===========================================================================
 * 行 → VO 映射
 * ======================================================================== */

/** 单行（drizzle 已按 schema 映射为驼峰键）→ 对外 VO（completed 转 boolean、repeatRule 反序列化） */
function toDailyTaskVO(row: typeof wbDailyTask.$inferSelect): DailyTaskVO {
  let rule: RepeatRule | null = null;
  if (row.repeatRule && row.repeatRule.trim() !== '') {
    try {
      const parsed = JSON.parse(row.repeatRule);
      if (parsed && typeof parsed === 'object' && 'type' in parsed) rule = parsed as RepeatRule;
    } catch {
      rule = null; // 脏数据降级为非重复，不炸
    }
  }
  return {
    id: row.id,
    targetDate: row.targetDate,
    content: row.content,
    completed: row.completed === 1,
    parentTemplateId: row.parentTemplateId ?? null,
    repeatRule: rule,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 模板行 → 对外 VO（tasks JSON 反序列化） */
function toTemplateVO(row: typeof wbTaskTemplate.$inferSelect): TaskTemplateVO {
  let tasks: TemplateTask[] = [];
  if (row.tasks && row.tasks.trim() !== '') {
    try {
      const parsed = JSON.parse(row.tasks);
      if (Array.isArray(parsed)) tasks = parsed as TemplateTask[];
    } catch {
      tasks = [];
    }
  }
  return {
    id: row.id,
    name: row.name,
    tasks,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* ===========================================================================
 * 当日任务：按需展开重复实例 + 查询
 * ======================================================================== */

/**
 * 把「今天该出现的重复任务」按需落库（幂等）。
 * 遍历所有模板，对其中带 repeatRule 的任务，按 shouldGenerateToday 判断 targetDate 是否命中；
 * 命中且 (parentTemplateId + targetDate + content) 尚无行时才插入——保证每个 (模板,日期,内容) 唯一。
 *
 * 这是「按需查询」策略的核心：用户切到某日期时实时计算并补行，不在应用启动预生成全量。
 * 落库后用户可对某天的该重复任务独立勾选完成，不影响其它日期。
 */
function expandRecurringForDate(date: string): void {
  const templates = db.select().from(wbTaskTemplate).all();
  for (const tpl of templates) {
    const tasks = toTemplateVO(tpl).tasks;
    const anchor = (tpl.createdAt || nowIso()).slice(0, 10);
    for (const t of tasks) {
      const rule = normalizeRepeat(t);
      if (!rule) continue;
      if (!shouldGenerateToday(rule, date, anchor)) continue;

      const exists = db
        .select({ id: wbDailyTask.id })
        .from(wbDailyTask)
        .where(
          and(
            eq(wbDailyTask.parentTemplateId, tpl.id),
            eq(wbDailyTask.targetDate, date),
            eq(wbDailyTask.content, t.content),
          ),
        )
        .get();
      if (exists) continue;

      db.insert(wbDailyTask)
        .values({
          userId: CURRENT_USER,
          targetDate: date,
          content: t.content,
          completed: 0,
          parentTemplateId: tpl.id,
          repeatRule: JSON.stringify(rule),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        })
        .run();
    }
  }
}

/** 取某天全部任务：先按需展开重复实例，再全量查询，未完成在前、已完成在后，同组内按 id 升序 */
export function listTasks(date: string): DailyTaskVO[] {
  if (!keyToDate(date)) return [];
  expandRecurringForDate(date);
  const rows = db
    .select()
    .from(wbDailyTask)
    .where(eq(wbDailyTask.targetDate, date))
    .orderBy(asc(wbDailyTask.completed), asc(wbDailyTask.id))
    .all();
  return rows.map(toDailyTaskVO);
}

/** 一键从模板生成某天计划：遍历模板任务，幂等插入（去重按 模板+日期+内容），重复规则一并带入 */
export function generateFromTemplate(templateId: number, targetDate: string): GenerateResult | null {
  if (!keyToDate(targetDate)) return null;
  const tpl = db.select().from(wbTaskTemplate).where(eq(wbTaskTemplate.id, templateId)).get();
  if (!tpl) return null;

  const tasks = toTemplateVO(tpl).tasks;
  const created: DailyTaskVO[] = [];

  for (const t of tasks) {
    const rule = normalizeRepeat(t);
    const exists = db
      .select({ id: wbDailyTask.id })
      .from(wbDailyTask)
      .where(
        and(
          eq(wbDailyTask.parentTemplateId, templateId),
          eq(wbDailyTask.targetDate, targetDate),
          eq(wbDailyTask.content, t.content),
        ),
      )
      .get();
    if (exists) continue;

    const res = db
      .insert(wbDailyTask)
      .values({
        userId: CURRENT_USER,
        targetDate: targetDate,
        content: t.content,
        completed: 0,
        parentTemplateId: templateId,
        repeatRule: rule ? JSON.stringify(rule) : null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })
      .run();
    const id = Number(res.lastInsertRowid);
    const row = db.select().from(wbDailyTask).where(eq(wbDailyTask.id, id)).get();
    if (row) created.push(toDailyTaskVO(row));
  }

  return { created, alreadyGenerated: created.length === 0 && tasks.length > 0 };
}

/**
 * 批量添加任务（手动/纯文本多行）。
 * 用 better-sqlite3 同步事务保证原子性：任一行失败整体回滚，避免半截写入。
 */
export function batchAddTasks(targetDate: string, rawTasks: string[]): { created: DailyTaskVO[] } {
  const cleaned = (rawTasks || [])
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t.length > 0);
  if (!cleaned.length) return { created: [] };

  const created: DailyTaskVO[] = [];
  db.transaction((tx) => {
    for (const content of cleaned) {
      const res = tx
        .insert(wbDailyTask)
        .values({
          userId: CURRENT_USER,
          targetDate,
          content,
          completed: 0,
          parentTemplateId: null,
          repeatRule: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        })
        .run();
      const id = Number(res.lastInsertRowid);
      const row = tx.select().from(wbDailyTask).where(eq(wbDailyTask.id, id)).get();
      if (row) created.push(toDailyTaskVO(row));
    }
  });
  return { created };
}

/** 局部更新一条当日任务（内容 / 完成态 / 重复规则） */
export function updateTask(id: number, patch: UpdateDailyTaskDTO): DailyTaskVO | null {
  const existing = db.select().from(wbDailyTask).where(eq(wbDailyTask.id, id)).get();
  if (!existing) return null;

  const nextCompleted = patch.completed === undefined ? existing.completed : patch.completed ? 1 : 0;
  const nextContent = patch.content !== undefined ? patch.content : existing.content;
  const nextRule =
    patch.repeatRule === undefined
      ? existing.repeatRule
      : patch.repeatRule
        ? JSON.stringify(patch.repeatRule)
        : null;

  db.update(wbDailyTask)
    .set({
      content: nextContent,
      completed: nextCompleted,
      repeatRule: nextRule,
      updatedAt: nowIso(),
    })
    .where(eq(wbDailyTask.id, id))
    .run();

  const row = db.select().from(wbDailyTask).where(eq(wbDailyTask.id, id)).get();
  return row ? toDailyTaskVO(row) : null;
}

/** 删除一条当日任务 */
export function deleteTask(id: number): void {
  db.delete(wbDailyTask).where(eq(wbDailyTask.id, id)).run();
}

/* ===========================================================================
 * 模板 CRUD
 * ======================================================================== */

export function listTemplates(): TaskTemplateVO[] {
  const rows = db.select().from(wbTaskTemplate).orderBy(asc(wbTaskTemplate.id)).all();
  return rows.map(toTemplateVO);
}

/** 新建模板（tasks 数组原样 JSON 化落库） */
export function createTemplate(name: string, tasks: TemplateTask[]): TaskTemplateVO {
  const res = db
    .insert(wbTaskTemplate)
    .values({
      userId: CURRENT_USER,
      name,
      tasks: JSON.stringify(Array.isArray(tasks) ? tasks : []),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    .run();
  const id = Number(res.lastInsertRowid);
  const row = db.select().from(wbTaskTemplate).where(eq(wbTaskTemplate.id, id)).get();
  return toTemplateVO(row!);
}

/** 删除模板（已生成的当日任务保留，不予级联，避免误删用户已勾选的进度） */
export function deleteTemplate(id: number): void {
  db.delete(wbTaskTemplate).where(eq(wbTaskTemplate.id, id)).run();
}
