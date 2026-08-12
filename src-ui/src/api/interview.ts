// 离线模拟面试 / 题库 接口封装（仅前端，对应 src-api 并行构建的 /interview、/qa-bank 路由）。
// 复用现有 axios 实例（baseURL '/api'、解包拦截器、断线重放）。
// SSE 类端点（start / answer）不在此处——走 api/sse.ts 的 postSSE()。
import { apiGet, apiPost } from './request'

// ============================ 面试：语音转写 ============================

export interface TranscribeResult {
  text: string
}

/** 把录音 Blob 以 multipart 发给后端，由本地 Whisper 转写为文本 */
export function transcribeAudio(blob: Blob, fileName = 'audio.webm') {
  const fd = new FormData()
  fd.append('file', blob, fileName)
  return apiPost<TranscribeResult>('/interview/transcribe', fd)
}

// ============================ 题库：导入 ============================

export interface QaBankImportResult {
  imported?: number
  count?: number
}

/** 粘贴 Markdown 面经文本导入 */
export function importQaBankMarkdown(text: string) {
  return apiPost<QaBankImportResult>('/qa-bank/import-md', { text })
}

/** 上传 PDF 文件（multipart）导入 */
export function importQaBankPdf(file: Blob, fileName = 'doc.pdf') {
  const fd = new FormData()
  fd.append('file', file, fileName)
  return apiPost<QaBankImportResult>('/qa-bank/import-pdf', fd)
}

/** 从复习卡（wb_review_card）导入为题库 */
export function importFromReviewCards() {
  return apiPost<QaBankImportResult>('/qa-bank/import-from-review-cards', {})
}

/** 从笔记（wb_note）导入为题库 */
export function importFromNotes() {
  return apiPost<QaBankImportResult>('/qa-bank/import-from-notes', {})
}

// ============================ 题库：查询 ============================

export interface QaBankItem {
  id: number
  question: string
  referenceAnswer?: string
  scoringPoints?: string
  sourceType?: 'import' | 'review_card' | 'note'
  sourceId?: number | null
  tags?: string[]
  difficulty?: string
  createdAt?: number
}

/** 题库列表 */
export function listQaBanks() {
  return apiGet<QaBankItem[]>('/qa-bank')
}

/** 随机下一题（题库为空时可能返回 null） */
export function randomNextQa() {
  return apiGet<{ id: number; question: string } | null>('/qa-bank/random-next')
}
