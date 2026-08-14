import type { FastifyInstance } from 'fastify';
import * as aiAssistantController from '../controllers/aiAssistantController';

/**
 * AI 助手 / 多轮对话路由（挂载在 /api/ai-assistant）。
 *
 * 边界约定：
 * - 严格遵守 Route / Controller / Service 三层分离：本文件只做「URL → 控制器函数」的映射，
 *   不写任何业务逻辑、不碰 DB、不构造 Service 入参（入参直接从 req.body/req.params 透传）。
 * - 普通 CRUD 走 JSON 信封；chat/completions 与 messages/:id/regenerate 为 SSE 流式端点，
 *   由 Controller 的 reply.hijack() 接管，绕过 onSend 信封。
 *
 * 默认导出签名与 index.ts 注册方式保持不变，新增路由无需改动 index.ts 之外的任何地方
 * （仅需在 index.ts 追加一行 app.register）。
 */
export default async function (app: FastifyInstance) {
  // ===== 会话管理 =====
  app.get('/conversations', aiAssistantController.listConversations);
  app.post('/conversations', aiAssistantController.createConversation);
  app.get('/conversations/:id/messages', aiAssistantController.getMessages);
  app.put('/conversations/:id', aiAssistantController.updateConversation);
  app.delete('/conversations/:id', aiAssistantController.deleteConversation);

  // ===== 多轮流式对话 =====
  app.post('/chat/completions', aiAssistantController.chatCompletions);

  // ===== 消息操作 =====
  app.post('/messages/:id/rating', aiAssistantController.rateMessage);
  app.post('/messages/:id/regenerate', aiAssistantController.regenerateMessage);
}
