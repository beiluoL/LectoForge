import { apiGet } from './request';

export type SearchType = 'capture' | 'note' | 'story';

/** 全局搜索返回项（与后端 SearchResult 一致） */
export interface SearchResult {
  type: SearchType;
  id: number;
  title: string;
  /** 匹配正文的 30 字摘要 */
  content: string;
  /** 前端路由跳转目标 */
  path: string;
}

/** 跨收集箱 / 笔记 / 故事 的实时模糊搜索 */
export function searchAll(q: string) {
  return apiGet<SearchResult[]>('/search', { q });
}
