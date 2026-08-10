import type { FastifyInstance } from 'fastify';

import * as listController from '../controllers/listController';

// 注册到前缀 /api（见 src/index.ts 的 app.register(lists, { prefix: '/api' })），
// 因此本文件只写内部路径：
//   GET    /lists       侧边栏清单树（含任务计数）
//   POST   /lists       新建清单 / 项目 / 领域
//   PUT    /lists/:id   重命名 / 换图标 / 换父级 / 排序
//   DELETE /lists/:id   删除清单（内部任务回落收件箱）
//
// Route 层只绑路径，禁止出现 db / drizzle / 业务判断。
export default async function (app: FastifyInstance) {
  app.get('/lists', listController.listLists);
  app.post('/lists', listController.createList);
  app.put('/lists/:id', listController.updateList);
  app.delete('/lists/:id', listController.deleteList);
}
