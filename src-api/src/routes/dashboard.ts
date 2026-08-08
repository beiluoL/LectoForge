import type { FastifyInstance } from 'fastify';
import * as dashboardController from '../controllers/dashboardController';

// 默认导出签名与 index.ts 注册方式保持不变 → src-api/src/index.ts 一行都不用改
export default async function (app: FastifyInstance) {
  app.get('/dashboard/stats', dashboardController.stats);
}
