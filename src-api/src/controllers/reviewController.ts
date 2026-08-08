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
import type {
  AdoptMnemonicDTO,
  DueQuery,
  ReviewSourceType,
  SnoozeReviewDTO,
  SubmitReviewDTO,
} from '../types/review';

interface DaysRawQuery {
  days?: string;
}

interface DateRawQuery {
  date?: string;
}

/** 源表白名单校验：仅 note / loci 两种 */
function isReviewSourceType(v: unknown): v is ReviewSourceType {
  return v === 'note' || v === 'loci';
}

/** 卡片已消失的软失败体。刻意 200 —— 见 types/review.ts ReviewSkippedVO 的说明 */
const SKIPPED_MESSAGE = '卡片已不存在，跳过';

/** GET /reviews/due?limit=20 —— limit 缺省 20（刷题页），清单抽屉传 100 */
export async function due(req: FastifyRequest) {
  return reviewService.listDueCards((req.query as DueQuery).limit);
}

/** GET /reviews/due-stats —— 进度条分母；与驾驶舱 dueReviews 同判据 */
export async function dueStats() {
  return reviewService.getDueStats();
}

/**
 * 提交评分。
 *
 * ⚠️ 状态码策略在本轮**刻意调整**（队列卡死修复的一部分）：
 * ① body/字段整体缺失、rating 非法 → 仍是 400。这是调用方把请求写错了，
 *    前端四个评分按钮是写死的，真出现就该在开发期炸出来。
 * ② cardId 非法、sourceType 不在白名单、卡片查不到、落库失败
 *    → 一律 200 + { ok:false, message }。
 *    理由：这些都是「数据层面的意外」，而客户端队列只是一份快照。
 *    回 4xx/5xx 会让前端 catch 分支接管，历史上正是这条路径把用户锁死在同一张卡。
 *    用 200 明确告诉前端「这张跳过就行」，出队逻辑走正常分支。
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
  // 下面两条从「400 抛错」降级为「200 软跳过」：脏 cardId / 未知 sourceType
  // 都意味着这张卡在服务端无从定位，语义上等同于「已不存在」。
  if (!isReviewSourceType(b.sourceType)) {
    return { ok: false, message: SKIPPED_MESSAGE };
  }
  const cardId = Number(b.cardId);
  if (!Number.isInteger(cardId) || cardId <= 0) {
    return { ok: false, message: SKIPPED_MESSAGE };
  }

  const outcome = reviewService.submitReview(cardId, b.sourceType, quality);
  if (outcome.kind === 'ok') return outcome.data;
  // skipped / degraded 都是 200：前端据 ok=false 提示 Toast，但照常出队
  return { ok: false, message: outcome.message };
}

/** GET /reviews/day?date=YYYY-MM-DD —— 热力图 / 遗忘曲线的单日下钻 */
export async function day(req: FastifyRequest) {
  return reviewService.getReviewDay((req.query as DateRawQuery).date);
}

/** PUT /reviews/mnemonic —— 采纳助记口诀，写入源表 image_hint */
export async function mnemonic(req: FastifyRequest, reply: FastifyReply) {
  const b = req.body as AdoptMnemonicDTO | null;
  if (!b || b.cardId == null || !b.sourceType) {
    return reply.code(400).send({ message: '参数缺失：需要 cardId / sourceType' });
  }
  if (!isReviewSourceType(b.sourceType)) {
    return reply.code(400).send({ message: 'sourceType 仅支持 note / loci' });
  }

  const outcome = reviewService.adoptMnemonic(Number(b.cardId), b.sourceType, b.mnemonic);
  if (outcome.kind === 'badInput') return reply.code(400).send({ message: outcome.message });
  if (outcome.kind === 'notFound') return reply.code(404).send({ message: '卡片不存在' });
  return outcome.data;
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
