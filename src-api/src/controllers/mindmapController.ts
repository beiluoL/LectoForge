import type { FastifyReply, FastifyRequest } from 'fastify';

import { LlmError } from '../lib/llm';
import * as mindmapAiService from '../services/mindmapAiService';
import * as mindmapService from '../services/mindmapService';
import type {
  CreateMindMapDTO,
  GenerateMindMapDTO,
  GenerateNoteMindMapDTO,
  UpdateMindMapDTO,
} from '../types/mindmap';

/** Fastify 未声明 schema 时 req.params 为 unknown，这里用显式结构收口，避免 any */
interface IdParams {
  id: string;
}

/**
 * 统一异常出口，与 routes/ai.ts 的 fail() 保持同一契约
 * （aiCode 供前端判断是否引导去设置页）。
 * TODO(Phase 4.8)：ai 模块下沉后与其 fail() 合并到同一处公共实现。
 */
function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof LlmError) {
    return reply.code(e.status).send({ code: e.status, message: e.message, aiCode: e.code });
  }
  const msg = e instanceof Error ? e.message : String(e);
  return reply.code(500).send({ code: 500, message: `AI 生成失败：${msg}`, aiCode: 'AI_UPSTREAM_ERROR' });
}

// ===================== CRUD =====================

export async function list() {
  return mindmapService.list();
}

export async function detail(req: FastifyRequest) {
  const { id } = req.params as IdParams;
  return mindmapService.detail(id);
}

export async function create(req: FastifyRequest) {
  const b = (req.body || {}) as CreateMindMapDTO;
  return mindmapService.create(b);
}

export async function update(req: FastifyRequest) {
  const { id } = req.params as IdParams;
  const b = (req.body || {}) as UpdateMindMapDTO;
  return mindmapService.update(id, b);
}

export async function remove(req: FastifyRequest) {
  const { id } = req.params as IdParams;
  return mindmapService.remove(id);
}

// ===================== AI 生成 =====================

/** POST /api/ai/generate-mindmap —— 由主题词发散 */
export async function generateMindmap(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as GenerateMindMapDTO;
  const topic = mindmapAiService.normalizeTopic(b.topic);
  if (!topic) {
    return reply.code(400).send({ code: 400, message: '请先输入主题词', aiCode: 'AI_BAD_INPUT' });
  }
  try {
    return await mindmapAiService.generateFromTopic({ topic, depth: b.depth, branches: b.branches });
  } catch (e) {
    return fail(reply, e);
  }
}

/** POST /api/ai/note/generate-mindmap —— 由康奈尔笔记正文归纳 */
export async function generateNoteMindmap(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as GenerateNoteMindMapDTO;
  const note = mindmapAiService.prepareNoteText(b.noteColumn);
  const noteTitle = String(b.title || '').trim();
  if (!note || note.length < 30) {
    return reply
      .code(400)
      .send({ code: 400, message: '笔记正文太短（至少 30 字），先写充实一点再生成导图', aiCode: 'AI_BAD_INPUT' });
  }
  const fallbackTitle = mindmapAiService.buildNoteFallbackTitle(noteTitle, note);

  try {
    return await mindmapAiService.generateFromNote({
      note,
      noteTitle,
      fallbackTitle,
      cueColumn: b.cueColumn,
      depth: b.depth,
      branches: b.branches,
    });
  } catch (e) {
    return fail(reply, e);
  }
}
