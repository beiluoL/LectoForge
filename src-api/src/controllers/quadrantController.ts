/* 四象限 Controller —— 薄 HTTP 层。
 *
 * 只做三件事：抽参数、调 service、把异常翻成状态码。
 * 这里**不允许**出现任何 SQL / drizzle 引用，也不手写 { code: 200, data }——
 * 成功信封由 index.ts 的 onSend 钩子统一包装，直接 return 纯数据即可。
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import { pickPage } from '../lib/pagination';
import * as quadrantService from '../services/quadrantService';
import type { QuadrantTaskCreateInput, QuadrantTaskUpdateInput } from '../types/quadrant';

interface IdParam {
  id: string;
}

/** 「任务不存在」映射 404，其余入参问题映射 400 */
function fail(reply: FastifyReply, e: unknown, fallback: string) {
  const message = e instanceof Error ? e.message : fallback;
  const code = message.includes('不存在') ? 404 : 400;
  return reply.code(code).send({ code, message });
}

/** GET /quadrant/tasks —— 四象限分组数据（服务端一次查询完成分组） */
export async function listTasks(req: FastifyRequest, reply: FastifyReply) {
  try {
    return quadrantService.getGroupedTasks(pickPage(req.query));
  } catch (e) {
    return fail(reply, e, '加载失败');
  }
}

/** POST /quadrant/tasks —— 新建任务 */
export async function createTask(req: FastifyRequest, reply: FastifyReply) {
  try {
    const body = (req.body || {}) as QuadrantTaskCreateInput;
    return quadrantService.createTask(body);
  } catch (e) {
    return fail(reply, e, '创建失败');
  }
}

/** PUT /quadrant/tasks/:id —— 局部更新（含拖拽换象限） */
export async function updateTask(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    const body = (req.body || {}) as QuadrantTaskUpdateInput;
    return quadrantService.updateTask(Number(id), body);
  } catch (e) {
    return fail(reply, e, '更新失败');
  }
}

/** PUT /quadrant/tasks/:id/toggle —— 切换完成状态 */
export async function toggleTask(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    return quadrantService.toggleTask(Number(id));
  } catch (e) {
    return fail(reply, e, '状态切换失败');
  }
}

/** DELETE /quadrant/tasks/:id —— 删除任务 */
export async function deleteTask(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    return quadrantService.deleteTask(Number(id));
  } catch (e) {
    return fail(reply, e, '删除失败');
  }
}

/** POST /quadrant/clear-completed —— 清空某象限的已完成项 */
export async function clearCompleted(req: FastifyRequest, reply: FastifyReply) {
  try {
    const body = (req.body || {}) as { quadrant?: string };
    return quadrantService.clearCompleted(body.quadrant);
  } catch (e) {
    return fail(reply, e, '清理失败');
  }
}
