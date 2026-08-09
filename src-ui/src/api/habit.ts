// 习惯打卡 API 客户端：对接后端 /api/habits/*。
// 字段名与后端 DTO 完全一致，前端 store 不再做映射。
import { apiGet, apiPost, apiPut, apiDelete } from './request';

/** 习惯（列表项带可选的 todayStatus；新建返回时无该字段） */
export interface Habit {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  iconName: string;
  color: string;
  frequency: string;
  createdAt: string;
  updatedAt: string;
  /** 今日打卡状态：0 未打卡 / 1 已打卡（列表接口返回，必存在） */
  todayStatus?: number;
  /** 当前连续打卡天数（列表接口返回，必存在） */
  streak?: number;
}

export interface HabitStats {
  habitId: number;
  /** 当前连续打卡天数 */
  streak: number;
  /** 历史最长连续天数 */
  bestStreak: number;
  /** 累计打卡天数 */
  totalDone: number;
  /** 近 30 天，升序 */
  monthlyData: { date: string; status: 0 | 1 }[];
  /** 近 365 天（热力图数据源），升序 */
  yearlyHeatmapData: { date: string; status: 0 | 1 }[];
}

/** 全局打卡概览：本周 / 本月打卡率 */
export interface HabitsSummary {
  /** 本周打卡率（0-100） */
  weekRate: number;
  /** 本月打卡率（0-100） */
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

export interface CreateHabitInput {
  name: string;
  description?: string | null;
  iconName: string;
  color: string;
  frequency?: string;
}

/** 拉取全部习惯（含今日状态） */
export function fetchHabits(): Promise<Habit[]> {
  return apiGet<Habit[]>('/habits');
}

/** 新建习惯 */
export function createHabit(data: CreateHabitInput): Promise<Habit> {
  return apiPost<Habit>('/habits', data);
}

/** 局部更新习惯 */
export function updateHabit(id: number, data: Partial<CreateHabitInput>): Promise<Habit> {
  return apiPut<Habit>(`/habits/${id}`, data);
}

/** 删除习惯（级联删除打卡记录） */
export function deleteHabit(id: number): Promise<{ ok: true }> {
  return apiDelete(`/habits/${id}`);
}

/** 切换某天打卡状态：返回切换后的最终状态 */
export function toggleHabitLog(
  id: number,
  date?: string,
  note?: string,
): Promise<{ habitId: number; logDate: string; status: number }> {
  return apiPost(`/habits/${id}/log`, { date, note });
}

/** 拉取单习惯统计（连续天数 / 热力图） */
export function fetchHabitStats(id: number): Promise<HabitStats> {
  return apiGet<HabitStats>(`/habits/${id}/stats`);
}

/** 拉取全局打卡概览（本周 / 本月打卡率） */
export function fetchHabitsSummary(): Promise<HabitsSummary> {
  return apiGet<HabitsSummary>('/habits/summary');
}
