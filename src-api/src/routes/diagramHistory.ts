import type { FastifyInstance } from 'fastify';

import * as diagramHistoryController from '../controllers/diagramHistoryController';

// 注册到前缀 /api（见 src/index.ts 的 app.register(diagramHistory, { prefix: '/api' })），
// 因此本文件只写内部路径：
//   POST   /diagram/:id/history                    记录一条快照（前端 ≥30s 防抖 / Ctrl+S 触发）
//   GET    /diagram/:id/history                    历史列表（倒序）
//   POST   /diagram/:id/history/restore/:historyId 恢复到此版本（覆盖前先存安全快照）
//   GET    /diagram/:id/history/:historyId/download 取快照对象（前端落盘为 .json）
//
// Route 层只绑路径，禁止出现 db / drizzle / 业务判断。
export default async function (app: FastifyInstance) {
  app.post('/diagram/:id/history', diagramHistoryController.recordHistory);
  app.get('/diagram/:id/history', diagramHistoryController.listHistory);
  app.post('/diagram/:id/history/restore/:historyId', diagramHistoryController.restoreHistory);
  app.get('/diagram/:id/history/:historyId/download', diagramHistoryController.downloadHistory);
}
