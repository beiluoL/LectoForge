import type { FastifyReply, FastifyRequest } from 'fastify';

import { LlmError } from '../lib/llm';
import * as aiDiagramService from '../services/aiDiagramService';

/** 统一异常出口，与 routes/ai.ts / mindmapController 的 fail() 保持同一契约（aiCode 供前端判断是否引导去设置页） */
function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof LlmError) {
    return reply.code(e.status).send({ code: e.status, message: e.message, aiCode: e.code });
  }
  const msg = e instanceof Error ? e.message : String(e);
  return reply.code(500).send({ code: 500, message: `AI 生成失败：${msg}`, aiCode: 'AI_UPSTREAM_ERROR' });
}

/** POST /api/ai/diagram/generate —— 自然语言生成流程图结构（无坐标，前端负责自动布局） */
export async function generate(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as { prompt?: string; layout?: 'TB' | 'LR' };
  const prompt = String(b.prompt || '').trim();
  if (!prompt) {
    return reply.code(400).send({ code: 400, message: '请先描述你要生成的流程', aiCode: 'AI_BAD_INPUT' });
  }
  try {
    return await aiDiagramService.generateDiagram({ prompt, layout: b.layout === 'LR' ? 'LR' : 'TB' });
  } catch (e) {
    return fail(reply, e);
  }
}
