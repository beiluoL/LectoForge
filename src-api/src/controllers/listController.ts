/* 任务清单容器 Controller —— 薄 HTTP 层。
 *
 * 只做三件事：抽参数、调 service、把异常翻成状态码。
 * 禁 SQL / drizzle；成功信封由 index.ts 的 onSend 统一包装，直接 return 纯数据。
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import { pickPage } from '../lib/pagination';
import * as listService from '../services/listService';
import type { TaskListCreateInput, TaskListUpdateInput } from '../types/task';

interface IdParam {
  id: string;
}

function fail(reply: FastifyReply, e: unknown, fallback: string) {
  const message = e instanceof Error ? e.message : fallback;
  const code = message.includes('不存在') ? 404 : 400;
  return reply.code(code).send({ code, message });
}

/** GET /lists —— 侧边栏清单树（含未完成 / 总数计数） */
export async function listLists(req: FastifyRequest, reply: FastifyReply) {
  try {
    return listService.listLists(pickPage(req.query));
  } catch (e) {
    return fail(reply, e, '加载失败');
  }
}

/** POST /lists —— 新建清单 / 项目 / 领域 */
export async function createList(req: FastifyRequest, reply: FastifyReply) {
  try {
    const body = (req.body || {}) as TaskListCreateInput;
    return listService.createList(body);
  } catch (e) {
    return fail(reply, e, '创建失败');
  }
}

/** PUT /lists/:id —— 重命名 / 换图标 / 换父级 / 排序 */
export async function updateList(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    const body = (req.body || {}) as TaskListUpdateInput;
    return listService.updateList(Number(id), body);
  } catch (e) {
    return fail(reply, e, '更新失败');
  }
}

/** DELETE /lists/:id —— 删除清单（内部任务回落收件箱，不跟着删） */
export async function deleteList(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    listService.deleteList(Number(id));
    return { id: Number(id) };
  } catch (e) {
    return fail(reply, e, '删除失败');
  }
}
