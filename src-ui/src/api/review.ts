// 间隔重复复习系统 API 客户端：对接后端 /api/reviews/due 与 /api/reviews/submit。
import { apiGet, apiPost, apiPut } from './request';

export type ReviewSourceType = 'note' | 'loci';
export type ReviewRating = 'hard' | 'good' | 'easy' | 'perfect';

/** 后端统一映射后的复习卡（notes / loci 聚合为同一结构） */
export interface ReviewCard {
  id: number;
  sourceType: ReviewSourceType;
  /** 正面：回忆提示（康奈尔线索 / 宫殿位点名） */
  front: string;
  /** 反面：知识点详情（支持 Markdown） */
  back: string;
  /** 下次复习时间（ISO） */
  dueDate: string;
  /** 熟练度 0-5 */
  masteredLevel: number;
  /** SM-2 难度系数（整数 130-250，展示时 /100） */
  easeFactor: number;
  /** SM-2 已复习轮数（0 = 新卡，>=1 = 复习卡） */
  repetitions: number;
  /** 累计遗忘次数（>2 标记易忘卡） */
  lapseCount: number;
}

export interface SubmitReviewPayload {
  cardId: number;
  sourceType: ReviewSourceType;
  rating: ReviewRating;
}

export interface SubmitReviewResult {
  ok: boolean;
  sourceType: ReviewSourceType;
  nextDue: string;
  masteredLevel: number;
  easeFactor: number;
  lapsed: boolean;
}

export interface SnoozeReviewPayload {
  cardId: number;
  sourceType: ReviewSourceType;
}

export interface SnoozeReviewResult {
  ok: boolean;
  sourceType: ReviewSourceType;
  cardId: number;
  nextDue: string;
}

/** 热力图单日数据点 */
export interface ReviewHeatmapPoint {
  date: string;
  count: number;
}

export interface ReviewHeatmapResult {
  startDate: string;
  endDate: string;
  days: number;
  data: ReviewHeatmapPoint[];
}

/** 遗忘曲线单日数据点（与新系统聚合口径一致） */
export interface ReviewForgettingPoint {
  date: string;
  reviews: number;
  lapses: number;
  lapseRate: number;
  newCards: number;
}

export interface ReviewForgettingCurveResult {
  startDate: string;
  endDate: string;
  points: ReviewForgettingPoint[];
  totalReviews: number;
  totalLapses: number;
  overallLapseRate: number;
}

/** 拉取待复习卡片（后端已按 dueDate 升序、最多 20 条裁剪） */
export function getDueReviews() {
  return apiGet<ReviewCard[]>('/reviews/due');
}

/** 提交一张卡片的评分，后端据此推进 SM-2 排程 */
export function submitReview(payload: SubmitReviewPayload) {
  return apiPost<SubmitReviewResult>('/reviews/submit', payload);
}

/** 挂起（稍后再背）：顺延 24h，不计入评分 */
export function snoozeReview(payload: SnoozeReviewPayload) {
  return apiPut<SnoozeReviewResult>('/reviews/snooze', payload);
}

/** 复习热力图：按天聚合的日活跃数据 */
export function getReviewHeatmap(days = 30) {
  return apiGet<ReviewHeatmapResult>('/reviews/heatmap', { days });
}

/** 遗忘曲线：近 N 天复习量 / 遗忘率 / 新卡走势 */
export function getReviewForgettingCurve(days = 30) {
  return apiGet<ReviewForgettingCurveResult>('/reviews/forgetting-curve', { days });
}
