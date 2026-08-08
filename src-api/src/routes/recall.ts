import type { FastifyInstance } from 'fastify';
import * as recallController from '../controllers/recallController';

// 默认导出签名与 index.ts 注册方式保持不变 → src-api/src/index.ts 一行都不用改
export default async function (app: FastifyInstance) {
  app.get('/recall-sessions', recallController.list);
  app.get('/recall-sessions/:id', recallController.detail);
  app.post('/recall-sessions', recallController.create);
  app.post('/recall-sessions/:id/submit', recallController.submit);
  app.delete('/recall-sessions/:id', recallController.remove);
}
