import type { FastifyInstance } from 'fastify';
import * as aiController from '../controllers/aiController';

/**
 * AI 能力路由（挂载在 /api/ai）
 *
 * 边界约定：
 * - 不碰任何既有 /api/workbench/* 契约，AI 只做「算出结果返回给前端」，
 *   落库仍走原有的 PUT /notes/:id、PUT /stories/:id、POST /recall-sessions/:id/submit。
 *   这样 AI 全程可选，关掉也不影响主流程。
 * - 所有异常统一转成 { code, message, aiCode }，前端据 aiCode 决定是否引导去设置页。
 *
 * 默认导出签名与 index.ts 注册方式保持不变 → src-api/src/index.ts 一行都不用改。
 * 注意：/api/ai 前缀下还并存着 routes/mindmap.ts 导出的 mindmapAiRoutes，两者路径不重叠。
 */
export default async function (app: FastifyInstance) {
  // ===== 配置中心 =====
  app.get('/config', aiController.getConfig);
  app.put('/config', aiController.updateConfig);
  app.post('/test', aiController.testConnection);
  app.get('/status', aiController.getStatus);

  // ===== 内容生成（笔记 / 故事 / 收集箱 / 自测题 / 记忆宫殿）=====
  app.post('/story/clarity', aiController.storyClarity);
  app.post('/recall/score', aiController.recallScore);
  app.post('/note/generate', aiController.noteGenerate);
  app.post('/note/extend', aiController.noteExtend);
  app.post('/capture/summarize', aiController.captureSummarize);
  app.post('/tags', aiController.tags);
  app.post('/note/flashcards', aiController.flashcards);
  app.post('/capture/draft-note', aiController.draftNote);
  app.post('/story/draft', aiController.storyDraft);

  // ===== 只读洞察（周报 / 薄弱点 / 默写趋势）=====
  app.post('/insight/report', aiController.insightReport);
  app.post('/weakness/diagnose', aiController.weaknessDiagnose);
  app.post('/recall/advice', aiController.recallAdvice);

  // ===== 记忆宫殿位点 =====
  app.post('/palace/loci', aiController.palaceLoci);
  app.post('/palace/loci/image-hint', aiController.palaceLociImageHint);

  // ===== 智能复习推荐 =====
  app.post('/review/recommend', aiController.reviewRecommend);

  // ===== 本地向量索引 + 语义关联 =====
  app.post('/embeddings/sync', aiController.embeddingsSync);
  app.post('/associate', aiController.associate);
}
