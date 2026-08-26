// 日历 API 客户端：对接后端 /api/calendar/*。
// 字段名与后端 DTO 完全一致（camelCase），前端 store 不再做映射。
//
// 唯一的例外是范围查询的两个参数：URL 上走下划线 start_date / end_date，
// 与后端 controller 的对外契约保持一致（后端同时兼容 camelCase，但这里只写一种，
// 避免出现「两个地方各写一种」的分裂）。
import { apiGet, apiPost, apiPut, apiDelete } from './request';

export interface CalendarEvent {
  id: number;
  userId: number;
  title: string;
  description: string | null;
  /** 开始时刻，UTC ISO 串 */
  startTime: string;
  /** 结束时刻，UTC ISO 串；null 表示单点事件 */
  endTime: string | null;
  /** 0 定时事件 / 1 全天事件 */
  isAllDay: number;
  /** 事件色，十六进制串（如 #3B6FE0） */
  color: string;
  location: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * 数据来源（与后端 types/calendar.ts 的 sourceType 一一对应）：
   * - 'calendar'   自定义日历事件
   * - 'daily_task' 旧「日程计划」每日任务（过渡期保留）
   * - 'task'       任务清单的「什么时候做」
   * - 'task_due'   任务清单的「截止日」
   */
  sourceType?: CalendarSourceType;
  /** 任务类来源专有：daily_task → wb_daily_task.id；task / task_due → wb_task.id */
  taskId?: number;
  /** 仅 task / task_due：0 未完成 / 1 已完成，前端据此加删除线 */
  taskCompleted?: number;
}

export type CalendarSourceType = 'calendar' | 'daily_task' | 'task' | 'task_due';

/**
 * 是否为「任务类」条目（而非普通日历事件）。
 *
 * 三种任务来源在日历里的渲染规则与点击行为完全一致（极简样式 + 跳 /tasks），
 * 差别只在配色。把判断收口成一个函数，是因为它散落在月视图、周视图、日视图
 * 至少 6 处；每加一种来源就要改 6 个 `=== 'daily_task'` 是必然漏改的写法。
 */
export function isTaskSource(ev: Pick<CalendarEvent, 'sourceType'>): boolean {
  return ev.sourceType === 'daily_task' || ev.sourceType === 'task' || ev.sourceType === 'task_due';
}

export interface CreateCalendarEventInput {
  title: string;
  startTime: string;
  endTime?: string | null;
  isAllDay?: number | boolean;
  color?: string | null;
  description?: string | null;
  location?: string | null;
}

export type UpdateCalendarEventInput = Partial<CreateCalendarEventInput>;

/**
 * 按日期范围拉取事件。
 *
 * 🔴 两个参数都是**必填**的，这是后端的性能红线：日历不提供全量拉取形态。
 * 调用方永远传「当前网格覆盖的第一天 / 最后一天」（本地日，YYYY-MM-DD），
 * 后端会按本机时区换算成时刻边界，并返回与该区间**重叠**的全部事件
 * （跨月的长事件也能在两侧月份各自出现）。
 */
export function fetchCalendarEvents(startDate: string, endDate: string): Promise<CalendarEvent[]> {
  return apiGet<CalendarEvent[]>('/calendar/events', { start_date: startDate, end_date: endDate });
}

export function createCalendarEvent(data: CreateCalendarEventInput): Promise<CalendarEvent> {
  return apiPost<CalendarEvent>('/calendar/events', data);
}

export function updateCalendarEvent(id: number, data: UpdateCalendarEventInput): Promise<CalendarEvent> {
  return apiPut<CalendarEvent>(`/calendar/events/${id}`, data);
}

export function deleteCalendarEvent(id: number): Promise<{ ok: true }> {
  return apiDelete(`/calendar/events/${id}`);
}

/* ==================== 纪念日 / 生日 ==================== */

export interface Anniversary {
  id: number;
  userId: number;
  name: string;
  /** lucide 图标名，默认 heart */
  iconName: string;
  /** yearly → MM-DD（如 03-15）；monthly → DD（如 15） */
  date: string;
  /** 起始年份（可选），null = 不限 */
  year: number | null;
  /** yearly（每年）/ monthly（每月） */
  repeatRule: 'yearly' | 'monthly';
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnniversaryInput {
  name: string;
  iconName?: string | null;
  date: string;
  year?: number | null;
  repeatRule?: 'yearly' | 'monthly' | null;
  note?: string | null;
}

export type UpdateAnniversaryInput = Partial<CreateAnniversaryInput>;

/** 获取全部纪念日（数据量小，全量拉取） */
export function fetchAnniversaries(): Promise<Anniversary[]> {
  return apiGet<Anniversary[]>('/calendar/anniversaries');
}

export function createAnniversary(data: CreateAnniversaryInput): Promise<Anniversary> {
  return apiPost<Anniversary>('/calendar/anniversaries', data);
}

export function updateAnniversary(id: number, data: UpdateAnniversaryInput): Promise<Anniversary> {
  return apiPut<Anniversary>(`/calendar/anniversaries/${id}`, data);
}

export function deleteAnniversary(id: number): Promise<{ ok: true }> {
  return apiDelete(`/calendar/anniversaries/${id}`);
}
