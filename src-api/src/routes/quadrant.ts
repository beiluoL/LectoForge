import type { FastifyInstance } from 'fastify';

import * as quadrantController from '../controllers/quadrantController';

// 注册到前缀 /api（见 src/index.ts 的 app.register(quadrant, { prefix: '/api' })），
// 因此本文件只写内部路径：
//   GET    /quadrant/tasks             四象限分组数据（服务端一次查询完成分组）
//   POST   /quadrant/tasks             新建任务
//   PUT    /quadrant/tasks/:id         局部更新（改标题 / 拖拽换象限 / 改提醒时间）
//   PUT    /quadrant/tasks/:id/toggle  切换完成状态
//   DELETE /quadrant/tasks/:id         删除任务
//   POST   /quadrant/clear-completed   清空某象限的已完成项
//
// Route 层只绑路径，禁止出现 db / drizzle / 业务判断。
export default async function (app: FastifyInstance) {
  app.get('/quadrant/tasks', quadrantController.listTasks);
  app.post('/quadrant/tasks', quadrantController.createTask);
  app.put('/quadrant/tasks/:id', quadrantController.updateTask);
  app.put('/quadrant/tasks/:id/toggle', quadrantController.toggleTask);
  app.delete('/quadrant/tasks/:id', quadrantController.deleteTask);
  app.post('/quadrant/clear-completed', quadrantController.clearCompleted);
}
