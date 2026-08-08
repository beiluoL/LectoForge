/**
 * 间隔复习路由（新 SRS 系统，前缀 /api，端点 /reviews/*）。
 *
 * ⚠️ 与 routes/reviews.ts 区分：那个挂在 /api/workbench 下操作 wb_review_card，两套并存。
 * 本层只做「路径 → controller」绑定，默认导出签名保持不变，index.ts 无需改动。
 */
import type { FastifyInstance } from 'fastify';

import * as reviewController from '../controllers/reviewController';

/** 类型已迁至 types/review.ts。此处保留一轮 re-export，避免历史引用点一次性改爆。 */
export type { ReviewCardVO } from '../types/review';

export default async function (app: FastifyInstance) {
  // 队列：limit 缺省 20（刷题页）；「待复习清单」抽屉传 100，服务端硬上限 200
  app.get('/reviews/due', reviewController.due);
  // 进度条分母：与驾驶舱 dueReviews 同判据，消除「31 vs 20」的观感落差
  app.get('/reviews/due-stats', reviewController.dueStats);
  app.post('/reviews/submit', reviewController.submit);
  // 挂起 24h：service 内置同卡 1 小时防刷守卫，被拦时回 429 + retryAfterSec
  app.put('/reviews/snooze', reviewController.snooze);
  // 采纳 AI 助记口诀 → 写入源表 image_hint
  app.put('/reviews/mnemonic', reviewController.mnemonic);
  app.get('/reviews/heatmap', reviewController.heatmap);
  app.get('/reviews/forgetting-curve', reviewController.forgettingCurve);
  // 热力图 / 遗忘曲线的单日下钻：那天复习了什么、哪些没记住
  app.get('/reviews/day', reviewController.day);
}
