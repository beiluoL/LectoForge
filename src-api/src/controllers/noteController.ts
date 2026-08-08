import type { FastifyReply, FastifyRequest } from 'fastify';
import { pickPage } from '../lib/pagination';
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

/**
 * 解析笔记列表的筛选参数。
 *
 * GET /notes 与 GET /notes/stats 必须用**同一份**解析结果：
 * 统计卡显示的是「当前筛选下的总数」，两边若各自解析一遍，
 * 迟早会因为某一边漏接一个筛选项而对不上号。
 *
 * @param req         Fastify 请求
 * @param withPaging  是否带上分页四件套；统计接口不需要（统计天然是全量口径）
 */
function parseListQuery(req: FastifyRequest, withPaging: boolean): ListNoteQuery {
  const q = req.query as RawListQuery;
  const params: ListNoteQuery = {
    captureId: q.captureId ? Number(q.captureId) : undefined,
    categoryId: q.categoryId ? Number(q.categoryId) : undefined,
    keyword: q.keyword,
    tag: q.tag,
    // 分页：未传时 service 侧的 resolvePage 会套用该接口的默认页大小兜底
    ...(withPaging ? pickPage(req.query) : {}),
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

  return params;
}

export async function list(req: FastifyRequest) {
  return noteService.listNotes(parseListQuery(req, true));
}

/**
 * 列表页头部统计。刻意与 list 拆成两个请求，而不是把 total 塞进列表响应体：
 * 列表返回的是裸数组，改成 `{ items, total }` 会波及所有既有调用方，
 * 也会让 onSend 信封外面再套一层壳。加一个只读聚合端点是代价最小的做法。
 */
export async function stats(req: FastifyRequest) {
  return noteService.getNoteStats(parseListQuery(req, false));
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
