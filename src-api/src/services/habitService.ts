/* 习惯打卡业务层
 *
 * 职责边界（与项目三层架构一致）：
 * - routes/habits.ts   只声明 HTTP 契约（路径 + 方法）；
 * - controllers/habitController.ts 只做 HTTP 层（参数收口 + 错误 → 400 文案）；
 * - 本文件是唯一承载业务逻辑的地方（SQL、统计、事务）。
 *
 * 时区口径（与番茄钟 / 日程一致）：
 * 打卡按「本机自然日」分桶，库里 log_date 存 YYYY-MM-DD（本地时区），
 * 绝不用 toISOString()——那是 UTC 日，会让「今天」在不同机器上错位。
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm';

import { db, CURRENT_USER, nowIso } from '../db';
import { wbHabit, wbHabitLog } from '../db/schema';
import type {
  HabitCreateInput,
  HabitRow,
  HabitStatsVO,
  HabitSummaryVO,
  HabitUpdateInput,
  HabitWithToday,
  ToggleLogInput,
  ToggleLogResult,
} from '../types/habit';

/** 本机时区 YYYY-MM-DD（绝不用 toISOString 的 UTC 日） */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayKey(): string {
  return localDateKey(new Date());
}

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 在 YYYY-MM-DD 字符串上加减天数（避免手动拼串出错） */
function shiftKey(key: string, delta: number): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + delta);
  return localDateKey(d);
}

/** 当前连续天数：今天没打卡则从昨天起算（当天未结束，不视为断签） */
function currentStreak(doneSet: Set<string>): number {
  let cursor = todayKey();
  if (!doneSet.has(cursor)) cursor = shiftKey(cursor, -1);
  let streak = 0;
  while (doneSet.has(cursor)) {
    streak += 1;
    cursor = shiftKey(cursor, -1);
  }
  return streak;
}

/* ------------------------------------------------------------------ */
/* 读                                                                  */
/* ------------------------------------------------------------------ */

function getHabitById(id: number): HabitRow | undefined {
  return db.select().from(wbHabit).where(eq(wbHabit.id, id)).get() as HabitRow | undefined;
}

/**
 * 列出全部习惯，并**一句 SQL** 拼出每条的今日打卡状态（todayStatus），
 * 同时附上当前连续天数（streak）。
 *
 * 🔴 N+1 红线：绝不能在「SELECT * FROM wb_habit」之后于循环里逐条查 wb_habit_log。
 * - todayStatus：用 LEFT JOIN + 当天日期条件，在一个查询内算好；
 * - streak：额外用**一条**聚合查询把本用户全部 log 捞回，在内存里按 habit 分组算连续天数，
 *   全程只有 2 条 SQL，绝不随习惯数线性增长。
 */
export function getAllHabits(): HabitWithToday[] {
  const today = todayKey();

  const rows = db
    .select({
      id: wbHabit.id,
      userId: wbHabit.userId,
      name: wbHabit.name,
      description: wbHabit.description,
      iconName: wbHabit.iconName,
      color: wbHabit.color,
      frequency: wbHabit.frequency,
      createdAt: wbHabit.createdAt,
      updatedAt: wbHabit.updatedAt,
      todayStatus: sql<number>`COALESCE(${wbHabitLog.status}, 0)`,
    })
    .from(wbHabit)
    .leftJoin(
      wbHabitLog,
      and(
        eq(wbHabitLog.habitId, wbHabit.id),
        eq(wbHabitLog.logDate, today),
        eq(wbHabitLog.userId, CURRENT_USER),
      ),
    )
    .where(eq(wbHabit.userId, CURRENT_USER))
    .all() as HabitWithToday[];

  /* 单条聚合：一次取回全部「已完成」打卡，内存分组后算各习惯连续天数。
   *
   * 这里刻意不分页——currentStreak 需要从今天往回连续走到第一个断点，
   * 少一天数据结果就错，所以按天截断是不安全的优化。
   * 真正的减负是把 `status = 1` 下推到 SQL：未完成的打卡记录（status=0）
   * 拉回来也只是被下面的循环丢掉，属于纯浪费的 IO + 反序列化。
   * 量级参考：10 个习惯打满 3 年约 1 万行，SQLite 本地读毫秒级，可接受。 */
  const logs = db
    .select({ habitId: wbHabitLog.habitId, logDate: wbHabitLog.logDate })
    .from(wbHabitLog)
    .where(and(eq(wbHabitLog.userId, CURRENT_USER), eq(wbHabitLog.status, 1)))
    .all() as { habitId: number; logDate: string }[];

  const doneByHabit = new Map<number, Set<string>>();
  for (const l of logs) {
    if (!doneByHabit.has(l.habitId)) doneByHabit.set(l.habitId, new Set());
    doneByHabit.get(l.habitId)!.add(l.logDate);
  }

  for (const r of rows) {
    r.streak = currentStreak(doneByHabit.get(r.id) ?? new Set());
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* 写                                                                  */
/* ------------------------------------------------------------------ */

export function createHabit(input: HabitCreateInput): HabitRow {
  const name = (input.name || '').trim();
  if (!name) throw new Error('习惯名称不能为空');
  const now = nowIso();
  const res = db
    .insert(wbHabit)
    .values({
      userId: CURRENT_USER,
      name,
      description: input.description ? input.description.trim() : null,
      iconName: input.iconName || 'check-circle',
      color: input.color || '#3B6FE0',
      frequency: input.frequency || 'DAILY',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getHabitById(Number(res.lastInsertRowid))!;
}

export function updateHabit(id: number, patch: HabitUpdateInput): HabitRow {
  const existing = getHabitById(id);
  if (!existing) throw new Error('习惯不存在');

  const values: Partial<HabitRow> = { updatedAt: nowIso() };
  if (typeof patch.name === 'string' && patch.name.trim()) values.name = patch.name.trim();
  if (patch.description !== undefined) {
    values.description = patch.description ? patch.description.trim() : null;
  }
  if (patch.iconName) values.iconName = patch.iconName;
  if (patch.color) values.color = patch.color;
  if (patch.frequency) values.frequency = patch.frequency;

  db.update(wbHabit).set(values).where(eq(wbHabit.id, id)).run();
  return getHabitById(id)!;
}

/**
 * 删除习惯 + 级联删除其全部打卡记录。
 *
 * ⚠️ better-sqlite3 同步事务：回调**禁止 async**——一旦在回调里 await，
 * 首个 await 处事务就会提前提交，级联删除可能只跑一半。这里全程同步。
 */
export function deleteHabit(id: number): { ok: true } {
  // better-sqlite3 同步事务：回调**禁止 async**——一旦在回调里 await，
  // 首个 await 处事务就会提前提交，级联删除可能只跑一半。这里全程同步。
  // 注意：drizzle 的 db.transaction 会**立即执行**回调并返回其结果（非可调用函数）。
  db.transaction((tx) => {
    tx.delete(wbHabitLog).where(eq(wbHabitLog.habitId, id)).run();
    tx.delete(wbHabit).where(eq(wbHabit.id, id)).run();
  });
  return { ok: true };
}

/**
 * 切换某天某习惯的打卡状态（toggle / upsert）。
 * 已存在当日记录 → 翻转 status；不存在 → 插入 status=1。
 * 返回切换后的最终状态，前端据此对齐（而非盲目信任乐观值）。
 */
export function toggleHabitLog(input: ToggleLogInput): ToggleLogResult {
  const habitId = input.habitId;
  if (!getHabitById(habitId)) throw new Error('习惯不存在');

  const logDate = input.date ? input.date : todayKey();
  const existing = db
    .select()
    .from(wbHabitLog)
    .where(and(eq(wbHabitLog.habitId, habitId), eq(wbHabitLog.logDate, logDate)))
    .get() as { id: number; status: number; note: string | null } | undefined;

  if (existing) {
    const next = existing.status ? 0 : 1;
    db.update(wbHabitLog)
      .set({
        status: next,
        note: input.note !== undefined ? input.note : existing.note,
      })
      .where(eq(wbHabitLog.id, existing.id))
      .run();
    return { habitId, logDate, status: next };
  }

  db.insert(wbHabitLog)
    .values({
      habitId,
      userId: CURRENT_USER,
      logDate,
      status: 1,
      note: input.note ?? null,
      createdAt: nowIso(),
    })
    .run();
  return { habitId, logDate, status: 1 };
}

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

/** 生成 [end-days+1 .. end] 的升序日期数组，并标注是否打卡 */
function buildRange(days: number, doneSet: Set<string>) {
  const out: { date: string; status: 0 | 1 }[] = [];
  const end = todayKey();
  for (let i = days - 1; i >= 0; i--) {
    const d = shiftKey(end, -i);
    out.push({ date: d, status: doneSet.has(d) ? 1 : 0 });
  }
  return out;
}

export function getHabitStats(habitId: number): HabitStatsVO {
  const habit = getHabitById(habitId);
  if (!habit) throw new Error('习惯不存在');

  /* 同 listHabits：status = 1 下推到 SQL，避免把「取消打卡」的行拉回来再 filter 掉。
   * 最长连续天数必须看完整历史，因此这里同样不能按天截断。 */
  const logs = db
    .select({ logDate: wbHabitLog.logDate })
    .from(wbHabitLog)
    .where(and(eq(wbHabitLog.habitId, habitId), eq(wbHabitLog.status, 1)))
    .all() as { logDate: string }[];
  const doneSet = new Set(logs.map((l) => l.logDate));

  // 当前连续天数（复用公共逻辑：今天没打卡则从昨天起算）
  const streak = currentStreak(doneSet);

  // 最长连续天数
  const sortedDays = [...doneSet].sort();
  let bestStreak = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of sortedDays) {
    if (prev && shiftKey(prev, 1) === k) run += 1;
    else run = 1;
    if (run > bestStreak) bestStreak = run;
    prev = k;
  }

  return {
    habitId,
    streak,
    bestStreak,
    totalDone: doneSet.size,
    monthlyData: buildRange(30, doneSet),
    yearlyHeatmapData: buildRange(365, doneSet),
  };
}

/**
 * 全局打卡概览（跨所有习惯）：本周 / 本月打卡率。
 *
 * 口径：打卡率 = 「窗口内已打卡( status=1 )的 (习惯×天) 槽位数」 / 「窗口内应打卡槽位数」。
 * - 本周：以周一为起点，窗口 = [本周一, 今天]，天数 = 本周已过天数(含今天)；
 * - 本月：窗口 = [本月1号, 今天]，天数 = 本月已过天数(含今天)。
 * 全部用聚合 COUNT 查询，习惯数为 0 时打卡率记 0（避免除零），无 N+1。
 */
export function getHabitsSummary(): HabitSummaryVO {
  const today = todayKey();
  const now = new Date();

  // 周一为一周起点（中国习惯）：getDay() 周日=0 → (d+6)%7 周一=0 … 周日=6
  const dow = (now.getDay() + 6) % 7;
  const weekStart = shiftKey(today, -dow);
  const weekDaysElapsed = dow + 1;

  // 本月 1 号（YYYY-MM-01）
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthDaysElapsed = now.getDate();

  const countRow = db
    .select({ c: sql<number>`COUNT(*)` })
    .from(wbHabit)
    .where(eq(wbHabit.userId, CURRENT_USER))
    .get() as { c: number } | undefined;
  const habitCount = Number(countRow?.c ?? 0);

  const todayDoneRow = db
    .select({ c: sql<number>`COUNT(*)` })
    .from(wbHabitLog)
    .where(and(eq(wbHabitLog.userId, CURRENT_USER), eq(wbHabitLog.status, 1), eq(wbHabitLog.logDate, today)))
    .get() as { c: number } | undefined;
  const todayDone = Number(todayDoneRow?.c ?? 0);

  const weekDoneRow = db
    .select({ c: sql<number>`COUNT(*)` })
    .from(wbHabitLog)
    .where(
      and(
        eq(wbHabitLog.userId, CURRENT_USER),
        eq(wbHabitLog.status, 1),
        gte(wbHabitLog.logDate, weekStart),
        lte(wbHabitLog.logDate, today),
      ),
    )
    .get() as { c: number } | undefined;
  const weekDone = Number(weekDoneRow?.c ?? 0);

  const monthDoneRow = db
    .select({ c: sql<number>`COUNT(*)` })
    .from(wbHabitLog)
    .where(
      and(
        eq(wbHabitLog.userId, CURRENT_USER),
        eq(wbHabitLog.status, 1),
        gte(wbHabitLog.logDate, monthStart),
        lte(wbHabitLog.logDate, today),
      ),
    )
    .get() as { c: number } | undefined;
  const monthDone = Number(monthDoneRow?.c ?? 0);

  const weekRate = habitCount > 0 ? Math.round((weekDone / (weekDaysElapsed * habitCount)) * 100) : 0;
  const monthRate = habitCount > 0 ? Math.round((monthDone / (monthDaysElapsed * habitCount)) * 100) : 0;

  return {
    weekRate,
    monthRate,
    todayDone,
    totalHabits: habitCount,
    weekDaysElapsed,
    monthDaysElapsed,
  };
}
