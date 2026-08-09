/* 日历视图（月 / 周 / 日）模块 DTO / VO。
 *
 * 命名口径：字段一律 camelCase（startTime / isAllDay / createdAt），与 wb_note、
 * wb_quadrant_task 等既有模块一致，前端 store 拿到即用、两侧零映射。
 * ⚠️ 唯一的例外是 **查询参数** startDate / endDate —— 见 ListCalendarEventQuery
 * 的注释，那是对外契约里刻意保留的下划线别名。
 *
 * ⚠️ 本文件是**纯类型层**，禁止出现任何运行时值（常量、函数、默认色板）。
 *    色板与校验逻辑一律放 services/calendarService.ts。
 */
import type { PageQuery } from './pagination';

/** 库表行（wb_calendar_event），也是单条事件对外的 VO */
export interface CalendarEventRow {
  id: number;
  userId: number;
  title: string;
  description: string | null;
  /** 开始时刻，UTC ISO 串（如 2026-08-09T06:00:00.000Z） */
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
}

/**
 * GET /calendar/events 的查询参数。
 *
 * startDate / endDate 是**本地日历日**（YYYY-MM-DD），不是 ISO 时刻：
 * 调用方传的是「屏幕上这张网格覆盖了哪几天」，具体到几点几分的边界换算
 * 由服务端按本机时区完成（桌面端前后端同机，时区天然一致）。
 *
 * 两者都必填 —— 这是本模块的性能红线：没有范围就没有查询，
 * 绝不提供「拉全部事件」的接口形态，否则用三年后翻月会一次性拖回上万行。
 *
 * 继承 PageQuery 是全站列表的统一约定（page/pageSize 优先于 limit/offset）；
 * 日历一屏最多 42 天，默认 200 条的安全网足够，通常无需显式传分页。
 */
export interface ListCalendarEventQuery extends PageQuery {
  /** 起始日（含），YYYY-MM-DD */
  startDate: string;
  /** 结束日（含），YYYY-MM-DD */
  endDate: string;
}

/**
 * 合并后的单条「日历格内容」：既可能是自定义日历事件，也可能是来自 /schedule 的每日任务。
 *
 * 在 types 层只做类型声明（不引入运行时值）：`CalendarEventRow` 仍是库表行的原始形态，
 * 这里通过交叉类型补上两个**前端渲染分流**用的字段：
 * - sourceType：'calendar' = 普通日历事件；'daily_task' = 来自 wb_daily_task 的每日任务；
 * - taskId：仅 daily_task 有，指向 wb_daily_task.id，前端据此跳转 /schedule 并高亮。
 *
 * 两个字段都是「可选 + 联合字面量」，这样既有的 CalendarEventRow 仍是它的合法子集，
 * 既不用改其它用到 CalendarEventRow 的地方，又能让前端按 sourceType 安全分流。
 */
export interface CalendarEventWithSource extends CalendarEventRow {
  sourceType: 'calendar' | 'daily_task';
  /** 仅 sourceType==='daily_task' 时存在：对应 wb_daily_task 的主键 */
  taskId?: number;
}

export interface CalendarEventCreateInput {
  title: string;
  /** ISO 时刻串，必填；服务端会归一化成 UTC ISO */
  startTime: string;
  endTime?: string | null;
  /** 布尔与 0/1 都接受，服务端统一收敛为 0/1 */
  isAllDay?: number | boolean;
  color?: string | null;
  description?: string | null;
  location?: string | null;
}

/** 局部更新：只有显式出现的字段才会被写，未出现的字段保持原值 */
export interface CalendarEventUpdateInput {
  title?: string;
  startTime?: string;
  endTime?: string | null;
  isAllDay?: number | boolean;
  color?: string | null;
  description?: string | null;
  location?: string | null;
}
