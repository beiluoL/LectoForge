import type { FastifyReply, FastifyRequest } from 'fastify';
import { pickPage } from '../lib/pagination';
import * as storyService from '../services/storyService';
import type { CreateStoryDTO, ListStoryQuery, UpdateStoryDTO } from '../types/story';

interface RawListQuery {
  status?: string;
  categoryId?: string;
  keyword?: string;
}
interface IdParams {
  id: string;
}

export async function list(req: FastifyRequest) {
  const q = req.query as RawListQuery;
  const params: ListStoryQuery = {
    status: q.status,
    categoryId: q.categoryId ? Number(q.categoryId) : undefined,
    keyword: q.keyword,
    // 分页：未传时 service 侧的 resolvePage 会套用 DEFAULT_PAGE_SIZE 兜底
    ...pickPage(req.query),
  };
  return storyService.listStories(params);
}

export async function detail(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const vo = storyService.findStory(id);
  if (!vo) return reply.code(404).send({ message: 'not found' });
  return vo;
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const b = req.body as CreateStoryDTO;
  if (!b.title) return reply.code(400).send({ message: 'title required' });
  return storyService.createStory(b);
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const b = req.body as UpdateStoryDTO;
  const vo = storyService.updateStory(id, b);
  if (!vo) return reply.code(404).send({ message: 'not found' });
  return vo;
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  storyService.deleteStory(id);
  return reply.code(204).send();
}
