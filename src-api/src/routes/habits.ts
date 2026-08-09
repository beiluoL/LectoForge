import type { FastifyInstance } from 'fastify';

import * as habitController from '../controllers/habitController';

// 注册到前缀 /api（见 src/index.ts 的 app.register(habits, { prefix: '/api' })），
// 因此本文件只写内部路径：
//   GET    /habits             列表（含今日状态）
//   POST   /habits             新建
//   PUT    /habits/:id         局部更新
//   DELETE /habits/:id         删除 + 级联
//   POST   /habits/:id/log     切换打卡（toggle）
//   GET    /habits/:id/stats   统计
//   GET    /habits/summary     跨习惯的本周/本月打卡率概览
export default async function (app: FastifyInstance) {
  app.get('/habits', habitController.listHabits);
  app.post('/habits', habitController.createHabit);
  // 静态段 /habits/summary 必须排在 /habits/:id 之前（find-my-way 静态优先，但显式靠前更稳妥）
  app.get('/habits/summary', habitController.summary);
  app.put('/habits/:id', habitController.updateHabit);
  app.delete('/habits/:id', habitController.deleteHabit);
  app.post('/habits/:id/log', habitController.toggleLog);
  app.get('/habits/:id/stats', habitController.habitStats);
}
