import type { FastifyInstance } from 'fastify';
import * as pomodoroController from '../controllers/pomodoroController';

/**
 * 番茄钟路由（前缀 /api/pomodoro）：只声明 HTTP 契约。
 *
 * 业务与落盘规则见 services/pomodoroService.ts，
 * 领域类型见 types/pomodoro.ts。
 */
export default async function (app: FastifyInstance) {
  app.post('/pomodoro/record', pomodoroController.record);
  app.get('/pomodoro/stats', pomodoroController.stats);
  app.get('/pomodoro/config', pomodoroController.getConfig);
  app.put('/pomodoro/config', pomodoroController.putConfig);
  app.get('/pomodoro/today', pomodoroController.today);
}
