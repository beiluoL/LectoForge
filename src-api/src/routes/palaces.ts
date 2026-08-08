import type { FastifyInstance } from 'fastify';
import * as palaceController from '../controllers/palaceController';

// 默认导出签名与 index.ts 注册方式保持不变 → src-api/src/index.ts 一行都不用改
export default async function (app: FastifyInstance) {
  app.get('/palaces', palaceController.list);
  app.get('/palaces/:id', palaceController.detail);
  app.post('/palaces', palaceController.create);
  app.put('/palaces/:id', palaceController.update);
  app.delete('/palaces/:id', palaceController.remove);
  app.get('/palaces/:palaceId/loci', palaceController.listLoci);
  app.post('/loci', palaceController.createLoci);
  app.put('/loci/:id', palaceController.updateLoci);
  app.get('/palaces/:id/review/due', palaceController.listDue);
  app.delete('/loci/:id', palaceController.removeLoci);
}
