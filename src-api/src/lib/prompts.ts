import type { ChatMessage } from './llm';
import { truncate } from './llm';

/**
 * AI 提示词集中管理
 *
 * 单独成文件的原因：提示词是最高频迭代的部分，与路由/业务逻辑解耦后，
 * 调优时只需改这里，不必碰接口契约；同时便于后续做 A/B 与版本化。
 * 约定：所有提示词都要求模型输出严格 JSON，字段名与前端 VO 保持一致。
 */

/** 受众枚举 → 中文描述（严格对齐 WorkbenchStoryEdit.vue 的 audience 下拉选项） */
const AUDIENCE_LABEL: Record<string, string> = {
  CHILD: '一个 10 岁的小学生',
  NEWBIE: '刚入门、完全没有背景知识的初学者',
  PEER: '同专业的同学/同事',
  INTERVIEWER: '正在考察你技术深度的面试官',
};

export interface StoryClarityInput {
  title: string;
  audience?: string | null;
  metaphor?: string | null;
  content: string;
}

export interface StoryClarityOutput {
  /** 0~100 清晰度评分 */
  clarityScore: number;
  /** 知识缺口说明，落库到 wb_story.gap_note */
  gapNote: string;
  /** 三条以内可执行的改进建议 */
  suggestions: string[];
  /** 讲不清楚的具体位置（原文片段） */
  vagueParts: string[];
}

/**
 * E1：费曼故事清晰度评分
 * 目标是把「讲不清楚 = 没学会」量化，输出可直接落库的 clarityScore + gapNote。
 */
export function buildStoryClarityPrompt(input: StoryClarityInput): ChatMessage[] {
  const audience = AUDIENCE_LABEL[String(input.audience || 'CHILD')] || AUDIENCE_LABEL.CHILD;
  return [
    {
      role: 'system',
      content: [
        '你是费曼学习法的严格教练。用户尝试用大白话把一个知识点讲给指定听众听，你要判断他是否真的理解了。',
        '评分标准（总分 100）：',
        '1. 通俗度 30 分——是否避免了术语堆砌、能否被目标听众听懂；',
        '2. 完整度 25 分——核心机制/因果链是否讲全，有无跳步；',
        '3. 准确度 25 分——有无事实错误、过度简化导致的失真；',
        '4. 类比质量 20 分——类比是否贴切、是否帮助理解而非制造新困惑。',
        '严格要求：宁可打低分也不要客套。80 分以上只给真正讲透的内容。',
        '只输出 JSON，不要任何解释性文字。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【目标听众】${audience}`,
        `【标题】${input.title || '（未填写）'}`,
        `【使用的类比】${input.metaphor || '（未使用类比）'}`,
        '【讲述内容】',
        truncate(input.content, 6000) || '（内容为空）',
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "clarityScore": 0-100 的整数,',
        '  "gapNote": "用 100 字以内指出他还没真正理解的地方，直接称呼\'你\'，具体到知识点，不要空话",',
        '  "suggestions": ["最多 3 条可立即执行的改写建议，每条 30 字以内"],',
        '  "vagueParts": ["最多 3 段原文中含糊/跳步的片段原文摘录，每条 40 字以内"]',
        '}',
      ].join('\n'),
    },
  ];
}

export interface RecallScoreInput {
  sourceText: string;
  recallText: string;
  round?: number;
  /** 规则法算出的字面命中分，作为参考锚点传给模型 */
  ruleScore?: number;
}

export interface RecallScoreOutput {
  /** 0~100 语义还原度 */
  score: number;
  /** 遗漏的关键要点 */
  missedPoints: string[];
  /** 记错/写反的地方 */
  wrongPoints: string[];
  /** 一句话反馈 */
  feedback: string;
}

/**
 * D1：主动回忆语义化评分
 * 现有规则法只比对字面重合，换个说法就扣分；这里让模型按「意思是否还原」评分。
 */
export function buildRecallScorePrompt(input: RecallScoreInput): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是主动回忆（闭卷默写）的批改老师。学生看过原文后凭记忆默写，你要评估他还原了多少「意思」。',
        '重要原则：',
        '1. 只看语义是否还原，换一种说法、调换顺序、用自己的话概括都算对，不要因为用词不同扣分；',
        '2. 关键概念、数字、因果关系、步骤顺序漏了或记反了才扣分；',
        '3. 默写内容里原文没有的编造信息要在 wrongPoints 中指出并扣分；',
        '4. 分数是「还原比例」：还原了一半核心要点就是 50 分左右，不要给安慰分。',
        '只输出 JSON，不要任何解释性文字。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【这是第 ${input.round || 1} 轮默写】`,
        input.ruleScore != null ? `【字面重合度参考分】${input.ruleScore}（仅供参考，以语义判断为准）` : '',
        '【原文】',
        truncate(input.sourceText, 6000),
        '',
        '【学生默写】',
        truncate(input.recallText, 6000),
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "score": 0-100 的整数,',
        '  "missedPoints": ["最多 5 条遗漏的关键要点，每条 25 字以内"],',
        '  "wrongPoints": ["最多 3 条记错或编造的内容，每条 25 字以内，没有则空数组"],',
        '  "feedback": "一句话反馈，60 字以内，直接称呼\'你\'"',
        '}',
      ].join('\n'),
    },
  ].filter((m) => m.content.trim()) as ChatMessage[];
}

export interface NoteGenerateInput {
  title?: string | null;
  noteColumn: string;
  /** cue = 只生成线索列；summary = 只生成总结；both = 两者都生成 */
  mode?: 'cue' | 'summary' | 'both';
}

export interface NoteGenerateOutput {
  /** 康奈尔线索列（问题式），换行分隔 */
  cueColumn: string;
  /** 康奈尔总结区，一段话 */
  summaryColumn: string;
  /** 供后续建卡使用的问答对 */
  keyPoints: string[];
}

/**
 * B1：康奈尔笔记线索列 + 总结区生成
 * 康奈尔笔记的价值全在线索列（提问）和总结（复述），但这两栏最容易被跳过。
 */
export function buildNoteGeneratePrompt(input: NoteGenerateInput): ChatMessage[] {
  const mode = input.mode || 'both';
  const modeHint =
    mode === 'cue'
      ? '本次只需要生成线索列（cueColumn），summaryColumn 返回空字符串。'
      : mode === 'summary'
        ? '本次只需要生成总结区（summaryColumn），cueColumn 返回空字符串。'
        : '两栏都要生成。';
  return [
    {
      role: 'system',
      content: [
        '你是康奈尔笔记法（Cornell Note-taking）的助教。用户已写好「笔记区」正文，你负责补齐「线索列」与「总结区」。',
        '线索列规则：',
        '- 必须是「问题」，不是关键词罗列，因为它的用途是遮住笔记区自我提问；',
        '- 每行一个问题，5~8 个，覆盖正文全部核心概念，按正文顺序排列；',
        '- 问题要具体可答，禁止「什么是XX？」这类可以照抄标题的空问题，优先问机制、区别、条件、为什么。',
        '总结区规则：',
        '- 用自己的话把整篇笔记浓缩成 2~4 句，说清「这一页到底在讲什么、结论是什么」；',
        '- 不要罗列小标题，不要出现「本文/本笔记」这类字眼。',
        '严禁编造正文中不存在的信息。只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【笔记标题】${input.title || '（未填写）'}`,
        `【生成范围】${modeHint}`,
        '【笔记区正文】',
        truncate(input.noteColumn, 8000),
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "cueColumn": "每行一个问题，用 \\n 分隔",',
        '  "summaryColumn": "2~4 句话的总结",',
        '  "keyPoints": ["最多 5 条核心要点，每条 30 字以内，供后续做成记忆卡片"]',
        '}',
      ].join('\n'),
    },
  ];
}

export interface CaptureSummarizeInput {
  title?: string | null
  content: string
}

export interface CaptureSummarizeOutput {
  /** 3~5 条要点，每条 30 字以内 */
  bullets: string[]
  /** 一句话概括 */
  oneLine: string
}

/**
 * A1：收集箱一键提炼要点
 * 把长文/灵感压成可扫读的要点与一句话概括，降低「丢进收集箱就再也不看」的概率。
 */
export function buildCaptureSummarizePrompt(input: CaptureSummarizeInput): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是知识整理助手。用户往收集箱丢了一段内容（可能是文章摘录、灵感、网页剪藏），你要帮它提炼成可快速回看的要点。',
        '要求：',
        '- 要点 3~5 条，每条只讲一个核心信息，30 字以内，用「结论先行」；',
        '- 去掉客套、背景铺垫和重复；',
        '- oneLine 用一句话说清「这段到底在讲什么」；',
        '- 严禁编造原文没有的信息。只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【标题】${input.title || '（未填写）'}`,
        '【内容】',
        truncate(input.content, 8000),
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "bullets": ["最多 5 条要点，每条 30 字以内"],',
        '  "oneLine": "一句话概括，40 字以内"',
        '}',
      ].join('\n'),
    },
  ];
}

export interface TagsInput {
  title?: string | null
  content: string
  /** 本地已有的分类名列表，供模型从中建议一个最贴合的；为空则不建议分类 */
  categories?: string[]
}

export interface TagsOutput {
  /** 3~6 个中文关键词标签 */
  tags: string[]
  /** 从给定分类列表里挑一个最贴合的；都不贴合返回「无」 */
  suggestedCategory: string
}

/**
 * A2：自动标签 + 建议分类
 * 从内容抽关键词做标签，并从本地已有分类里建议一个最贴合的归类。
 */
export function buildTagsPrompt(input: TagsInput): ChatMessage[] {
  const catList = input.categories && input.categories.length
    ? input.categories.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : '（本地暂无分类）'
  return [
    {
      role: 'system',
      content: [
        '你是知识分类助手。根据内容抽取 3~6 个中文关键词标签，并从用户给出的分类列表里挑一个最贴合的归类。',
        '要求：',
        '- 标签是「检索用关键词」，不要是完整句子；',
        '- 建议分类必须严格来自给定列表中的某一项；若都不贴合，返回「无」；',
        '- 不要强行归类。只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【标题】${input.title || '（未填写）'}`,
        '【可选分类列表】',
        catList,
        '【内容】',
        truncate(input.content, 6000),
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "tags": ["3~6 个中文关键词标签"],',
        '  "suggestedCategory": "列表中的某一项，或「无」"',
        '}',
      ].join('\n'),
    },
  ];
}

// ============================ P2 增强体验 ============================

export interface FlashcardsInput {
  title?: string | null
  noteColumn: string
  /** 期望生成卡片数量，默认 5 */
  count?: number
}

export interface FlashcardsOutput {
  cards: { front: string; back: string }[]
}

/**
 * B4/C1：由笔记/收集箱内容批量生成间隔重复卡片（Q/A）。
 * 卡片只生成不写库，由前端逐张走 POST /reviews 创建，避免影响 SM-2 排程。
 */
export function buildFlashcardsPrompt(input: FlashcardsInput): ChatMessage[] {
  const n = Math.max(3, Math.min(8, input.count || 5))
  return [
    {
      role: 'system',
      content: [
        '你是间隔重复（SM-2）的卡片设计助手。把一段知识拆成可自测的问答卡。',
        '要求：',
        '- 生成 ' + n + ' 张左右，front 是「具体可答的问题」，back 是「简洁准确的答案」；',
        '- 一张卡只考一个知识点，避免 open-book 式的大题；',
        '- 优先覆盖核心机制、定义、区别、条件、易错点；',
        '- back 不超过 60 字。只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【主题】${input.title || '（未填写）'}`,
        '【内容】',
        truncate(input.noteColumn, 8000),
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "cards": [{"front": "问题", "back": "答案"}]',
        '}',
      ].join('\n'),
    },
  ];
}

// ============================ 康奈尔笔记 · AI 自测题 ============================

export interface QuizInput {
  title?: string | null
  noteColumn: string
  /** 期望题目数量，默认 5，收敛到 3~8 */
  count?: number
}

/** 单题原始结构（模型输出未清洗前，字段一律按可选处理） */
export interface QuizItemRaw {
  type?: string
  question?: string
  options?: string[]
  answer?: string
  explain?: string
}

export interface QuizOutput {
  quiz: QuizItemRaw[]
}

/**
 * 由笔记正文生成结构化自测题（单选 choice + 填空 fill 混合）。
 *
 * 与 buildFlashcardsPrompt 的差别：后者只要 front/back 两段文本，
 * 这里要求模型给出可判分的题型结构（选项 + 标准答案），
 * 便于路由层直接转成 wb_review_card 并进入复习队列。
 */
export function buildQuizPrompt(input: QuizInput): ChatMessage[] {
  const n = Math.max(3, Math.min(8, input.count || 5))
  return [
    {
      role: 'system',
      content: [
        '你是命题老师，负责把一段学习笔记出成可自测的题目，用于间隔重复复习。',
        '要求：',
        '- 共出 ' + n + ' 道题，单选题（type="choice"）与填空题（type="fill"）混合，单选题占多数；',
        '- 单选题必须给 4 个 options，其中恰有 1 个正确；干扰项要似是而非，不能明显荒谬；',
        '- 单选题的 answer 只写正确选项的字母（A/B/C/D），不要写选项原文；',
        '- 填空题的 question 用连续下划线 ___ 表示待填空位，answer 写应填入的内容；',
        '- 一题只考一个知识点，题干自足（不依赖「上文」「如图」这类指代）；',
        '- explain 用一句话说明为什么，不超过 40 字；',
        '- 所有内容必须来自给定笔记，不得杜撰笔记里没有的事实。只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【主题】${input.title || '（未填写）'}`,
        '【笔记正文】',
        truncate(input.noteColumn, 8000),
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "quiz": [',
        '    {"type": "choice", "question": "题干", "options": ["选项A", "选项B", "选项C", "选项D"], "answer": "A", "explain": "一句话解析"},',
        '    {"type": "fill", "question": "___ 是一种过程。", "answer": "应填内容", "explain": "一句话解析"}',
        '  ]',
        '}',
      ].join('\n'),
    },
  ]
}

export interface InsightReportInput {
  overview: Record<string, unknown>
  forgettingCurve: Record<string, unknown>
  days?: number
}

export interface InsightReportOutput {
  /** 一句话总体评价 */
  summary: string
  /** 3~5 条本周亮点/数据观察 */
  highlights: string[]
  /** 3~5 条可执行的改进建议 */
  suggestions: string[]
}

/**
 * G1：学习周报/洞察。把 overview + forgetting-curve 的硬数据讲成人话。
 */
export function buildInsightReportPrompt(input: InsightReportInput): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是学习数据分析教练。用户给你一周的学习数据，你要用自然语言总结趋势并给可执行建议。',
        '要求：',
        '- summary 一句话点出整体状态（是否在坚持、遗忘率是否偏高）；',
        '- highlights 挑 3~5 个最有信息量的数据点；',
        '- suggestions 给 3~5 条具体、可立刻执行的动作；',
        '- 不编造数据，只基于所给数据推断。只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【统计概览】${JSON.stringify(input.overview)}`,
        `【遗忘曲线（近 ${input.days || 30} 天）】${JSON.stringify(input.forgettingCurve)}`,
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "summary": "一句话总体评价",',
        '  "highlights": ["3~5 条数据观察"],',
        '  "suggestions": ["3~5 条改进建议"]',
        '}',
      ].join('\n'),
    },
  ];
}

export interface WeaknessDiagnoseInput {
  /** 近期 lapse（quality=0）的复习记录摘要 */
  lapses: { front: string; reviewedAt: string }[]
  overallLapseRate: number
  totalReviews: number
}

export interface WeaknessDiagnoseOutput {
  summary: string
  /** 归纳出的薄弱主题 */
  weakTopics: string[]
  suggestions: string[]
}

/**
 * C2：薄弱点诊断。基于复习日志里的 lapse 聚类，归纳「常在哪类上遗忘」。
 */
export function buildWeaknessDiagnosePrompt(input: WeaknessDiagnoseInput): ChatMessage[] {
  const sample = input.lapses.slice(0, 40)
  return [
    {
      role: 'system',
      content: [
        '你是复习诊断师。用户给你一批「答错/遗忘」的卡片正面（问题），你要归纳他常在哪类知识上翻车，并给补救建议。',
        '要求：',
        '- summary 一句话说明整体薄弱情况；',
        '- weakTopics 归纳 3~5 个反复出现的主题/类型（如「公式推导」「人名与时间线」「定义辨析」）；',
        '- suggestions 给 3~5 条针对性补救动作；',
        '- 只基于所给 lapse 推断，不编造。只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【总体遗忘率】${(input.overallLapseRate * 100).toFixed(1)}%（共 ${input.totalReviews} 次复习）`,
        '【近期答错/遗忘的卡片问题】',
        sample.length ? sample.map((l) => `- ${l.front}`).join('\n') : '（无）',
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "summary": "一句话薄弱情况",',
        '  "weakTopics": ["3~5 个薄弱主题类型"],',
        '  "suggestions": ["3~5 条补救建议"]',
        '}',
      ].join('\n'),
    },
  ];
}

export interface DraftNoteInput {
  title?: string | null
  content: string
}

export interface DraftNoteOutput {
  title: string
  noteColumn: string
  cueColumn: string
  summaryColumn: string
}

/**
 * A3：从收集箱内容自动起草康奈尔笔记草稿（含线索列与总结区）。
 */
export function buildDraftNotePrompt(input: DraftNoteInput): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是笔记整理助手。用户给一段收集箱内容，你把它整理成结构化的康奈尔笔记草稿：',
        '- noteColumn 是主体笔记（用自己的话重组，分点/分段，不照抄原文）；',
        '- cueColumn 是 4~6 个「可自测的问题」；',
        '- summaryColumn 是一句话总结；',
        '- 不编造原文没有的关键事实。只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【原标题】${input.title || '（未填写）'}`,
        '【收集箱内容】',
        truncate(input.content, 8000),
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "title": "提炼后的笔记标题",',
        '  "noteColumn": "主体笔记正文",',
        '  "cueColumn": "问题1\\n问题2\\n问题3",',
        '  "summaryColumn": "一句话总结"',
        '}',
      ].join('\n'),
    },
  ];
}

export interface DraftStoryInput {
  title?: string | null
  noteColumn?: string
  audience?: string | null
}

export interface DraftStoryOutput {
  content: string
  metaphor: string
}

/**
 * E3：根据笔记为指定受众起草费曼故事初稿 + 贴切比喻。
 */
export function buildDraftStoryPrompt(input: DraftStoryInput): ChatMessage[] {
  const audience = AUDIENCE_LABEL[String(input.audience || 'CHILD')] || AUDIENCE_LABEL.CHILD
  return [
    {
      role: 'system',
      content: [
        '你是费曼学习法写作助手。用户给你一个知识点（可能还有笔记），你要为指定听众写一段「讲得像个外行也能听懂」的故事初稿，并配一个贴切比喻。',
        '要求：',
        '- content 是 200~400 字的通俗讲解，避免术语堆砌，多用类比和生活例子；',
        '- metaphor 是「一句话比喻」，点出这个知识点最像什么；',
        '- 不编造事实，但可以用合理的生活化类比帮助理解。只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【目标听众】${audience}`,
        `【主题】${input.title || '（未填写）'}`,
        input.noteColumn ? `【参考笔记】${truncate(input.noteColumn, 4000)}` : '',
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "content": "200~400 字通俗讲解",',
        '  "metaphor": "一句话比喻"',
        '}',
      ].join('\n'),
    },
  ];
}

// ============================ P3 进阶/可选 ============================

export interface RecallAdviceRound {
  round: number
  text: string
  score: number | null
}

export interface RecallAdviceInput {
  title: string
  sourceText: string
  rounds: RecallAdviceRound[]
  /** 各轮相对上一轮的进步百分比（可为 null）；用于让模型判断趋势而不是只看单轮分 */
  improvementPct?: (number | null)[]
}

export interface RecallAdviceOutput {
  /** 一句话总体评价：三轮走势如何、记忆是否真正扎根 */
  summary: string
  /** 已经做对/记得牢的地方（正向强化） */
  strengths: string[]
  /** 仍薄弱、易错或混淆的点 */
  gaps: string[]
  /** 针对性的后续复习策略（主动回忆 / 费曼 / 宫殿 / 间隔安排等） */
  advice: string[]
  /** 立刻可执行的下一步动作 */
  nextSteps: string[]
}

/**
 * D2：三轮闭卷默写「趋势改进建议」。
 * 不是再打一次分，而是基于三轮得分走势 + 各轮默写内容，给出「接下来怎么练」的策略。
 */
export function buildRecallAdvicePrompt(input: RecallAdviceInput): ChatMessage[] {
  const trend =
    input.rounds
      .map((r, i) => {
        const imp = input.improvementPct?.[i]
        const impStr = imp == null ? '' : `（较上一轮 ${imp >= 0 ? '+' : ''}${imp}%）`
        return `第 ${r.round} 轮：得分 ${r.score ?? '未提交'}${impStr}\n${truncate(r.text || '（空）', 1500)}`
      })
      .join('\n\n') || '（无提交记录）'
  return [
    {
      role: 'system',
      content: [
        '你是主动回忆训练的教练。用户做了一轮「三轮闭卷默写」（即时默写→补漏默写→1小时复测），',
        '你基于三轮得分走势和各轮默写内容，判断他的记忆到底扎没扎根，并给「接下来怎么练」的具体策略。',
        '要求：',
        '- summary 一句话点出整体走势（稳步上升 / 原地踏步 / 反复遗忘）；',
        '- strengths 指出他记得牢、写对的地方（正向强化，别只挑刺）；',
        '- gaps 指出仍薄弱、记错或混淆的点（结合原文比对，具体不到知识点）；',
        '- advice 给 3~5 条针对性策略（如「第 X 轮明显下滑，建议用费曼法重新讲一遍」「易混点用记忆宫殿固定」）；',
        '- nextSteps 给 3 条立刻可执行的下一步；',
        '- 不编造原文没有的信息。只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【主题】${input.title || '（未填写）'}`,
        '【原文】',
        truncate(input.sourceText, 4000),
        '',
        '【三轮默写记录】',
        trend,
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "summary": "一句话总体评价",',
        '  "strengths": ["已掌握的点"],',
        '  "gaps": ["仍薄弱的点"],',
        '  "advice": ["3~5 条复习策略"],',
        '  "nextSteps": ["3 条下一步动作"]',
        '}',
      ].join('\n'),
    },
  ];
}

export interface PalaceLociInput {
  /** 宫殿主题：房间/街道/校园/自定义 */
  theme?: string
  /** 期望生成的位点数量，默认 6 */
  count?: number
  /**
   * 待挂靠的知识点列表（用户已整理好的条目）。
   * 提供时模型按这些点铺成有序 loci；不提供时模型根据主题自行拆出典型知识点。
   */
  points?: string[]
  /** 宫殿的整体描述/场景说明，帮助模型把握意象风格 */
  context?: string
}

export interface PalaceLociItem {
  /** 位点名称（空间位置名，如「书桌左上角」「第二个路灯」） */
  name: string
  /** 该位点要记住的知识点 */
  knowledgePoint: string
  /** 助记联想图像：夸张、好记、与知识点强关联 */
  imageHint: string
}

export interface PalaceLociOutput {
  loci: PalaceLociItem[]
}

/**
 * F1/F2：记忆宫殿位点自动生成 + 抽象→具象联想图像。
 * 把一组知识点铺成有序的 loci（空间位点），并为每个点生成夸张易记的 imageHint 助记意象。
 * 仅返回位点草稿，由前端逐张走 POST /loci 创建，不自动改库。
 */
export function buildPalaceLociPrompt(input: PalaceLociInput): ChatMessage[] {
  const n = Math.max(3, Math.min(12, input.count || 6))
  const themeLabel =
    { ROOM: '房间', STREET: '街道', CAMPUS: '校园', CUSTOM: '自定义场景' }[String(input.theme || '').toUpperCase()] ||
    (input.theme || '熟悉空间')
  const pointList =
    input.points && input.points.length
      ? input.points.map((p, i) => `${i + 1}. ${p}`).join('\n')
      : '（未提供，请基于主题自行拆出典型、可独立记忆的知识点）'
  return [
    {
      role: 'system',
      content: [
        '你是记忆宫殿（Method of Loci）搭建助手。用户给一组知识点，你把它们挂靠到一个熟悉空间的「有序位点」上，',
        '并为每个点配一个夸张、好记的联想图像（imageHint），利用空间记忆让抽象知识具象化。',
        '要求：',
        `- 生成 ${n} 个左右的位点，按「空间漫游顺序」排列（从入口到深处，或沿一条路线）；`,
        '- name 必须是具体的空间位置名（如「玄关鞋柜」「第三个路灯」「图书馆门口」），不要叫「知识点1」；',
        '- knowledgePoint 是该位点要记住的内容，和输入点一一对应、不遗漏；',
        '- imageHint 必须是「有视觉冲击力」的具象画面：把抽象知识点变成夸张、动态、带颜色/声音/动作的电影镜头（如「一只大象穿围裙在客厅背单词，单词像气球一样炸开」）；越离谱、越鲜艳、越有动感越好记；',
        '- imageHint 不写解释性文字，只输出一个可脑补的画面短句（15~30 字）；',
        '- 严禁编造知识。只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【宫殿主题】${themeLabel}`,
        input.context ? `【场景说明】${input.context}` : '',
        `【待挂靠的知识点（${input.points?.length || 0} 条）】`,
        pointList,
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "loci": [',
        '    { "name": "空间位置名", "knowledgePoint": "该点要记的内容", "imageHint": "夸张易记的联想图像" }',
        '  ]',
        '}',
      ].join('\n'),
    },
  ];
}

export interface PalaceLociImageHintOutput {
  /** 重生成的、有视觉冲击力的联想图像描述 */
  imageHint: string
}

/**
 * F1/F2 单点增强：为「某个已存在位点」重新生成/润色它的 imageHint。
 * 输入位点名称与已绑定的知识点，返回一个更具视觉冲击力、更夸张好记的联想画面。
 */
export function buildPalaceLociImageHintPrompt(input: { name: string; knowledgePoint: string }): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是记忆宫殿（Method of Loci）的联想图像设计师。用户给你一个空间位点名和它绑定的知识点，',
        '你要为这个知识点重新设计一句「有视觉冲击力」的联想图像（imageHint）。',
        '要求：',
        '- 只输出画面，不解释；像一句能直接在脑海里播放的电影镜头（15~30 字）。',
        '- 必须夸张、动态、带颜色/声音/动作/质感，越离谱越好记；把抽象知识变成具体可感的物体或动作。',
        '- 紧扣该位点的知识点，不能偏离主题；严禁编造无关知识。',
        '- 只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【位点名称】${input.name || '未知位置'}`,
        `【绑定知识点】${input.knowledgePoint || '（空）'}`,
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "imageHint": "有视觉冲击力的联想图像短句"',
        '}',
      ].join('\n'),
    },
  ];
}

export interface ReviewRecommendCard {
  front: string
  back?: string
  /** 距下次复习的天数（来自 SM-2，<=0 表示已逾期） */
  intervalDay: number
  /** 易度因子（小数，2.5 为初始） */
  easeFactorDecimal: number
  /** 历史遗忘次数 */
  lapseCount?: number
}

export interface ReviewRecommendInput {
  dueCards: ReviewRecommendCard[]
  /** 近期答错/遗忘的卡片正面（用于判断常错类型） */
  lapses: string[]
  /** 遗忘曲线汇总（总体遗忘率等） */
  forgettingSummary?: Record<string, unknown>
}

export interface ReviewRecommendPriority {
  /** 对应卡片正面 */
  front: string
  /** 为什么现在该优先复习它 */
  reason: string
  /** 建议的复习方式：主动回忆 / 费曼讲解 / 记忆宫殿 / 重做卡片 等 */
  method: string
}

export interface ReviewRecommendOutput {
  /** 一句话总体复习策略 */
  summary: string
  /** 现在最该复习的若干张卡，按优先级排序 */
  priorities: ReviewRecommendPriority[]
  /** 通用复习习惯建议 */
  suggestions: string[]
}

/**
 * G2：智能复习推荐引擎。
 * 综合 SM-2 排程（到期卡、逾期、易度、遗忘次数）与近期 lapse 类型，给出「现在先复习什么、用什么方式」。
 * 只读聚合，不改动排程。
 */
export function buildReviewRecommendPrompt(input: ReviewRecommendInput): ChatMessage[] {
  const due = input.dueCards.slice(0, 30)
  const lapseSample = input.lapses.slice(0, 30)
  return [
    {
      role: 'system',
      content: [
        '你是间隔重复复习教练。用户给你一批「现在该复习」的卡片（含 SM-2 排程信息）和近期常错的卡片，',
        '你要排出复习优先级，并建议每张卡用什么方式复习最有效。',
        '要求：',
        '- summary 一句话点出今天复习重点（如「先抢救逾期的弱卡，再用费曼巩固概念」）；',
        '- priorities 挑 3~6 张最该优先的卡：reason 说明为什么（逾期/易度低/常错），method 给具体方式；',
        '- 优先把「已逾期」和「lapseCount 高」的卡排前面；',
        '- method 从「主动回忆 / 费曼讲解 / 记忆宫殿 / 重做卡片 / 关联笔记」中选最合适的一项；',
        '- suggestions 给 3 条通用复习习惯建议；',
        '- 不编造数据。只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【今天待复习卡片（${due.length} 张）】`,
        due.length
          ? due
              .map(
                (c, i) =>
                  `${i + 1}. ${c.front} ｜间隔${c.intervalDay}天｜易度${c.easeFactorDecimal}｜遗忘${c.lapseCount ?? 0}次`,
              )
              .join('\n')
          : '（无）',
        '',
        `【近期常错卡片（${lapseSample.length} 张）】`,
        lapseSample.length ? lapseSample.map((f) => `- ${f}`).join('\n') : '（无）',
        '',
        input.forgettingSummary ? `【遗忘曲线汇总】${JSON.stringify(input.forgettingSummary)}` : '',
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "summary": "一句话复习策略",',
        '  "priorities": [{"front": "卡片正面", "reason": "为什么优先", "method": "建议方式"}],',
        '  "suggestions": ["3 条习惯建议"]',
        '}',
      ].join('\n'),
    },
  ];
}

// ===================== 思维导图大纲生成 =====================

export interface MindMapInput {
  /** 用户输入的主题词或一句话需求 */
  topic: string;
  /** 期望的层级深度，2~5，默认 3 */
  depth?: number;
  /** 期望的一级分支数量，3~8，默认 5 */
  branches?: number;
}

/** 模型输出的裸树节点（无 id，id 由服务端补齐） */
export interface MindMapOutlineNode {
  text: string;
  children?: MindMapOutlineNode[];
}

export interface MindMapOutput {
  /** 导图标题，前端用作文档名 */
  title: string;
  /** 层级嵌套的大纲数组 */
  outline: MindMapOutlineNode[];
}

/**
 * 思维导图大纲生成
 *
 * 与其它提示词的差别：这里输出的是「递归结构」而非扁平字段，模型最容易犯的两个错是
 * (1) 用 Markdown 代码块包裹 JSON，(2) 把树拍平成带缩进的字符串。
 * 因此系统提示对结构与「只输出 JSON」都做了强约束，并在 user 段给出结构范例。
 */
export function buildMindMapPrompt(input: MindMapInput): ChatMessage[] {
  const depth = Math.min(5, Math.max(2, Number(input.depth) || 3));
  const branches = Math.min(8, Math.max(3, Number(input.branches) || 5));
  return [
    {
      role: 'system',
      content: [
        '你是一个生成思维导图大纲的专家。请根据用户输入的主题，返回一个层级嵌套的 JSON 数组结构，',
        '数组每一项包含 text（节点文本）和 children（子节点数组）。',
        '不要返回任何额外的 Markdown 解释说明，只输出纯 JSON。',
        '',
        '质量要求：',
        `1. 一级分支 ${branches} 个左右，覆盖该主题的主要维度，彼此之间不重叠（MECE 原则）；`,
        `2. 整体层级深度控制在 ${depth} 级，叶子节点要具体可执行，不要空泛的口号；`,
        '3. 节点文本精炼，控制在 20 个汉字以内，能带关键术语就带上；',
        '4. 用中文输出，除非用户主题本身是英文；',
        '5. 叶子节点的 children 写成空数组 []，不要省略该字段。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【主题】${truncate(input.topic, 500)}`,
        '',
        '请严格按以下 JSON 结构输出（结构示意，内容请围绕上面的主题重新生成）：',
        '{',
        '  "title": "导图标题",',
        '  "outline": [',
        '    { "text": "一级分支", "children": [',
        '      { "text": "二级节点", "children": [ { "text": "三级节点", "children": [] } ] }',
        '    ] }',
        '  ]',
        '}',
      ].join('\n'),
    },
  ];
}
