/**
 * 面试控制器。
 *
 * - start / answer：SSE 流式端点。按本项目约定，这类端点**故意绕过** index.ts 的 onSend JSON 信封，
 *   直接接管 reply.raw 手写 text/event-stream（用 reply.hijack() 告知 Fastify 由我们掌控响应）。
 *   事件对象由 interviewService 的 async generator 逐个产出。
 * - transcribe：普通 JSON 端点（multipart 收音频 → 调 whisperSttService → 返回 { text }），
 *   走 onSend 信封，与其它控制器一致。
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import { LlmError } from '../lib/llm';
import * as interviewService from '../services/interviewService';
import * as whisperSttService from '../services/whisperSttService';
import { MAX_UPLOAD_BYTES } from '../services/inboxUploadService';
import type { QaBankFilter } from '../types/qaBank';

interface StartBody {
  filter?: QaBankFilter;
  /** 预设面试角色（通用面试官 / 大厂架构师 / HR面试官 / 同级评审 / 技术主管） */
  role?: string;
}
interface AnswerBody {
  sessionId?: string;
  transcript?: string;
}

/** 与 inboxController 同样用结构化类型收口 @fastify/multipart 的 part。 */
interface MultipartPart {
  filename?: string;
  mimetype?: string;
  file: NodeJS.ReadableStream & { truncated?: boolean };
}
type FileReader = {
  file(options?: { limits?: { fileSize?: number; files?: number } }): Promise<MultipartPart | undefined>;
};

/** 把 SSE 事件逐个手写进 reply.raw。 */
async function streamSse(reply: FastifyReply, gen: AsyncGenerator<interviewService.SseEvent>): Promise<void> {
  const res = reply.raw as typeof reply.raw & { flush?: () => void };
  // 接管响应：onSend 信封钩子不再介入，避免把 SSE 包成 { code, data }
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
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
    } catch {
      /* socket 可能已关闭，忽略 */
    }
  } finally {
    res.end();
  }
}

// ===================== SSE 流式端点 =====================

export async function start(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body ?? {}) as StartBody;
  await streamSse(reply, interviewService.startSession(b.filter, b.role));
}

export async function answer(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body ?? {}) as AnswerBody;
  if (!b.sessionId) {
    return reply.code(400).send({ message: 'sessionId 必填' });
  }
  await streamSse(reply, interviewService.answerSession(b.sessionId, b.transcript ?? ''));
}

// ===================== 普通 JSON 端点（STT 代理）=====================

export async function transcribe(req: FastifyRequest, reply: FastifyReply) {
  try {
    const part = await (req as unknown as FileReader).file({
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    });
    if (!part) return reply.code(400).send({ message: '未收到音频文件' });
    const chunks: Buffer[] = [];
    for await (const c of part.file) chunks.push(c as Buffer);
    if ((part.file as { truncated?: boolean }).truncated) {
      return reply.code(413).send({ message: '音频超过体积上限' });
    }
    const buffer = Buffer.concat(chunks);
    const { text } = await whisperSttService.transcribe(buffer, part.mimetype || 'audio/webm');
    return { text };
  } catch (e) {
    if (e instanceof LlmError) return reply.code(e.status).send({ message: e.message });
    const err = e as { statusCode?: number; message?: string };
    return reply.code(err?.statusCode || 500).send({ message: err?.message || '转写失败' });
  }
}
