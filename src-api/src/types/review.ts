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
  /** 已采纳的助记口诀（源表 image_hint）。null = 还没有，前端据此决定是否显示「生成」按钮 */
  imageHint: string | null;
}

/** GET /reviews/due 查询参数（limit 可选，缺省 20；解析与钳制在 service 完成） */
export interface DueQuery {
  limit?: string | number;
}

/**
 * GET /reviews/due-stats 出参：进度条分母的唯一真相。
 *
 * 存在的理由：/reviews/due 出于 UI 性能只吐 20 条，而用户在驾驶舱看到的是 31。
 * 前端拿 total 当分母、拿已处理数当分子，文案「已复习 X / 共 Y 张」即可消除落差。
 * total 与 dashboardService.dueReviews 采用**同一判据**（dueDate <= now），保证两处数字永远一致。
 */
export interface ReviewDueStatsVO {
  total: number;
  /** 从未复习过的新卡（repetitions = 0） */
  newCount: number;
  /** 已进入排程的复习卡 */
  reviewCount: number;
  /** 易忘卡（lapseCount > 2），前端用于风险提示 */
  riskCount: number;
  noteCount: number;
  lociCount: number;
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

/**
 * 「卡片已不存在」的软失败体。
 *
 * ⚠️ 这是刻意的 200 响应而非 404：客户端队列是一份快照，卡片可能在刷题过程中
 * 被别处删除。若回 4xx/5xx，前端 catch 后极易把用户锁死在同一张卡上（本次修复的核心场景）。
 * 用 { ok: false } 告诉前端「这张跳过就行，不是你的错」。
 */
export interface ReviewSkippedVO {
  ok: false;
  message: string;
}

/**
 * 提交评分结果三态。
 * service 不碰 reply，用可辨识联合把「成功 / 卡片已消失 / 内部异常」交给 controller 决定响应形态。
 * 注意 skipped 与 degraded 最终都会被翻译成 HTTP 200，差别只在文案与是否落库。
 */
export type SubmitOutcome =
  | { kind: 'ok'; data: SubmitReviewVO }
  | { kind: 'skipped'; message: string }
  | { kind: 'degraded'; message: string };

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

// ===================== 单日复盘（热力图 / 遗忘趋势的下钻）=====================

/** 单条当日复习记录。front 为空说明源卡已被删除，前端展示为「已删除的卡片」 */
export interface ReviewDayItem {
  cardId: number;
  /** 'note' | 'loci' 来自新 SRS；'card' 表示旧卡组的历史流水 */
  sourceType: ReviewSourceType | 'card';
  front: string;
  quality: number;
  /** quality < 2 判定为遗忘，与遗忘曲线口径一致 */
  lapsed: boolean;
  reviewedAt: string;
}

/** GET /reviews/day?date=YYYY-MM-DD 出参：那一天到底复习了什么、错在哪 */
export interface ReviewDayVO {
  date: string;
  total: number;
  lapses: number;
  lapseRate: number;
  items: ReviewDayItem[];
}

// ===================== 助记口诀落库 =====================

/** PUT /reviews/mnemonic 入参：把 AI 生成（或用户手写）的口诀写进源表的 image_hint */
export interface AdoptMnemonicDTO {
  cardId?: number | null;
  sourceType?: string;
  mnemonic?: string;
}

export interface AdoptMnemonicVO {
  ok: true;
  cardId: number;
  sourceType: ReviewSourceType;
  mnemonic: string;
}

/** 采纳口诀三态：与 snooze 一样，由 controller 翻译成状态码 */
export type AdoptMnemonicOutcome =
  | { kind: 'ok'; data: AdoptMnemonicVO }
  | { kind: 'notFound' }
  | { kind: 'badInput'; message: string };
