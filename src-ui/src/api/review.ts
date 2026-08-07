// 间隔重复复习系统 API 客户端：对接后端 /api/reviews/due 与 /api/reviews/submit。
import { apiGet, apiPost } from './request';

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

/** 拉取待复习卡片（后端已按 dueDate 升序、最多 20 条裁剪） */
export function getDueReviews() {
  return apiGet<ReviewCard[]>('/reviews/due');
}

/** 提交一张卡片的评分，后端据此推进 SM-2 排程 */
export function submitReview(payload: SubmitReviewPayload) {
  return apiPost<SubmitReviewResult>('/reviews/submit', payload);
}
