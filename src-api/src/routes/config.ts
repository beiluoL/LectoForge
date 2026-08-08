// 应用级配置路由：只声明 HTTP 契约，不含任何业务与数据访问。
import type { FastifyInstance } from 'fastify';

import * as configController from '../controllers/configController';

export default async function (app: FastifyInstance) {
  app.get('/config', configController.getConfig);
  app.post('/config/init', configController.initConfig);
}
