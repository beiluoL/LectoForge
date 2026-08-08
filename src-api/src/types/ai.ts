/**
 * AI 能力模块类型契约 —— 纯类型文件，不得出现任何运行时值。
 *
 * 边界约定（沿用重构前的设计）：AI 只做「算出结果返回给前端」，
 * 落库仍走原有的 PUT /notes/:id、PUT /stories/:id、POST /recall-sessions/:id/submit，
 * 因此绝大多数 VO 都是纯计算产物，不含持久化副作用。
 */

/**
 * AI 业务失败载荷。Service 层不接触 FastifyReply，只回报「失败成什么样」，
 * 由 Controller 统一翻译成 { code, message, aiCode } 的 HTTP 响应。
 */
export interface AiFailure {
  kind: 'fail';
  status: number;
  message: string;
  aiCode: string;
}

export type AiResult<T> = { kind: 'ok'; data: T } | AiFailure;

/** 所有 LLM 调用结果共享的元信息 */
export interface AiMeta {
  model: string;
  latencyMs: number;
}

// ===================== 配置中心 =====================

export interface AiStatusVO {
  ready: boolean;
  enabled: boolean;
  model: string;
  provider: string;
}

// ===================== 费曼故事 =====================

export interface StoryClarityDTO {
  title?: string;
  audience?: string;
  metaphor?: string;
  content?: string;
}

export interface StoryClarityVO extends AiMeta {
  clarityScore: number;
  gapNote: string;
  suggestions: string[];
  vagueParts: string[];
}

export interface StoryDraftDTO {
  title?: string;
  noteColumn?: string;
  audience?: string;
}

export interface StoryDraftVO extends AiMeta {
  content: string;
  metaphor: string;
}

// ===================== 主动回忆 =====================

export interface RecallScoreDTO {
  sourceText?: string;
  recallText?: string;
  round?: number;
}

export interface RecallScoreVO extends AiMeta {
  score: number;
  ruleScore: number;
  missedPoints: string[];
  wrongPoints: string[];
  feedback: string;
}

export interface RecallAdviceDTO {
  sessionId?: number;
}

export interface RecallAdviceVO extends AiMeta {
  summary: string;
  strengths: string[];
  gaps: string[];
  advice: string[];
  nextSteps: string[];
}

// ===================== 康奈尔笔记 =====================

export interface NoteGenerateDTO {
  title?: string;
  noteColumn?: string;
  mode?: 'cue' | 'summary' | 'both';
}

export interface NoteGenerateVO extends AiMeta {
  cueColumn: string;
  summaryColumn: string;
  keyPoints: string[];
}

export interface NoteExtendDTO {
  currentText?: string;
  title?: string;
  direction?: string;
  minChars?: number;
}

export interface NoteExtendVO extends AiMeta {
  continuation: string;
  summary: string;
  chars: number;
  /** 未达字数下限时置 true，前端在对比窗给个轻提示即可，不阻断采纳 */
  belowTarget: boolean;
  minChars: number;
}

// ===================== 收集箱 =====================

export interface CaptureSummarizeDTO {
  title?: string;
  content?: string;
}

export interface CaptureSummarizeVO extends AiMeta {
  bullets: string[];
  oneLine: string;
}

export interface TagsDTO {
  title?: string;
  content?: string;
}

export interface TagsVO extends AiMeta {
  tags: string[];
  suggestedCategoryId: number | null;
  suggestedCategoryName: string;
}

export interface DraftNoteDTO {
  title?: string;
  content?: string;
}

export interface DraftNoteVO extends AiMeta {
  title: string;
  noteColumn: string;
  cueColumn: string;
  summaryColumn: string;
}

// ===================== 自测题 / 复习卡 =====================

/** 清洗后的题目结构（对前端与建卡逻辑的唯一契约） */
export interface QuizItem {
  type: 'choice' | 'fill';
  question: string;
  /** 填空题为空数组 */
  options: string[];
  /** 单选题为选项字母（A/B/C…），填空题为应填内容 */
  answer: string;
  explain: string;
}

export interface QuizCard {
  front: string;
  back: string;
}

export interface FlashcardsDTO {
  title?: string;
  noteColumn?: string;
  count?: number;
  noteId?: number;
  categoryId?: number;
  autoSave?: boolean;
  /** 'choice' = 只出单选题；'fill' = 只出填空题；缺省混合（旧契约） */
  type?: 'choice' | 'fill' | 'mixed';
}

export interface FlashcardsVO extends AiMeta {
  quiz: QuizItem[];
  cards: QuizCard[];
  created: number;
}

// ===================== 记忆宫殿 =====================

export interface PalaceLociDTO {
  theme?: string;
  count?: number;
  points?: string[] | string;
  context?: string;
}

export interface PalaceLociItem {
  name: string;
  knowledgePoint: string;
  imageHint: string;
}

export interface PalaceLociVO extends AiMeta {
  loci: PalaceLociItem[];
}

export interface PalaceLociImageHintDTO {
  name?: string;
  knowledgePoint?: string;
}

export interface PalaceLociImageHintVO extends AiMeta {
  imageHint: string;
}

// ===================== 洞察 / 诊断 / 推荐 =====================

export interface DaysDTO {
  days?: number;
}

export interface InsightReportVO extends AiMeta {
  summary: string;
  highlights: string[];
  suggestions: string[];
}

export interface WeaknessDiagnoseVO extends AiMeta {
  summary: string;
  weakTopics: string[];
  suggestions: string[];
}

export interface ReviewRecommendDTO {
  limit?: number;
}

export interface ReviewPriority {
  front: string;
  reason: string;
  method: string;
}

export interface ReviewRecommendVO extends AiMeta {
  summary: string;
  priorities: ReviewPriority[];
  suggestions: string[];
}

// ===================== 复习辅助记忆（助记口诀 / 本轮简报）=====================

/**
 * POST /ai/review/mnemonics 入参。
 * ⚠️ 纯计算端点：只拿卡面文本算口诀，**不落库**。
 * 采纳与否是用户的决定，落库走 PUT /reviews/mnemonic（写 image_hint）。
 * 这样拆开的好处是「多生成几次挑一个」不会污染数据。
 */
export interface ReviewMnemonicDTO {
  front?: string;
  back?: string;
  /** 学科上下文，如「Java 多线程」，帮模型选对领域的类比 */
  context?: string;
}

export interface ReviewMnemonicVO extends AiMeta {
  mnemonic: string;
  explanation: string;
  alternatives: string[];
}

/** 本轮复习里的一张卡，前端只需回传 front / back / rating */
export interface ReviewSummaryCardDTO {
  front?: string;
  back?: string;
  rating?: string;
}

/**
 * POST /ai/review/summary 入参。
 * 同样是纯计算端点，不落库——简报是一次性读物，用户关掉就没了，
 * 存起来反而要面对「历史简报列表」这种没人看的功能。
 */
export interface ReviewSummaryDTO {
  total?: number;
  /** 需要复盘的卡片，一般是 rating='hard' 的那些 */
  cards?: ReviewSummaryCardDTO[];
  /** 本轮用时（分钟），可选 */
  minutes?: number;
}

export interface ReviewWeakTopic {
  topic: string;
  reason: string;
}

export interface ReviewSummaryVO extends AiMeta {
  headline: string;
  weakTopics: ReviewWeakTopic[];
  suggestions: string[];
  encouragement: string;
  /** 回显本轮统计，前端简报头部直接用，省得再算一遍 */
  total: number;
  hardCount: number;
}

// ===================== 向量索引 / 语义关联 =====================

export interface EmbeddingsSyncDTO {
  force?: boolean;
}

export interface EmbeddingsSyncVO {
  synced: number;
  skipped: number;
  total: number;
  model: string;
  latencyMs: number;
}

export interface AssociateDTO {
  entityType?: string;
  entityId?: number;
  text?: string;
  limit?: number;
}

export interface AssociateItem {
  entityType: string;
  entityId: number;
  title: string;
  snippet: string;
  score: number;
  route: string;
}

export interface AssociateVO {
  items: AssociateItem[];
  model: string;
  latencyMs: number;
}
