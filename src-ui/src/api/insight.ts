// 主动智能：每日学习日报 接口封装（baseURL 已是 /api，路径不再带 /api 前缀）
import { apiGet, apiPost } from './request';
import type { DailyReportStats, DailyReportContent, GenerateCardsResult } from '@/types/insight';

/** 拉取昨日数据聚合（纯只读，无 AI 依赖） */
export function getDailyReport() {
  return apiGet<DailyReportStats>('/insight/daily-report');
}

/** 生成 AI 日报文案（后端带 1h 缓存；未配置 AI 时抛 AI_NOT_CONFIGURED） */
export function generateDailyReport() {
  return apiPost<DailyReportContent>('/insight/daily-report/generate');
}

/** 基于昨日薄弱点生成强化复习卡（写入 wb_review_card） */
export function generateDailyCards() {
  return apiPost<GenerateCardsResult>('/insight/daily-report/generate-cards');
}
