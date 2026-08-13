import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { LlmError } from '../lib/llm';
import * as insightService from '../services/insightService';
import type { AiResult } from '../types/ai';

/**
 * 主动智能：每日学习日报路由（挂载在 /api/insight）。
 *
 * 边界约定：
 * - Route 层只做「接收请求 + 翻译结果」，不碰 db、不直接调 LLM。
 * - 成功响应只返回纯数据，由 index.ts 的 onSend 统一包成 { code: 200, data }；
 *   失败的 AiResult 与 LlmError 翻译成子契约错误体 { code, message, aiCode }（onSend 对 >=400 原样透传）。
 */
export default async function (app: FastifyInstance) {
  // 昨日数据聚合（纯只读，无 AI 依赖）
  app.get('/daily-report', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      return insightService.getDailyReport();
    } catch (e) {
      return fail(reply, e);
    }
  });

  // 生成 AI 日报文案（带 1h 缓存，未配置 AI 时降级为 409 引导去设置）
  app.post('/daily-report/generate', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const r = await insightService.generateDailyReport();
      return replyResult(reply, r);
    } catch (e) {
      return fail(reply, e);
    }
  });

  // 基于昨日薄弱点生成强化复习卡（写入 wb_review_card，立即进入复习队列）
  app.post('/daily-report/generate-cards', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const r = await insightService.generateCards();
      return replyResult(reply, r);
    } catch (e) {
      return fail(reply, e);
    }
  });
}

/** Service 的 AiResult → HTTP 响应 */
function replyResult(reply: FastifyReply, r: AiResult<unknown>) {
  if (r.kind === 'ok') return r.data;
  return reply.code(r.status).send({ code: r.status, message: r.message, aiCode: r.aiCode });
}

/** 统一异常出口：LlmError 带业务码，其它异常兜底 500 */
function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof LlmError) {
    return reply.code(e.status).send({ code: e.status, message: e.message, aiCode: e.code });
  }
  const msg = e instanceof Error ? e.message : String(e);
  return reply.code(500).send({ code: 500, message: `日报处理失败：${msg}`, aiCode: 'AI_UPSTREAM_ERROR' });
}
