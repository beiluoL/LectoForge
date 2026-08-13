import type { FastifyReply, FastifyRequest } from 'fastify';

import { LlmError, type LlmConfig } from '../lib/llm';
import * as aiConfigService from '../services/aiConfigService';
import * as aiContentService from '../services/aiContentService';
import * as aiEmbeddingService from '../services/aiEmbeddingService';
import * as aiInsightService from '../services/aiInsightService';
import * as aiRagService from '../services/aiRagService';
import type { RagRequest } from '../types/rag';
import type {
  AiResult,
  AssociateDTO,
  CaptureSummarizeDTO,
  DaysDTO,
  DraftNoteDTO,
  EmbeddingsSyncDTO,
  FlashcardsDTO,
  NoteExtendDTO,
  NoteGenerateDTO,
  PalaceLociDTO,
  PalaceLociImageHintDTO,
  RecallAdviceDTO,
  RecallScoreDTO,
  ReviewMnemonicDTO,
  ReviewRecommendDTO,
  ReviewSummaryDTO,
  StoryClarityDTO,
  StoryDraftDTO,
  TagsDTO,
  MindmapToStoryDTO,
} from '../types/ai';

/**
 * AI 能力控制器（挂载在 /api/ai）。
 *
 * 与其它模块的差别只有一处：AI 的失败响应有自己的历史子契约 { code, message, aiCode }，
 * 前端据 aiCode 决定是否引导用户去「AI 设置」页。这类响应状态码 >= 400，
 * index.ts 的 onSend 信封钩子对错误响应原样透传，因此这里直接 send 不会与统一信封冲突；
 * 成功响应仍然只返回纯数据，由 onSend 统一包成 { code: 200, data }。
 */

/** 统一异常出口：LlmError 带业务码，其它异常兜底 500。 */
function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof LlmError) {
    return reply.code(e.status).send({ code: e.status, message: e.message, aiCode: e.code });
  }
  const msg = e instanceof Error ? e.message : String(e);
  return reply.code(500).send({ code: 500, message: `AI 处理失败：${msg}`, aiCode: 'AI_UPSTREAM_ERROR' });
}

/**
 * Service 结果 → HTTP 响应的唯一通道。
 * Service 层不接触 FastifyReply，只回报 AiResult；成功取 data，失败翻译成子契约错误体，
 * 过程中抛出的 LlmError 走 fail() 兜底。
 */
async function run<T>(reply: FastifyReply, task: () => Promise<AiResult<T>>) {
  try {
    const r = await task();
    if (r.kind === 'ok') return r.data;
    return reply.code(r.status).send({ code: r.status, message: r.message, aiCode: r.aiCode });
  } catch (e) {
    return fail(reply, e);
  }
}

// ===================== 配置中心 =====================

/** 读取当前 AI 配置（Key 脱敏）与服务商预设 */
export async function getConfig() {
  return aiConfigService.getConfigWithPresets();
}

/** 保存 AI 配置。apiKey 留空表示保持原值，传 null 表示清空。 */
export async function updateConfig(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as Partial<LlmConfig> & { apiKey?: string | null };
  try {
    return aiConfigService.updateConfig(b);
  } catch (e) {
    return fail(reply, e);
  }
}

/** 连通性测试。可传临时配置（未保存即测试），apiKey 留空时回落到已保存的 Key。 */
export async function testConnection(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as Partial<LlmConfig>;
  try {
    return await aiConfigService.testConnection(b);
  } catch (e) {
    return fail(reply, e);
  }
}

/** 轻量状态查询，供各页面决定是否展示 AI 按钮（不发起网络请求） */
export async function getStatus() {
  return aiConfigService.getStatus();
}

// ===================== P1-E1：费曼故事清晰度评分 =====================

export async function storyClarity(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as StoryClarityDTO;
  return run(reply, () => aiContentService.scoreStoryClarity(b));
}

// ===================== P1-D1：主动回忆语义化评分 =====================

export async function recallScore(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as RecallScoreDTO;
  return run(reply, () => aiContentService.scoreRecall(b));
}

// ===================== P1-B1：康奈尔笔记线索列 / 总结区生成 =====================

export async function noteGenerate(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as NoteGenerateDTO;
  return run(reply, () => aiContentService.generateNoteColumns(b));
}

// ===================== P3-B1：康奈尔笔记 AI 续写拓展 =====================

export async function noteExtend(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as NoteExtendDTO;
  return run(reply, () => aiContentService.extendNote(b));
}

// ===================== P1-A1：收集箱一键提炼要点 =====================

export async function captureSummarize(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as CaptureSummarizeDTO;
  return run(reply, () => aiContentService.summarizeCapture(b));
}

// ===================== P1-A2：自动标签 + 建议分类 =====================

export async function tags(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as TagsDTO;
  return run(reply, () => aiContentService.suggestTags(b));
}

// ===================== P2-B4/C1：批量生成间隔重复卡片 =====================

export async function flashcards(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as FlashcardsDTO;
  return run(reply, () => aiContentService.generateFlashcards(b));
}

// ===================== P2-A3：收集箱 → 自动起草康奈尔笔记 =====================

export async function draftNote(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as DraftNoteDTO;
  return run(reply, () => aiContentService.draftNote(b));
}

// ===================== P2-E3：笔记 → 费曼故事初稿 =====================

export async function storyDraft(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as StoryDraftDTO;
  return run(reply, () => aiContentService.draftStory(b));
}

// ===================== 功能 B：思维导图 → 费曼故事草稿 =====================

/**
 * POST /api/ai/mindmap/convert-to-story
 * 把导图大纲润色成费曼故事；落库（写 wb_story）由前端调 POST /api/workbench/stories 完成。
 */
export async function convertMindmapToStory(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as MindmapToStoryDTO;
  return run(reply, () => aiContentService.convertMindmapToStory(b));
}

// ===================== P2-G1：学习周报 / 洞察 =====================

export async function insightReport(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as DaysDTO;
  return run(reply, () => aiInsightService.buildInsightReport(b));
}

// ===================== P2-C2：薄弱点诊断 =====================

export async function weaknessDiagnose(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as DaysDTO;
  return run(reply, () => aiInsightService.diagnoseWeakness(b));
}

// ===================== P3-D2：三轮闭卷默写「趋势改进建议」 =====================

export async function recallAdvice(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as RecallAdviceDTO;
  return run(reply, () => aiInsightService.adviseRecall(b));
}

// ===================== P3-F1/F2：记忆宫殿位点 =====================

export async function palaceLoci(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as PalaceLociDTO;
  return run(reply, () => aiContentService.generatePalaceLoci(b));
}

export async function palaceLociImageHint(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as PalaceLociImageHintDTO;
  return run(reply, () => aiContentService.generateLociImageHint(b));
}

// ===================== P3-G2：智能复习推荐引擎 =====================

export async function reviewRecommend(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as ReviewRecommendDTO;
  return run(reply, () => aiInsightService.recommendReview(b));
}

// ===================== 复习辅助记忆：助记口诀 / 本轮简报 =====================

/** POST /ai/review/mnemonics —— 纯计算，落库另走 PUT /reviews/mnemonic */
export async function reviewMnemonics(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as ReviewMnemonicDTO;
  return run(reply, () => aiContentService.generateReviewMnemonic(b));
}

/** POST /ai/review/summary —— 纯计算，本轮记录由前端回传，不落库 */
export async function reviewSummary(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as ReviewSummaryDTO;
  return run(reply, () => aiInsightService.summarizeReviewSession(b));
}

// ===================== P3-G3：内容向量索引 + 语义关联 =====================

export async function embeddingsSync(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as EmbeddingsSyncDTO;
  return run(reply, () => aiEmbeddingService.syncEmbeddings(b));
}

export async function associate(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as AssociateDTO;
  return run(reply, () => aiEmbeddingService.associate(b));
}

// ===================== 知识库问答（RAG 检索增强生成）=====================

/** POST /api/ai/rag/ask —— 检索文档库 + 康奈尔笔记，基于上下文作答并回传来源 */
export async function ragAsk(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as RagRequest;
  return run(reply, () => aiRagService.askRag(b));
}
