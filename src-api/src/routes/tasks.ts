import type { FastifyInstance } from 'fastify';

import * as taskController from '../controllers/taskController';

// 注册到前缀 /api（见 src/index.ts 的 app.register(tasks, { prefix: '/api' })），
// 因此本文件只写内部路径：
//   GET    /tasks                  任务树（?status= / ?list_id= / ?q= / 分页）
//   GET    /tasks/counters         侧边栏五个智能列表的徽标计数
//   GET    /tasks/:id              单条详情
//   POST   /tasks                  新建任务（parentTaskId 非空即子任务）
//   PUT    /tasks/:id              局部更新
//   PUT    /tasks/:id/complete     勾选 / 取消勾选（服务端读现值翻面）
//   DELETE /tasks/:id              删除任务（连带子任务）
//   POST   /tasks/clear-logbook    清空日志本
//
// ⚠️ /tasks/counters 与 /tasks/clear-logbook 必须写在 /tasks/:id 之前语义上更清晰，
//    虽然 Fastify 的 find-my-way 路由树天然优先静态段、不会把 counters 当成 :id，
//    但显式排前面能让读代码的人少一次疑惑。
//
// Route 层只绑路径，禁止出现 db / drizzle / 业务判断。
export default async function (app: FastifyInstance) {
  app.get('/tasks/counters', taskController.counters);
  app.post('/tasks/clear-logbook', taskController.clearLogbook);
  app.get('/tasks', taskController.listTasks);
  app.get('/tasks/:id', taskController.getTask);
  app.post('/tasks', taskController.createTask);
  app.put('/tasks/:id', taskController.updateTask);
  app.put('/tasks/:id/complete', taskController.completeTask);
  app.delete('/tasks/:id', taskController.deleteTask);
}
