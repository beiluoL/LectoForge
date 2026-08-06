import { FastifyInstance, FastifyReply } from 'fastify';
import { db, CURRENT_USER } from '../db';
import { categories, wbCapture, wbNote, wbReviewCard, wbReviewLog, wbStory, wbEmbedding, wbRecallSession } from '../db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';

import {
  LlmError,
  PROVIDER_PRESETS,
  EMBEDDING_PRESETS,
  chatJson,
  isReady,
  embeddingsReady,
  embed,
  ping,
  publicConfig,
  readConfig,
  readEmbeddingConfig,
  saveConfig,
  stripHtml,
  type LlmConfig,
  type EmbeddingConfig,
} from '../lib/llm';
import {
  buildCaptureSummarizePrompt,
  buildDraftNotePrompt,
  buildDraftStoryPrompt,
  buildFlashcardsPrompt,
  buildInsightReportPrompt,
  buildNoteGeneratePrompt,
  buildPalaceLociPrompt,
  buildRecallAdvicePrompt,
  buildRecallScorePrompt,
  buildReviewRecommendPrompt,
  buildStoryClarityPrompt,
  buildTagsPrompt,
  buildWeaknessDiagnosePrompt,
  type CaptureSummarizeOutput,
  type DraftNoteOutput,
  type DraftStoryOutput,
  type FlashcardsOutput,
  type InsightReportOutput,
  type NoteGenerateOutput,
  type PalaceLociOutput,
  type RecallAdviceOutput,
  type RecallScoreOutput,
  type ReviewRecommendOutput,
  type StoryClarityOutput,
  type TagsOutput,
  type WeaknessDiagnoseOutput,
} from '../lib/prompts';

/**
 * AI 能力路由（挂载在 /api/ai）
 *
 * 边界约定：
 * - 不碰任何既有 /api/workbench/* 契约，AI 只做「算出结果返回给前端」，
 *   落库仍走原有的 PUT /notes/:id、PUT /stories/:id、POST /recall-sessions/:id/submit。
 *   这样 AI 全程可选，关掉也不影响主流程。
 * - 所有异常统一转成 { code, message, aiCode }，前端据 aiCode 决定是否引导去设置页。
 */

/** 统一异常出口：LlmError 带业务码，其它异常兜底 500。 */
function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof LlmError) {
    return reply.code(e.status).send({ code: e.status, message: e.message, aiCode: e.code });
  }
  const msg = e instanceof Error ? e.message : String(e);
  return reply.code(500).send({ code: 500, message: `AI 处理失败：${msg}`, aiCode: 'AI_UPSTREAM_ERROR' });
}

/** 把模型返回的分数收敛到 0~100 整数。 */
function normalizeScore(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** 模型偶尔会把数组写成字符串，这里统一收敛为字符串数组并限长。 */
function normalizeList(v: unknown, max = 5): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => String(x ?? '').trim())
      .filter(Boolean)
      .slice(0, max);
  }
  if (typeof v === 'string' && v.trim()) {
    return v
      .split(/\n|；|;/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, max);
  }
  return [];
}

/** 规则法字面命中分：与 routes/recall.ts 的 scoreRecall 保持同一算法，作为 AI 的对照锚点。 */
function ruleScore(source: string, recall: string): number {
  const tokenize = (text: string) => {
    const set = new Set<string>();
    for (const t of (text || '').toLowerCase().match(/[a-z]+|[一-龥]/g) || []) {
      if (/[a-z]/.test(t)) {
        if (t.length >= 2) set.add(t);
      } else {
        set.add(t);
      }
    }
    return set;
  };
  const src = tokenize(source);
  if (src.size === 0) return 0;
  const rec = tokenize(recall);
  let hit = 0;
  rec.forEach((w) => {
    if (src.has(w)) hit += 1;
  });
  return Math.round((hit / src.size) * 100);
}

/** 余弦相似度（向量已归一化时即点积；这里显式归一化，避免维度不一致） */
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 计算待向量化文本（取标题+正文，纯文本化并截断） */
function embeddingText(entity: { title?: string | null; content?: string | null; noteColumn?: string | null }): string {
  const parts = [entity.title || '', entity.content || entity.noteColumn || ''];
  return stripHtml(parts.join('\n')).slice(0, 6000).trim();
}

/** 轻量内容指纹：用于判断是否需要重算（避免每次同步都重复调用向量服务） */
function contentHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

/** 按实体类型+id 读取实体（供关联结果回填标题/摘要） */
function loadEntity(type: string, id: number): { title?: string | null; content?: string | null; noteColumn?: string | null } | null {
  if (type === 'capture') return db.select().from(wbCapture).where(eq(wbCapture.id, id)).get() as any;
  if (type === 'note') return db.select().from(wbNote).where(eq(wbNote.id, id)).get() as any;
  if (type === 'story') return db.select().from(wbStory).where(eq(wbStory.id, id)).get() as any;
  return null;
}

/** 从待向量化文本截取展示摘要 */
function snippetOf(text: string): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

/** 关联结果的可点击前端路由 */
function entityRoute(type: string, id: number): string {
  if (type === 'capture') return '/workbench/capture';
  if (type === 'note') return `/workbench/notes/${id}`;
  if (type === 'story') return `/workbench/story/${id}`;
  return '/workbench';
}

export default async function (app: FastifyInstance) {
  // ===== 配置中心 =====

  /** 读取当前 AI 配置（Key 脱敏）与服务商预设 */
  app.get('/config', async () => ({
    ...publicConfig(),
    presets: Object.entries(PROVIDER_PRESETS).map(([value, p]) => ({ value, ...p })),
    embeddingPresets: Object.entries(EMBEDDING_PRESETS).map(([value, p]) => ({ value, ...p })),
  }));

  /** 保存 AI 配置。apiKey 留空表示保持原值，传 null 表示清空。 */
  app.put('/config', async (req, reply) => {
    const b = (req.body || {}) as Partial<LlmConfig> & { apiKey?: string | null };
    try {
      const saved = saveConfig(b);
      return publicConfig(saved);
    } catch (e) {
      return fail(reply, e);
    }
  });

  /**
   * 连通性测试。可传临时配置（未保存即测试），传了就用临时的，没传就用已保存的。
   * apiKey 留空时回落到已保存的 Key，避免为了测试必须重填。
   */
  app.post('/test', async (req, reply) => {
    const b = (req.body || {}) as Partial<LlmConfig>;
    try {
      const cur = readConfig();
      const temp: LlmConfig = {
        enabled: true,
        provider: (b.provider as LlmConfig['provider']) || cur.provider,
        baseUrl: (b.baseUrl || cur.baseUrl || '').trim(),
        apiKey: (b.apiKey || '').trim() || cur.apiKey,
        model: (b.model || cur.model || '').trim(),
        temperature: cur.temperature,
        timeoutMs: b.timeoutMs || cur.timeoutMs,
        embeddingsBaseUrl: cur.embeddingsBaseUrl,
        embeddingsApiKey: cur.embeddingsApiKey,
        embeddingsModel: cur.embeddingsModel,
      };
      return await ping(temp);
    } catch (e) {
      return fail(reply, e);
    }
  });

  /** 轻量状态查询，供各页面决定是否展示 AI 按钮（不发起网络请求） */
  app.get('/status', async () => {
    const cfg = readConfig();
    return { ready: isReady(cfg), enabled: cfg.enabled, model: cfg.model, provider: cfg.provider };
  });

  // ===== P1-E1：费曼故事清晰度评分 =====

  /**
   * 输入故事正文，返回 clarityScore + gapNote + 改进建议。
   * 前端拿到后填入表单，由用户确认再走原有 PUT /stories/:id 落库。
   */
  app.post('/story/clarity', async (req, reply) => {
    const b = (req.body || {}) as { title?: string; audience?: string; metaphor?: string; content?: string };
    const content = stripHtml(b.content);
    if (!content || content.length < 20) {
      return reply.code(400).send({ code: 400, message: '故事内容太短（至少 20 字），先讲一段再评分', aiCode: 'AI_BAD_INPUT' });
    }
    try {
      const { data, raw } = await chatJson<StoryClarityOutput>(
        buildStoryClarityPrompt({
          title: b.title || '',
          audience: b.audience,
          metaphor: b.metaphor,
          content,
        }),
        { temperature: 0.2 },
      );
      return {
        clarityScore: normalizeScore(data.clarityScore),
        gapNote: String(data.gapNote || '').trim(),
        suggestions: normalizeList(data.suggestions, 3),
        vagueParts: normalizeList(data.vagueParts, 3),
        model: raw.model,
        latencyMs: raw.latencyMs,
      };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ===== P1-D1：主动回忆语义化评分 =====

  /**
   * 语义比对原文与默写，返回 AI 分 + 规则分对照。
   * 不直接写库：SM-2 与三轮流转仍由原有 submit 接口决定，AI 分仅作为用户可选采纳的参考。
   */
  app.post('/recall/score', async (req, reply) => {
    const b = (req.body || {}) as { sourceText?: string; recallText?: string; round?: number };
    const source = stripHtml(b.sourceText);
    const recall = stripHtml(b.recallText);
    if (!source.trim()) {
      return reply.code(400).send({ code: 400, message: '缺少原文', aiCode: 'AI_BAD_INPUT' });
    }
    if (!recall.trim()) {
      return reply.code(400).send({ code: 400, message: '缺少默写内容', aiCode: 'AI_BAD_INPUT' });
    }
    const rule = ruleScore(source, recall);
    try {
      const { data, raw } = await chatJson<RecallScoreOutput>(
        buildRecallScorePrompt({ sourceText: source, recallText: recall, round: b.round, ruleScore: rule }),
        { temperature: 0.1 },
      );
      return {
        score: normalizeScore(data.score),
        ruleScore: rule,
        missedPoints: normalizeList(data.missedPoints, 5),
        wrongPoints: normalizeList(data.wrongPoints, 3),
        feedback: String(data.feedback || '').trim(),
        model: raw.model,
        latencyMs: raw.latencyMs,
      };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ===== P1-B1：康奈尔笔记线索列 / 总结区生成 =====

  /**
   * 由笔记区正文生成线索列（问题式）与总结区。
   * 返回后前端填入对应输入框，用户可编辑后由既有自动保存逻辑落库。
   */
  app.post('/note/generate', async (req, reply) => {
    const b = (req.body || {}) as { title?: string; noteColumn?: string; mode?: 'cue' | 'summary' | 'both' };
    const note = stripHtml(b.noteColumn);
    if (!note || note.length < 30) {
      return reply.code(400).send({ code: 400, message: '笔记正文太短（至少 30 字），先记一段再生成', aiCode: 'AI_BAD_INPUT' });
    }
    try {
      const { data, raw } = await chatJson<NoteGenerateOutput>(
        buildNoteGeneratePrompt({ title: b.title, noteColumn: note, mode: b.mode || 'both' }),
        { temperature: 0.3 },
      );
      const cueRaw = data.cueColumn;
      const cueColumn = Array.isArray(cueRaw)
        ? (cueRaw as unknown[]).map((x) => String(x).trim()).filter(Boolean).join('\n')
        : String(cueRaw || '').trim();
      return {
        cueColumn,
        summaryColumn: String(data.summaryColumn || '').trim(),
        keyPoints: normalizeList(data.keyPoints, 5),
        model: raw.model,
        latencyMs: raw.latencyMs,
      };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ===== P1-A1：收集箱一键提炼要点 =====

  /**
   * 由收集箱正文提炼 3~5 条要点 + 一句话概括。
   * 仅返回结果，落库（如转笔记、回填）由用户在前端采纳后走原有业务接口。
   */
  app.post('/capture/summarize', async (req, reply) => {
    const b = (req.body || {}) as { title?: string; content?: string };
    const content = stripHtml(b.content);
    if (!content || content.length < 30) {
      return reply.code(400).send({ code: 400, message: '收集箱内容太短（至少 30 字）', aiCode: 'AI_BAD_INPUT' });
    }
    try {
      const { data, raw } = await chatJson<CaptureSummarizeOutput>(
        buildCaptureSummarizePrompt({ title: b.title, content }),
        { temperature: 0.3 },
      );
      return {
        bullets: normalizeList(data.bullets, 5),
        oneLine: String(data.oneLine || '').trim(),
        model: raw.model,
        latencyMs: raw.latencyMs,
      };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ===== P1-A2：自动标签 + 建议分类 =====

  /**
   * 从收集箱内容抽关键词标签，并从本地已有分类里建议一个最贴合的归类。
   * 分类为读后建议（read-only），最终采用仍由前端走 PUT /captures/:id 落库。
   */
  app.post('/tags', async (req, reply) => {
    const b = (req.body || {}) as { title?: string; content?: string };
    const content = stripHtml(b.content);
    if (!content || content.length < 20) {
      return reply.code(400).send({ code: 400, message: '内容太短（至少 20 字）', aiCode: 'AI_BAD_INPUT' });
    }
    try {
      const cats = db.select().from(categories).all() as { id: number; name: string }[];
      const catNames = cats.map((c) => c.name);
      const { data, raw } = await chatJson<TagsOutput>(
        buildTagsPrompt({ title: b.title, content, categories: catNames }),
        { temperature: 0.3 },
      );
      const tags = normalizeList(data.tags, 6);
      const suggested = String(data.suggestedCategory || '').trim();
      let suggestedCategoryId: number | null = null;
      let suggestedCategoryName = '';
      if (suggested && suggested !== '无' && suggested !== 'none') {
        const hit = cats.find((c) => c.name === suggested);
        if (hit) {
          suggestedCategoryId = hit.id;
          suggestedCategoryName = hit.name;
        }
      }
      return {
        tags,
        suggestedCategoryId,
        suggestedCategoryName,
        model: raw.model,
        latencyMs: raw.latencyMs,
      };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ===== P2-B4/C1：批量生成间隔重复卡片 =====

  /**
   * 由笔记/收集箱内容生成一组 Q/A 复习卡。仅返回卡片，由前端逐张走 POST /reviews 创建，
   * 绝不改动 SM-2 排程或既有卡片。
   */
  app.post('/note/flashcards', async (req, reply) => {
    const b = (req.body || {}) as { title?: string; noteColumn?: string; count?: number };
    const note = stripHtml(b.noteColumn);
    if (!note || note.length < 30) {
      return reply.code(400).send({ code: 400, message: '内容太短（至少 30 字），先写充实一点', aiCode: 'AI_BAD_INPUT' });
    }
    try {
      const { data, raw } = await chatJson<FlashcardsOutput>(
        buildFlashcardsPrompt({ title: b.title, noteColumn: note, count: b.count }),
        { temperature: 0.3 },
      );
      const cards = Array.isArray(data.cards)
        ? data.cards
            .filter((c: any) => c && String(c.front || '').trim() && String(c.back || '').trim())
            .map((c: any) => ({ front: String(c.front).trim(), back: String(c.back).trim() }))
            .slice(0, 8)
        : [];
      return { cards, model: raw.model, latencyMs: raw.latencyMs };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ===== P2-A3：收集箱 → 自动起草康奈尔笔记 =====

  /**
   * 由收集箱内容起草一份康奈尔笔记草稿（含线索列与总结区）。
   * 仅返回草稿，由前端走 POST /notes 创建，不自动落库。
   */
  app.post('/capture/draft-note', async (req, reply) => {
    const b = (req.body || {}) as { title?: string; content?: string };
    const content = stripHtml(b.content);
    if (!content || content.length < 30) {
      return reply.code(400).send({ code: 400, message: '收集箱内容太短（至少 30 字）', aiCode: 'AI_BAD_INPUT' });
    }
    try {
      const { data, raw } = await chatJson<DraftNoteOutput>(
        buildDraftNotePrompt({ title: b.title, content }),
        { temperature: 0.3 },
      );
      return {
        title: String(data.title || b.title || '').trim(),
        noteColumn: String(data.noteColumn || '').trim(),
        cueColumn: String(data.cueColumn || '').trim(),
        summaryColumn: String(data.summaryColumn || '').trim(),
        model: raw.model,
        latencyMs: raw.latencyMs,
      };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ===== P2-E3：笔记 → 费曼故事初稿 =====

  /**
   * 由笔记为指定受众起草费曼故事初稿 + 比喻。仅返回草稿，由前端填入故事编辑器。
   */
  app.post('/story/draft', async (req, reply) => {
    const b = (req.body || {}) as { title?: string; noteColumn?: string; audience?: string };
    const note = stripHtml(b.noteColumn);
    if (!note.trim() && !(b.title || '').trim()) {
      return reply.code(400).send({ code: 400, message: '缺少主题或笔记内容', aiCode: 'AI_BAD_INPUT' });
    }
    try {
      const { data, raw } = await chatJson<DraftStoryOutput>(
        buildDraftStoryPrompt({ title: b.title, noteColumn: note, audience: b.audience }),
        { temperature: 0.4 },
      );
      return {
        content: String(data.content || '').trim(),
        metaphor: String(data.metaphor || '').trim(),
        model: raw.model,
        latencyMs: raw.latencyMs,
      };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ===== P2-G1：学习周报 / 洞察 =====

  /**
   * 聚合 overview + forgetting-curve（只读查询），交由 LLM 讲成人话周报。
   * 全程只读，不写任何表。
   */
  app.post('/insight/report', async (req, reply) => {
    const b = (req.body || {}) as { days?: number };
    const days = Math.max(7, Math.min(90, Number(b.days) || 30));
    try {
      const overview = await buildOverview();
      const forgettingCurve = await buildForgettingCurve(days);
      const { data, raw } = await chatJson<InsightReportOutput>(
        buildInsightReportPrompt({ overview, forgettingCurve, days }),
        { temperature: 0.3 },
      );
      return {
        summary: String(data.summary || '').trim(),
        highlights: normalizeList(data.highlights, 5),
        suggestions: normalizeList(data.suggestions, 5),
        model: raw.model,
        latencyMs: raw.latencyMs,
      };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ===== P2-C2：薄弱点诊断 =====

  /**
   * 读取近期 lapse 复习记录（只读），交由 LLM 归纳薄弱主题并给补救建议。
   */
  app.post('/weakness/diagnose', async (req, reply) => {
    const b = (req.body || {}) as { days?: number };
    const days = Math.max(7, Math.min(180, Number(b.days) || 60));
    try {
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const logs = db
        .select({ front: wbReviewCard.front, reviewedAt: wbReviewLog.reviewedAt })
        .from(wbReviewLog)
        .innerJoin(wbReviewCard, eq(wbReviewCard.id, wbReviewLog.cardId))
        .where(and(eq(wbReviewLog.userId, CURRENT_USER), eq(wbReviewLog.quality, 0), gte(wbReviewLog.reviewedAt, since)))
        .all() as { front: string; reviewedAt: string }[];
      const total = (
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(wbReviewLog)
          .where(and(eq(wbReviewLog.userId, CURRENT_USER), gte(wbReviewLog.reviewedAt, since)))
          .get() as any
      )?.c ?? 0
      const lapses = logs.map((l) => ({ front: l.front, reviewedAt: (l.reviewedAt || '').slice(0, 10) }))
      const overallLapseRate = total === 0 ? 0 : logs.length / total
      const { data, raw } = await chatJson<WeaknessDiagnoseOutput>(
        buildWeaknessDiagnosePrompt({ lapses, overallLapseRate, totalReviews: total }),
        { temperature: 0.3 },
      );
      return {
        summary: String(data.summary || '').trim(),
        weakTopics: normalizeList(data.weakTopics, 5),
        suggestions: normalizeList(data.suggestions, 5),
        model: raw.model,
        latencyMs: raw.latencyMs,
      };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ===== P3-D2：三轮闭卷默写「趋势改进建议」 =====

  /**
   * 读取已完成/进行中的默写会话三轮记录，交由 LLM 给出「接下来怎么练」的策略。
   * 只读会话表，不写库。
   */
  app.post('/recall/advice', async (req, reply) => {
    const b = (req.body || {}) as { sessionId?: number };
    if (!b.sessionId) {
      return reply.code(400).send({ code: 400, message: '缺少 sessionId', aiCode: 'AI_BAD_INPUT' });
    }
    const session = db.select().from(wbRecallSession).where(eq(wbRecallSession.id, Number(b.sessionId))).get() as any;
    if (!session) {
      return reply.code(404).send({ code: 404, message: '会话不存在', aiCode: 'AI_BAD_INPUT' });
    }
    const rounds = [
      { round: 1, text: session.round1Text || '', score: session.round1Score },
      { round: 2, text: session.round2Text || '', score: session.round2Score },
      { round: 3, text: session.round3Text || '', score: session.round3Score },
    ].filter((r) => (r.text || '').trim().length > 0);
    if (rounds.length === 0) {
      return reply.code(400).send({ code: 400, message: '该会话还没有任何默写记录，先完成至少一轮再求建议', aiCode: 'AI_BAD_INPUT' });
    }
    try {
      const { data, raw } = await chatJson<RecallAdviceOutput>(
        buildRecallAdvicePrompt({
          title: session.title || '',
          sourceText: session.sourceText || '',
          rounds,
          improvementPct: session.improvementPct || [null, null, null],
        }),
        { temperature: 0.3 },
      );
      return {
        summary: String(data.summary || '').trim(),
        strengths: normalizeList(data.strengths, 5),
        gaps: normalizeList(data.gaps, 5),
        advice: normalizeList(data.advice, 5),
        nextSteps: normalizeList(data.nextSteps, 3),
        model: raw.model,
        latencyMs: raw.latencyMs,
      };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ===== P3-F1/F2：记忆宫殿位点自动生成 + 抽象→具象联想图像 =====

  /**
   * 由主题 + 知识点列表生成有序 loci（含 name/knowledgePoint/imageHint）。
   * 仅返回草稿，由前端逐张走 POST /loci 创建，不自动改库。
   */
  app.post('/palace/loci', async (req, reply) => {
    const b = (req.body || {}) as { theme?: string; count?: number; points?: string[] | string; context?: string };
    let points: string[] = [];
    if (Array.isArray(b.points)) points = b.points.map((p) => String(p).trim()).filter(Boolean);
    else if (typeof b.points === 'string' && b.points.trim()) {
      points = b.points
        .split(/[\n;；]+/)
        .map((p) => p.trim())
        .filter(Boolean);
    }
    try {
      const { data, raw } = await chatJson<PalaceLociOutput>(
        buildPalaceLociPrompt({ theme: b.theme, count: b.count, points, context: b.context }),
        { temperature: 0.4 },
      );
      const loci = Array.isArray(data.loci)
        ? data.loci
            .filter((l: any) => l && String(l.name || '').trim() && String(l.knowledgePoint || '').trim())
            .map((l: any) => ({
              name: String(l.name).trim(),
              knowledgePoint: String(l.knowledgePoint || '').trim(),
              imageHint: String(l.imageHint || '').trim(),
            }))
            .slice(0, 12)
        : [];
      return { loci, model: raw.model, latencyMs: raw.latencyMs };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ===== P3-G2：智能复习推荐引擎 =====

  /**
   * 综合 SM-2 排程（到期/逾期/易度/遗忘次数）与近期 lapse 类型，给出复习优先级与方式建议。
   * 只读聚合，不改动排程。
   */
  app.post('/review/recommend', async (req, reply) => {
    const b = (req.body || {}) as { limit?: number };
    const limit = Math.max(5, Math.min(50, Number(b.limit) || 20));
    try {
      const now = new Date().toISOString();
      const dueCards = db
        .select({
          front: wbReviewCard.front,
          back: wbReviewCard.back,
          intervalDay: wbReviewCard.intervalDay,
          easeFactor: wbReviewCard.easeFactor,
          lapseCount: wbReviewCard.lapseCount,
        })
        .from(wbReviewCard)
        .where(and(eq(wbReviewCard.userId, CURRENT_USER), eq(wbReviewCard.suspended, 0), gte(wbReviewCard.nextReviewTime, now)))
        .orderBy(sql`${wbReviewCard.nextReviewTime} ASC`)
        .limit(limit)
        .all() as any[];
      const since = new Date(Date.now() - 60 * 86400000).toISOString();
      const lapses = db
        .select({ front: wbReviewCard.front })
        .from(wbReviewLog)
        .innerJoin(wbReviewCard, eq(wbReviewCard.id, wbReviewLog.cardId))
        .where(and(eq(wbReviewLog.userId, CURRENT_USER), eq(wbReviewLog.quality, 0), gte(wbReviewLog.reviewedAt, since)))
        .all() as { front: string }[];
      const forgettingCurve = await buildForgettingCurve(30);
      const { data, raw } = await chatJson<ReviewRecommendOutput>(
        buildReviewRecommendPrompt({
          dueCards: dueCards.map((c) => ({
            front: c.front,
            back: c.back,
            intervalDay: c.intervalDay,
            easeFactorDecimal: c.easeFactor / 100,
            lapseCount: c.lapseCount,
          })),
          lapses: lapses.map((l) => l.front),
          forgettingSummary: { overallLapseRate: forgettingCurve.overallLapseRate, totalReviews: forgettingCurve.totalReviews },
        }),
        { temperature: 0.3 },
      );
      return {
        summary: String(data.summary || '').trim(),
        priorities: Array.isArray(data.priorities)
          ? data.priorities
              .filter((p: any) => p && String(p.front || '').trim())
              .map((p: any) => ({
                front: String(p.front).trim(),
                reason: String(p.reason || '').trim(),
                method: String(p.method || '主动回忆').trim(),
              }))
              .slice(0, 6)
          : [],
        suggestions: normalizeList(data.suggestions, 5),
        model: raw.model,
        latencyMs: raw.latencyMs,
      };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ===== P3-G3：内容向量索引 + 语义关联 =====

  /**
   * 重建/补齐本地向量索引：扫描 captures/notes/stories，对缺失或变更的内容调用 embeddings 服务，
   * 向量落库到 wb_embedding（本地 SQLite）。绝不触碰业务表。
   * 向量化服务未配置时返回明确错误，由前端引导去设置页。
   */
  app.post('/embeddings/sync', async (req, reply) => {
    const b = (req.body || {}) as { force?: boolean };
    const cfg = readEmbeddingConfig();
    if (!embeddingsReady()) {
      return reply.code(409).send({
        code: 409,
        message: '尚未配置向量化服务，请在「AI 设置」中填写 Embeddings 地址、Key 与模型',
        aiCode: 'AI_NOT_CONFIGURED',
      });
    }
    try {
      const model = cfg.model;
      const now = new Date().toISOString();
      const collect = (rows: any[], type: string) =>
        rows
          .map((r) => ({ type, id: r.id, text: embeddingText(r), hash: contentHash(embeddingText(r)) }))
          .filter((x) => x.text.length > 0);

      const items = [
        ...collect(db.select().from(wbCapture).all() as any[], 'capture'),
        ...collect(db.select().from(wbNote).all() as any[], 'note'),
        ...collect(db.select().from(wbStory).all() as any[], 'story'),
      ];

      // 已有索引（按 实体+模型）用于跳过未变更项
      const existing = db
        .select({ entityType: wbEmbedding.entityType, entityId: wbEmbedding.entityId, contentHash: wbEmbedding.contentHash })
        .from(wbEmbedding)
        .where(eq(wbEmbedding.model, model))
        .all() as { entityType: string; entityId: number; contentHash: string | null }[];
      const existingMap = new Map(existing.map((e) => [`${e.entityType}:${e.entityId}`, e.contentHash]));

      const todo = items.filter((it) => b.force || existingMap.get(`${it.type}:${it.id}`) !== it.hash);
      let synced = 0;
      const BATCH = 16;
      for (let i = 0; i < todo.length; i += BATCH) {
        const chunk = todo.slice(i, i + BATCH);
        const vectors = await embed(chunk.map((c) => c.text), { config: cfg });
        const rows = chunk.map((c, idx) => ({
          entityType: c.type,
          entityId: c.id,
          model,
          dim: vectors[idx].length,
          vector: JSON.stringify(vectors[idx]),
          contentHash: c.hash,
          createdAt: now,
          updatedAt: now,
        }));
        for (const row of rows) {
          db.insert(wbEmbedding)
            .values(row)
            .onConflictDoUpdate({
              target: [wbEmbedding.entityType, wbEmbedding.entityId, wbEmbedding.model],
              set: { dim: row.dim, vector: row.vector, contentHash: row.contentHash, updatedAt: now },
            })
            .run();
          synced += 1;
        }
      }
      return { synced, skipped: items.length - synced, total: items.length, model, latencyMs: 0 };
    } catch (e) {
      return fail(reply, e);
    }
  });

  /**
   * 语义关联（学习路径）：给定实体或自由文本，返回最相似的其它内容。
   * 源向量即时计算并落库（若缺失），相似度在本地 JS 计算。向量化未配置时返回明确错误。
   */
  app.post('/associate', async (req, reply) => {
    const b = (req.body || {}) as { entityType?: string; entityId?: number; text?: string; limit?: number };
    const limit = Math.max(1, Math.min(20, Number(b.limit) || 6));
    const cfg = readEmbeddingConfig();
    if (!embeddingsReady()) {
      return reply.code(409).send({
        code: 409,
        message: '尚未配置向量化服务，请在「AI 设置」中填写 Embeddings 地址、Key 与模型',
        aiCode: 'AI_NOT_CONFIGURED',
      });
    }
    let sourceText = (b.text || '').trim();
    let sourceRef: { type: string; id: number } | null = null;
    if (!sourceText && b.entityType && b.entityId) {
      sourceRef = { type: b.entityType, id: Number(b.entityId) };
      const row = loadEntity(b.entityType, Number(b.entityId));
      if (!row) return reply.code(404).send({ code: 404, message: '关联源不存在', aiCode: 'AI_BAD_INPUT' });
      sourceText = embeddingText(row);
    }
    if (!sourceText) {
      return reply.code(400).send({ code: 400, message: '请提供 entityType+entityId 或 text', aiCode: 'AI_BAD_INPUT' });
    }
    try {
      // 确保源向量已落库（缺失则计算并存入）
      if (sourceRef) {
        const have = db
          .select({ id: wbEmbedding.id })
          .from(wbEmbedding)
          .where(and(eq(wbEmbedding.entityType, sourceRef.type), eq(wbEmbedding.entityId, sourceRef.id), eq(wbEmbedding.model, cfg.model)))
          .get();
        if (!have) {
          const [vec] = await embed([sourceText], { config: cfg });
          const now = new Date().toISOString();
          db.insert(wbEmbedding)
            .values({
              entityType: sourceRef.type,
              entityId: sourceRef.id,
              model: cfg.model,
              dim: vec.length,
              vector: JSON.stringify(vec),
              contentHash: contentHash(sourceText),
              createdAt: now,
              updatedAt: now,
            })
            .run();
        }
      }
      const [sourceVec] = await embed([sourceText], { config: cfg });
      // 拉取全部已索引向量，计算余弦相似度
      const all = db.select().from(wbEmbedding).all() as any[];
      const scored = all
        .map((e) => {
          let vec: number[];
          try {
            vec = JSON.parse(e.vector);
          } catch {
            return null;
          }
          const score = cosineSimilarity(sourceVec, vec);
          return { type: e.entity_type, id: e.entity_id, score, model: e.model };
        })
        .filter((x): x is { type: string; id: number; score: number; model: string } => !!x && x.score > 0)
        .filter((x) => !(sourceRef && x.type === sourceRef.type && x.id === sourceRef.id))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const result = scored.map((s) => {
        const row = loadEntity(s.type, s.id);
        const title = row ? row.title || '(无标题)' : '(已删除)';
        const snippet = row ? snippetOf(embeddingText(row)) : '';
        return { entityType: s.type, entityId: s.id, title, snippet, score: Math.round(s.score * 1000) / 1000, route: entityRoute(s.type, s.id) };
      });
      return { items: result, model: cfg.model, latencyMs: 0 };
    } catch (e) {
      return fail(reply, e);
    }
  });
}

  // ===== 只读聚合辅助（供 G1/C2 使用，绝不写库） =====

async function buildOverview() {
  const count = (tbl: any, extra: any[] = []) => {
    const r = db.select({ c: sql<number>`COUNT(*)` }).from(tbl).where(and(eq(tbl.userId, CURRENT_USER), ...extra)).get() as any
    return r?.c ?? 0
  }
  const now = new Date().toISOString()
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString()
  return {
    captureTotal: count(wbCapture),
    captureInbox: count(wbCapture, [eq(wbCapture.status, 'INBOX')]),
    noteTotal: count(wbNote),
    reviewDue: count(wbReviewCard, [eq(wbReviewCard.suspended, 0), sql`${wbReviewCard.nextReviewTime} <= ${now}`]),
    storyTotal: count(wbStory),
    reviewLast7d: count(wbReviewLog, [gte(wbReviewLog.reviewedAt, since7)]),
  }
}

async function buildForgettingCurve(days: number) {
  const end = new Date()
  const start = new Date(end.getTime() - (days - 1) * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const startDate = fmt(start)
  const endDate = fmt(end)
  const bucket: Record<string, { reviews: number; lapses: number }> = {}
  for (let i = 0; i < days; i++) {
    bucket[fmt(new Date(start.getTime() + i * 86400000))] = { reviews: 0, lapses: 0 }
  }
  const logs = db
    .select({ reviewedAt: wbReviewLog.reviewedAt, quality: wbReviewLog.quality })
    .from(wbReviewLog)
    .where(and(eq(wbReviewLog.userId, CURRENT_USER), gte(wbReviewLog.reviewedAt, start.toISOString())))
    .all() as { reviewedAt: string; quality: number }[]
  let totalReviews = 0
  let totalLapses = 0
  for (const log of logs) {
    const p = bucket[(log.reviewedAt || '').slice(0, 10)]
    if (!p) continue
    p.reviews += 1
    if (log.quality === 0) p.lapses += 1
    totalReviews += 1
    if (log.quality === 0) totalLapses += 1
  }
  const points = Object.keys(bucket).map((date) => ({
    date,
    reviews: bucket[date].reviews,
    lapses: bucket[date].lapses,
    lapseRate: bucket[date].reviews === 0 ? 0 : bucket[date].lapses / bucket[date].reviews,
  }))
  return { startDate, endDate, points, totalReviews, totalLapses, overallLapseRate: totalReviews === 0 ? 0 : totalLapses / totalReviews }
}
