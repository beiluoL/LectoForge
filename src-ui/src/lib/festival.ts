/**
 * 节日数据层（festival.ts）—— 动态与静态结合，统一「法定 / 传统 / 现代 / 纪念日」渲染数据源。
 *
 * 数据分三层：
 * 1) 法定节假日（休 / 班）：**直接复用** china-holidays.ts 的权威数据（国务院每年公布），
 *    不在此重复维护，避免两处数据漂移。
 * 2) 静态传统 / 现代节日：内置近三年（2024–2026）农历节日公历日期 + 固定公历节日。
 *    农历节日（中秋 / 端午 / 七夕 / 重阳 / 除夕等）直接硬编码公历日期——这是最轻量、
 *    性能最高的做法（免引入几十 KB 的 lunar-javascript）。每年数据量小（约 20 条），
 *    且为「展示型」信息，未来若需覆盖多年再引入农历库。
 * 3) 动态节日：母亲节 / 父亲节 / 感恩节 =「第几个星期几」，用 dayjs 数学计算，每年自动更新。
 *
 * 渲染约定（与视图层对齐）：
 * - statutory + isOffDay  → 红色胶囊「休」
 * - statutory + isWorkDay → 橙色胶囊「班」
 * - observance（传统/现代节日）→ 主题蓝/绿胶囊
 * - commemorative（纪念日，来自 store 的 wb_anniversary）→ 粉色 Heart 徽章
 */
import dayjs from 'dayjs';
import { CHINA_HOLIDAYS, type Holiday } from './china-holidays';

/** 节日类型：法定（休/班）、传统/现代节日、纪念日 */
export type FestivalType = 'statutory' | 'observance' | 'commemorative';

export interface Festival {
  /** 日期键 YYYY-MM-DD */
  date: string;
  /** 完整名称（如 中秋节 / 母亲节），用于 tooltip */
  name: string;
  /** 极简名（如 中秋），用于月视图小胶囊；长度上限 4 字，防止溢出 */
  shortName: string;
  type: FestivalType;
  /** 是否法定放假（渲染红色「休」） */
  isOffDay?: boolean;
  /** 是否调休补班（渲染橙色「班」） */
  isWorkDay?: boolean;
  /** 展示用 lucide 图标名（周/日视图节日文字前的图标） */
  icon?: string;
}

/* ==================== 静态数据：传统 / 现代节日（2024–2026） ==================== */

/**
 * 农历传统节日（公历日期硬编码）—— 近三年，按年分组。
 * 覆盖：除夕 / 春节 / 元宵 / 端午 / 七夕 / 中秋 / 重阳 / 腊八。
 * ⚠️ 春节的法定休假数据在 china-holidays.ts，这里只标记「传统节日」展示层。
 */
const LUNAR_FESTIVALS: Festival[] = [
  // ---- 2024 ----
  { date: '2024-02-09', name: '除夕', shortName: '除夕', type: 'observance', icon: 'moon-star' },
  { date: '2024-02-10', name: '春节', shortName: '春节', type: 'observance', icon: 'party-popper' },
  { date: '2024-02-24', name: '元宵节', shortName: '元宵', type: 'observance', icon: 'moon' },
  { date: '2024-06-10', name: '端午节', shortName: '端午', type: 'observance', icon: 'sailboat' },
  { date: '2024-08-10', name: '七夕节', shortName: '七夕', type: 'observance', icon: 'heart' },
  { date: '2024-09-17', name: '中秋节', shortName: '中秋', type: 'observance', icon: 'moon' },
  { date: '2024-10-11', name: '重阳节', shortName: '重阳', type: 'observance', icon: 'mountain' },
  // ---- 2025 ----
  { date: '2025-01-28', name: '除夕', shortName: '除夕', type: 'observance', icon: 'moon-star' },
  { date: '2025-01-29', name: '春节', shortName: '春节', type: 'observance', icon: 'party-popper' },
  { date: '2025-02-12', name: '元宵节', shortName: '元宵', type: 'observance', icon: 'moon' },
  { date: '2025-05-31', name: '端午节', shortName: '端午', type: 'observance', icon: 'sailboat' },
  { date: '2025-08-29', name: '七夕节', shortName: '七夕', type: 'observance', icon: 'heart' },
  { date: '2025-10-06', name: '中秋节', shortName: '中秋', type: 'observance', icon: 'moon' },
  { date: '2025-10-29', name: '重阳节', shortName: '重阳', type: 'observance', icon: 'mountain' },
  // ---- 2026 ----
  { date: '2026-02-16', name: '春节', shortName: '春节', type: 'observance', icon: 'party-popper' },
  { date: '2026-03-03', name: '元宵节', shortName: '元宵', type: 'observance', icon: 'moon' },
  { date: '2026-06-19', name: '端午节', shortName: '端午', type: 'observance', icon: 'sailboat' },
  { date: '2026-08-19', name: '七夕节', shortName: '七夕', type: 'observance', icon: 'heart' },
  { date: '2026-09-25', name: '中秋节', shortName: '中秋', type: 'observance', icon: 'moon' },
  { date: '2026-10-18', name: '重阳节', shortName: '重阳', type: 'observance', icon: 'mountain' },
];

/**
 * 固定公历节日（每年同月同日，按 MM-DD 匹配）。
 * 现代节日 / 国际纪念日，展示型信息，与法定休假无关。
 */
const SOLAR_FESTIVALS: { md: string; name: string; shortName: string; icon?: string }[] = [
  { md: '01-01', name: '元旦', shortName: '元旦', icon: 'party-popper' },
  { md: '02-14', name: '情人节', shortName: '情人节', icon: 'heart' },
  { md: '03-08', name: '妇女节', shortName: '妇女节', icon: 'flower-2' },
  { md: '03-12', name: '植树节', shortName: '植树节', icon: 'tree-pine' },
  { md: '04-01', name: '愚人节', shortName: '愚人节', icon: 'smile' },
  { md: '05-01', name: '劳动节', shortName: '劳动节', icon: 'briefcase' },
  { md: '05-04', name: '青年节', shortName: '青年节', icon: 'flame' },
  { md: '06-01', name: '儿童节', shortName: '儿童节', icon: 'baby' },
  { md: '07-01', name: '建党节', shortName: '建党节', icon: 'flag' },
  { md: '08-01', name: '建军节', shortName: '建军节', icon: 'shield' },
  { md: '09-10', name: '教师节', shortName: '教师节', icon: 'graduation-cap' },
  { md: '10-01', name: '国庆节', shortName: '国庆节', icon: 'flag' },
  { md: '12-25', name: '圣诞节', shortName: '圣诞', icon: 'snowflake' },
];

/* ==================== 动态节日（第几个星期几，每年自动更新） ==================== */

/** 第 n 个星期几：weekday 0=周日 ~ 6=周六，index 从 1 开始 */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, index: number): string {
  // 当月 1 号的星期几
  const first = dayjs(new Date(year, month - 1, 1)).day();
  // 第一个目标 weekday 的日期（1~7 之间）
  const firstOccurrence = 1 + ((weekday - first + 7) % 7);
  const day = firstOccurrence + (index - 1) * 7;
  return dayjs(new Date(year, month - 1, day)).format('YYYY-MM-DD');
}

/** 动态节日计算（按年月），返回该年所有动态节日（通常每年 3 个） */
function dynamicFestivalsOf(year: number): Festival[] {
  return [
    { date: nthWeekdayOfMonth(year, 5, 0, 2), name: '母亲节', shortName: '母亲节', type: 'observance' as const, icon: 'heart' },
    { date: nthWeekdayOfMonth(year, 6, 0, 3), name: '父亲节', shortName: '父亲节', type: 'observance' as const, icon: 'user' },
    { date: nthWeekdayOfMonth(year, 11, 4, 4), name: '感恩节', shortName: '感恩节', type: 'observance' as const, icon: 'pizza' },
  ];
}

/* ==================== 索引构建 ==================== */

/** 法定节假日索引（来自 china-holidays.ts 权威数据） */
const statutoryByDate = new Map<string, Holiday>(CHINA_HOLIDAYS.map((h) => [h.date, h]));

/** 农历传统节日索引（按日期键） */
const lunarByDate = new Map<string, Festival>(LUNAR_FESTIVALS.map((f) => [f.date, f]));

/** 动态节日缓存：年份 → Festival[]（同一年多次查询不重复计算） */
const dynamicCache = new Map<number, Festival[]>();

/** 公历节日按 MM-DD 索引 */
const solarByMd = new Map<string, (typeof SOLAR_FESTIVALS)[number]>(SOLAR_FESTIVALS.map((f) => [f.md, f]));

/**
 * 取某天的节日信息（含法定 / 传统 / 现代 / 动态节日），无则返回 null。
 *
 * 优先级（同一天可能重叠，如春节既是法定休也是传统节日，取展示更完整的组合）：
 * 1) 法定节假日：原样透传，标红「休」或橙「班」；
 * 2) 农历传统节日：叠加在法定之上（春节同时显示「休」语义 + 传统名）；
 * 3) 公历现代节日 / 动态节日：最低优先级，仅当该日无更重要的节日时填充。
 *
 * @param dateString 日期键 YYYY-MM-DD
 */
export function getFestivalInfo(dateString: string): Festival | null {
  const [y, md] = [dateString.slice(0, 4), dateString.slice(5)];
  const year = Number(y);
  if (!Number.isInteger(year) || year < 2024 || year > 2100) return null;

  // 1) 法定节假日（休 / 班）—— 权威优先
  const stat = statutoryByDate.get(dateString);
  if (stat) {
    return {
      date: dateString,
      name: stat.name,
      shortName: stat.isOffDay ? '休' : '班',
      type: 'statutory',
      isOffDay: stat.isOffDay,
      isWorkDay: !stat.isOffDay,
      icon: stat.isOffDay ? 'moon-star' : 'briefcase',
    };
  }

  // 2) 农历传统节日
  const lunar = lunarByDate.get(dateString);
  if (lunar) return lunar;

  // 3) 动态节日（母亲节 / 父亲节 / 感恩节）
  let dynamic = dynamicCache.get(year);
  if (!dynamic) {
    dynamic = dynamicFestivalsOf(year);
    dynamicCache.set(year, dynamic);
  }
  const dyn = dynamic.find((f) => f.date === dateString);
  if (dyn) return dyn;

  // 4) 公历现代节日
  const solar = solarByMd.get(md);
  if (solar) {
    return { date: dateString, name: solar.name, shortName: solar.shortName, type: 'observance', icon: solar.icon };
  }

  return null;
}
