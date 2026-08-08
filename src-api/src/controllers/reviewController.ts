/**
 * 间隔复习控制器（新 SRS 系统，前缀 /api/reviews）。
 *
 * ⚠️ 与 controllers/reviewsController.ts 区分：本文件服务跨 note + loci 的新体系，
 * 另一个服务 /api/workbench/reviews/*（wb_review_card 旧体系）。两套契约并存，勿合并。
 *
 * 成功响应一律 return 纯业务数据，{ code: 200, data } 信封由 index.ts 的 onSend 钩子唯一负责。
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import * as reviewService from '../services/reviewService';
import type { ReviewSourceType, SnoozeReviewDTO, SubmitReviewDTO } from '../types/review';

interface DaysRawQuery {
  days?: string;
}

/** 源表白名单校验：仅 note / loci 两种 */
function isReviewSourceType(v: unknown): v is ReviewSourceType {
  return v === 'note' || v === 'loci';
}

export async function due() {
  return reviewService.listDueCards();
}

/**
 * 提交评分。
 *
 * ⚠️ 三段校验的顺序与文案逐字保留：
 * ① 参数缺失 → ② rating 不在映射表 → ③ sourceType 非白名单 → ④ 卡片不存在(404)。
 * 调换顺序会让同时缺多个参数时返回的错误文案发生变化，属契约漂移。
 */
export async function submit(req: FastifyRequest, reply: FastifyReply) {
  const b = req.body as SubmitReviewDTO | null;
  if (!b || b.cardId == null || !b.sourceType || !b.rating) {
    return reply.code(400).send({ message: '参数缺失：需要 cardId / sourceType / rating' });
  }
  const quality = reviewService.ratingToQuality(b.rating);
  if (quality === undefined) {
    return reply.code(400).send({ message: 'rating 仅支持 hard / good / easy / perfect' });
  }
  if (!isReviewSourceType(b.sourceType)) {
    return reply.code(400).send({ message: 'sourceType 仅支持 note / loci' });
  }

  const vo = reviewService.submitReview(b.cardId, b.sourceType, quality);
  if (!vo) return reply.code(404).send({ message: '卡片不存在' });
  return vo;
}

/** 挂起（稍后再背）：service 返回三态，此处翻译为 429 / 404 / 200 */
export async function snooze(req: FastifyRequest, reply: FastifyReply) {
  const b = req.body as SnoozeReviewDTO | null;
  if (!b || b.cardId == null || !b.sourceType) {
    return reply.code(400).send({ message: '参数缺失：需要 cardId / sourceType' });
  }
  if (!isReviewSourceType(b.sourceType)) {
    return reply.code(400).send({ message: 'sourceType 仅支持 note / loci' });
  }

  const outcome = reviewService.snoozeCard(b.cardId, b.sourceType);
  if (outcome.kind === 'throttled') {
    return reply
      .code(429)
      .send({ message: '同一张卡片 1 小时内不可重复挂起', retryAfterSec: outcome.retryAfterSec });
  }
  if (outcome.kind === 'notFound') return reply.code(404).send({ message: '卡片不存在' });
  return outcome.data;
}

export async function heatmap(req: FastifyRequest) {
  return reviewService.getHeatmap((req.query as DaysRawQuery).days);
}

export async function forgettingCurve(req: FastifyRequest) {
  return reviewService.getForgettingCurve((req.query as DaysRawQuery).days);
}
