import type { FastifyInstance } from 'fastify';

import * as calendarController from '../controllers/calendarController';

// 注册到前缀 /api（见 src/index.ts 的 app.register(calendar, { prefix: '/api' })），
// 因此本文件只写内部路径：
//   GET    /calendar/events      按日期范围查询（start_date / end_date 必填）
//   POST   /calendar/events      新建事件
//   PUT    /calendar/events/:id  局部更新（改标题 / 挪时间 / 换颜色）
//   DELETE /calendar/events/:id  删除事件
//
// Route 层只绑路径，禁止出现 db / drizzle / 业务判断。
export default async function (app: FastifyInstance) {
  app.get('/calendar/events', calendarController.listEvents);
  app.post('/calendar/events', calendarController.createEvent);
  app.put('/calendar/events/:id', calendarController.updateEvent);
  app.delete('/calendar/events/:id', calendarController.deleteEvent);
}
