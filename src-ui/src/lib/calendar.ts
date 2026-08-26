/**
 * 日历网格的**纯计算**模块（无 Vue、无请求、无副作用）。
 *
 * 为什么单独抽一层而不是写在组件里：网格边界（这张月视图到底覆盖了哪一天到哪一天）
 * 同时被两处需要——
 *   1. `calendar-store` 拿它算出要向后端请求的 start_date / end_date；
 *   2. `CalendarMonthView` / 时间轴视图 拿它渲染格子。
 * 如果两边各算一遍，一旦「周起始日」从周一改成周日，就会出现「请求的区间」
 * 和「渲染的区间」错开一天，表现为最左侧那列永远是空的——极难排查。
 * 所以边界计算只允许有这一份实现。
 *
 * 约定：日期一律用本地日键 `YYYY-MM-DD` 传递（不是 Date 对象、不是 ISO 时刻）。
 * 这样它天然可序列化、可当 v-for 的 key、可直接做字符串比较。
 */
import dayjs from 'dayjs';

/** 视图模式。月视图是默认形态，周/日共用同一套时间轴渲染。 */
export type CalendarViewMode = 'month' | 'week' | 'day';

/** 月视图固定 6 行 × 7 列 = 42 格。固定行数是为了翻月时高度不跳动。 */
export const MONTH_CELL_COUNT = 42;

/**
 * 一周的起始日：1 = 周一。
 *
 * dayjs 的 `day()` 是 0(周日) ~ 6(周六)，而中文日历习惯从周一排起。
 * 这个常量与下面 WEEKDAY_LABELS 的顺序必须同步修改，改一个不改另一个，
 * 表头文字就会和实际列错位。
 */
export const WEEK_START = 1;

/** 表头文字，顺序与 WEEK_START 对应（周一打头） */
export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

/**
 * 事件配色板。
 *
 * 刻意用固定的十六进制串而不是 `--kb-*` token：这些颜色要原样存进数据库
 * （库里只有一列 color），而 CSS 变量在 JS 侧取值需要 getComputedStyle，
 * 还会随明暗主题变化——存进库的颜色必须是稳定值。
 * 取值本身对齐了设计系统：primary / accent / warning / destructive 同色，
 * 另补两个中性偏冷的紫与青，保证六色在浅色背景上都能压住白字。
 */
export const EVENT_COLORS = [
  { value: '#3B6FE0', label: '蓝' },
  { value: '#10B981', label: '绿' },
  { value: '#F59E0B', label: '橙' },
  { value: '#EF4444', label: '红' },
  { value: '#8B5CF6', label: '紫' },
  { value: '#0EA5E9', label: '青' },
] as const;

export const DEFAULT_EVENT_COLOR = EVENT_COLORS[0].value;

/** 月/周网格里的一个日期格 */
export interface DayCell {
  /** 本地日键 YYYY-MM-DD，同时用作 v-for 的 key */
  key: string;
  /** 日期数字（1~31） */
  dayNum: number;
  /** 月份数字（1~12），月视图里用来判断是否需要显示「8月」前缀 */
  monthNum: number;
  /** 周几文字（周一~周日） */
  weekdayLabel: string;
  /** 是否属于锚点所在的当月（false = 上/下月补位格，渲染成浅灰且不可交互） */
  inMonth: boolean;
  /** 是否今天 */
  isToday: boolean;
  /** 是否周末（周六 / 周日） */
  isWeekend: boolean;
}

/** 今天的日期键 */
export function todayKey(): string {
  return dayjs().format('YYYY-MM-DD');
}

/** 把任意可解析值收敛成日期键；非法值退化为今天，保证视图永远有锚点 */
export function toKey(input?: string | number | Date | null): string {
  const d = dayjs(input ?? undefined);
  return d.isValid() ? d.format('YYYY-MM-DD') : todayKey();
}

/** 该日期所在周的周一（受 WEEK_START 控制） */
function startOfWeek(key: string) {
  const d = dayjs(key);
  // dayjs 的 day(): 0=周日。以周一为首时，周日要回退 6 天而不是前进 1 天。
  const shift = (d.day() - WEEK_START + 7) % 7;
  return d.subtract(shift, 'day');
}

function buildCell(d: dayjs.Dayjs, anchorMonth: number, today: string): DayCell {
  const key = d.format('YYYY-MM-DD');
  return {
    key,
    dayNum: d.date(),
    monthNum: d.month() + 1,
    weekdayLabel: WEEKDAY_LABELS[(d.day() - WEEK_START + 7) % 7],
    inMonth: d.month() === anchorMonth,
    isToday: key === today,
    isWeekend: d.day() === 0 || d.day() === 6,
  };
}

/**
 * 构造月视图的 42 格。
 *
 * 算法：找到当月 1 号是周几 → 往前补上个月的尾巴凑到周一 → 从这天起连排 42 天。
 * 固定 42 而不是「按需 35 或 42」，是为了翻月时网格高度恒定：
 * 高度会跳变的日历用起来非常晕，每次翻月都要重新定位视线。
 */
export function buildMonthMatrix(anchorKey: string): DayCell[] {
  const anchor = dayjs(anchorKey);
  const anchorMonth = anchor.month();
  const first = startOfWeek(anchor.startOf('month').format('YYYY-MM-DD'));
  const today = todayKey();

  const cells: DayCell[] = [];
  for (let i = 0; i < MONTH_CELL_COUNT; i++) {
    cells.push(buildCell(first.add(i, 'day'), anchorMonth, today));
  }
  return cells;
}

/** 构造周视图的 7 格（周一 ~ 周日） */
export function buildWeekDays(anchorKey: string): DayCell[] {
  const anchor = dayjs(anchorKey);
  const first = startOfWeek(anchorKey);
  const today = todayKey();
  return Array.from({ length: 7 }, (_, i) => buildCell(first.add(i, 'day'), anchor.month(), today));
}

/** 构造日视图的单格 */
export function buildSingleDay(anchorKey: string): DayCell[] {
  const d = dayjs(anchorKey);
  return [buildCell(d, d.month(), todayKey())];
}

/** 按视图模式返回要渲染的日期格集合（视图层唯一的取格入口） */
export function buildCells(anchorKey: string, mode: CalendarViewMode): DayCell[] {
  if (mode === 'month') return buildMonthMatrix(anchorKey);
  if (mode === 'week') return buildWeekDays(anchorKey);
  return buildSingleDay(anchorKey);
}

/**
 * 当前视图覆盖的日期区间（含首尾），即要向后端请求的 start_date / end_date。
 *
 * 注意月视图取的是**整张 42 格网格**的首尾，而不是当月 1 号到月末：
 * 网格里首行有上个月的尾巴、末行有下个月的开头，那些格子里的事件同样要显示。
 * 少算这几天，就会出现「上月最后几天的事件在本月视图里凭空消失」。
 */
export function visibleRange(anchorKey: string, mode: CalendarViewMode): { start: string; end: string } {
  const cells = buildCells(anchorKey, mode);
  return { start: cells[0].key, end: cells[cells.length - 1].key };
}

/** 前后翻页：月视图翻月、周视图翻周、日视图翻天 */
export function shiftAnchor(anchorKey: string, mode: CalendarViewMode, delta: number): string {
  const unit = mode === 'month' ? 'month' : mode === 'week' ? 'week' : 'day';
  return dayjs(anchorKey).add(delta, unit).format('YYYY-MM-DD');
}

/**
 * 某个事件覆盖的全部本地日键（跨天事件会返回多个）。
 *
 * MAX_SPAN 是防御性的：库里若混进一条脏数据（如结束时间在 2999 年），
 * 没有上限的循环会直接把主线程转死。截断到 62 天不影响任何真实使用场景——
 * 一屏最多也就 42 天。
 */
export function coveredDayKeys(startIso: string, endIso: string | null): string[] {
  const MAX_SPAN = 62;
  const start = dayjs(startIso);
  if (!start.isValid()) return [];
  const end = endIso ? dayjs(endIso) : start;
  const last = end.isValid() && end.isAfter(start) ? end : start;

  const keys: string[] = [];
  let cursor = start.startOf('day');
  const stop = last.startOf('day');
  for (let i = 0; i <= MAX_SPAN; i++) {
    keys.push(cursor.format('YYYY-MM-DD'));
    if (!cursor.isBefore(stop)) break;
    cursor = cursor.add(1, 'day');
  }
  return keys;
}

/**
 * 判断某纪念日是否命中某个本地日键（纯计算，无副作用）。
 *
 * 匹配规则：
 * - yearly：date 为 MM-DD，把 dateKey 的年拼上 MM-DD 比对；
 * - monthly：date 为 DD（仅日），只比对 dateKey 的「日」部分。
 *
 * year（起始年份）语义：yearly 模式下若设置了 year，则只有 dateKey 的年份
 * >= year 才算命中（如「只纪念出生后的年份」）；monthly 不受年份约束。
 *
 * @param dateKey 本地日键 YYYY-MM-DD
 * @param md      纪念日 date 字段（yearly → MM-DD；monthly → DD）
 * @param rule    重复规则 yearly / monthly
 * @param year    起始年份（可选），null 表示不限
 */
export function anniversaryHitsOn(
  dateKey: string,
  md: string,
  rule: 'yearly' | 'monthly',
  year?: number | null,
): boolean {
  if (rule === 'monthly') {
    const day = Number(md);
    const keyDay = Number(dateKey.slice(8, 10));
    return Number.isInteger(day) && day >= 1 && day <= 31 && day === keyDay;
  }
  // yearly：MM-DD 比对（含 02-29 闰日——非闰年不命中，语义正确）
  const keyYear = Number(dateKey.slice(0, 4));
  if (year != null && keyYear < year) return false;
  return dateKey.slice(5) === md;
}
