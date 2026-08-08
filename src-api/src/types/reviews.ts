/* 复习卡牌（workbench 旧系统，表 wb_review_card）领域类型
 *
 * ⚠️ 与 types/review.ts 区分：
 * - 本文件对应 routes/reviews.ts（前缀 /api/workbench/reviews），操作 wb_review_card；
 * - types/review.ts 对应 routes/review.ts（前缀 /api/reviews），是跨 note + loci 的新 SRS 系统。
 * 两套契约并存、互不干扰，改名或合并都会破坏前端。
 */
import type { wbReviewCard } from '../db/schema';

/** 数据库行（drizzle 推断，字段以 schema 为唯一定义源） */
export type ReviewCardRow = typeof wbReviewCard.$inferSelect;

/**
 * 列表 / 详情视图对象：在数据库行之上补三个派生字段。
 * 注意是「展开行 + 追加」，字段名与顺序都不能动——前端直接按行字段渲染。
 */
export type ReviewCardVO = ReviewCardRow & {
  /** easeFactor 存的是整数百分数（250 = 2.5），这里给前端一份小数形态 */
  easeFactorDecimal: number;
  /** 人类可读的「下次复习」提示：今天 / 明天 / N 天后 / 已逾期 N 天 / 待安排 */
  nextReviewHint: string;
  categoryName: string | null;
};

/** GET /reviews 的筛选条件 */
export interface ListReviewCardQuery {
  categoryId?: number;
  noteId?: number;
}

/** POST /reviews */
export interface CreateReviewCardDTO {
  captureId?: number | null;
  noteId?: number | null;
  categoryId?: number | null;
  front?: string;
  back?: string;
  cardType?: string;
}

/** PUT /reviews/:id —— 只覆盖请求体里出现的字段（undefined 表示不动） */
export interface UpdateReviewCardDTO {
  front?: string;
  back?: string;
  cardType?: string;
  captureId?: number | null;
  noteId?: number | null;
  categoryId?: number | null;
}

/** POST /reviews/:id/grade */
export interface GradeReviewCardDTO {
  quality?: unknown;
  costMs?: number | null;
}

/** 评分结果：nextReviewAt 与 Web 端语义一致（同一瞬时，前端按本地时区展示墙钟时间） */
export interface GradeReviewCardVO {
  cardId: number;
  quality: number;
  repetitions: number;
  intervalDay: number;
  /** 小数形态的 EF（如 2.5），与库里存的整数 250 区分 */
  easeFactor: number;
  nextReviewAt: number;
  lapsed: boolean;
}

/** GET /reviews/due-count —— 供桌面端原生通知调度轮询 */
export interface DueCountVO {
  count: number;
  sample: string[];
}

/** 遗忘曲线单日点 */
export interface ForgettingCurvePoint {
  date: string;
  reviews: number;
  lapses: number;
  /** 当日遗忘率；无复习记录时为 0 而非 NaN */
  lapseRate: number;
  newCards: number;
}

export interface ForgettingCurveVO {
  startDate: string;
  endDate: string;
  points: ForgettingCurvePoint[];
  totalReviews: number;
  totalLapses: number;
  overallLapseRate: number;
}
