/**
 * 思维导图路由
 *
 * 两个插件、两个前缀，刻意分开注册：
 * - default 导出 → /api/mindmaps：纯 CRUD，落本地 JSON 文件，永远可用，不依赖 AI。
 * - mindmapAiRoutes → /api/ai：AI 大纲生成，未配置 Key 时返回 Mock 结构而不是报错，
 *   保证「没有 Key 也能把整条前端链路跑通」——这是本页面能独立演示的前提。
 *
 * 本文件只声明 HTTP 契约：CRUD 见 services/mindmapService.ts，
 * 大纲生成见 services/mindmapAiService.ts。
 */
import type { FastifyInstance } from 'fastify';
import * as mindmapController from '../controllers/mindmapController';

// ===================== CRUD（/api/mindmaps） =====================

export default async function (app: FastifyInstance) {
  app.get('/', mindmapController.list);
  app.post('/', mindmapController.create);
  app.get('/:id', mindmapController.detail);
  app.put('/:id', mindmapController.update);
  app.delete('/:id', mindmapController.remove);
}

// ===================== AI 生成（/api/ai） =====================

/**
 * AI 大纲生成路由（挂载在 /api/ai）
 * POST /api/ai/generate-mindmap        —— 由主题词发散
 * POST /api/ai/note/generate-mindmap   —— 由康奈尔笔记正文归纳
 */
export async function mindmapAiRoutes(app: FastifyInstance) {
  app.post('/generate-mindmap', mindmapController.generateMindmap);
  app.post('/note/generate-mindmap', mindmapController.generateNoteMindmap);
}
