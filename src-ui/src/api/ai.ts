// AI 能力接口：配置中心 + 三个学习闭环增强点（费曼评分 / 语义回忆评分 / 康奈尔笔记生成）。
// 与 /api/workbench/* 完全解耦——AI 只负责算出结果返回，落库仍走原有业务接口，
// 因此未配置 Key 或断网时，所有原有功能不受任何影响。
import { apiGet, apiPost, apiPut } from './request'

/** AI 调用普遍在 1~10s，远超全局 15s 默认超时的安全边界，单独放宽 */
const AI_TIMEOUT = 90000

// ============================ 配置中心 ============================

export interface AiProviderPreset {
  value: string
  label: string
  baseUrl: string
  model: string
}

/** 服务端返回的安全配置视图（apiKey 仅返回掩码） */
export interface AiConfigVO {
  enabled: boolean
  provider: string
  baseUrl: string
  model: string
  temperature: number
  timeoutMs: number
  apiKeyMask: string
  configured: boolean
  presets?: AiProviderPreset[]
  /** 向量化配置（G3 内容关联用，可选） */
  embeddingsModel?: string
  embeddingsConfigured?: boolean
  embeddingPresets?: AiProviderPreset[]
  /** 本地 Whisper 语音识别地址（离线面试用，可选） */
  whisperUrl?: string
  /** 本地 Whisper 模型名（可选） */
  whisperModel?: string
}

export interface AiConfigPayload {
  enabled?: boolean
  provider?: string
  baseUrl?: string
  /** 留空 = 保持原值；传 null = 清空已保存的 Key */
  apiKey?: string | null
  model?: string
  temperature?: number
  timeoutMs?: number
  /** 向量化配置（可选） */
  embeddingsBaseUrl?: string
  /** 留空 = 保持原值；传 null = 清空已保存的 Embeddings Key */
  embeddingsApiKey?: string | null
  embeddingsModel?: string
  /** 本地 Whisper 语音识别地址（离线面试，可选） */
  whisperUrl?: string
  /** 本地 Whisper 模型名（可选） */
  whisperModel?: string
}

export interface AiStatusVO {
  ready: boolean
  enabled: boolean
  model: string
  provider: string
}

export interface AiPingResult {
  ok: boolean
  model: string
  latencyMs: number
  reply: string
}

export function getAiConfig() {
  return apiGet<AiConfigVO>('/ai/config')
}

export function saveAiConfig(payload: AiConfigPayload) {
  return apiPut<AiConfigVO>('/ai/config', payload)
}

/** 连通性测试；可传未保存的临时配置先试后存 */
export function testAiConnection(payload?: AiConfigPayload) {
  return apiPost<AiPingResult>('/ai/test', payload ?? {}, { timeout: AI_TIMEOUT })
}

/** 轻量状态查询：各页面据此决定是否展示 AI 入口，不产生模型调用 */
export function getAiStatus() {
  return apiGet<AiStatusVO>('/ai/status')
}

// ============================ P1-E1：费曼故事清晰度评分 ============================

export interface StoryClarityResult {
  /** 0~100，可直接填入 form.clarityScore */
  clarityScore: number
  /** 知识缺口说明，可直接填入 form.gapNote */
  gapNote: string
  suggestions: string[]
  vagueParts: string[]
  model: string
  latencyMs: number
}

export function scoreStoryClarity(payload: {
  title?: string
  audience?: string
  metaphor?: string
  content: string
}) {
  return apiPost<StoryClarityResult>('/ai/story/clarity', payload, { timeout: AI_TIMEOUT })
}

// ============================ P1-D1：主动回忆语义评分 ============================

export interface RecallScoreResult {
  /** AI 语义还原度 0~100 */
  score: number
  /** 原规则法字面命中分，用于对照展示 */
  ruleScore: number
  missedPoints: string[]
  wrongPoints: string[]
  feedback: string
  model: string
  latencyMs: number
}

export function scoreRecallSemantic(payload: {
  sourceText: string
  recallText: string
  round?: number
}) {
  return apiPost<RecallScoreResult>('/ai/recall/score', payload, { timeout: AI_TIMEOUT })
}

// ============================ P1-B1：康奈尔笔记生成 ============================

export interface NoteGenerateResult {
  /** 问题式线索列，换行分隔，可直接填入 form.cueColumn */
  cueColumn: string
  /** 总结区，可直接填入 form.summaryColumn */
  summaryColumn: string
  keyPoints: string[]
  model: string
  latencyMs: number
}

export function generateNoteColumns(payload: {
  title?: string
  noteColumn: string
  mode?: 'cue' | 'summary' | 'both'
}) {
  return apiPost<NoteGenerateResult>('/ai/note/generate', payload, { timeout: AI_TIMEOUT })
}

// ============================ P1-A1：收集箱一键提炼要点 ============================

export interface CaptureSummarizeResult {
  /** 3~5 条要点 */
  bullets: string[]
  /** 一句话概括 */
  oneLine: string
  model: string
  latencyMs: number
}

export function summarizeCapture(payload: { title?: string; content: string }) {
  return apiPost<CaptureSummarizeResult>('/ai/capture/summarize', payload, { timeout: AI_TIMEOUT })
}

// ============================ P1-A2：自动标签 + 建议分类 ============================

export interface TagsResult {
  /** 3~6 个关键词标签 */
  tags: string[]
  /** 建议分类的本地 id（未命中则为 null） */
  suggestedCategoryId: number | null
  /** 建议分类名（用于展示） */
  suggestedCategoryName: string
  model: string
  latencyMs: number
}

export function suggestTags(payload: { title?: string; content: string }) {
  return apiPost<TagsResult>('/ai/tags', payload, { timeout: AI_TIMEOUT })
}

// ============================ P2-B4/C1：批量生成复习卡片 ============================

export interface Flashcard {
  front: string
  back: string
}

export interface FlashcardsResult {
  cards: Flashcard[]
  model: string
  latencyMs: number
}

export function generateFlashcards(payload: { title?: string; noteColumn: string; count?: number }) {
  return apiPost<FlashcardsResult>('/ai/note/flashcards', payload, { timeout: AI_TIMEOUT })
}

// ============================ 康奈尔笔记 · AI 自测题（连通复习系统） ============================

export type QuizItemType = 'choice' | 'fill'

export interface QuizItem {
  type: QuizItemType
  /** 题干；填空题用 ___ 表示空位 */
  question: string
  /** 单选题的 4 个选项；填空题为空数组 */
  options: string[]
  /** 单选题为选项字母（A/B/C/D），填空题为应填内容 */
  answer: string
  explain: string
}

export interface NoteQuizResult {
  quiz: QuizItem[]
  /** 同一批题目转成的复习卡正反面，便于直接预览 */
  cards: Flashcard[]
  /** 实际写入 wb_review_card 的条数（autoSave 为 false 时恒为 0） */
  created: number
  model: string
  latencyMs: number
}

/**
 * 生成结构化自测题。
 * 传 `autoSave: true` 时服务端直接入库并把 next_review_time 置为当前时间，
 * 题目立刻出现在复习队列里；否则只返回题目不落库（与 generateFlashcards 行为一致）。
 */
export function generateNoteQuiz(payload: {
  title?: string
  noteColumn: string
  count?: number
  noteId?: number
  categoryId?: number
  autoSave?: boolean
  /** 'choice' = 只出单选题；'fill' = 只出填空题；缺省混合 */
  type?: QuizItemType | 'mixed'
}) {
  return apiPost<NoteQuizResult>('/ai/note/flashcards', payload, { timeout: AI_TIMEOUT })
}

// ============================ 康奈尔笔记 · AI 续写拓展 ============================

export interface NoteExtendResult {
  /** 续写出来的增量段落（Markdown），不含原文 */
  continuation: string
  /** 一句话说明这段补充了什么，用于对比窗标题 */
  summary: string
  chars: number
  /** true = 没写到 minChars，前端给个轻提示即可，不阻断采纳 */
  belowTarget: boolean
  minChars: number
  model: string
  latencyMs: number
}

/**
 * 让 AI 接着当前正文往下写。
 * 服务端只返回「增量段落」而非整篇改写版，因此前端可以自由选择插入位置
 * （另起新段落 / 插入光标处），不会出现「只能整体接受」的窘境。
 */
export function extendNote(payload: {
  currentText: string
  title?: string
  /** 可选方向指令，如「多讲讲落地实践」 */
  direction?: string
  /** 字数下限，默认 300 */
  minChars?: number
}) {
  return apiPost<NoteExtendResult>('/ai/note/extend', payload, { timeout: AI_TIMEOUT })
}

// ============================ P2-A3：收集箱 → 起草笔记 ============================

export interface DraftNoteResult {
  title: string
  noteColumn: string
  cueColumn: string
  summaryColumn: string
  model: string
  latencyMs: number
}

export function draftNoteFromCapture(payload: { title?: string; content: string }) {
  return apiPost<DraftNoteResult>('/ai/capture/draft-note', payload, { timeout: AI_TIMEOUT })
}

// ============================ P2-E3：笔记 → 费曼故事初稿 ============================

export interface DraftStoryResult {
  content: string
  metaphor: string
  model: string
  latencyMs: number
}

export function draftStoryFromNote(payload: { title?: string; noteColumn?: string; audience?: string }) {
  return apiPost<DraftStoryResult>('/ai/story/draft', payload, { timeout: AI_TIMEOUT })
}

// ============================ P2-G1：学习周报 / 洞察 ============================

export interface InsightReportResult {
  summary: string
  highlights: string[]
  suggestions: string[]
  model: string
  latencyMs: number
}

export function generateInsightReport(payload: { days?: number } = {}) {
  return apiPost<InsightReportResult>('/ai/insight/report', payload, { timeout: AI_TIMEOUT })
}

// ============================ P2-C2：薄弱点诊断 ============================

export interface WeaknessResult {
  summary: string
  weakTopics: string[]
  suggestions: string[]
  model: string
  latencyMs: number
}

export function diagnoseWeakness(payload: { days?: number } = {}) {
  return apiPost<WeaknessResult>('/ai/weakness/diagnose', payload, { timeout: AI_TIMEOUT })
}

// ============================ P3-D2：三轮闭卷默写趋势改进建议 ============================

export interface RecallAdviceResult {
  summary: string
  strengths: string[]
  gaps: string[]
  advice: string[]
  nextSteps: string[]
  model: string
  latencyMs: number
}

export function adviseRecall(payload: { sessionId: number }) {
  return apiPost<RecallAdviceResult>('/ai/recall/advice', payload, { timeout: AI_TIMEOUT })
}

// ============================ P3-F1/F2：记忆宫殿位点生成 ============================

export interface PalaceLociItem {
  name: string
  knowledgePoint: string
  imageHint: string
}

export interface PalaceLociResult {
  loci: PalaceLociItem[]
  model: string
  latencyMs: number
}

export function generatePalaceLoci(payload: { theme?: string; count?: number; points?: string[]; context?: string }) {
  return apiPost<PalaceLociResult>('/ai/palace/loci', payload, { timeout: AI_TIMEOUT })
}

export interface PalaceLociImageHintResult {
  imageHint: string
  model: string
  latencyMs: number
}

/** F1/F2 单点增强：为某个已存在位点重新生成/润色 imageHint（联想图像） */
export function regeneratePalaceLociImageHint(payload: { name?: string; knowledgePoint?: string }) {
  return apiPost<PalaceLociImageHintResult>('/ai/palace/loci/image-hint', payload, { timeout: AI_TIMEOUT })
}

// ============================ P3-G2：智能复习推荐引擎 ============================

export interface ReviewRecommendPriority {
  front: string
  reason: string
  method: string
}

export interface ReviewRecommendResult {
  summary: string
  priorities: ReviewRecommendPriority[]
  suggestions: string[]
  model: string
  latencyMs: number
}

export function recommendReview(payload: { limit?: number } = {}) {
  return apiPost<ReviewRecommendResult>('/ai/review/recommend', payload, { timeout: AI_TIMEOUT })
}

// ============================ 复习辅助记忆：助记口诀 / 本轮简报 ============================

export interface ReviewMnemonicResult {
  /** 首选口诀（<= 20 字） */
  mnemonic: string
  /** 口诀各部分对应什么，帮用户建立锚点 */
  explanation: string
  /** 0~2 条风格不同的备选，点「换一个」时本地轮换，不再请求模型 */
  alternatives: string[]
  model: string
  latencyMs: number
}

/**
 * 为单张复习卡生成助记口诀。
 * 只算不存——采纳与否由用户决定，落库走 review.ts 的 adoptMnemonic（写 image_hint）。
 */
export function generateReviewMnemonic(payload: {
  front: string
  back: string
  /** 学科上下文，如「Java 多线程」 */
  context?: string
}) {
  return apiPost<ReviewMnemonicResult>('/ai/review/mnemonics', payload, { timeout: AI_TIMEOUT })
}

export interface ReviewWeakTopic {
  topic: string
  reason: string
}

export interface ReviewSummaryResult {
  headline: string
  weakTopics: ReviewWeakTopic[]
  suggestions: string[]
  encouragement: string
  total: number
  hardCount: number
  model: string
  latencyMs: number
}

/**
 * 本轮复习结束后的 AI 复盘简报。
 * 本轮记录由前端回传（库里没有「一轮」的概念），一般只传评为 hard 的卡片。
 */
export function summarizeReviewSession(payload: {
  total: number
  cards: { front: string; back?: string; rating: string }[]
  minutes?: number
}) {
  return apiPost<ReviewSummaryResult>('/ai/review/summary', payload, { timeout: AI_TIMEOUT })
}

// ============================ P3-G3：内容向量索引 + 语义关联 ============================

export interface SyncEmbeddingsResult {
  synced: number
  skipped: number
  total: number
  model: string
  latencyMs: number
}

export function syncEmbeddings(payload: { force?: boolean } = {}) {
  return apiPost<SyncEmbeddingsResult>('/ai/embeddings/sync', payload, { timeout: 120000 })
}

export interface AssociateItem {
  entityType: 'capture' | 'note' | 'story'
  entityId: number
  title: string
  snippet: string
  /** 余弦相似度 0~1 */
  score: number
  route: string
}

export interface AssociateResult {
  items: AssociateItem[]
  model: string
  latencyMs: number
}

export function associateContent(payload: {
  entityType?: 'capture' | 'note' | 'story'
  entityId?: number
  text?: string
  limit?: number
}) {
  return apiPost<AssociateResult>('/ai/associate', payload, { timeout: AI_TIMEOUT })
}
