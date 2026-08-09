// 习惯打卡模块 DTO / VO（字段名与前端 store 完全对齐，避免两侧再做映射）。

/** 库表行（wb_habit） */
export interface HabitRow {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  iconName: string;
  color: string;
  frequency: string;
  createdAt: string;
  updatedAt: string;
}

/** 列表项：在 HabitRow 基础上附带「今日打卡状态」与当前连续天数 */
export interface HabitWithToday extends HabitRow {
  /** 今日打卡状态：0 未打卡 / 1 已打卡 */
  todayStatus: number;
  /** 当前连续打卡天数（当天未结束且昨天已打卡时不视为断签） */
  streak: number;
}

export interface HabitCreateInput {
  name: string;
  description?: string | null;
  iconName?: string;
  color?: string;
  frequency?: string;
}

export interface HabitUpdateInput {
  name?: string;
  description?: string | null;
  iconName?: string;
  color?: string;
  frequency?: string;
}

export interface ToggleLogInput {
  habitId: number;
  /** 目标日期 YYYY-MM-DD，缺省为今天 */
  date?: string;
  note?: string | null;
}

export interface ToggleLogResult {
  habitId: number;
  logDate: string;
  status: number;
}

export interface HabitStatsVO {
  habitId: number;
  /** 当前连续打卡天数（今天没打卡则从昨天起算，当天未结束不视为断签） */
  streak: number;
  /** 历史最长连续天数 */
  bestStreak: number;
  /** 累计打卡天数 */
  totalDone: number;
  /** 近 30 天，按日期升序 */
  monthlyData: { date: string; status: 0 | 1 }[];
  /** 近 365 天（GitHub 风格热力图数据源），按日期升序 */
  yearlyHeatmapData: { date: string; status: 0 | 1 }[];
}

/** 全局打卡概览（跨所有习惯）：本周 / 本月打卡率 */
export interface HabitSummaryVO {
  /** 本周打卡率（百分比 0-100，整数；周一为一周起点） */
  weekRate: number;
  /** 本月打卡率（百分比 0-100，整数） */
  monthRate: number;
  /** 今日已打卡习惯数 */
  todayDone: number;
  /** 习惯总数 */
  totalHabits: number;
  /** 本周已过天数（含今天） */
  weekDaysElapsed: number;
  /** 本月已过天数（含今天） */
  monthDaysElapsed: number;
}
