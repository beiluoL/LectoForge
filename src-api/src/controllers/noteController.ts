import type { FastifyReply, FastifyRequest } from 'fastify';
import * as noteService from '../services/noteService';
import type { CreateNoteDTO, ListNoteQuery, UpdateNoteDTO } from '../types/note';

/** Fastify 在未声明 schema 时 req.query/params/body 为 unknown，这里用显式结构收口，避免 any */
interface RawListQuery {
  captureId?: string;
  categoryId?: string;
  keyword?: string;
  tag?: string;
  /** 智慧筛选器同时接受 snake_case 与 camelCase 两种写法（历史前端并存） */
  mastery_lte?: string;
  masteryLte?: string;
  has_summary?: string;
  hasSummary?: string;
}
interface IdParams {
  id: string;
}
interface RawResolveQuery {
  title?: string;
}

export async function list(req: FastifyRequest) {
  const q = req.query as RawListQuery;
  const params: ListNoteQuery = {
    captureId: q.captureId ? Number(q.captureId) : undefined,
    categoryId: q.categoryId ? Number(q.categoryId) : undefined,
    keyword: q.keyword,
    tag: q.tag,
  };

  // mastery_lte：非空且能解析成有限数才生效，脏参数一律忽略而不是报错
  const rawMastery = q.mastery_lte ?? q.masteryLte;
  if (rawMastery !== undefined && rawMastery !== '') {
    const v = Number(rawMastery);
    if (Number.isFinite(v)) params.masteryLte = v;
  }

  // has_summary：'true' / '1' 视为 true，其余视为 false；未传则不参与筛选
  const rawHasSummary = q.has_summary ?? q.hasSummary;
  if (rawHasSummary !== undefined && rawHasSummary !== '') {
    params.hasSummary = String(rawHasSummary) === 'true' || String(rawHasSummary) === '1';
  }

  return noteService.listNotes(params);
}

/**
 * 标签聚合（标签云数据源）。
 * 注意注册顺序：本路由是静态路径，必须在 /notes/:id 之前声明，
 * 否则 "tags" 会被参数路由吃掉、当成 id=NaN。
 */
export async function tags() {
  return noteService.listTagCounts();
}

export async function backlinks(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const rows = noteService.listBacklinks(id);
  if (rows === null) return reply.code(404).send({ message: 'not found' });
  return rows;
}

export async function resolve(req: FastifyRequest) {
  const raw = String((req.query as RawResolveQuery).title ?? '').trim();
  return noteService.resolveNoteByTitle(raw);
}

export async function detail(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const vo = noteService.findNote(id);
  if (!vo) return reply.code(404).send({ message: 'not found' });
  return vo;
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const b = req.body as CreateNoteDTO;
  if (!b.title) return reply.code(400).send({ message: 'title required' });
  return noteService.createNote(b);
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const b = req.body as UpdateNoteDTO;
  const vo = noteService.updateNote(id, b);
  if (!vo) return reply.code(404).send({ message: 'not found' });
  return vo;
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  noteService.deleteNote(id);
  return reply.code(204).send();
}
