/**
 * 复习卡牌控制器（workbench 旧系统，前缀 /api/workbench/reviews）。
 *
 * ⚠️ 与 controllers/reviewController.ts 区分：本文件服务 wb_review_card 旧体系，
 * 另一个服务 /api/reviews/*（跨 note + loci 的新 SRS）。两套契约并存，勿合并。
 *
 * 职责边界：取参 → 收窄类型 → 调 service → 决定 HTTP 状态码。
 * 成功响应一律 return 纯业务数据，{ code: 200, data } 信封由 index.ts 的 onSend 钩子唯一负责。
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import { pickPage } from '../lib/pagination';
import * as reviewsService from '../services/reviewsService';
import type { CreateReviewCardDTO, GradeReviewCardDTO, ListReviewCardQuery, UpdateReviewCardDTO } from '../types/reviews';

interface IdParams {
  id: string;
}

/** query string 原始形态：Fastify 不做 schema 校验时值恒为 string */
interface ListReviewCardRawQuery {
  categoryId?: string;
  noteId?: string;
}

interface DrawRawQuery {
  limit?: string;
}

interface ForgettingCurveRawQuery {
  days?: string;
}

/**
 * 卡片列表。
 *
 * ⚠️ 行为对齐：原路由用 `if (q.categoryId)` 做 truthy 判断，空串 `?categoryId=` 不参与过滤，
 * 而 service 侧判据是 `!== undefined`。此处保留 truthy 语义后再转 number，避免契约漂移。
 */
export async function list(req: FastifyRequest) {
  const q = req.query as ListReviewCardRawQuery;
  // 分页：未传时 service 侧的 resolvePage 会套用 DEFAULT_PAGE_SIZE 兜底
  const query: ListReviewCardQuery = { ...pickPage(req.query) };
  if (q.categoryId) query.categoryId = Number(q.categoryId);
  if (q.noteId) query.noteId = Number(q.noteId);
  return reviewsService.listCards(query);
}

export async function draw(req: FastifyRequest) {
  return reviewsService.drawCards((req.query as DrawRawQuery).limit);
}

export async function dueCount() {
  return reviewsService.getDueCount();
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const b = req.body as CreateReviewCardDTO;
  if (!b.front) return reply.code(400).send({ message: 'front required' });
  return reviewsService.createCard(b);
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const vo = reviewsService.updateCard(id, req.body as UpdateReviewCardDTO);
  if (!vo) return reply.code(404).send({ message: 'not found' });
  return vo;
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  reviewsService.deleteCard(Number((req.params as IdParams).id));
  return reply.code(204).send();
}

/**
 * SM-2 评分。
 *
 * ⚠️ 校验顺序与原文案逐字保留：先判 quality 缺失（'quality required'），
 * 再判范围（'评分质量需在 0~3 之间'），最后判卡片存在性（404 'not found'）。
 * NaN 落库导致 500 是既有行为，本轮不修正（详见 reviewsService.gradeReviewCard 注释）。
 */
export async function grade(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const b = req.body as GradeReviewCardDTO;
  if (b.quality === undefined || b.quality === null) {
    return reply.code(400).send({ message: 'quality required' });
  }
  const quality = Number(b.quality);
  if (quality < 0 || quality > 3) {
    return reply.code(400).send({ message: '评分质量需在 0~3 之间' });
  }
  const vo = reviewsService.gradeReviewCard(id, quality, b.costMs ?? null);
  if (!vo) return reply.code(404).send({ message: 'not found' });
  return vo;
}

export async function suspend(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  if (!reviewsService.toggleSuspend(id)) return reply.code(404).send({ message: 'not found' });
  return reply.code(200).send();
}

export async function forgettingCurve(req: FastifyRequest) {
  return reviewsService.getForgettingCurve((req.query as ForgettingCurveRawQuery).days);
}
