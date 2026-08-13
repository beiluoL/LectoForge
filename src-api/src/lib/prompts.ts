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

/** 出题类型：choice=全单选，fill=全填空，mixed=混合（默认，保持旧行为） */
export type QuizType = 'choice' | 'fill' | 'mixed'

export interface QuizInput {
  title?: string | null
  noteColumn: string
  /** 期望题目数量，默认 5，收敛到 3~8 */
  count?: number
  /** 题型；缺省 mixed，与本接口最初的契约一致 */
  type?: QuizType
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
  const type: QuizType = input.type === 'choice' || input.type === 'fill' ? input.type : 'mixed'

  // 题型约束单独拼：三种模式只有这一句不同，其余规则完全共用，避免维护三份提示词
  const typeRule =
    type === 'choice'
      ? `- 共出 ${n} 道题，全部为单选题（type 一律写 "choice"），不要出填空题；`
      : type === 'fill'
        ? `- 共出 ${n} 道题，全部为填空题（type 一律写 "fill"），不要出单选题；`
        : `- 共出 ${n} 道题，单选题（type="choice"）与填空题（type="fill"）混合，单选题占多数；`

  // 结构示例也跟着题型走，模型对「示例」的服从度远高于对「文字要求」的服从度
  const sample =
    type === 'fill'
      ? ['    {"type": "fill", "question": "___ 是一种过程。", "answer": "应填内容", "explain": "一句话解析"}']
      : type === 'choice'
        ? [
            '    {"type": "choice", "question": "题干", "options": ["选项A", "选项B", "选项C", "选项D"], "answer": "A", "explain": "一句话解析"}',
          ]
        : [
            '    {"type": "choice", "question": "题干", "options": ["选项A", "选项B", "选项C", "选项D"], "answer": "A", "explain": "一句话解析"},',
            '    {"type": "fill", "question": "___ 是一种过程。", "answer": "应填内容", "explain": "一句话解析"}',
          ]

  return [
    {
      role: 'system',
      content: [
        '你是命题老师，负责把一段学习笔记出成可自测的题目，用于间隔重复复习。',
        '要求：',
        typeRule,
        ...(type === 'fill'
          ? []
          : [
              '- 单选题必须给 4 个 options，其中恰有 1 个正确；干扰项要似是而非，不能明显荒谬；',
              '- 单选题的 answer 只写正确选项的字母（A/B/C/D），不要写选项原文；',
            ]),
        ...(type === 'choice'
          ? []
          : ['- 填空题的 question 用连续下划线 ___ 表示待填空位，answer 写应填入的内容；']),
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
        ...sample,
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

// ===================== 康奈尔笔记 · 由正文生成导图大纲 =====================

export interface NoteMindMapInput {
  /** 笔记标题，用作导图根节点的语义锚点 */
  title?: string | null;
  /** 笔记区正文（已 stripHtml） */
  noteColumn: string;
  /** 线索列，作为「作者本人认为的重点」提示，可为空 */
  cueColumn?: string | null;
  depth?: number;
  branches?: number;
}

/**
 * 由康奈尔笔记正文抽取思维导图大纲。
 *
 * 与 buildMindMapPrompt（主题词发散）的本质区别：这里是「归纳」而非「生成」——
 * 只允许重组笔记里已有的信息，禁止补充笔记外的知识点，
 * 否则导图会掺进模型的通用常识，回看时无法分辨哪些是自己记过的。
 */
export function buildNoteMindMapPrompt(input: NoteMindMapInput): ChatMessage[] {
  const depth = Math.min(5, Math.max(2, Number(input.depth) || 3));
  const branches = Math.min(8, Math.max(3, Number(input.branches) || 5));
  return [
    {
      role: 'system',
      content: [
        '你是知识结构化专家。用户会给你一份康奈尔笔记，请把它的知识结构抽成层级嵌套的思维导图大纲。',
        '数组每一项包含 text（节点文本）和 children（子节点数组）。只输出纯 JSON，不要 Markdown 代码块。',
        '',
        '质量要求：',
        `1. 一级分支 ${branches} 个左右，对应笔记的主要板块，彼此不重叠；`,
        `2. 层级深度控制在 ${depth} 级，叶子节点落到具体结论、定义或步骤；`,
        '3. 节点文本精炼，20 个汉字以内，保留原文的关键术语，不要改写成同义词；',
        '4. 【最重要】只能归纳笔记里已经写到的内容，严禁补充笔记之外的知识点——',
        '   宁可分支少一点，也不要杜撰；笔记没展开的地方就只留一个节点；',
        '5. 叶子节点的 children 写成空数组 []，不要省略该字段；',
        '6. title 用笔记标题或对笔记主旨的一句话概括。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【笔记标题】${input.title || '（未填写）'}`,
        input.cueColumn ? `【线索列（作者标注的重点）】\n${truncate(input.cueColumn, 1500)}` : '',
        '【笔记正文】',
        truncate(input.noteColumn, 8000),
        '',
        '请严格按以下 JSON 结构输出（结构示意，内容必须来自上面的笔记）：',
        '{',
        '  "title": "导图标题",',
        '  "outline": [',
        '    { "text": "一级分支", "children": [',
        '      { "text": "二级节点", "children": [ { "text": "三级节点", "children": [] } ] }',
        '    ] }',
        '  ]',
        '}',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

// ===================== 康奈尔笔记 · AI 续写拓展 =====================

export interface NoteExtendInput {
  title?: string | null;
  /** 当前正文（已 stripHtml），模型据此判断文风与已覆盖的范围 */
  currentText: string;
  /** 用户可选的方向指令，如「多讲讲落地实践」 */
  direction?: string | null;
  /** 期望字数下限，默认 300 */
  minChars?: number;
}

export interface NoteExtendOutput {
  /** 续写正文，Markdown 片段 */
  continuation: string;
  /** 一句话说明这段补充了什么，用于对比窗标题 */
  summary?: string;
}

/**
 * 康奈尔笔记 AI 续写。
 *
 * 设计取舍：不让模型重写全文，只产出「可独立插入的增量段落」。
 * 原因是前端提供了「另起新段落」与「插入光标处」两种落点，
 * 若模型返回整篇改写版，用户就只能整体接受或整体丢弃，失去局部采纳的能力。
 * 因此提示词明确要求：不复述已有内容、不写开场白、不带标题层级跳跃。
 */
export function buildNoteExtendPrompt(input: NoteExtendInput): ChatMessage[] {
  const min = Math.min(1200, Math.max(150, Number(input.minChars) || 300));
  return [
    {
      role: 'system',
      content: [
        '你是这份笔记作者的写作助手，任务是「接着往下写」，而不是重写或总结。',
        '要求：',
        `- 基于前面的内容，延伸输出至少 ${min} 字的详细说明，保持文风一致；`,
        '- 严格模仿原文的语气、人称、术语习惯和排版粒度（原文用列表你就用列表，原文是段落就写段落）；',
        '- 只写「新增」的部分：不要复述已有内容，不要写「综上所述」「接下来我们来看」这类过渡口水话；',
        '- 不要重复原文已经出现过的标题；如需分节，用比原文最深标题低一级的标题，或直接用加粗小标题；',
        '- 内容要具体：给机制、给条件、给例子、给对比、给边界，避免正确但无信息量的空话；',
        '- 如果涉及不确定的事实，用「一般来说 / 常见做法是」这类限定语，不要编造具体数字、人名和出处；',
        '- 用 Markdown 书写，不要用代码块包裹整段输出；',
        '- 只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【笔记标题】${input.title || '（未填写）'}`,
        input.direction ? `【本次续写方向】${truncate(input.direction, 300)}` : '',
        '【已写正文】',
        truncate(input.currentText, 8000),
        '',
        '请按以下 JSON 结构输出：',
        '{',
        `  "continuation": "接着上文写下去的正文（Markdown，不少于 ${min} 字）",`,
        '  "summary": "一句话说明这段补充了什么，不超过 30 字"',
        '}',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

// ===================== 间隔复习：AI 辅助记忆 =====================

export interface ReviewMnemonicInput {
  /** 卡片正面（问题 / 线索） */
  front: string;
  /** 卡片背面（答案 / 知识点） */
  back: string;
  /** 学科上下文，如「Java 多线程」。缺省时模型自行判断领域 */
  context?: string | null;
}

export interface ReviewMnemonicOutput {
  /** 首选口诀，直接展示在卡片底部 */
  mnemonic: string;
  /** 口诀怎么对应知识点的一句话拆解，帮用户建立锚点 */
  explanation: string;
  /** 备选口诀（0~2 条），用户不满意时可换一个 */
  alternatives?: string[];
}

/**
 * 为单张复习卡生成助记口诀。
 *
 * 设计取舍：
 * - 强制「短」。口诀超过 20 字就失去了口诀的意义，用户宁可背原文。
 * - 要求同时给 explanation。只给一句谐音梗而不说明对应关系，用户第二天照样忘；
 *   拆解本身就是记忆锚点，也是前端「采纳」前判断质量的依据。
 * - 备选做成数组而非再请求一次：一次 LLM 调用拿三个候选，比点三次「换一个」便宜得多。
 * - 明确禁止编造知识点：口诀只能重组 back 里已有的信息，不能引入新事实，
 *   否则会把错误的记忆锚点焊进用户脑子里，比不给口诀更糟。
 */
export function buildReviewMnemonicPrompt(input: ReviewMnemonicInput): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是记忆法专家，擅长把枯燥知识点压缩成朗朗上口、过目不忘的助记口诀。',
        '要求：',
        '- 口诀必须**短**：不超过 20 个字，优先四字短语、对仗、押韵、谐音、首字母串联。',
        '- 口诀要能直接映射到答案的关键要素，读一遍就能反推出知识点。',
        '- 允许用夸张画面、生活化类比、谐音梗，越具体越好记；但不要低俗。',
        '- 严禁编造：只能重组用户给出的答案里已有的信息，不得引入任何新的事实、数字或术语。',
        '- explanation 用一句话说明口诀的每一部分对应什么，不超过 60 字。',
        '- alternatives 给 0~2 条风格不同的备选口诀（比如一条走谐音、一条走画面）。',
        '- 只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        input.context ? `【学科领域】${truncate(input.context, 60)}` : '',
        `【卡片正面 / 问题】${truncate(input.front, 500)}`,
        `【卡片背面 / 答案】${truncate(input.back, 2000)}`,
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "mnemonic": "不超过 20 字的助记口诀",',
        '  "explanation": "口诀各部分对应什么，一句话，不超过 60 字",',
        '  "alternatives": ["备选口诀1", "备选口诀2"]',
        '}',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

export interface ReviewSummaryCard {
  front: string;
  back?: string;
  /** 本轮评分档位，用于区分「完全没记住」和「勉强想起来」 */
  rating: string;
}

export interface ReviewSummaryInput {
  /** 本轮总复习张数 */
  total: number;
  /** 其中评为 hard（没记住）的张数 */
  hardCount: number;
  /** 需要重点复盘的卡片（一般只传 hard，最多 20 张） */
  cards: ReviewSummaryCard[];
  /** 用时（分钟），可选，用于简报里的节奏点评 */
  minutes?: number | null;
}

export interface ReviewSummaryOutput {
  /** 一句话总评，展示在简报最上方 */
  headline: string;
  /** 从 hard 卡里归纳出的薄弱知识簇（2~4 条） */
  weakTopics: { topic: string; reason: string }[];
  /** 下一步行动建议（2~4 条），要具体可执行 */
  suggestions: string[];
  /** 鼓励语，一句话，避免用户被负面反馈劝退 */
  encouragement: string;
}

/**
 * 本轮复习结束后的 AI 简报。
 *
 * 设计取舍：
 * - 输入只喂 hard 卡而非全量。全量会稀释信号，模型倾向于泛泛总结「你今天很努力」；
 *   只喂没记住的，才能逼出「这几张都属于同一个概念簇」这种真正有用的归纳。
 * - weakTopics 要求归纳成「簇」而不是逐张点评。逐张点评用户自己看卡片就行了，
 *   AI 的增量价值在于发现跨卡片的共性（例如「都栽在 volatile 的可见性上」）。
 * - 强制 encouragement 字段：复习简报天然全是负反馈，没有正向收尾会让人不想开第二轮。
 * - 全 hard 与全 pass 都要能出稿，所以 weakTopics 允许为空数组。
 */
export function buildReviewSummaryPrompt(input: ReviewSummaryInput): ChatMessage[] {
  const list = input.cards
    .slice(0, 20)
    .map((c, i) => {
      const back = c.back ? truncate(c.back, 300) : '（无答案文本）';
      return `${i + 1}. [${c.rating}] 问：${truncate(c.front, 120)} ｜ 答：${back}`;
    })
    .join('\n');

  return [
    {
      role: 'system',
      content: [
        '你是学习教练。用户刚做完一轮间隔复习，你要基于他「没记住」的卡片写一份简短复盘。',
        '要求：',
        '- headline 一句话总评，不超过 30 字，要具体，不要「继续加油」这种废话。',
        '- weakTopics 把没记住的卡片**归纳成 2~4 个知识簇**，而不是逐张复述；',
        '  每条给 topic（薄弱主题，不超过 12 字）和 reason（为什么会栽在这里，不超过 40 字）。',
        '  如果没有任何 hard 卡，weakTopics 返回空数组。',
        '- suggestions 给 2~4 条**下一步具体做什么**，例如「把 X 和 Y 放一起对比记」，',
        '  不要写「多复习」「保持练习」这类无信息量建议。',
        '- encouragement 一句真诚的鼓励，不超过 25 字，不要浮夸。',
        '- 严禁编造用户没有涉及的知识点。',
        '- 只输出 JSON。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【本轮复习】共 ${input.total} 张，其中没记住（hard）${input.hardCount} 张` +
          (input.minutes ? `，用时约 ${input.minutes} 分钟` : ''),
        '',
        '【需要复盘的卡片】',
        list || '（本轮全部通过，没有需要复盘的卡片）',
        '',
        '请按以下 JSON 结构输出：',
        '{',
        '  "headline": "一句话总评",',
        '  "weakTopics": [{ "topic": "薄弱主题", "reason": "为什么栽在这里" }],',
        '  "suggestions": ["具体行动建议1", "具体行动建议2"],',
        '  "encouragement": "一句鼓励"',
        '}',
      ].join('\n'),
    },
  ];
}

// ===================== 知识库问答（RAG 检索增强生成）=====================

/**
 * 知识库问答 Prompt。
 *
 * 设计要点（与本项目其他提示词一致的「只输出 JSON」约束）：
 * - context 已由 Service 拼装为带序号的「[来源 N]」块，每块内含 标题 / 链接 / 正文；
 *   模型被严格要求**只依据这些块**作答，禁止引入外部知识或凭空捏造。
 * - 若 context 中没有任何相关信息，必须固定回答「知识库中未找到相关内容」。
 * - sources 只列**实际引用**的来源：把对应「[来源 N]」里的 标题 与 链接 原样照抄，
 *   不改动、不编造链接。Service 端会二次校验 link 是否真实存在，过滤掉幻觉来源。
 */
export function buildRagPrompt(query: string, context: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是 LectoForge 的知识库问答助手。你只能依据下方「[来源 N]」标注的检索片段来回答用户问题。',
        '严格要求：',
        '1. 仅使用提供的检索片段作答；若片段中没有任何与问题相关的信息，必须回答「知识库中未找到相关内容」，严禁凭空捏造或引入外部知识。',
        '2. 回答要基于片段原文、引用关键事实，不要泛泛而谈，也不要重复整段原文。',
        '3. sources 中只列出你**实际引用**的来源：把对应「[来源 N]」里的「标题」与「链接」原样照抄进 title / link 字段，sourceType 照抄 doc 或 note。不要编造来源、不要改动链接。',
        '4. 若没有任何可引用来源，sources 返回空数组。',
        '5. 只输出 JSON，不要任何解释性文字。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '【用户问题】',
        query,
        '',
        '【检索到的上下文（仅供你引用，禁止泄漏无关内容）】',
        context,
        '',
        '请严格按以下 JSON 结构输出：',
        '{',
        '  "answer": "基于上述来源生成的回答；无相关信息时固定为「知识库中未找到相关内容」",',
        '  "sources": [',
        '    { "sourceType": "doc" 或 "note", "title": "照抄来源标题", "link": "照抄来源链接" }',
        '  ]',
        '}',
      ].join('\n'),
    },
  ];
}

// ===================== 模拟面试（多角色 + 智能追问）=====================

/** 不同面试角色的 System 人设。键与前端胶囊选项保持一致。 */
const INTERVIEW_ROLE_PROMPTS: Record<string, string> = {
  通用面试官:
    '你是一场模拟面试的通用面试官，正在和学员进行语音通话。请用自然、口语化、适合语音朗读的中文沟通，' +
    '不要使用 Markdown、列表或括号备注，也不要暴露「我是 AI」。保持简短、像真人在对话，兼顾广度与深度。',
  大厂架构师:
    '你是一位拥有 10 年经验的 Java 架构师，正在对候选人进行后端技术栈的深度压力面试。' +
    '语气严厉、专业，追问务必切中要害：深入底层原理（JVM、并发、分布式、系统设计），' +
    '对含糊回答要当场追问「为什么」「底层是怎么实现的」。不要使用 Markdown，口语化、适合语音朗读。',
  HR面试官:
    '你是一位资深 HR 面试官，正在评估候选人的综合素质、沟通表达、职业规划与团队协作。' +
    '关注行为面试（STAR 法则）、自我认知与稳定性，语气专业但温和，像真人在对话，不要用 Markdown。',
  同级评审:
    '你是一位同级的资深同事，正在和 candidate 做技术评审（peer review / 结对探讨）。' +
    '风格平等、 Collaborative，可以探讨不同方案的取舍，也可以就某个实现细节深入切磋，像真人同事聊天，不用 Markdown。',
  技术主管:
    '你是一位技术主管（Tech Lead），关注候选人的技术判断力、权衡决策、带人能力与落地经验。' +
    '会问「为什么选 A 不选 B」「如果规模扩大 10 倍你怎么改」，语气沉稳、有领导者视角，口语化、适合语音朗读，不用 Markdown。',
};

const DEFAULT_INTERVIEW_ROLE = '通用面试官';

/**
 * 生成面试 System Prompt（含角色人设 + 历史对话上下文）。
 *
 * @param role    前端选择的预设角色（见 INTERVIEW_ROLE_PROMPTS 的键）
 * @param history 最近若干轮「问答+点评」的文本摘要（已截断），用于让追问连贯
 * @returns ChatMessage[]（单条 system 消息），供 interviewService 再追加 user 指令
 */
export function buildInterviewSystemPrompt(role: string, history: string): ChatMessage[] {
  const persona = INTERVIEW_ROLE_PROMPTS[role] || INTERVIEW_ROLE_PROMPTS[DEFAULT_INTERVIEW_ROLE];
  const historyBlock = history && history.trim() ? `\n\n【对话历史（最近几轮，供你保持连贯）】\n${history.trim()}` : '';
  return [
    {
      role: 'system',
      content:
        `${persona}${historyBlock}\n\n你的职责：基于学员上一轮回答，判断其薄弱点；` +
        '若发现薄弱点（如死锁、JVM 调优、并发安全、系统设计缺陷等），必须生成一道针对该薄弱点的深入追问，' +
        '不要每次都抽新题。只输出严格 JSON，不要任何解释性文字。',
    },
  ];
}

/**
 * 构建「下一轮决策」请求的 user 指令：要求模型输出
 * { nextAction, nextQuestion, weakness, suggestion }。
 */
export function buildInterviewDecisionPrompt(input: {
  lastQuestion: string;
  transcript: string;
  score: number;
}): ChatMessage[] {
  return [
    {
      role: 'user',
      content: [
        `【上一题】${input.lastQuestion || '（开场，无上一题）'}`,
        `【学员回答】${input.transcript || '（未作答）'}`,
        `【关键词命中评分(0~100)】${input.score}`,
        '',
        '请基于以上，做出下一步决策，严格按以下 JSON 结构输出：',
        '{',
        '  "nextAction": "question" 或 "end"（学员表现达标且无可追问题则 end），',
        '  "nextQuestion": "若 nextAction=question，给出下一题或追问内容（针对薄弱点深入）；若 end 可留空字符串",',
        '  "weakness": "检出的薄弱点关键词（如 死锁/JVM调优/并发安全），无则空字符串",',
        '  "suggestion": "给学员的改进建议（1~2 句，口语化、适合语音朗读）"',
        '}',
      ].join('\n'),
    },
  ];
}
