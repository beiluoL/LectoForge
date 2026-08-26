/* 日历 Controller —— 薄 HTTP 层。
 *
 * 只做三件事：抽参数、调 service、把异常翻成状态码。
 * 这里**不允许**出现任何 SQL / drizzle 引用，也不手写 { code: 200, data }——
 * 成功信封由 index.ts 的 onSend 钩子统一包装，直接 return 纯数据即可。
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import { pickPage } from '../lib/pagination';
import * as calendarService from '../services/calendarService';
import type {
  AnniversaryCreateInput,
  AnniversaryUpdateInput,
  CalendarEventCreateInput,
  CalendarEventUpdateInput,
} from '../types/calendar';

interface IdParam {
  id: string;
}

/**
 * 范围查询的原始 query。
 *
 * 对外用下划线 start_date / end_date：这两个是**日期参数**而非实体字段，
 * 与 URL 里的 query string 惯例（全小写下划线）保持一致，也和请求体里
 * camelCase 的实体字段形成视觉区分。同时兼容 camelCase 写法，
 * 避免调用方两种直觉都写错。
 */
interface RangeQuery {
  start_date?: string;
  end_date?: string;
  startDate?: string;
  endDate?: string;
}

/** 「事件不存在」映射 404，其余入参问题映射 400 */
function fail(reply: FastifyReply, e: unknown, fallback: string) {
  const message = e instanceof Error ? e.message : fallback;
  const code = message.includes('不存在') ? 404 : 400;
  return reply.code(code).send({ code, message });
}

/**
 * GET /calendar/events —— 按日期范围查询事件。
 *
 * start_date / end_date 必填（性能红线：没有范围就没有查询）。
 * 缺参数时在这里直接挡下并返回 400，不进 service —— 让错误信息明确指向
 * 「你少传了什么」，而不是从时间解析报错里去猜。
 */
export async function listEvents(req: FastifyRequest, reply: FastifyReply) {
  const q = (req.query || {}) as RangeQuery;
  const startDate = q.start_date ?? q.startDate;
  const endDate = q.end_date ?? q.endDate;

  if (!startDate || !endDate) {
    return reply.code(400).send({ code: 400, message: '缺少必填参数 start_date / end_date' });
  }

  try {
    return calendarService.listEventsInRange({ startDate, endDate, ...pickPage(req.query) });
  } catch (e) {
    return fail(reply, e, '加载失败');
  }
}

/** POST /calendar/events —— 新建事件 */
export async function createEvent(req: FastifyRequest, reply: FastifyReply) {
  try {
    const body = (req.body || {}) as CalendarEventCreateInput;
    return calendarService.createEvent(body);
  } catch (e) {
    return fail(reply, e, '创建失败');
  }
}

/** PUT /calendar/events/:id —— 局部更新（改标题 / 挪时间 / 换颜色） */
export async function updateEvent(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    const body = (req.body || {}) as CalendarEventUpdateInput;
    return calendarService.updateEvent(Number(id), body);
  } catch (e) {
    return fail(reply, e, '更新失败');
  }
}

/** DELETE /calendar/events/:id —— 删除事件 */
export async function deleteEvent(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    return calendarService.deleteEvent(Number(id));
  } catch (e) {
    return fail(reply, e, '删除失败');
  }
}

/* =====================================================================
 * 纪念日 / 生日（wb_anniversary）HTTP 层
 * ===================================================================== */

/** GET /calendar/anniversaries —— 获取某用户全部纪念日（全量，无需分页） */
export async function listAnniversaries(_req: FastifyRequest, reply: FastifyReply) {
  try {
    return calendarService.listAnniversaries();
  } catch (e) {
    return fail(reply, e, '加载纪念日失败');
  }
}

/** POST /calendar/anniversaries —— 新建纪念日 */
export async function createAnniversary(req: FastifyRequest, reply: FastifyReply) {
  try {
    const body = (req.body || {}) as AnniversaryCreateInput;
    return calendarService.createAnniversary(body);
  } catch (e) {
    return fail(reply, e, '创建纪念日失败');
  }
}

/** PUT /calendar/anniversaries/:id —— 修改纪念日 */
export async function updateAnniversary(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    const body = (req.body || {}) as AnniversaryUpdateInput;
    return calendarService.updateAnniversary(Number(id), body);
  } catch (e) {
    return fail(reply, e, '更新纪念日失败');
  }
}

/** DELETE /calendar/anniversaries/:id —— 删除纪念日 */
export async function deleteAnniversary(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    return calendarService.deleteAnniversary(Number(id));
  } catch (e) {
    return fail(reply, e, '删除纪念日失败');
  }
}
