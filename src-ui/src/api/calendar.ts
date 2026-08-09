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
  /** 数据来源：'calendar' = 自定义日历事件；'daily_task' = 来自 /schedule 的每日任务 */
  sourceType?: 'calendar' | 'daily_task';
  /** 仅 daily_task 有：对应 wb_daily_task 主键，前端据此跳转 /schedule 高亮 */
  taskId?: number;
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
