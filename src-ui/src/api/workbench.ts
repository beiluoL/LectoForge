// 学习工作台接口：输入（收集箱）→ 整理（康奈尔笔记）→ 复习（间隔重复+记忆宫殿）→ 输出（费曼故事）四模块闭环。
import { apiGet, apiPost, apiPut, apiDelete } from './request'
import type {
  WorkbenchOverview,
  WbCapture,
  WbCapturePayload,
  WbNote,
  WbNotePayload,
  WbReviewCard,
  WbReviewCardVO,
  WbReviewCardPayload,
  WbReviewGradePayload,
  WbReviewGradeResult,
  WbReviewDueCount,
  WbPalace,
  WbPalacePayload,
  WbPalaceLoci,
  WbPalaceLociPayload,
  WbStory,
  WbStoryPayload,
  CategoryVO,
  WbForgettingCurve,
  WbRecallSession,
  WbRecallSessionPayload,
} from './types'

// ============================ 总览 ============================
/** 工作台总览统计（四模块概览指标） */
export function getWorkbenchOverview() {
  return apiGet<WorkbenchOverview>('/workbench/overview')
}

// ============================ 模块一：收集箱 ============================
export function listCaptures(params?: { status?: string; categoryId?: number; keyword?: string }) {
  return apiGet<WbCapture[]>('/workbench/captures', params)
}
export function getCapture(id: number) {
  return apiGet<WbCapture>(`/workbench/captures/${id}`)
}
export function createCapture(payload: WbCapturePayload) {
  return apiPost<number>('/workbench/captures', payload)
}
export function updateCapture(id: number, payload: Partial<WbCapturePayload>) {
  return apiPut<void>(`/workbench/captures/${id}`, payload)
}
export function deleteCapture(id: number) {
  return apiDelete<void>(`/workbench/captures/${id}`)
}
export function setCaptureStatus(id: number, status: string) {
  return apiPut<void>(`/workbench/captures/${id}/status`, undefined, { params: { status } })
}
export function toggleCaptureStar(id: number) {
  return apiPut<void>(`/workbench/captures/${id}/star`)
}

// ============================ 模块二：康奈尔笔记 ============================

/** 标签云一项：name 为标签原文，count 为引用它的笔记数（DISTINCT） */
export interface NoteTagCount {
  name: string
  count: number
}

/** 反向引用一项：excerpt 已在服务端截好双链命中处的上下文 */
export interface NoteBacklink {
  id: number
  title: string
  excerpt: string
}

/** 双链解析结果；exists=false 表示该标题还没有对应笔记 */
export interface NoteResolveResult {
  exists: boolean
  id: number | null
  title: string
}

export interface ListNotesParams {
  captureId?: number
  categoryId?: number
  keyword?: string
  /** 标签云联动：精确匹配（"AI" 不会命中 "AIGC"） */
  tag?: string
  /** 智慧筛选：掌握度 ≤ N */
  mastery_lte?: number
  /** 智慧筛选：false = 只看没写总结的半成品笔记 */
  has_summary?: boolean
}

export function listNotes(params?: ListNotesParams) {
  return apiGet<WbNote[]>('/workbench/notes', params)
}

/** 标签聚合，服务端 SQL GROUP BY 直出，不会把全表正文拉进内存 */
export function listNoteTags() {
  return apiGet<NoteTagCount[]>('/workbench/notes/tags')
}

/** 谁引用了这篇笔记（正文里写了 [[本笔记标题]] 的其它笔记） */
export function listNoteBacklinks(id: number) {
  return apiGet<NoteBacklink[]>(`/workbench/notes/backlinks/${id}`)
}

/** [[标题]] → 笔记 id；标题精确匹配，未命中返回 exists=false */
export function resolveNoteByTitle(title: string) {
  return apiGet<NoteResolveResult>('/workbench/notes/resolve', { title })
}
export function getNote(id: number) {
  return apiGet<WbNote>(`/workbench/notes/${id}`)
}
export function createNote(payload: WbNotePayload) {
  return apiPost<number>('/workbench/notes', payload)
}
export function updateNote(id: number, payload: WbNotePayload) {
  return apiPut<void>(`/workbench/notes/${id}`, payload)
}
export function deleteNote(id: number) {
  return apiDelete<void>(`/workbench/notes/${id}`)
}

// ============================ 模块三：间隔重复 ============================
export function listReviews(params?: { categoryId?: number; noteId?: number }) {
  return apiGet<WbReviewCardVO[]>('/workbench/reviews', params)
}
export function drawReviews(limit = 20) {
  return apiGet<WbReviewCardVO[]>('/workbench/reviews/draw', { limit })
}
export function createReview(payload: WbReviewCardPayload) {
  return apiPost<number>('/workbench/reviews', payload)
}
export function updateReview(id: number, payload: WbReviewCardPayload) {
  return apiPut<void>(`/workbench/reviews/${id}`, payload)
}
export function deleteReview(id: number) {
  return apiDelete<void>(`/workbench/reviews/${id}`)
}
export function gradeReview(id: number, payload: WbReviewGradePayload) {
  return apiPost<WbReviewGradeResult>(`/workbench/reviews/${id}/grade`, payload)
}
export function toggleReviewSuspend(id: number) {
  return apiPut<void>(`/workbench/reviews/${id}/suspend`)
}
/**
 * 旧系统（wb_review_card）待复习计数。
 * 复习驾驶舱用它区分「传统卡组」与「SM-2 自动排期」两条队列的待办量，
 * 后端端点早已存在（原供桌面端通知调度轮询），此处只是复用，无需改后端。
 */
export function getReviewDueCount() {
  return apiGet<WbReviewDueCount>('/workbench/reviews/due-count')
}

// ============================ 模块三扩展：记忆宫殿 ============================
export function listPalaces() {
  return apiGet<WbPalace[]>('/workbench/palaces')
}
export function getPalace(id: number) {
  return apiGet<WbPalace>(`/workbench/palaces/${id}`)
}
export function createPalace(payload: WbPalacePayload) {
  return apiPost<number>('/workbench/palaces', payload)
}
export function updatePalace(id: number, payload: WbPalacePayload) {
  return apiPut<void>(`/workbench/palaces/${id}`, payload)
}
export function deletePalace(id: number) {
  return apiDelete<void>(`/workbench/palaces/${id}`)
}
export function listLoci(palaceId: number) {
  return apiGet<WbPalaceLoci[]>(`/workbench/palaces/${palaceId}/loci`)
}
export function createLoci(payload: WbPalaceLociPayload) {
  return apiPost<number>('/workbench/loci', payload)
}
export function updateLoci(id: number, payload: WbPalaceLociPayload) {
  return apiPut<void>(`/workbench/loci/${id}`, payload)
}
export function deleteLoci(id: number) {
  return apiDelete<void>(`/workbench/loci/${id}`)
}
/** 复习待办：返回熟练度 < 3 的位点（SRS 简化判定） */
export function listReviewDue(palaceId: number) {
  return apiGet<WbPalaceLoci[]>(`/workbench/palaces/${palaceId}/review/due`)
}

// ============================ 模块四：费曼故事 ============================
export function listStories(params?: { categoryId?: number; status?: string; keyword?: string }) {
  return apiGet<WbStory[]>('/workbench/stories', params)
}
export function getStory(id: number) {
  return apiGet<WbStory>(`/workbench/stories/${id}`)
}
export function createStory(payload: WbStoryPayload) {
  return apiPost<number>('/workbench/stories', payload)
}
export function updateStory(id: number, payload: WbStoryPayload) {
  return apiPut<void>(`/workbench/stories/${id}`, payload)
}
export function deleteStory(id: number) {
  return apiDelete<void>(`/workbench/stories/${id}`)
}

// ============================ 公共：知识库分类下拉 ============================
/** 获取真实 doc_category 分类树（用于收集箱/宫殿/位点等归类下拉） */
export function getCategoryTree() {
  return apiGet<CategoryVO[]>('/categories/tree')
}

// ============================ 复习：遗忘曲线可视化 ============================
/** 遗忘曲线：按日聚合复习量与遗忘率走势（基于 wb_review_log） */
export function getForgettingCurve(days = 30) {
  return apiGet<WbForgettingCurve>('/workbench/reviews/forgetting-curve', { days })
}

// ============================ 复习扩展：主动回忆（三轮闭卷默写） ============================
/** 主动回忆会话列表 */
export function listRecallSessions() {
  return apiGet<WbRecallSession[]>('/workbench/recall-sessions')
}
/** 主动回忆会话详情 */
export function getRecallSession(id: number) {
  return apiGet<WbRecallSession>(`/workbench/recall-sessions/${id}`)
}
/** 创建主动回忆会话（填原文与标题） */
export function createRecallSession(payload: WbRecallSessionPayload) {
  return apiPost<number>('/workbench/recall-sessions', payload)
}
/** 提交某轮默写内容（自动比对计分） */
export function submitRecallRound(id: number, payload: WbRecallSessionPayload) {
  return apiPost<WbRecallSession>(`/workbench/recall-sessions/${id}/submit`, payload)
}
/** 删除主动回忆会话 */
export function deleteRecallSession(id: number) {
  return apiDelete<void>(`/workbench/recall-sessions/${id}`)
}
