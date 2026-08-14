/**
 * AI 助手 / 多轮对话控制器（挂载在 /api/ai-assistant）。
 *
 * 与 interviewController 同款边界约定：
 * - 普通 CRUD 走 run/fail 信封：成功返回纯数据，由 index.ts 的 onSend 包成 { code:200, data }；
 *   失败回报 { code, message, aiCode }，onSend 对错误响应原样透传。
 * - 流式端点（chat/completions、messages/:id/regenerate）**故意绕过** onSend 信封，
 *   用 reply.hijack() 接管 reply.raw 手写 text/event-stream（SSE），事件对象由
 *   aiAssistantService 的 async generator 逐个产出。LlmError 转成 error 事件带 aiCode。
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import { LlmError } from '../lib/llm';
import * as aiAssistantService from '../services/aiAssistantService';
import type { SseEvent } from '../services/aiAssistantService';
import type {
  AiResult,
  ChatCompletionsDTO,
  CreateConversationDTO,
  RateMessageDTO,
  UpdateConversationDTO,
} from '../types/ai';

/** 统一异常出口：LlmError 带业务码，其它异常兜底 500。 */
function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof LlmError) {
    return reply.code(e.status).send({ code: e.status, message: e.message, aiCode: e.code });
  }
  const msg = e instanceof Error ? e.message : String(e);
  return reply.code(500).send({ code: 500, message: `AI 助手处理失败：${msg}`, aiCode: 'AI_UPSTREAM_ERROR' });
}

/** Service 结果 → HTTP 响应的唯一通道（Controller 不写业务文案，只翻译 AiResult）。 */
async function run<T>(reply: FastifyReply, task: () => AiResult<T>) {
  const r = task();
  if (r.kind === 'ok') return r.data;
  return reply.code(r.status).send({ code: r.status, message: r.message, aiCode: r.aiCode });
}

/** 把 SSE 事件逐个手写进 reply.raw（接管响应，onSend 信封不再介入）。 */
async function streamSse(reply: FastifyReply, gen: AsyncGenerator<SseEvent>): Promise<void> {
  const res = reply.raw as typeof reply.raw & { flush?: () => void };
  reply.hijack();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  try {
    for await (const ev of gen) {
      res.write(`event: ${ev.event}\n`);
      res.write(`data: ${JSON.stringify(ev.data)}\n\n`);
      res.flush?.();
    }
  } catch (e) {
    const msg = e instanceof LlmError ? e.message : e instanceof Error ? e.message : String(e);
    const aiCode = e instanceof LlmError ? e.code : 'AI_UPSTREAM_ERROR';
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ message: msg, aiCode })}\n\n`);
    } catch {
      /* socket 可能已关闭，忽略 */
    }
  } finally {
    res.end();
  }
}

function parseId(req: FastifyRequest): number | null {
  const id = Number((req.params as { id: string }).id);
  return Number.isInteger(id) ? id : null;
}

// ===================== 会话 CRUD =====================

/** GET /conversations?search= */
export async function listConversations(req: FastifyRequest, reply: FastifyReply) {
  const search = (req.query as { search?: string } | undefined)?.search;
  return run(reply, () => aiAssistantService.listConversations(search));
}

/** POST /conversations */
export async function createConversation(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as CreateConversationDTO;
  return run(reply, () => aiAssistantService.createConversation(b.title));
}

/** GET /conversations/:id/messages */
export async function getMessages(req: FastifyRequest, reply: FastifyReply) {
  const id = parseId(req);
  if (id == null) return reply.code(400).send({ code: 400, message: '会话 id 无效', aiCode: 'AI_BAD_INPUT' });
  return run(reply, () => aiAssistantService.getMessages(id));
}

/** PUT /conversations/:id */
export async function updateConversation(req: FastifyRequest, reply: FastifyReply) {
  const id = parseId(req);
  if (id == null) return reply.code(400).send({ code: 400, message: '会话 id 无效', aiCode: 'AI_BAD_INPUT' });
  const b = (req.body || {}) as UpdateConversationDTO;
  return run(reply, () => aiAssistantService.updateConversation(id, b));
}

/** DELETE /conversations/:id（事务级联删消息） */
export async function deleteConversation(req: FastifyRequest, reply: FastifyReply) {
  const id = parseId(req);
  if (id == null) return reply.code(400).send({ code: 400, message: '会话 id 无效', aiCode: 'AI_BAD_INPUT' });
  return run(reply, () => aiAssistantService.deleteConversation(id));
}

// ===================== 流式对话 =====================

/**
 * POST /chat/completions —— SSE 多轮对话。
 * 入参 { conversationId?, query }；query 为空直接返回 400（JSON），不进入 SSE。
 */
export async function chatCompletions(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as ChatCompletionsDTO;
  const query = (b.query || '').trim();
  if (!query) {
    return reply.code(400).send({ code: 400, message: '问题不能为空', aiCode: 'AI_BAD_INPUT' });
  }
  await streamSse(reply, aiAssistantService.chatCompletionsStream({ conversationId: b.conversationId, query }));
}

/** POST /messages/:id/rating */
export async function rateMessage(req: FastifyRequest, reply: FastifyReply) {
  const id = parseId(req);
  if (id == null) return reply.code(400).send({ code: 400, message: '消息 id 无效', aiCode: 'AI_BAD_INPUT' });
  const b = (req.body || {}) as RateMessageDTO;
  return run(reply, () => aiAssistantService.rateMessage(id, b.rating));
}

/** POST /messages/:id/regenerate —— SSE 重新生成该助手消息 */
export async function regenerateMessage(req: FastifyRequest, reply: FastifyReply) {
  const id = parseId(req);
  if (id == null) return reply.code(400).send({ code: 400, message: '消息 id 无效', aiCode: 'AI_BAD_INPUT' });
  await streamSse(reply, aiAssistantService.regenerateMessageStream(id));
}
