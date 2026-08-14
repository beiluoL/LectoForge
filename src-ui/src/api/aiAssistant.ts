// AI 助手 / 多轮对话接口（前端）。
// 前缀 /ai-assistant 由 request 的 baseURL(/api) 拼接为 /api/ai-assistant/*。
// 流式对话不走这里（fetch + SSE 由 @/api/sse 的 postSSE 直接消费）。
import { apiGet, apiPost, apiPut, apiDelete } from './request';
import type { RagSource } from './types';

/** 会话（列表项 + 详情同源） */
export interface AiConversationVO {
  id: number;
  userId: number;
  title: string;
  /** 0 未置顶 / 1 置顶 */
  pinned: number;
  createdAt: string;
  updatedAt: string;
}

/** 单条消息 */
export interface AiMessageVO {
  id: number;
  conversationId: number;
  role: 'user' | 'assistant';
  content: string;
  rating: 'like' | 'dislike' | 'none';
  sourceRefs: RagSource[] | null;
  createdAt: string;
}

/** 会话列表（?search= 标题模糊搜索） */
export function listConversations(search?: string) {
  return apiGet<AiConversationVO[]>('/ai-assistant/conversations', search ? { search } : undefined);
}

/** 新建会话（标题可空） */
export function createConversation(title?: string) {
  return apiPost<AiConversationVO>('/ai-assistant/conversations', { title });
}

/** 拉取会话消息 */
export function getMessages(conversationId: number) {
  return apiGet<AiMessageVO[]>(`/ai-assistant/conversations/${conversationId}/messages`);
}

/** 改标题 / 切换置顶 */
export function updateConversation(id: number, payload: { title?: string; pinned?: number }) {
  return apiPut<AiConversationVO>(`/ai-assistant/conversations/${id}`, payload);
}

/** 删除会话（服务端事务级联删消息） */
export function deleteConversation(id: number) {
  return apiDelete<{ ok: true }>(`/ai-assistant/conversations/${id}`);
}

/** 消息评分：赞 / 踩 / 取消 */
export function rateMessage(id: number, rating: 'like' | 'dislike' | 'none') {
  return apiPost<AiMessageVO>(`/ai-assistant/messages/${id}/rating`, { rating });
}
