import type { FastifyInstance } from 'fastify';

import * as diagramController from '../controllers/diagramController';

// 注册到前缀 /api（见 src/index.ts 的 app.register(diagram, { prefix: '/api' })），
// 因此本文件只写内部路径：
//   GET    /diagram          列表（本用户全部图文件）
//   GET    /diagram/:id      详情（data 解析为对象）
//   POST   /diagram          新建（返回空白画布）
//   PUT    /diagram/:id      保存（防抖自动保存 / 手动保存）
//   DELETE /diagram/:id      删除
//
// Route 层只绑路径，禁止出现 db / drizzle / 业务判断。
export default async function (app: FastifyInstance) {
  app.get('/diagram', diagramController.listDiagrams);
  app.get('/diagram/:id', diagramController.getDiagram);
  app.post('/diagram', diagramController.createDiagram);
  app.put('/diagram/:id', diagramController.updateDiagram);
  app.delete('/diagram/:id', diagramController.deleteDiagram);
}
