/**
 * AI 助手 / 多轮对话 Pinia 状态（store id: 'ai-assistant'）。
 *
 * 职责：
 * - 会话管理：fetchConversations / createNew / selectConversation / loadMessages /
 *   renameConversation / togglePin / removeConversation。
 * - 对话：sendMessage(query) 与 regenerateMessage(msgId) 通过 @/api/sse 的 postSSE
 *   消费流式端点，把 delta 增量追加到对应气泡，并落地 meta/sources/done/error 事件。
 * - 反馈：rateMessage(msgId, rating)。
 *
 * 红色约束：本 store 不渲染任何 UI，也不引入 Markdown 库——Markdown 渲染只在
 * AiChatView 内通过 @/lib/markdown 的 renderMarkdown 完成（单一事实源）。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

import { postSSE } from '@/api/sse';
import {
  createConversation,
  deleteConversation,
  getMessages,
  listConversations,
  rateMessage as rateMessageApi,
  updateConversation,
} from '@/api/aiAssistant';
import type { RagSource } from '@/api/types';

export interface ChatMessage {
  /** 服务端消息 id（流式 meta 事件回填）；占位气泡在落库前无 id */
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  rating?: 'like' | 'dislike' | 'none';
  /** 知识库来源（代码块渲染后用来源胶囊展示） */
  sourceRefs?: RagSource[] | null;
  /** 流式生成中占位标记 */
  loading?: boolean;
}

export interface ConversationItem {
  id: number;
  title: string;
  pinned: number;
  updatedAt: string;
}

export const useAiAssistantStore = defineStore('ai-assistant', () => {
  const conversations = ref<ConversationItem[]>([]);
  const currentConversationId = ref<number | null>(null);
  const messages = ref<ChatMessage[]>([]);
  /** 是否有流式请求进行中（用于禁用输入/按钮） */
  const loading = ref(false);
  /** 当前生成中的 AbortController（「停止生成」用） */
  let activeAbort: AbortController | null = null;
  const searchQuery = ref('');
  /** 最近一次错误的可读提示（含「未配置 AI」等引导） */
  const error = ref<string | null>(null);

  // ===================== 会话管理 =====================

  async function fetchConversations() {
    try {
      const list = await listConversations(searchQuery.value || undefined);
      conversations.value = list.map((c) => ({
        id: c.id,
        title: c.title,
        pinned: c.pinned,
        updatedAt: c.updatedAt,
      }));
    } catch {
      /* 列表失败静默，不阻断主流程 */
    }
  }

  /** 确保当前有会话：没有则新建并返回其 id */
  async function ensureConversation(): Promise<number> {
    if (currentConversationId.value != null) return currentConversationId.value;
    const conv = await createConversation();
    currentConversationId.value = conv.id;
    conversations.value = [
      { id: conv.id, title: conv.title, pinned: conv.pinned, updatedAt: conv.updatedAt },
      ...conversations.value,
    ];
    return conv.id;
  }

  async function selectConversation(id: number) {
    currentConversationId.value = id;
    await loadMessages(id);
  }

  async function loadMessages(id: number) {
    try {
      const list = await getMessages(id);
      messages.value = list.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        rating: m.rating,
        sourceRefs: m.sourceRefs ?? null,
      }));
    } catch {
      messages.value = [];
    }
  }

  async function createNew() {
    const conv = await createConversation();
    currentConversationId.value = conv.id;
    messages.value = [];
    await fetchConversations();
  }

  async function renameConversation(id: number, title: string) {
    const t = title.trim();
    if (!t) return;
    await updateConversation(id, { title: t });
    await fetchConversations();
  }

  async function togglePin(id: number, pinned: number) {
    await updateConversation(id, { pinned: pinned ? 1 : 0 });
    await fetchConversations();
  }

  async function removeConversation(id: number) {
    await deleteConversation(id);
    conversations.value = conversations.value.filter((c) => c.id !== id);
    if (currentConversationId.value === id) {
      currentConversationId.value = null;
      messages.value = [];
    }
  }

  function setSearch(q: string) {
    searchQuery.value = q;
    void fetchConversations();
  }

  // ===================== 流式对话 =====================

  async function sendMessage(query: string) {
    const q = query.trim();
    if (!q || loading.value) return;

    // 先把用户气泡落进 UI，即使后续 ensureConversation / 网络失败，用户也能看到自己说了什么
    messages.value.push({ role: 'user', content: q });
    const assistant: ChatMessage = { role: 'assistant', content: '', loading: true };
    messages.value.push(assistant);

    loading.value = true;
    error.value = null;

    try {
      const convId = await ensureConversation();
      activeAbort = new AbortController();
      const gen = postSSE(
        '/ai-assistant/chat/completions',
        { conversationId: convId, query: q },
        { signal: activeAbort.signal },
      );
      let metaConvId = convId;
      for await (const ev of gen) {
        if (ev.event === 'meta') {
          const d = ev.data as { conversationId?: number; messageId?: number };
          if (d.conversationId) metaConvId = d.conversationId;
          if (d.messageId) assistant.id = d.messageId;
        } else if (ev.event === 'delta') {
          const d = ev.data as { content?: string };
          assistant.content += d.content || '';
        } else if (ev.event === 'sources') {
          const d = ev.data as { sources?: RagSource[] };
          if (d.sources) assistant.sourceRefs = d.sources;
        } else if (ev.event === 'done') {
          const d = ev.data as { sources?: RagSource[] };
          if (d.sources) assistant.sourceRefs = d.sources;
          await fetchConversations();
        } else if (ev.event === 'error') {
          const d = ev.data as { message?: string };
          error.value = d.message || '生成失败';
          if (!assistant.content) assistant.content = error.value;
        }
      }
      currentConversationId.value = metaConvId;
    } catch (e: unknown) {
      const msg = (e as Error)?.message || '生成失败';
      // eslint-disable-next-line no-console
      console.error('[ai-assistant] sendMessage failed:', e);
      error.value = msg;
      // 保留一个可见的助手气泡，避免页面「空无一物」看起来像没响应
      if (!assistant.content) assistant.content = `⚠️ ${msg}`;
    } finally {
      activeAbort = null;
      assistant.loading = false;
      loading.value = false;
    }
  }

  /** 停止当前流式生成（AbortError 由 postSSE 吞掉，正常走 finally） */
  function stopStreaming() {
    if (!loading.value || !activeAbort) return
    activeAbort.abort()
    const last = messages.value[messages.value.length - 1]
    if (last && last.role === 'assistant' && last.loading) last.loading = false
    loading.value = false
    activeAbort = null
  }

  async function rateMessage(msgId: number, rating: 'like' | 'dislike' | 'none') {
    const m = messages.value.find((x) => x.id === msgId);
    if (m) m.rating = rating;
    try {
      await rateMessageApi(msgId, rating);
    } catch {
      /* 乐观更新为主，失败静默 */
    }
  }

  async function regenerateMessage(msgId: number) {
    if (loading.value) return;
    const idx = messages.value.findIndex((x) => x.id === msgId);
    if (idx < 0) return;
    const target = messages.value[idx];
    target.loading = true;
    target.content = '';
    target.sourceRefs = null;
    loading.value = true;
    error.value = null;

    try {
      activeAbort = new AbortController();
      const gen = postSSE(`/ai-assistant/messages/${msgId}/regenerate`, {}, { signal: activeAbort.signal });
      for await (const ev of gen) {
        if (ev.event === 'meta') {
          const d = ev.data as { messageId?: number };
          if (d.messageId) target.id = d.messageId;
        } else if (ev.event === 'delta') {
          const d = ev.data as { content?: string };
          target.content += d.content || '';
        } else if (ev.event === 'sources') {
          const d = ev.data as { sources?: RagSource[] };
          if (d.sources) target.sourceRefs = d.sources;
        } else if (ev.event === 'done') {
          const d = ev.data as { sources?: RagSource[] };
          if (d.sources) target.sourceRefs = d.sources;
          await fetchConversations();
        } else if (ev.event === 'error') {
          const d = ev.data as { message?: string };
          error.value = d.message || '重新生成失败';
          if (!target.content) target.content = error.value;
        }
      }
    } catch (e: unknown) {
      const msg = (e as Error)?.message || '重新生成失败';
      // eslint-disable-next-line no-console
      console.error('[ai-assistant] regenerateMessage failed:', e);
      error.value = msg;
      if (!target.content) target.content = `⚠️ ${msg}`;
    } finally {
      activeAbort = null;
      target.loading = false;
      loading.value = false;
    }
  }

  return {
    conversations,
    currentConversationId,
    messages,
    loading,
    searchQuery,
    error,
    fetchConversations,
    selectConversation,
    loadMessages,
    createNew,
    renameConversation,
    togglePin,
    removeConversation,
    setSearch,
    sendMessage,
    rateMessage,
    regenerateMessage,
    stopStreaming,
  };
});
