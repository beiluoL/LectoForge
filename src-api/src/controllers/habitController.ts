import type { FastifyReply, FastifyRequest } from 'fastify';

import * as habitService from '../services/habitService';
import type { HabitCreateInput, HabitUpdateInput, ToggleLogInput } from '../types/habit';

interface IdParam {
  id: string;
}

/** GET /habits —— 全部习惯 + 各自今日状态（单查询，见 service.getAllHabits） */
export async function listHabits() {
  return habitService.getAllHabits();
}

/** POST /habits —— 新建习惯 */
export async function createHabit(req: FastifyRequest, reply: FastifyReply) {
  try {
    const body = (req.body || {}) as HabitCreateInput;
    return habitService.createHabit(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : '创建失败';
    return reply.code(400).send({ code: 400, message });
  }
}

/** PUT /habits/:id —— 局部更新习惯 */
export async function updateHabit(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    const body = (req.body || {}) as HabitUpdateInput;
    return habitService.updateHabit(Number(id), body);
  } catch (e) {
    const message = e instanceof Error ? e.message : '更新失败';
    return reply.code(400).send({ code: 400, message });
  }
}

/** DELETE /habits/:id —— 删除习惯 + 级联打卡记录 */
export async function deleteHabit(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    return habitService.deleteHabit(Number(id));
  } catch (e) {
    const message = e instanceof Error ? e.message : '删除失败';
    return reply.code(400).send({ code: 400, message });
  }
}

/** POST /habits/:id/log —— 切换某天打卡状态（toggle / upsert） */
export async function toggleLog(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    const body = (req.body || {}) as ToggleLogInput;
    return habitService.toggleHabitLog({ habitId: Number(id), date: body.date, note: body.note });
  } catch (e) {
    const message = e instanceof Error ? e.message : '打卡失败';
    return reply.code(400).send({ code: 400, message });
  }
}

/** GET /habits/:id/stats —— 连续天数 / 热力图等统计 */
export async function habitStats(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    return habitService.getHabitStats(Number(id));
  } catch (e) {
    const message = e instanceof Error ? e.message : '统计失败';
    return reply.code(400).send({ code: 400, message });
  }
}

/** GET /habits/summary —— 跨习惯的本周 / 本月打卡率概览 */
export async function summary() {
  return habitService.getHabitsSummary();
}
