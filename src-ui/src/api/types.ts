// 后端接口数据类型定义。
//
// ⚠️ 本文件共 158 个导出，但全项目实际只 import 了其中 16 个，分界线在下方 §「学习工作台」注释：
//
//   · 分界线【之后】 —— 学习工作台在用类型（收集箱 / 笔记 / 记忆宫殿 / 复述 / 故事 / 总览），随后端契约演进；
//   · 分界线【之前】 —— 社区、评论、排行榜、学习小组、单聊私信、编程 Agent、Ollama、代码题库、成就勋章等
//     分区，均为 Web 端 LearnHub 时期带过来的历史类型，桌面端**没有任何对应功能**，属死代码，
//     待独立 PR 清理（预计可删 ~1400 行）。新增功能请勿引用分界线之前的类型。
//
// 收敛方向：在用类型逐步指向 @shared（= src-api/src/types，后端契约单一事实源）。
// 已完成：WorkbenchOverview + 五个 Payload 入参类型。
// 未完成：6 个读模型 VO（WbCapture / WbNote / WbPalace / WbPalaceLoci / WbRecallSession / WbStory），
//        原因是两侧在「可空写法」与「字面量联合」上存在 34 处差异，直接指过去会丢失
//        status / theme / audience / sourceType 的字面量约束，需单独的契约对齐 PR，见重构方案 §6.2。
import type { OverviewStats as SharedOverviewStats } from '@shared/overview'
import type { CreateCaptureDTO } from '@shared/capture'
import type { CreateNoteDTO } from '@shared/note'
import type { CreatePalaceDTO, CreateLociDTO, UpdateLociDTO } from '@shared/palace'
import type { CreateStoryDTO } from '@shared/story'

/**
 * 把后端 DTO 的可空写法（`T | null`）收紧成前端惯用的 `?: T`，同时保留 @shared 作为字段名的单一事实源。
 *
 * 为什么需要它：后端如实标注了库列可空，而前端从来只构造对象、不发送 null。
 * 直接 `type X = CreateXxxDTO` 会把 null 引入前端类型并泄漏到下游 AI 请求参数上（实测 5 处报错），
 * 而这些 null 在运行时根本不会出现——那是类型放宽带来的假阳性，不是真实缺陷。
 * 这里用同态映射保留 `?` 修饰符、仅剔除 null，得到与重构前逐字段等价的形状：零行为变化。
 * 后端 DTO 增删字段时，前端仍会自动同步。
 */
type FromDTO<T> = { [K in keyof T]: Exclude<T[K], null> }

export interface ApiResult<T = unknown> {
  code: number
  message: string
  data: T
}

// ===== 分类 =====
export interface CategoryVO {
  id: number
  name: string
  code?: string
  parentId?: number
  icon?: string
  description?: string
  sortOrder?: number
  docCount?: number
  createTime?: string
  memberCount?: number
  storageSize?: string
  /** 分类树节点层级（0 为顶级） */
  depth?: number
  /** 分类树节点全路径，如「学习/前端/Vue」 */
  path?: string
  children?: CategoryVO[]
}

// ===== 学习工作台（输入 → 整理 → 复习 → 输出 四模块闭环）=====

/**
 * 工作台总览统计。
 * 已收敛到 @shared：逐字段与后端 OverviewStats 完全一致，故直接复用，不再手写第二份。
 */
export type WorkbenchOverview = SharedOverviewStats

/** 收集箱条目（知识输入） */
export interface WbCapture {
  id: number
  userId: number
  title: string
  content?: string
  sourceType?: 'MANUAL' | 'DOC' | 'WEB' | 'AI' | 'IMPORT'
  sourceUrl?: string
  docId?: number
  categoryId?: number
  tags?: string
  status?: 'INBOX' | 'PROCESSED' | 'ARCHIVED'
  starred?: number
  createTime?: string
  updateTime?: string
}

/** 康奈尔笔记（知识整理） */
export interface WbNote {
  id: number
  userId: number
  captureId?: number
  categoryId?: number
  title: string
  cueColumn?: string
  noteColumn?: string
  summaryColumn?: string
  tags?: string
  mastery?: number
  /** SRS 排程：下次复习时间（ISO 字符串）；从未复习过时为 1970 纪元默认值 */
  dueDate?: string
  easeFactor?: number
  repetitions?: number
  intervalDay?: number
  lapseCount?: number
  /** 已复习次数；为 0 表示这条笔记还没进过复习队列（列表页据此区分「新笔记」与「需复习」） */
  reviewCount?: number
  lastReviewedAt?: string
  createTime?: string
  updateTime?: string
}

/** 间隔重复卡片（知识复习） */
export interface WbReviewCard {
  id: number
  userId: number
  captureId?: number
  noteId?: number
  categoryId?: number
  front: string
  back: string
  cardType?: 'BASIC' | 'CLOZE' | 'RECALL'
  easeFactor?: number
  repetitions?: number
  intervalDay?: number
  reviewCount?: number
  lapseCount?: number
  nextReviewTime?: string
  lastReviewTime?: string
  suspended?: number
  createTime?: string
  updateTime?: string
}

/** 复习卡片返回（含人类可读调度信息） */
export interface WbReviewCardVO extends WbReviewCard {
  easeFactorDecimal?: number
  nextReviewHint?: string
}

/** 复习评分结果 */
export interface WbReviewGradeResult {
  cardId: number
  quality: number
  repetitions: number
  intervalDay: number
  easeFactor: number
  nextReviewAt: number
  lapsed: boolean
}

/**
 * 旧复习系统（wb_review_card）待复习计数。
 * 复习驾驶舱用它渲染「待复习（传统卡组）：N 张」摘要标签，
 * 与新系统（notes + loci 的 SM-2 到期数，取自 dashboard.dueReviews）并列展示。
 */
export interface WbReviewDueCount {
  /** 到期且未暂停的卡片总数 */
  count: number
  /** 前 3 张卡片的正面文案，可用于提示预览 */
  sample: string[]
}

/** 记忆宫殿（知识复习扩展） */
export interface WbPalace {
  id: number
  userId: number
  name: string
  description?: string
  theme?: 'ROOM' | 'STREET' | 'CAMPUS' | 'CUSTOM'
  coverColor?: string
  categoryId?: number
  createTime?: string
  updateTime?: string
}

/** 记忆宫殿位点 */
export interface WbPalaceLoci {
  id: number
  userId: number
  palaceId: number
  captureId?: number
  noteId?: number
  categoryId?: number
  name: string
  knowledgePoint?: string
  imageHint?: string
  icon?: string
  posX?: number
  posY?: number
  sortOrder?: number
  /** SRS 熟练度 0-5（越高越熟） */
  masteredLevel?: number
  /** 最近一次复习打分时间（ISO 字符串） */
  lastReviewedAt?: string
  createTime?: string
  updateTime?: string
}

/** 费曼故事（知识输出） */
export interface WbStory {
  id: number
  userId: number
  captureId?: number
  noteId?: number
  categoryId?: number
  title: string
  audience?: 'CHILD' | 'NEWBIE' | 'PEER' | 'INTERVIEWER'
  metaphor?: string
  content?: string
  gapNote?: string
  status?: 'DRAFT' | 'DONE' | 'PUBLISHED'
  clarityScore?: number
  wordCount?: number
  createTime?: string
  updateTime?: string
}

/**
 * 收集箱入参。已收敛到 @shared。
 * 入参是「只写」方向：前端构造对象交给后端，指向 DTO 属于放宽可空性（多接受 null），
 * 不会收紧任何现有调用点，故可无损收敛。下同。
 */
export type WbCapturePayload = FromDTO<CreateCaptureDTO>

/** 康奈尔笔记入参。已收敛到 @shared。 */
export type WbNotePayload = FromDTO<CreateNoteDTO>

/** 复习卡片入参 */
export interface WbReviewCardPayload {
  captureId?: number
  noteId?: number
  categoryId?: number
  front: string
  back: string
  cardType?: string
}

/** 复习评分入参 */
export interface WbReviewGradePayload {
  quality: number
  costMs?: number
}

/** 记忆宫殿入参。已收敛到 @shared。 */
export type WbPalacePayload = FromDTO<CreatePalaceDTO>

/**
 * 宫殿位点入参。已收敛到 @shared。
 * 前端同一个 payload 同时用于新建与编辑，而后端把两者拆成了 CreateLociDTO / UpdateLociDTO，
 * 其中 masteredLevel、lastReviewedAt 只存在于 Update 侧，故在此取并集补回这两个字段。
 */
export type WbPalaceLociPayload = FromDTO<
  CreateLociDTO & Pick<UpdateLociDTO, 'masteredLevel' | 'lastReviewedAt'>
>

/** 费曼故事入参。已收敛到 @shared。 */
export type WbStoryPayload = FromDTO<CreateStoryDTO>

/* 知识库分类树节点（与 doc_category 同源）：
 * 字段已合并进本文件上方的 CategoryVO 单一声明，此处不再重复声明，
 * 避免 TS 接口自动合并导致 parentId / docCount 可选性冲突（TS2687 / TS2717）。 */

/** 遗忘曲线单日数据点 */
export interface WbForgettingCurvePoint {
  date: string
  reviews: number
  lapses: number
  lapseRate: number
  newCards: number
}

/** 遗忘曲线可视化数据 */
export interface WbForgettingCurve {
  startDate: string
  endDate: string
  points: WbForgettingCurvePoint[]
  totalReviews: number
  totalLapses: number
  overallLapseRate: number
}

/** 主动回忆会话（三轮闭卷默写） */
export interface WbRecallSession {
  id: number
  noteId?: number
  cardId?: number
  title?: string
  sourceText: string
  round1Text?: string
  round1Score?: number
  round2Text?: string
  round2Score?: number
  round3Text?: string
  round3Score?: number
  currentRound: number
  status: 'IN_PROGRESS' | 'COMPLETED'
  round3DueTime?: string
  completedTime?: string
  createTime?: string
  updateTime?: string
  /** 三轮分数序列（用于折线图），null 表示该轮未提交 */
  scoreTrend: (number | null)[]
  /** 逐轮进步百分比（相对上一轮），null 表示无对比基准 */
  improvementPct: (number | null)[]
}

/** 主动回忆会话提交入参 */
export interface WbRecallSessionPayload {
  noteId?: number
  cardId?: number
  title?: string
  sourceText?: string
  /** 当前提交的轮次：1 / 2 / 3 */
  round?: number
  /** 本轮默写内容 */
  text?: string
}

// ===== 知识库问答（RAG）=====

/** 检索来源（文档库 .md 或康奈尔笔记） */
export interface RagSource {
  /** 来源类型：文档库 或 笔记 */
  sourceType: 'doc' | 'note'
  /** 匹配标题：文档为文件名（去 .md 后缀），笔记为 wb_note.title */
  title: string
  /** 跳转链接：文档为 /library?doc=<相对id>，笔记为 /workbench/notes/<id> */
  link: string
  /**
   * 文档库命中时的精确行号锚点，形如 "L20-L25"（1-based，闭区间）。
   * 笔记来源因 content 多为 HTML/富文本，暂不提供精确行号，故为可选。
   */
  anchor?: string
}

/** POST /ai/rag/ask 返回 */
export interface RagResponse {
  /** 基于检索上下文生成的回答；无相关信息时固定为「知识库中未找到相关内容」 */
  answer: string
  /** 实际引用的来源清单（链接均为真实可跳转地址） */
  sources: RagSource[]
}
