/**
 * 日程计划控制器。
 *
 * 职责边界：取参 → 收窄类型 → 调 service → 决定 HTTP 状态码。
 * 成功响应一律 return 纯业务数据，{ code: 200, data } 信封由 index.ts 的 onSend 钩子唯一负责。
 * 校验失败用 reply.code(4xx).send({ message })；2xx 成功只 return 数据（含 204 时 return reply.code(204).send()）。
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import * as scheduleService from '../services/scheduleService';
import type {
  BatchAddDTO,
  CreateTemplateDTO,
  GenerateDTO,
  UpdateDailyTaskDTO,
} from '../types/schedule';

interface IdParams {
  id: string;
}

interface TasksQuery {
  date?: string;
}

export async function listTasks(req: FastifyRequest) {
  const date = (req.query as TasksQuery).date || scheduleService.todayKey();
  return scheduleService.listTasks(date);
}

export async function generate(req: FastifyRequest, reply: FastifyReply) {
  const b = req.body as GenerateDTO;
  if (!b.templateId || !b.targetDate) {
    return reply.code(400).send({ message: 'templateId 与 targetDate 必填' });
  }
  const r = scheduleService.generateFromTemplate(Number(b.templateId), b.targetDate);
  if (!r) return reply.code(404).send({ message: '模板不存在' });
  return r;
}

export async function batchAdd(req: FastifyRequest, reply: FastifyReply) {
  const b = req.body as BatchAddDTO;
  if (!b.targetDate || !Array.isArray(b.tasks)) {
    return reply.code(400).send({ message: 'targetDate 与 tasks[] 必填' });
  }
  return scheduleService.batchAddTasks(b.targetDate, b.tasks);
}

export async function updateTask(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const r = scheduleService.updateTask(id, req.body as UpdateDailyTaskDTO);
  if (!r) return reply.code(404).send({ message: '任务不存在' });
  return r;
}

export async function deleteTask(req: FastifyRequest, reply: FastifyReply) {
  scheduleService.deleteTask(Number((req.params as IdParams).id));
  return reply.code(204).send();
}

export async function listTemplates() {
  return scheduleService.listTemplates();
}

export async function createTemplate(req: FastifyRequest, reply: FastifyReply) {
  const b = req.body as CreateTemplateDTO;
  if (!b.name || !Array.isArray(b.tasks)) {
    return reply.code(400).send({ message: 'name 与 tasks[] 必填' });
  }
  return scheduleService.createTemplate(b.name, b.tasks);
}

export async function deleteTemplate(req: FastifyRequest, reply: FastifyReply) {
  scheduleService.deleteTemplate(Number((req.params as IdParams).id));
  return reply.code(204).send();
}
