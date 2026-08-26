/* 日历视图（月 / 周 / 日）业务层
 *
 * 职责边界（与项目三层架构一致）：
 * - routes/calendar.ts               只声明 HTTP 契约（路径 + 方法）；
 * - controllers/calendarController.ts 只做 HTTP 层（参数收口 + 错误 → 状态码）；
 * - 本文件是唯一承载业务逻辑的地方（SQL、时间归一化、色值校验）。
 *
 * 🔴 性能红线：**没有范围就没有查询**。
 * 对外只暴露 listEventsInRange(startDate, endDate)，不提供任何「拉全量事件」的
 * 入口。日历是会长期累积的数据（三年 ≈ 数千条），一次性拉回来既拖垮
 * better-sqlite3 的同步查询，也让前端拿着一堆当前屏幕根本用不到的数据。
 *
 * 🔴 时间口径：库里 start_time / end_time 一律是 UTC ISO 串（normalizeIso 保证）。
 * 统一格式换来一个关键性质——**字符串字典序 === 时间先后序**，
 * 于是范围过滤可以直接写 `start_time <= ?`，走 (user_id, start_time) 索引；
 * 一旦用 datetime(start_time) 之类的函数包裹，索引立刻失效退化成全表扫描。
 */
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';

import { db, CURRENT_USER, nowIso } from '../db';
import { wbAnniversary, wbCalendarEvent, wbDailyTask, wbTask } from '../db/schema';
import { resolvePage } from '../lib/pagination';
import type {
  AnniversaryCreateInput,
  AnniversaryRow,
  AnniversaryUpdateInput,
  CalendarEventCreateInput,
  CalendarEventRow,
  CalendarEventUpdateInput,
  CalendarEventWithSource,
  ListCalendarEventQuery,
} from '../types/calendar';

/** 缺省事件色，与 --kb-primary 同色（前端色板的第一项） */
const DEFAULT_COLOR = '#3B6FE0';

/** 日程计划任务（daily_task）在日历上的统一呈现色：柔和的灰，与普通事件区分 */
const DAILY_TASK_COLOR = '#B0B0B0';

/** 任务清单「什么时候做」在日历上的呈现色：柔和蓝紫，与普通事件的主蓝拉开距离 */
const TASK_COLOR = '#8E7CFF';

/** 任务清单「截止日」的呈现色：警示红。截止日是硬约束，视觉上必须比 target_date 更抢眼 */
const TASK_DUE_COLOR = '#E5484D';

/** 十六进制色值：#RGB 或 #RRGGBB，大小写不敏感 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** 日历日格式 YYYY-MM-DD */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 单次范围查询允许跨越的最大天数。
 *
 * 月视图一屏 42 天、周视图 7 天，366 天足够覆盖「年视图」这类未来形态，
 * 同时挡住 startDate=1970 & endDate=2999 这种把范围查询退化成全表扫描的调用。
 */
const MAX_RANGE_DAYS = 366;

const MS_PER_DAY = 86_400_000;

/* ------------------------------------------------------------------ */
/* 入参归一化 / 校验                                                    */
/* ------------------------------------------------------------------ */

/** 标题清洗：去空白 + 非空校验 + 长度上限（防止一条超长标题撑爆日历格子） */
function normalizeTitle(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new Error('事件标题不能为空');
  if (s.length > 200) throw new Error('事件标题过长（上限 200 字）');
  return s;
}

/** 空串一律存 null，避免库里同时存在 '' 和 NULL 两种「没有值」 */
function nullable(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/**
 * 任意可被 Date 解析的时间串 → 统一的 UTC ISO 串。
 *
 * 这个函数是「字符串比较即时间比较」这一前提的**唯一守门人**：
 * 前端可能传 '2026-08-09T14:00'（datetime-local 原样值）、带时区偏移的
 * '2026-08-09T14:00:00+08:00'，甚至已经是 UTC ISO。全部在这里收敛成一种写法，
 * 否则库里混着几种格式，`start_time <= ?` 的比较结果就会错得毫无规律。
 */
function normalizeIso(v: unknown, field: string): string {
  const d = new Date(String(v ?? ''));
  if (Number.isNaN(d.getTime())) throw new Error(`${field} 不是合法的时间`);
  return d.toISOString();
}

/** 色值校验：非法值不报错、直接落默认色——配色是装饰性字段，不值得为它中断一次创建 */
function normalizeColor(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  return HEX_COLOR.test(s) ? s.toUpperCase() : DEFAULT_COLOR;
}

/** 布尔 / 0 / 1 / '1' 统一收敛为 0|1 */
function toFlag(v: unknown): number {
  return v ? 1 : 0;
}

/**
 * 本地日历日 → 当天 00:00:00.000 的 UTC ISO。
 *
 * 为什么可以按「本机时区」解释这个日期：桌面端的 Node 侧车与窗口跑在同一台机器上，
 * 两者的 TZ 天然一致。前端传来的 '2026-08-09' 指的就是用户屏幕上那一格，
 * 这里用 new Date(y, m-1, d) 构造**本地**零点再转 UTC，边界才不会整体偏 8 小时。
 */
function localDayStartIso(date: string, field: string): string {
  if (!DATE_ONLY.test(date)) throw new Error(`${field} 格式应为 YYYY-MM-DD`);
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) throw new Error(`${field} 不是合法日期`);
  return dt.toISOString();
}

/** 本地日历日 → 当天 23:59:59.999 的 UTC ISO（范围**含**结束日） */
function localDayEndIso(date: string, field: string): string {
  if (!DATE_ONLY.test(date)) throw new Error(`${field} 格式应为 YYYY-MM-DD`);
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 23, 59, 59, 999);
  if (Number.isNaN(dt.getTime())) throw new Error(`${field} 不是合法日期`);
  return dt.toISOString();
}

/* ------------------------------------------------------------------ */
/* 读                                                                  */
/* ------------------------------------------------------------------ */

export function getEventById(id: number): CalendarEventRow | undefined {
  return db.select().from(wbCalendarEvent).where(eq(wbCalendarEvent.id, id)).get() as
    | CalendarEventRow
    | undefined;
}

/**
 * 按日期范围查询事件（日历模块唯一的读接口）。
 *
 * 命中条件是**区间重叠**而不是「开始时间落在范围内」，这两者差别很大：
 * 一个 8/28 → 9/2 的跨月假期，在 9 月的网格里 start_time 并不在范围内，
 * 但它确实占了 9/1、9/2 两格，用「开始时间落在范围内」会让它整段消失。
 *
 *   重叠 ⇔ event.start <= rangeEnd 且 coalesce(event.end, event.start) >= rangeStart
 *
 * coalesce 是给单点事件（end_time 为 NULL）兜底的：没有结束时间时，
 * 把开始时间当作结束时间，等价于一个零长度区间。
 *
 * @param q 必须携带 startDate / endDate（YYYY-MM-DD 本地日），可选分页
 * @returns 按开始时间升序的「合并事件」数组（普通日历事件 + 每日任务），
 *   裸数组，不含分页元信息，与全站契约一致。
 */
export function listEventsInRange(q: ListCalendarEventQuery): CalendarEventWithSource[] {
  const startIso = localDayStartIso(q?.startDate, 'start_date');
  const endIso = localDayEndIso(q?.endDate, 'end_date');

  if (startIso > endIso) throw new Error('start_date 不能晚于 end_date');
  const spanDays = (Date.parse(endIso) - Date.parse(startIso)) / MS_PER_DAY;
  if (spanDays > MAX_RANGE_DAYS) {
    throw new Error(`查询跨度过大（上限 ${MAX_RANGE_DAYS} 天），请缩小时间范围`);
  }

  const { limit, offset } = resolvePage(q);

  /* ---------- 数据源 A：wb_calendar_event（普通日历事件）----------
   * 直接比较字符串而非 datetime(...)：库里全是同格式 UTC ISO，字典序即时间序，
   * 这样才吃得到 (user_id, start_time) 索引。 */
  const calendarEvents = db
    .select()
    .from(wbCalendarEvent)
    .where(
      and(
        eq(wbCalendarEvent.userId, CURRENT_USER),
        sql`${wbCalendarEvent.startTime} <= ${endIso}
            and coalesce(${wbCalendarEvent.endTime}, ${wbCalendarEvent.startTime}) >= ${startIso}`,
      ),
    )
    /* 排序口径一次定死，前端不再排：
     * 1) 全天事件优先（is_all_day DESC）——它是这一天的「背景板」，钉在格子顶部；
     * 2) 开始时间升序——同一天内按时间轴自然顺序阅读。 */
    .orderBy(sql`${wbCalendarEvent.isAllDay} desc`, asc(wbCalendarEvent.startTime))
    .limit(limit)
    .offset(offset)
    .all() as CalendarEventRow[];

  /* ---------- 数据源 B：wb_daily_task（来自 /schedule 的每日任务）----------
   * 目标：让「日程计划」在日历网格里可见、可点（跳转 /schedule）。
   * 映射规则（与用户约定一致）：
   * - target_date 视为当天 00:00:00（本地）→ UTC ISO 作为 start_time，end_time 取当天 23:59:59.999，
   *   于是它在日历上呈现为「当天全天」的一条，且 coveredDayKeys 只命中那一天；
   * - is_all_day = 1（全天）；title = content；color = DAILY_TASK_COLOR（柔和灰）；
   * - 额外带 sourceType:'daily_task' 与 taskId，便于前端点击时分流跳转。
   * 普通事件的 sourceType 统一补 'calendar'，保持两侧类型一致。
   *
   * 🔴 同步 API：better-sqlite3 全程同步，这里不出现任何 await。 */
  const dailyRows = db
    .select()
    .from(wbDailyTask)
    .where(
      and(
        eq(wbDailyTask.userId, CURRENT_USER),
        gte(wbDailyTask.targetDate, q.startDate),
        lte(wbDailyTask.targetDate, q.endDate),
      ),
    )
    .all();

  const dailyEvents: CalendarEventWithSource[] = dailyRows.map((t) => ({
    id: t.id,
    userId: t.userId,
    title: t.content,
    description: null,
    startTime: localDayStartIso(t.targetDate, 'start_time'),
    endTime: localDayEndIso(t.targetDate, 'end_time'),
    isAllDay: 1,
    color: DAILY_TASK_COLOR,
    location: null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    sourceType: 'daily_task',
    taskId: t.id,
  }));

  /* ---------- 数据源 C：wb_task（任务清单 /tasks）----------
   * 一条任务最多在日历上产生**两个**条目：
   * - target_date（什么时候做）→ sourceType 'task'，柔和蓝；
   * - due_date（截止日）      → sourceType 'task_due'，警示红。
   * 两者刻意分开呈现，理由见 types/calendar.ts 的 sourceType 注释。
   *
   * 只发**一条 SQL** 把范围内 target_date 或 due_date 命中的任务全捞回来，
   * 再在 JS 层裂成两组；分两次查会让同时命中两个日期的任务被查两遍。
   *
   * 子任务（parent_task_id 非空）不上日历：Checklist 项是父任务的实现细节，
   * 让它们各自占一格会把月视图刷爆。
   *
   * 🔴 同步 API：better-sqlite3 全程同步，这里不出现任何 await。 */
  const taskRows = db
    .select()
    .from(wbTask)
    .where(
      and(
        eq(wbTask.userId, CURRENT_USER),
        isNull(wbTask.parentTaskId),
        sql`(
          (${wbTask.targetDate} is not null and ${wbTask.targetDate} between ${q.startDate} and ${q.endDate})
          or
          (${wbTask.dueDate} is not null and ${wbTask.dueDate} between ${q.startDate} and ${q.endDate})
        )`,
      ),
    )
    .all();

  const taskEvents: CalendarEventWithSource[] = [];
  taskRows.forEach((t) => {
    const base = {
      userId: t.userId,
      description: t.notes,
      isAllDay: 1,
      location: null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      taskId: t.id,
      taskCompleted: t.completed,
    };
    if (t.targetDate && t.targetDate >= q.startDate && t.targetDate <= q.endDate) {
      taskEvents.push({
        ...base,
        id: t.id,
        title: t.title,
        startTime: localDayStartIso(t.targetDate, 'start_time'),
        endTime: localDayEndIso(t.targetDate, 'end_time'),
        color: TASK_COLOR,
        sourceType: 'task',
      });
    }
    if (t.dueDate && t.dueDate >= q.startDate && t.dueDate <= q.endDate) {
      taskEvents.push({
        ...base,
        id: t.id,
        title: `截止：${t.title}`,
        startTime: localDayStartIso(t.dueDate, 'start_time'),
        endTime: localDayEndIso(t.dueDate, 'end_time'),
        color: TASK_DUE_COLOR,
        sourceType: 'task_due',
      });
    }
  });

  const calendarWithSource: CalendarEventWithSource[] = calendarEvents.map((e) => ({
    ...e,
    sourceType: 'calendar',
  }));

  /* 合并：日历事件在前（全天优先的排序已在库内定好），任务类追加在后。
   * 任务条目数量由日期范围天然有界（≤ MAX_RANGE_DAYS 天），不随日历事件的分页 limit 被裁切，
   * 保证「用户在日历上看到的任务」与 /tasks 完全一致。 */
  return [...calendarWithSource, ...dailyEvents, ...taskEvents];
}

/* ------------------------------------------------------------------ */
/* 写                                                                  */
/* ------------------------------------------------------------------ */

/**
 * 新建事件。
 *
 * 结束时间早于开始时间直接拒绝：这种数据一旦落库，周/日视图算高度时会得到
 * 负数，渲染出一个倒着长的色块，比报错难查得多。
 */
export function createEvent(input: CalendarEventCreateInput): CalendarEventRow {
  const title = normalizeTitle(input.title);
  const startTime = normalizeIso(input.startTime, 'start_time');
  const endTime = input.endTime ? normalizeIso(input.endTime, 'end_time') : null;
  if (endTime && endTime < startTime) throw new Error('结束时间不能早于开始时间');

  const now = nowIso();
  const res = db
    .insert(wbCalendarEvent)
    .values({
      userId: CURRENT_USER,
      title,
      description: nullable(input.description),
      startTime,
      endTime,
      isAllDay: toFlag(input.isAllDay),
      color: normalizeColor(input.color),
      location: nullable(input.location),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const created = getEventById(Number(res.lastInsertRowid));
  if (!created) throw new Error('事件创建失败');
  return created;
}

/**
 * 局部更新。只有显式出现在 body 里的字段才会被写，避免「没传等于清空」。
 *
 * 时间校验要拿**合并后**的值来做：只改 endTime 时，必须和库里已有的 startTime 比，
 * 否则「把结束时间提前到开始之前」这种非法状态能绕过校验落库。
 */
export function updateEvent(id: number, input: CalendarEventUpdateInput): CalendarEventRow {
  const existing = getEventById(id);
  if (!existing) throw new Error('事件不存在');

  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  if (input.title !== undefined) patch.title = normalizeTitle(input.title);
  if (input.startTime !== undefined) patch.startTime = normalizeIso(input.startTime, 'start_time');
  if (input.endTime !== undefined) {
    patch.endTime = input.endTime ? normalizeIso(input.endTime, 'end_time') : null;
  }
  if (input.isAllDay !== undefined) patch.isAllDay = toFlag(input.isAllDay);
  if (input.color !== undefined) patch.color = normalizeColor(input.color);
  if (input.description !== undefined) patch.description = nullable(input.description);
  if (input.location !== undefined) patch.location = nullable(input.location);

  const nextStart = (patch.startTime as string | undefined) ?? existing.startTime;
  const nextEnd = (patch.endTime as string | null | undefined) ?? existing.endTime;
  if (nextEnd && nextEnd < nextStart) throw new Error('结束时间不能早于开始时间');

  db.update(wbCalendarEvent).set(patch).where(eq(wbCalendarEvent.id, id)).run();

  const updated = getEventById(id);
  if (!updated) throw new Error('事件更新失败');
  return updated;
}

/** 物理删除。日历事件是轻量条目，删了就是删了，不做逻辑删除墓碑。 */
export function deleteEvent(id: number): { ok: true } {
  const existing = getEventById(id);
  if (!existing) throw new Error('事件不存在');
  db.delete(wbCalendarEvent).where(eq(wbCalendarEvent.id, id)).run();
  return { ok: true };
}

/* =====================================================================
 * 纪念日 / 生日（wb_anniversary）CRUD
 *
 * 业务要点：
 * - date 口径：yearly → MM-DD（正则 ^\d{2}-\d{2}$，含 02-29 这种特殊日期）；
 *   monthly → DD（^\d{1,2}$，1~31）。渲染时前端把当前年拼上 MM-DD 比对即可，
 *   每年自动出现，无需把纪念日复制成 wb_calendar_event 的具体事件。
 * - repeat_rule 只收 yearly / monthly 两个字面量，非法值直接报错（业务字段，
 *   不像事件颜色那样宽容——错误规则会让「每月」被误读成「每年」）。
 * - 列表是全量拉取（个人纪念日几十条封顶），不需要分页；
 *   按 name 排序保证每次渲染顺序稳定。
 * - 🔴 better-sqlite3 全同步：本段无任何 async/await。
 * ===================================================================== */

/** MM-DD（yearly）或 DD（monthly）日期格式校验 */
const DATE_MMDD = /^\d{2}-\d{2}$/;
const DATE_DD = /^\d{1,2}$/;

/** 纪念日名称：去空白 + 非空 + 长度上限 */
function normalizeAnniversaryName(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new Error('纪念日名称不能为空');
  if (s.length > 100) throw new Error('纪念日名称过长（上限 100 字）');
  return s;
}

/** 图标名：合法则保留，非法回退 heart（装饰性字段，不值得为它中断一次创建） */
function normalizeIcon(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  // 只允许小写字母 + 数字 + 连字符（lucide 图标名的构成），防注入长串
  return /^[a-z0-9-]{1,50}$/.test(s) ? s : 'heart';
}

/** 重复规则：只收 yearly / monthly */
function normalizeRepeatRule(v: unknown): 'yearly' | 'monthly' {
  const s = String(v ?? 'yearly');
  if (s !== 'yearly' && s !== 'monthly') throw new Error('repeat_rule 只支持 yearly / monthly');
  return s;
}

/**
 * 校验日期字段口径：
 * - yearly → MM-DD；
 * - monthly → DD（1~31）。
 */
function normalizeAnniversaryDate(v: unknown, rule: 'yearly' | 'monthly'): string {
  const s = String(v ?? '').trim();
  if (rule === 'yearly') {
    if (!DATE_MMDD.test(s)) throw new Error('日期格式应为 MM-DD（如 03-15）');
    const month = Number(s.slice(0, 2));
    const day = Number(s.slice(3, 5));
    if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error('日期超出合法范围');
    return s;
  }
  if (!DATE_DD.test(s)) throw new Error('每月重复的日期应为日数字（如 15）');
  const day = Number(s);
  if (day < 1 || day > 31) throw new Error('每月重复的日期应在 1~31 之间');
  return String(day);
}

/** 起始年份：整数且 >= 1900，否则回退 null（不限） */
function normalizeAnniversaryYear(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1900 || n > 9999) return null;
  return n;
}

export function getAnniversaryById(id: number): AnniversaryRow | undefined {
  return db.select().from(wbAnniversary).where(eq(wbAnniversary.id, id)).get() as
    | AnniversaryRow
    | undefined;
}

/** 获取某用户的全部纪念日（全量，按名称排序保证稳定） */
export function listAnniversaries(): AnniversaryRow[] {
  return db
    .select()
    .from(wbAnniversary)
    .where(eq(wbAnniversary.userId, CURRENT_USER))
    .orderBy(asc(wbAnniversary.name))
    .all() as AnniversaryRow[];
}

/** 新建纪念日 */
export function createAnniversary(input: AnniversaryCreateInput): AnniversaryRow {
  const name = normalizeAnniversaryName(input.name);
  const repeatRule = normalizeRepeatRule(input.repeatRule);
  const date = normalizeAnniversaryDate(input.date, repeatRule);
  const year = normalizeAnniversaryYear(input.year);
  const now = nowIso();
  const res = db
    .insert(wbAnniversary)
    .values({
      userId: CURRENT_USER,
      name,
      iconName: normalizeIcon(input.iconName),
      date,
      year,
      repeatRule,
      note: nullable(input.note),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const created = getAnniversaryById(Number(res.lastInsertRowid));
  if (!created) throw new Error('纪念日创建失败');
  return created;
}

/** 局部更新：只有显式出现的字段才会被写 */
export function updateAnniversary(id: number, input: AnniversaryUpdateInput): AnniversaryRow {
  const existing = getAnniversaryById(id);
  if (!existing) throw new Error('纪念日不存在');

  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  if (input.name !== undefined) patch.name = normalizeAnniversaryName(input.name);
  if (input.iconName !== undefined) patch.iconName = normalizeIcon(input.iconName);
  if (input.note !== undefined) patch.note = nullable(input.note);
  if (input.year !== undefined) patch.year = normalizeAnniversaryYear(input.year);
  // 日期与规则联动校验：改了规则要按新规则重验日期；只改日期按现有规则验
  const nextRule =
    input.repeatRule !== undefined
      ? normalizeRepeatRule(input.repeatRule)
      : (existing.repeatRule as 'yearly' | 'monthly');
  if (input.repeatRule !== undefined) patch.repeatRule = nextRule;
  if (input.date !== undefined) patch.date = normalizeAnniversaryDate(input.date, nextRule);

  db.update(wbAnniversary).set(patch).where(eq(wbAnniversary.id, id)).run();

  const updated = getAnniversaryById(id);
  if (!updated) throw new Error('纪念日更新失败');
  return updated;
}

/** 物理删除纪念日 */
export function deleteAnniversary(id: number): { ok: true } {
  const existing = getAnniversaryById(id);
  if (!existing) throw new Error('纪念日不存在');
  db.delete(wbAnniversary).where(eq(wbAnniversary.id, id)).run();
  return { ok: true };
}
