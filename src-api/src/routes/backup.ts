// 数据备份路由：只声明 HTTP 契约，不含任何业务与数据访问。
import type { FastifyInstance } from 'fastify';

import * as backupController from '../controllers/backupController';

export default async function (app: FastifyInstance) {
  app.post('/backup', backupController.runBackup);
  app.get('/backup/schedule', backupController.getSchedule);
  app.put('/backup/schedule', backupController.setSchedule);
}
