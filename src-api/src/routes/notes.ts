import type { FastifyInstance } from 'fastify';
import * as noteController from '../controllers/noteController';

/**
 * 康奈尔笔记路由：只声明 HTTP 契约，不含任何业务与数据访问。
 *
 * ⚠️ 注册顺序有语义：静态路径 /notes/tags、/notes/stats、/notes/backlinks/:id、
 * /notes/resolve 必须排在参数路由 /notes/:id 之前，否则会被 :id 吃掉当成 NaN。
 */
export default async function (app: FastifyInstance) {
  app.get('/notes', noteController.list);
  app.get('/notes/tags', noteController.tags);
  // 列表分页后头部统计不能再用数组长度算，改由这个聚合端点直出
  app.get('/notes/stats', noteController.stats);
  app.get('/notes/backlinks/:id', noteController.backlinks);
  app.get('/notes/resolve', noteController.resolve);
  app.get('/notes/:id', noteController.detail);
  app.post('/notes', noteController.create);
  app.put('/notes/:id', noteController.update);
  app.delete('/notes/:id', noteController.remove);
}
