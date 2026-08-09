/**
 * 全局唯一的「时间 → 字符串」格式化模块。
 *
 * 【为什么从 utils/time.ts 升格到 lib/date.ts】
 * 原来这里只有相对时间两个函数，而 HH:mm:ss、MM-DD HH:mm、MM:SS、时长文案
 * 散在康奈尔笔记、主动回想、番茄钟统计、番茄钟 store、录音 composable 五个地方，
 * 各写各的 `padStart(2,'0')`。口径分裂的后果是同一个时刻在不同页面显示不一样，
 * 而且时区 / 补零 / 兜底空值这些坑要各踩一遍。
 * 现在的约定是：**项目里任何把时间变成字符串的逻辑都放这里**，
 * 全项目一律 `from '@/lib/date'`；`src/` 下不应再出现手写的日期补零。
 *
 * 【为什么相对时间用 dayjs，其余用原生 Date】
 * 相对时间要判断「是否今天 / 是否昨天 / 是否今年」，跨天与时区手算极易出错，
 * 交给 dayjs 插件最稳。而定长格式（HH:mm:ss / MM:SS）只是纯粹的取值 + 补零，
 * 引 dayjs 反而多一层解析语义——尤其 `MM-DD HH:mm` 那个函数要吃后端可能返回的
 * `'2026-08-08 10:00:00'`（空格分隔，非标准 ISO），原生 Date 配合手工 replace 的
 * 行为是当前线上已验证的，换 dayjs 解析口径会漂移。所以此处刻意混用，别"统一"。
 */
import dayjs from 'dayjs';
import isYesterday from 'dayjs/plugin/isYesterday';
import isToday from 'dayjs/plugin/isToday';

dayjs.extend(isYesterday);
dayjs.extend(isToday);

/** 两位补零，本模块内部共用 */
const pad2 = (n: number): string => String(n).padStart(2, '0');

/* ==================== 一、相对 / 绝对时间 ==================== */

/**
 * 人性化相对时间。
 * - < 1 分钟      → 刚刚
 * - < 60 分钟     → N分钟前
 * - 今天内        → N小时前
 * - 昨天          → 昨天 HH:mm
 * - 今年内        → M月D日
 * - 更早          → YYYY年M月D日
 *
 * 之所以不直接用 dayjs 的 relativeTime 插件：它的中文输出是「几秒前 / 1 天前」，
 * 而设计稿要求的是更口语的「刚刚 / 5分钟前 / 昨天」。这里用 diff 手写阶梯，
 * 保证文案可控，同时保留 dayjs 做日期解析与跨天判断（避免手算时区踩坑）。
 */
export function fromNow(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = dayjs(input);
  if (!d.isValid()) return '';

  const now = dayjs();
  const diffMin = now.diff(d, 'minute');

  // 容忍轻微的服务端 / 客户端时钟偏差，未来时间一律显示「刚刚」
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (d.isToday()) return `${now.diff(d, 'hour')}小时前`;
  if (d.isYesterday()) return `昨天 ${d.format('HH:mm')}`;
  if (d.year() === now.year()) return d.format('M月D日');
  return d.format('YYYY年M月D日');
}

/** 绝对时间，用于 title 悬浮提示（相对时间看不出确切时刻时的补充） */
export function formatDateTime(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = dayjs(input);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : '';
}

/* ==================== 二、定长时刻 ==================== */

/**
 * 时钟文本 `HH:mm:ss`。
 * 康奈尔笔记的自动保存时间戳在用——它只关心"今天几点存的"，不需要日期。
 */
export function formatClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * 短日期 + 时刻 `MM-DD HH:mm`，用于列表里排版紧凑的场景（如主动回想的会话历史）。
 *
 * 入参兼容两种后端格式：标准 ISO `2026-08-08T10:00:00` 与空格分隔的
 * `2026-08-08 10:00:00`。后者在 Safari/WebKit 上 `new Date()` 会得到 Invalid Date，
 * 所以先把空格换成 T——这行不是冗余，删了 macOS 上就炸。
 */
export function formatMonthDayTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 计划时间文案：`今天 14:30` / `明天 09:00` / `8月12日 09:00`（跨年补年份）。
 *
 * 四象限、日程这类「往前看」的场景在用：和 fromNow 正好相反——后者描述过去
 * （3小时前），这里描述未来。同一个 ISO 串在两处显示成不同文案是刻意的，
 * 任务卡片上写「3小时前」会让人误以为已经过期。
 *
 * 已经过去的时间点不特殊标记，由调用方自行判断是否加「已逾期」样式。
 */
export function formatScheduleTime(input?: string | null): string {
  if (!input) return '';
  const d = dayjs(input);
  if (!d.isValid()) return '';

  const now = dayjs();
  const hm = d.format('HH:mm');
  if (d.isSame(now, 'day')) return `今天 ${hm}`;
  if (d.isSame(now.add(1, 'day'), 'day')) return `明天 ${hm}`;
  if (d.isSame(now.subtract(1, 'day'), 'day')) return `昨天 ${hm}`;
  if (d.year() === now.year()) return `${d.format('M月D日')} ${hm}`;
  return `${d.format('YYYY年M月D日')} ${hm}`;
}

/**
 * 本地日历日键 `YYYY-MM-DD`。
 *
 * 日历模块用它把事件归到某一格：库里存的是 UTC ISO（`...T06:00:00.000Z`），
 * 直接 `slice(0, 10)` 在东八区会把 08:00 之前的事件算到前一天去。
 * 必须先落到本地时区再取年月日，这正是本函数存在的理由——
 * 项目里任何「时刻 → 某一天」的归属判断都应走这里，别再手写 slice。
 */
export function toDateKey(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = dayjs(input);
  return d.isValid() ? d.format('YYYY-MM-DD') : '';
}

/** 定长时刻 `HH:mm`（日历事件卡片、时间轴刻度在用） */
export function formatHM(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = dayjs(input);
  return d.isValid() ? d.format('HH:mm') : '';
}

/** 年月标题 `2026年8月`（日历顶部导航在用，月份不补零，与中文习惯一致） */
export function formatYearMonth(input: string | number | Date): string {
  const d = dayjs(input);
  return d.isValid() ? d.format('YYYY年M月') : '';
}

/** 年月日标题 `2026年8月9日 周日`（日历「日视图」标题在用） */
export function formatYearMonthDay(input: string | number | Date): string {
  const d = dayjs(input);
  if (!d.isValid()) return '';
  return `${d.format('YYYY年M月D日')} ${'周日周一周二周三周四周五周六'.slice(d.day() * 2, d.day() * 2 + 2)}`;
}

/** 计划时间是否已过（用于「逾期」红字），无值一律 false */
export function isOverdue(input?: string | null): boolean {
  if (!input) return false;
  const d = dayjs(input);
  return d.isValid() && d.isBefore(dayjs());
}

/* ==================== 三、时长 ==================== */

/**
 * 倒计时 / 计时文本 `MM:SS`。
 * 番茄钟菜单栏标题与录音计时共用，分钟数不截断（99 分钟以上照样显示 `120:00`）。
 */
export function formatMMSS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

/**
 * 人话时长：`45 分` / `2 时` / `2 时 30 分`。
 * 番茄钟统计页在用，秒数**四舍五入**到分钟（不是截断），保证「累计 59.6 分钟」
 * 显示成 1 时而不是 59 分导致和后端汇总对不上。
 */
export function formatDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} 分`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h} 时 ${rm} 分` : `${h} 时`;
}

/* ==================== 四、文件名时间戳 ==================== */

/**
 * 文件名安全的时间戳 `YYYYMMDD-HHmmss`（录音上传的默认文件名在用）。
 * 不含冒号与空格，可直接拼进文件名；用本地时区，方便用户对照自己的录制时间。
 */
export function formatFileStamp(d: Date = new Date()): string {
  const date = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  return `${date}-${time}`;
}
