/**
 * 数据导出路由（前缀 /api/export）：CSV 附件下载。
 * ⚠️ 与 SSE 同属「响应信封例外」——控制器直写 reply.header + reply.send。
 */
import type { FastifyInstance } from 'fastify';

import * as exportController from '../controllers/exportController';

export default async function (app: FastifyInstance) {
  app.get('/reviews', exportController.reviews);
  app.get('/habits', exportController.habits);
  app.get('/tasks', exportController.tasks);
}
