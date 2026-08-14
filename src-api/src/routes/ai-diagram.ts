/**
 * AI 流程图生成路由（挂载在 /api/ai）
 *
 * 只声明 HTTP 契约；业务逻辑见 services/aiDiagramService.ts。
 * 端点：
 *   POST /api/ai/diagram/generate  —— 自然语言生成流程图结构（无坐标，前端自动布局）
 */
import type { FastifyInstance } from 'fastify';
import * as aiDiagramController from '../controllers/aiDiagramController';

export async function aiDiagramRoutes(app: FastifyInstance) {
  app.post('/diagram/generate', aiDiagramController.generate);
}
