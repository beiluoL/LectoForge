import type { FastifyInstance } from 'fastify';
import * as storyController from '../controllers/storyController';

// 默认导出签名与 index.ts 注册方式保持不变 → src-api/src/index.ts 一行都不用改
export default async function (app: FastifyInstance) {
  app.get('/stories', storyController.list);
  app.get('/stories/:id', storyController.detail);
  app.post('/stories', storyController.create);
  app.put('/stories/:id', storyController.update);
  app.delete('/stories/:id', storyController.remove);
}
