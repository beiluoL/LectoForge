import type { FastifyInstance } from 'fastify';
import * as captureController from '../controllers/captureController';

// 默认导出签名与 index.ts 注册方式保持不变 → src-api/src/index.ts 一行都不用改
export default async function (app: FastifyInstance) {
  app.get('/captures', captureController.list);
  app.get('/captures/:id', captureController.detail);
  app.post('/captures', captureController.create);
  app.put('/captures/:id', captureController.update);
  app.delete('/captures/:id', captureController.remove);
  app.put('/captures/:id/status', captureController.setStatus);
  app.put('/captures/:id/star', captureController.star);
}
