import type { FastifyReply, FastifyRequest } from 'fastify';
import { pickPage } from '../lib/pagination';
import * as captureService from '../services/captureService';
import type { CreateCaptureDTO, ListCaptureQuery, UpdateCaptureDTO } from '../types/capture';

/** Fastify 在未声明 schema 时 req.query/params/body 为 unknown，这里用显式结构收口，避免 any */
interface RawListQuery {
  status?: string;
  categoryId?: string;
  keyword?: string;
}
interface IdParams {
  id: string;
}
interface RawStatusQuery {
  status?: string;
}

export async function list(req: FastifyRequest) {
  const q = req.query as RawListQuery;
  const params: ListCaptureQuery = {
    status: q.status,
    categoryId: q.categoryId ? Number(q.categoryId) : undefined,
    keyword: q.keyword,
    // 分页：未传时 service 侧的 resolvePage 会套用 DEFAULT_PAGE_SIZE 兜底
    ...pickPage(req.query),
  };
  return captureService.listCaptures(params);
}

export async function detail(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const vo = captureService.findCapture(id);
  if (!vo) return reply.code(404).send({ message: 'not found' });
  return vo;
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const b = req.body as CreateCaptureDTO;
  if (!b.title) return reply.code(400).send({ message: 'title required' });
  return captureService.createCapture(b);
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const b = req.body as UpdateCaptureDTO;
  const vo = captureService.updateCapture(id, b);
  if (!vo) return reply.code(404).send({ message: 'not found' });
  return vo;
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  captureService.deleteCapture(id);
  return reply.code(204).send();
}

export async function setStatus(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const status = (req.query as RawStatusQuery).status;
  if (!status) return reply.code(400).send({ message: 'status required' });
  captureService.setCaptureStatus(id, status);
  return reply.code(200).send();
}

export async function star(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  if (!captureService.toggleStar(id)) return reply.code(404).send({ message: 'not found' });
  return reply.code(200).send();
}
