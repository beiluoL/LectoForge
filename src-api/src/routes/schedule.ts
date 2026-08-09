/**
 * 日程计划路由（前缀 /api，独立模块，不挂 /api/workbench）。
 *
 * 端点清单：
 *   模板： GET    /schedule/templates
 *          POST   /schedule/templates
 *          DELETE /schedule/templates/:id
 *   任务： GET    /schedule/tasks?date=YYYY-MM-DD   （含重复规则按需展开）
 *          POST   /schedule/generate                （templateId + targetDate 一键生成）
 *          POST   /schedule/batch                   （targetDate + tasks[] 批量添加）
 *          PUT    /schedule/tasks/:id
 *          DELETE /schedule/tasks/:id
 *
 * 本层只做「路径 → controller」绑定，默认导出签名保持不变，index.ts 无需改动。
 */
import type { FastifyInstance } from 'fastify';

import * as scheduleController from '../controllers/scheduleController';

export default async function (app: FastifyInstance) {
  // 模板
  app.get('/schedule/templates', scheduleController.listTemplates);
  app.post('/schedule/templates', scheduleController.createTemplate);
  app.delete('/schedule/templates/:id', scheduleController.deleteTemplate);

  // 当日任务
  app.get('/schedule/tasks', scheduleController.listTasks);
  app.post('/schedule/generate', scheduleController.generate);
  app.post('/schedule/batch', scheduleController.batchAdd);
  app.put('/schedule/tasks/:id', scheduleController.updateTask);
  app.delete('/schedule/tasks/:id', scheduleController.deleteTask);
}
