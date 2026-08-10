/* 任务清单 Controller —— 薄 HTTP 层。
 *
 * 只做三件事：抽参数、调 service、把异常翻成状态码。
 * 这里**不允许**出现任何 SQL / drizzle 引用，也不手写 { code: 200, data }——
 * 成功信封由 index.ts 的 onSend 钩子统一包装，直接 return 纯数据即可。
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import { pickPage } from '../lib/pagination';
import * as taskService from '../services/taskService';
import type { ListTasksQuery, TaskCreateInput, TaskUpdateInput } from '../types/task';

interface IdParam {
  id: string;
}

/** 「不存在」映射 404，其余入参问题映射 400 */
function fail(reply: FastifyReply, e: unknown, fallback: string) {
  const message = e instanceof Error ? e.message : fallback;
  const code = message.includes('不存在') ? 404 : 400;
  return reply.code(code).send({ code, message });
}

/** GET /tasks —— 任务树（按 status / list_id / q 过滤，子任务随父返回） */
export async function listTasks(req: FastifyRequest, reply: FastifyReply) {
  try {
    const q = (req.query || {}) as ListTasksQuery;
    return taskService.listTasks({ ...q, ...pickPage(req.query) });
  } catch (e) {
    return fail(reply, e, '加载失败');
  }
}

/** GET /tasks/counters —— 侧边栏五个智能列表的徽标计数 */
export async function counters(_req: FastifyRequest, reply: FastifyReply) {
  try {
    return taskService.getCounters();
  } catch (e) {
    return fail(reply, e, '加载失败');
  }
}

/** GET /tasks/:id —— 单条详情 */
export async function getTask(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    const row = taskService.getTaskById(Number(id));
    if (!row) return reply.code(404).send({ code: 404, message: '任务不存在' });
    return row;
  } catch (e) {
    return fail(reply, e, '加载失败');
  }
}

/** POST /tasks —— 新建任务（parentTaskId 非空即为子任务） */
export async function createTask(req: FastifyRequest, reply: FastifyReply) {
  try {
    const body = (req.body || {}) as TaskCreateInput;
    return taskService.createTask(body);
  } catch (e) {
    return fail(reply, e, '创建失败');
  }
}

/** PUT /tasks/:id —— 局部更新（改标题 / 改日期 / 换清单 / 换状态） */
export async function updateTask(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    const body = (req.body || {}) as TaskUpdateInput;
    return taskService.updateTask(Number(id), body);
  } catch (e) {
    return fail(reply, e, '更新失败');
  }
}

/**
 * PUT /tasks/:id/complete —— 勾选 / 取消勾选。
 *
 * body 可选传 { completed: boolean } 强制指定；不传则由服务端读现值翻面，
 * 后者更抗并发（两个窗口同时点不会互相覆盖）。
 */
export async function completeTask(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    const body = (req.body || {}) as { completed?: boolean | number };
    const force = body.completed === undefined ? undefined : body.completed === true || Number(body.completed) === 1;
    return taskService.toggleComplete(Number(id), force);
  } catch (e) {
    return fail(reply, e, '状态切换失败');
  }
}

/** DELETE /tasks/:id —— 删除任务（连带其子任务） */
export async function deleteTask(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    taskService.deleteTask(Number(id));
    return { id: Number(id) };
  } catch (e) {
    return fail(reply, e, '删除失败');
  }
}

/** POST /tasks/clear-logbook —— 清空日志本 */
export async function clearLogbook(_req: FastifyRequest, reply: FastifyReply) {
  try {
    return { removed: taskService.clearLogbook() };
  } catch (e) {
    return fail(reply, e, '清理失败');
  }
}
