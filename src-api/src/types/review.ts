/* 间隔复习（新 SRS 系统，前缀 /api/reviews）领域类型
 *
 * ⚠️ 与 types/reviews.ts 区分：
 * - 本文件对应 routes/review.ts（前缀 /api/reviews），跨 wb_note + wb_palace_loci 两张源表聚合；
 * - types/reviews.ts 对应 routes/reviews.ts（前缀 /api/workbench/reviews），操作 wb_review_card。
 * 两套契约并存、互不干扰，改名或合并都会破坏前端。
 *
 * 本文件只放纯类型：RATING_TO_QUALITY、MAX_DUE 等运行时常量归 services/reviewService.ts。
 */

/** 复习卡来源表 */
export type ReviewSourceType = 'note' | 'loci';

/** 前端评分档位。注意 easy 与 perfect 在 SM-2 排程上等价（均 quality=3） */
export type ReviewRating = 'hard' | 'good' | 'easy' | 'perfect';

/** 前端统一的复习卡结构（notes / loci 两类源聚合后都映射成它） */
export interface ReviewCardVO {
  id: number;
  sourceType: ReviewSourceType;
  front: string;
  back: string;
  dueDate: string;
  masteredLevel: number;
  easeFactor: number;
  /** SM-2 已复习轮数（0 = 新卡，>=1 = 复习卡） */
  repetitions: number;
  /** 累计遗忘次数（>2 标记易忘卡） */
  lapseCount: number;
}

/** POST /reviews/submit 入参。字段全部可选：校验在 controller 完成，此处如实描述未校验形态 */
export interface SubmitReviewDTO {
  cardId?: number | null;
  sourceType?: string;
  rating?: string;
}

/** POST /reviews/submit 出参 */
export interface SubmitReviewVO {
  ok: true;
  sourceType: ReviewSourceType;
  nextDue: string;
  masteredLevel: number;
  /** 小数形态的 EF（如 2.5），与库里存的整数 250 区分 */
  easeFactor: number;
  lapsed: boolean;
}

/** PUT /reviews/snooze 入参 */
export interface SnoozeReviewDTO {
  cardId?: number | null;
  sourceType?: string;
}

/** PUT /reviews/snooze 出参 */
export interface SnoozeReviewVO {
  ok: true;
  sourceType: ReviewSourceType;
  cardId: number;
  nextDue: string;
}

/**
 * 挂起结果三态。
 * service 不碰 reply，用可辨识联合把「限流 / 不存在 / 成功」交给 controller 翻译成 429 / 404 / 200。
 */
export type SnoozeOutcome =
  | { kind: 'throttled'; retryAfterSec: number }
  | { kind: 'notFound' }
  | { kind: 'ok'; data: SnoozeReviewVO };

/** GET /reviews/heatmap 单日点 */
export interface HeatmapPoint {
  date: string;
  count: number;
}

export interface HeatmapVO {
  startDate: string;
  endDate: string;
  days: number;
  data: HeatmapPoint[];
}

/**
 * GET /reviews/forgetting-curve 单日点。
 * ⚠️ 与 types/reviews.ts 的 ForgettingCurvePoint 字段同形但契约独立：
 * 本系统 lapse 判据是 quality < 2，旧系统是 quality === 0。刻意不复用类型，避免日后被合并。
 */
export interface ReviewForgettingCurvePoint {
  date: string;
  reviews: number;
  lapses: number;
  /** 当日遗忘率；无复习记录时为 0 而非 NaN */
  lapseRate: number;
  newCards: number;
}

export interface ReviewForgettingCurveVO {
  startDate: string;
  endDate: string;
  points: ReviewForgettingCurvePoint[];
  totalReviews: number;
  totalLapses: number;
  overallLapseRate: number;
}
