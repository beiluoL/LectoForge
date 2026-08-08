/**
 * 复习卡牌路由（workbench 旧系统，前缀 /api/workbench，表 wb_review_card）。
 *
 * ⚠️ 与 routes/review.ts 区分：那个是前缀 /api/reviews 的新 SRS 体系，两套并存。
 * 本层只做「路径 → controller」绑定，默认导出签名保持不变，index.ts 无需改动。
 */
import type { FastifyInstance } from 'fastify';

import * as reviewsController from '../controllers/reviewsController';

export default async function (app: FastifyInstance) {
  app.get('/reviews', reviewsController.list);
  app.get('/reviews/draw', reviewsController.draw);
  app.get('/reviews/due-count', reviewsController.dueCount);
  app.post('/reviews', reviewsController.create);
  app.put('/reviews/:id', reviewsController.update);
  app.delete('/reviews/:id', reviewsController.remove);
  app.post('/reviews/:id/grade', reviewsController.grade);
  app.put('/reviews/:id/suspend', reviewsController.suspend);
  app.get('/reviews/forgetting-curve', reviewsController.forgettingCurve);
}
