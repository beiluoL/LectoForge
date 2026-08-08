import type { FastifyInstance } from 'fastify';
import * as migrationController from '../controllers/migrationController';

/**
 * 数据迁移导入端点：消费 Web 端 GET /api/workbench/export 产出的 JSON，
 * 将工作台四模块数据落库到本地 SQLite。
 *
 * 默认导出签名与 index.ts 注册方式保持不变（挂在 /api/workbench 前缀下）→ index.ts 一行都不用改。
 */
export default async function (app: FastifyInstance) {
  app.post('/import', migrationController.importData);
}
