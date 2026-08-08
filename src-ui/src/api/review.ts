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
  /** 已采纳的助记口诀（源表 image_hint）；null = 尚未生成 */
  imageHint: string | null;
}

/**
 * 待复习总量与卡型分布。
 * 存在的意义：/reviews/due 只吐 20 条，而驾驶舱显示 31 —— 进度条要用这里的 total 当分母，
 * 文案「已复习 X / 共 Y 张」才对得上，用户不会以为系统漏卡。
 */
export interface ReviewDueStats {
  total: number;
  newCount: number;
  reviewCount: number;
  riskCount: number;
  noteCount: number;
  lociCount: number;
}

export interface SubmitReviewPayload {
  cardId: number;
  sourceType: ReviewSourceType;
  rating: ReviewRating;
}

/**
 * 提交评分的返回体。
 *
 * ⚠️ ok 是 boolean 而非恒 true：后端在「卡片已被删除」「落库失败」时会回
 * HTTP 200 + { ok:false, message }。这是刻意设计——4xx/5xx 会把前端推进 catch 分支，
 * 历史上正是那条路径导致用户被锁死在同一张卡。ok=false 时照常出队，只弹个 Toast。
 */
export interface SubmitReviewResult {
  ok: boolean;
  message?: string;
  sourceType?: ReviewSourceType;
  nextDue?: string;
  masteredLevel?: number;
  easeFactor?: number;
  lapsed?: boolean;
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

/** 单日复盘条目：热力图 / 遗忘曲线点击某天后展开的明细 */
export interface ReviewDayItem {
  cardId: number;
  /** 'card' 表示旧卡组的历史流水（无法回源卡面时 front 为空） */
  sourceType: ReviewSourceType | 'card';
  front: string;
  quality: number;
  lapsed: boolean;
  reviewedAt: string;
}

export interface ReviewDayResult {
  date: string;
  total: number;
  lapses: number;
  lapseRate: number;
  items: ReviewDayItem[];
}

export interface AdoptMnemonicPayload {
  cardId: number;
  sourceType: ReviewSourceType;
  /** 传空字符串 = 清除已采纳的口诀 */
  mnemonic: string;
}

export interface AdoptMnemonicResult {
  ok: boolean;
  cardId: number;
  sourceType: ReviewSourceType;
  mnemonic: string;
}

/**
 * 拉取待复习卡片（后端按 dueDate 升序裁剪）。
 * @param limit 刷题页用默认 20；「待复习清单」抽屉传 100（服务端硬上限 200）。
 */
export function getDueReviews(limit?: number) {
  return apiGet<ReviewCard[]>('/reviews/due', limit ? { limit } : undefined);
}

/** 待复习总量：进度条分母的唯一来源，与驾驶舱 dueReviews 同判据 */
export function getDueStats() {
  return apiGet<ReviewDueStats>('/reviews/due-stats');
}

/** 某天复习了什么、哪些没记住（热力图 / 遗忘曲线下钻） */
export function getReviewDay(date: string) {
  return apiGet<ReviewDayResult>('/reviews/day', { date });
}

/** 采纳助记口诀 → 写入源表 image_hint */
export function adoptMnemonic(payload: AdoptMnemonicPayload) {
  return apiPut<AdoptMnemonicResult>('/reviews/mnemonic', payload);
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
