/**
 * AI 内容生成服务：故事清晰度、默写评分、笔记线索/总结、续写、要点提炼、
 * 自动标签、自测题、笔记草稿、故事初稿、记忆宫殿位点。
 *
 * 统一约定：
 * - 入参校验失败与模型空产出，一律以 AiFailure 回报，由 Controller 翻译成 HTTP 状态码；
 * - LlmError 直接向上抛，由 Controller 的 fail() 统一转 { code, message, aiCode }；
 * - 除 flashcards 的 autoSave 分支外全程只读，不写任何业务表。
 */
import { eq } from 'drizzle-orm';

import { CURRENT_USER, db, nowIso } from '../db';
import { categories, wbReviewCard } from '../db/schema';
import { chatJson, stripHtml } from '../lib/llm';
import { normalizeList, normalizeScore } from '../lib/aiNormalize';
import {
  buildCaptureSummarizePrompt,
  buildDraftNotePrompt,
  buildDraftStoryPrompt,
  buildMindmapStoryPrompt,
  buildNoteExtendPrompt,
  buildNoteGeneratePrompt,
  buildPalaceLociPrompt,
  buildPalaceLociImageHintPrompt,
  buildQuizPrompt,
  buildRecallScorePrompt,
  buildReviewMnemonicPrompt,
  buildStoryClarityPrompt,
  buildTagsPrompt,
  type CaptureSummarizeOutput,
  type DraftNoteOutput,
  type DraftStoryOutput,
  type NoteExtendOutput,
  type NoteGenerateOutput,
  type PalaceLociOutput,
  type PalaceLociImageHintOutput,
  type QuizOutput,
  type RecallScoreOutput,
  type ReviewMnemonicOutput,
  type StoryClarityOutput,
  type TagsOutput,
} from '../lib/prompts';
import type {
  AiResult,
  CaptureSummarizeDTO,
  CaptureSummarizeVO,
  DraftNoteDTO,
  DraftNoteVO,
  FlashcardsDTO,
  FlashcardsVO,
  MindmapOutlineNode,
  NoteExtendDTO,
  NoteExtendVO,
  NoteGenerateDTO,
  NoteGenerateVO,
  PalaceLociDTO,
  PalaceLociImageHintDTO,
  PalaceLociImageHintVO,
  PalaceLociVO,
  QuizCard,
  QuizItem,
  RecallScoreDTO,
  RecallScoreVO,
  ReviewMnemonicDTO,
  ReviewMnemonicVO,
  StoryClarityDTO,
  StoryClarityVO,
  StoryDraftDTO,
  StoryDraftVO,
  TagsDTO,
  TagsVO,
  MindmapToStoryDTO,
  MindmapToStoryVO,
} from '../types/ai';

/** 入参不合法 —— 前端可直接把 message 展示给用户 */
function badInput(message: string): AiResult<never> {
  return { kind: 'fail', status: 400, message, aiCode: 'AI_BAD_INPUT' };
}

/** 模型返回了空内容 —— 提示重试或换模型 */
function badResponse(message: string, aiCode = 'AI_BAD_RESPONSE'): AiResult<never> {
  return { kind: 'fail', status: 502, message, aiCode };
}

// ===================== 自测题清洗 =====================

const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * 把模型输出收敛成可判分的题目数组。
 * 模型常见的三种不规范：answer 写成选项原文、type 缺失、options 少于 2 项，这里逐一兜底。
 */
function normalizeQuiz(v: unknown, max = 8): QuizItem[] {
  if (!Array.isArray(v)) return [];
  const out: QuizItem[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const question = String(o.question ?? '').trim();
    let answer = String(o.answer ?? '').trim();
    if (!question || !answer) continue;

    const opts = Array.isArray(o.options)
      ? (o.options as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean)
      : [];
    const declaredChoice = String(o.type ?? '').toLowerCase() === 'choice';
    const type: 'choice' | 'fill' = declaredChoice || opts.length >= 2 ? 'choice' : 'fill';
    if (type === 'choice' && opts.length < 2) continue;

    const options = type === 'choice' ? opts.slice(0, CHOICE_LETTERS.length) : [];
    if (type === 'choice') {
      // answer 可能是 "B" / "B. xxx" / 选项原文，统一收敛成字母
      const letter = /^\s*([A-Fa-f])\b/.exec(answer)?.[1]?.toUpperCase();
      let idx = letter ? CHOICE_LETTERS.indexOf(letter) : -1;
      if (idx < 0 || idx >= options.length) {
        idx = options.findIndex((op) => op === answer || answer.includes(op));
      }
      if (idx < 0) idx = 0;
      answer = CHOICE_LETTERS[idx];
    }

    out.push({ type, question, options, answer, explain: String(o.explain ?? '').trim() });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 题目 → 复习卡正反面。
 * 单选题把选项一并写进正面，答案页给「字母 + 原文 + 解析」，
 * 这样卡片脱离原笔记也能独立作答，符合 wb_review_card 的纯文本卡面约定。
 */
function quizToCard(q: QuizItem): QuizCard {
  if (q.type === 'choice') {
    const front = [q.question, ...q.options.map((op, i) => `${CHOICE_LETTERS[i]}. ${op}`)].join('\n');
    const idx = CHOICE_LETTERS.indexOf(q.answer);
    const text = idx >= 0 && idx < q.options.length ? q.options[idx] : '';
    const back = [`正确答案：${q.answer}${text ? `. ${text}` : ''}`, q.explain].filter(Boolean).join('\n');
    return { front, back };
  }
  return { front: q.question, back: [q.answer, q.explain].filter(Boolean).join('\n') };
}

/** 规则法字面命中分：与 recallService 的 scoreRecall 保持同一算法，作为 AI 的对照锚点。 */
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

// ===================== P1-E1：费曼故事清晰度评分 =====================

export async function scoreStoryClarity(b: StoryClarityDTO): Promise<AiResult<StoryClarityVO>> {
  const content = stripHtml(b.content);
  if (!content || content.length < 20) {
    return badInput('故事内容太短（至少 20 字），先讲一段再评分');
  }
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
    kind: 'ok',
    data: {
      clarityScore: normalizeScore(data.clarityScore),
      gapNote: String(data.gapNote || '').trim(),
      suggestions: normalizeList(data.suggestions, 3),
      vagueParts: normalizeList(data.vagueParts, 3),
      model: raw.model,
      latencyMs: raw.latencyMs,
    },
  };
}

// ===================== P1-D1：主动回忆语义化评分 =====================

export async function scoreRecall(b: RecallScoreDTO): Promise<AiResult<RecallScoreVO>> {
  const source = stripHtml(b.sourceText);
  const recall = stripHtml(b.recallText);
  if (!source.trim()) return badInput('缺少原文');
  if (!recall.trim()) return badInput('缺少默写内容');

  const rule = ruleScore(source, recall);
  const { data, raw } = await chatJson<RecallScoreOutput>(
    buildRecallScorePrompt({ sourceText: source, recallText: recall, round: b.round, ruleScore: rule }),
    { temperature: 0.1 },
  );
  return {
    kind: 'ok',
    data: {
      score: normalizeScore(data.score),
      ruleScore: rule,
      missedPoints: normalizeList(data.missedPoints, 5),
      wrongPoints: normalizeList(data.wrongPoints, 3),
      feedback: String(data.feedback || '').trim(),
      model: raw.model,
      latencyMs: raw.latencyMs,
    },
  };
}

// ===================== P1-B1：康奈尔笔记线索列 / 总结区生成 =====================

export async function generateNoteColumns(b: NoteGenerateDTO): Promise<AiResult<NoteGenerateVO>> {
  const note = stripHtml(b.noteColumn);
  if (!note || note.length < 30) {
    return badInput('笔记正文太短（至少 30 字），先记一段再生成');
  }
  const { data, raw } = await chatJson<NoteGenerateOutput>(
    buildNoteGeneratePrompt({ title: b.title, noteColumn: note, mode: b.mode || 'both' }),
    { temperature: 0.3 },
  );
  const cueRaw = data.cueColumn;
  const cueColumn = Array.isArray(cueRaw)
    ? (cueRaw as unknown[]).map((x) => String(x).trim()).filter(Boolean).join('\n')
    : String(cueRaw || '').trim();
  return {
    kind: 'ok',
    data: {
      cueColumn,
      summaryColumn: String(data.summaryColumn || '').trim(),
      keyPoints: normalizeList(data.keyPoints, 5),
      model: raw.model,
      latencyMs: raw.latencyMs,
    },
  };
}

// ===================== P3-B1：康奈尔笔记 AI 续写拓展 =====================

/** 去掉模型偶尔套在整段外面的 ``` 围栏，避免整段续写被渲染成代码块 */
function unfence(s: string): string {
  const t = s.trim();
  const m = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(t);
  return (m ? m[1] : t).trim();
}

export async function extendNote(b: NoteExtendDTO): Promise<AiResult<NoteExtendVO>> {
  const currentText = stripHtml(b.currentText);
  if (!currentText || currentText.length < 30) {
    return badInput('正文太短（至少 30 字），先写一段再让 AI 接着写');
  }
  const minChars = Math.min(1200, Math.max(150, Number(b.minChars) || 300));
  const input = {
    title: b.title,
    currentText,
    direction: String(b.direction || '').trim() || undefined,
    minChars,
  };

  let { data, raw } = await chatJson<NoteExtendOutput>(buildNoteExtendPrompt(input), { temperature: 0.7 });
  let continuation = unfence(String(data.continuation || ''));

  // 明显不达标（不到目标的一半）时补一刀：小模型常把「至少 300 字」理解成「大约 100 字」。
  // 只重试一次，避免把用户卡在两轮 LLM 往返上。
  if (continuation.length < minChars * 0.5) {
    const retry = await chatJson<NoteExtendOutput>(
      buildNoteExtendPrompt({
        ...input,
        direction: [input.direction, `上一版只写了 ${continuation.length} 字，太短了，请展开到 ${minChars} 字以上，多给机制、条件和例子`]
          .filter(Boolean)
          .join('；'),
      }),
      { temperature: 0.7 },
    );
    const retryText = unfence(String(retry.data.continuation || ''));
    if (retryText.length > continuation.length) {
      continuation = retryText;
      data = retry.data;
      raw = retry.raw;
    }
  }

  if (!continuation) return badResponse('AI 没有产出可用内容，请重试或换个模型');

  return {
    kind: 'ok',
    data: {
      continuation,
      summary: String(data.summary || '').trim(),
      chars: continuation.length,
      belowTarget: continuation.length < minChars,
      minChars,
      model: raw.model,
      latencyMs: raw.latencyMs,
    },
  };
}

// ===================== P1-A1：收集箱一键提炼要点 =====================

export async function summarizeCapture(b: CaptureSummarizeDTO): Promise<AiResult<CaptureSummarizeVO>> {
  const content = stripHtml(b.content);
  if (!content || content.length < 30) return badInput('收集箱内容太短（至少 30 字）');

  const { data, raw } = await chatJson<CaptureSummarizeOutput>(
    buildCaptureSummarizePrompt({ title: b.title, content }),
    { temperature: 0.3 },
  );
  return {
    kind: 'ok',
    data: {
      bullets: normalizeList(data.bullets, 5),
      oneLine: String(data.oneLine || '').trim(),
      model: raw.model,
      latencyMs: raw.latencyMs,
    },
  };
}

// ===================== P1-A2：自动标签 + 建议分类 =====================

export async function suggestTags(b: TagsDTO): Promise<AiResult<TagsVO>> {
  const content = stripHtml(b.content);
  if (!content || content.length < 20) return badInput('内容太短（至少 20 字）');

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
    kind: 'ok',
    data: { tags, suggestedCategoryId, suggestedCategoryName, model: raw.model, latencyMs: raw.latencyMs },
  };
}

// ===================== P2-B4/C1：批量生成间隔重复卡片 =====================

/**
 * 由笔记/收集箱内容生成一组自测题（单选 + 填空）。
 *
 * autoSave = true 时题目直接写入 wb_review_card（旧复习系统），next_review_time 置为当前时间，
 * 立刻进入复习队列。选 wb_review_card 是因为它本来就有 noteId 外键与 front/back 卡面；
 * 新复习系统（wb_note 内嵌 SM-2）按笔记粒度排程，不适合装一题一卡。
 */
export async function generateFlashcards(b: FlashcardsDTO): Promise<AiResult<FlashcardsVO>> {
  const note = stripHtml(b.noteColumn);
  if (!note || note.length < 30) return badInput('内容太短（至少 30 字），先写充实一点');

  const wantType = b.type === 'choice' || b.type === 'fill' ? b.type : 'mixed';
  const { data, raw } = await chatJson<QuizOutput>(
    buildQuizPrompt({ title: b.title, noteColumn: note, count: b.count, type: wantType }),
    { temperature: 0.3 },
  );
  // 指定了题型就做二次过滤：提示词只是「要求」，模型仍可能夹带另一种题型，
  // 混进来会让「生成选择题」的结果里冒出填空题，用户会当成 bug。
  const quiz = normalizeQuiz(data.quiz).filter((q) => wantType === 'mixed' || q.type === wantType);
  if (!quiz.length) return badResponse('AI 没有产出可用题目，请重试或换个模型');

  const cards = quiz.map(quizToCard);

  let created = 0;
  if (b.autoSave) {
    const now = nowIso();
    quiz.forEach((q, i) => {
      db.insert(wbReviewCard)
        .values({
          userId: CURRENT_USER,
          noteId: b.noteId ?? null,
          categoryId: b.categoryId ?? null,
          front: cards[i].front,
          back: cards[i].back,
          cardType: q.type,
          // 立即到期：生成完就能在复习模块作答，不用等 SM-2 首轮排程
          nextReviewTime: now,
        })
        .run();
      created += 1;
    });
  }

  return { kind: 'ok', data: { quiz, cards, created, model: raw.model, latencyMs: raw.latencyMs } };
}

// ===================== P2-A3：收集箱 → 自动起草康奈尔笔记 =====================

export async function draftNote(b: DraftNoteDTO): Promise<AiResult<DraftNoteVO>> {
  const content = stripHtml(b.content);
  if (!content || content.length < 30) return badInput('收集箱内容太短（至少 30 字）');

  const { data, raw } = await chatJson<DraftNoteOutput>(
    buildDraftNotePrompt({ title: b.title, content }),
    { temperature: 0.3 },
  );
  return {
    kind: 'ok',
    data: {
      title: String(data.title || b.title || '').trim(),
      noteColumn: String(data.noteColumn || '').trim(),
      cueColumn: String(data.cueColumn || '').trim(),
      summaryColumn: String(data.summaryColumn || '').trim(),
      model: raw.model,
      latencyMs: raw.latencyMs,
    },
  };
}

// ===================== P2-E3：笔记 → 费曼故事初稿 =====================

export async function draftStory(b: StoryDraftDTO): Promise<AiResult<StoryDraftVO>> {
  const note = stripHtml(b.noteColumn);
  if (!note.trim() && !(b.title || '').trim()) return badInput('缺少主题或笔记内容');

  const { data, raw } = await chatJson<DraftStoryOutput>(
    buildDraftStoryPrompt({ title: b.title, noteColumn: note, audience: b.audience }),
    { temperature: 0.4 },
  );
  return {
    kind: 'ok',
    data: {
      content: String(data.content || '').trim(),
      metaphor: String(data.metaphor || '').trim(),
      model: raw.model,
      latencyMs: raw.latencyMs,
    },
  };
}

// ===================== P3-F1/F2：记忆宫殿位点 =====================

export async function generatePalaceLoci(b: PalaceLociDTO): Promise<AiResult<PalaceLociVO>> {
  let points: string[] = [];
  if (Array.isArray(b.points)) points = b.points.map((p) => String(p).trim()).filter(Boolean);
  else if (typeof b.points === 'string' && b.points.trim()) {
    points = b.points
      .split(/[\n;；]+/)
      .map((p) => p.trim())
      .filter(Boolean);
  }
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
  return { kind: 'ok', data: { loci, model: raw.model, latencyMs: raw.latencyMs } };
}

/** 为某个已存在位点重新生成/润色 imageHint（抽象→具象联想图像） */
export async function generateLociImageHint(
  b: PalaceLociImageHintDTO,
): Promise<AiResult<PalaceLociImageHintVO>> {
  if (!String(b.name || '').trim() && !String(b.knowledgePoint || '').trim()) {
    return badInput('请至少提供位点名称或知识点');
  }
  const { data, raw } = await chatJson<PalaceLociImageHintOutput>(
    buildPalaceLociImageHintPrompt({ name: String(b.name || ''), knowledgePoint: String(b.knowledgePoint || '') }),
    { temperature: 0.5 },
  );
  const imageHint = String(data.imageHint || '').trim();
  if (!imageHint) return badResponse('AI 未返回有效联想图像', 'AI_EMPTY');

  return { kind: 'ok', data: { imageHint, model: raw.model, latencyMs: raw.latencyMs } };
}

// ===================== 复习助记口诀 =====================

/** 口诀长度上限，与 reviewService.MNEMONIC_MAX_LEN 对齐，防止模型跑题写成小作文 */
const MNEMONIC_MAX_LEN = 300;

/**
 * 为单张复习卡生成助记口诀（纯计算，不落库）。
 *
 * 落库刻意分离到 PUT /reviews/mnemonic：用户可能连点几次「换一个」再决定采纳哪条，
 * 生成即写库会让 image_hint 被中间态反复覆盖。
 *
 * 兜底策略：模型偶尔会把口诀写成一整段解释，这里做两道清洗——
 * ① 截断到 MNEMONIC_MAX_LEN；② mnemonic 为空但 alternatives 有内容时，提升第一条备选。
 * 只有彻底空产出才报 502，尽量不让用户白等一次 LLM 往返。
 */
export async function generateReviewMnemonic(
  b: ReviewMnemonicDTO,
): Promise<AiResult<ReviewMnemonicVO>> {
  const front = String(b.front || '').trim();
  const back = String(b.back || '').trim();
  if (!front && !back) return badInput('卡片内容为空，无法生成口诀');

  const { data, raw } = await chatJson<ReviewMnemonicOutput>(
    buildReviewMnemonicPrompt({ front, back, context: b.context ? String(b.context) : null }),
    // 口诀需要一点创造力，但又不能天马行空跑离知识点，0.7 是试出来的折中
    { temperature: 0.7 },
  );

  const alternatives = normalizeList(data.alternatives)
    .map((s) => s.slice(0, MNEMONIC_MAX_LEN))
    .filter(Boolean)
    .slice(0, 2);
  let mnemonic = String(data.mnemonic || '').trim().slice(0, MNEMONIC_MAX_LEN);
  // 主口诀缺失时提升第一条备选，避免整次调用作废
  if (!mnemonic && alternatives.length) mnemonic = alternatives.shift() as string;
  if (!mnemonic) return badResponse('AI 未返回有效口诀，请重试或换个模型', 'AI_EMPTY');

  return {
    kind: 'ok',
    data: {
      mnemonic,
      explanation: String(data.explanation || '').trim(),
      alternatives,
      model: raw.model,
      latencyMs: raw.latencyMs,
    },
  };
}

/** 提供给依赖方复用的只读导出（当前仅测试与内部编排使用） */
export { normalizeQuiz, quizToCard, ruleScore };

// ===================== 功能 B：思维导图 → 费曼故事草稿 =====================

/** LLM 返回的 JSON 结构（与提示词约定的字段对齐） */
interface MindmapStoryOutput {
  title: string
  content: string
}

/**
 * 把思维导图大纲润色成费曼故事。
 *
 * 纯计算 + 落库分离：本函数只产出正文与标题，落库（写 wb_story）由前端调
 * POST /api/workbench/stories 完成——与既有「AI 只算不存」的边界保持一致。
 */
export async function convertMindmapToStory(b: MindmapToStoryDTO): Promise<AiResult<MindmapToStoryVO>> {
  if (!Array.isArray(b.outlineJson) || b.outlineJson.length === 0) {
    return badInput('导图大纲为空，请先在大纲视图里写点内容');
  }
  const { data, raw } = await chatJson<MindmapStoryOutput>(
    buildMindmapStoryPrompt({
      mindmapTitle: b.mindmapTitle,
      outline: b.outlineJson as MindmapOutlineNode[],
      targetAudience: b.targetAudience,
    }),
    { temperature: 0.6 },
  )
  const storyContent = String(data.content || '').trim()
  if (!storyContent) return badResponse('AI 没有产出故事内容，请重试或换个模型')
  return {
    kind: 'ok',
    data: {
      storyContent,
      title: String(data.title || b.mindmapTitle || '费曼故事草稿').trim(),
      model: raw.model,
      latencyMs: raw.latencyMs,
    },
  }
}
