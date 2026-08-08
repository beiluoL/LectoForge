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
  app.get('/reviews/due', reviewController.due);
  app.post('/reviews/submit', reviewController.submit);
  app.put('/reviews/snooze', reviewController.snooze);
  app.get('/reviews/heatmap', reviewController.heatmap);
  app.get('/reviews/forgetting-curve', reviewController.forgettingCurve);
}
