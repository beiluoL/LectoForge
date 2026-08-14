/* 绘图工具 / 流程图 Controller —— 薄 HTTP 层。
 *
 * 只做三件事：抽参数、调 service、把异常翻成状态码。
 * 这里**不允许**出现任何 SQL / drizzle 引用，也不手写 { code: 200, data }——
 * 成功信封由 index.ts 的 onSend 钩子统一包装，直接 return 纯数据即可。
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import * as diagramService from '../services/diagramService';
import type { DiagramCreateInput, DiagramUpdateInput } from '../types/diagram';

interface IdParam {
  id: string;
}

/** 「图表不存在」映射 404，其余入参问题映射 400 */
function fail(reply: FastifyReply, e: unknown, fallback: string) {
  const message = e instanceof Error ? e.message : fallback;
  const code = message.includes('不存在') ? 404 : 400;
  return reply.code(code).send({ code, message });
}

/** GET /api/diagram —— 列表 */
export async function listDiagrams(_req: FastifyRequest, reply: FastifyReply) {
  try {
    return diagramService.listDiagrams();
  } catch (e) {
    return fail(reply, e, '加载失败');
  }
}

/** GET /api/diagram/:id —— 详情 */
export async function getDiagram(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    return diagramService.getDiagram(Number(id));
  } catch (e) {
    return fail(reply, e, '加载失败');
  }
}

/** POST /api/diagram —— 新建（返回空白画布） */
export async function createDiagram(req: FastifyRequest, reply: FastifyReply) {
  try {
    const body = (req.body || {}) as DiagramCreateInput;
    return diagramService.createDiagram(body);
  } catch (e) {
    return fail(reply, e, '创建失败');
  }
}

/** PUT /api/diagram/:id —— 保存（防抖自动保存 / 手动保存） */
export async function updateDiagram(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    const body = (req.body || {}) as DiagramUpdateInput;
    return diagramService.updateDiagram(Number(id), body);
  } catch (e) {
    return fail(reply, e, '保存失败');
  }
}

/** DELETE /api/diagram/:id —— 删除 */
export async function deleteDiagram(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    return diagramService.deleteDiagram(Number(id));
  } catch (e) {
    return fail(reply, e, '删除失败');
  }
}
