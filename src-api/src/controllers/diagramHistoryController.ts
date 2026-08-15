/* 绘图工具 / 流程图 版本历史 Controller —— 薄 HTTP 层。
 *
 * 只做三件事：抽参数、调 service、把异常翻成状态码。
 * 这里**不允许**出现任何 SQL / drizzle 引用，也不手写 { code: 200, data }——
 * 成功信封由 index.ts 的 onSend 钩子统一包装，直接 return 纯数据即可。
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import * as diagramHistoryService from '../services/diagramHistoryService';
import type { DiagramHistoryRecordInput } from '../types/diagram';

interface IdParam {
  id: string;
}
interface IdHistoryParam {
  id: string;
  historyId: string;
}

/** 「图表不存在」/「历史版本不存在」映射 404，其余入参问题映射 400 */
function fail(reply: FastifyReply, e: unknown, fallback: string) {
  const message = e instanceof Error ? e.message : fallback;
  const code = message.includes('不存在') ? 404 : 400;
  return reply.code(code).send({ code, message });
}

/** GET /api/diagram/:id/history —— 历史列表 */
export async function listHistory(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    return diagramHistoryService.listHistory(Number(id));
  } catch (e) {
    return fail(reply, e, '加载历史失败');
  }
}

/** POST /api/diagram/:id/history —— 记录一条快照 */
export async function recordHistory(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as IdParam;
  try {
    const body = (req.body || {}) as DiagramHistoryRecordInput;
    const newId = diagramHistoryService.recordHistory(Number(id), body.snapshot, body.actionLabel);
    return { id: newId };
  } catch (e) {
    return fail(reply, e, '记录历史失败');
  }
}

/** POST /api/diagram/:id/history/restore/:historyId —— 恢复到此版本 */
export async function restoreHistory(req: FastifyRequest, reply: FastifyReply) {
  const { id, historyId } = req.params as IdHistoryParam;
  try {
    return diagramHistoryService.restoreHistory(Number(id), Number(historyId));
  } catch (e) {
    return fail(reply, e, '恢复失败');
  }
}

/** GET /api/diagram/:id/history/:historyId/download —— 取快照对象（前端据此落盘） */
export async function downloadHistory(req: FastifyRequest, reply: FastifyReply) {
  const { id, historyId } = req.params as IdHistoryParam;
  try {
    return diagramHistoryService.getHistory(Number(id), Number(historyId));
  } catch (e) {
    return fail(reply, e, '下载失败');
  }
}
