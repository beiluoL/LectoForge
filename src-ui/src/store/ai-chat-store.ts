/**
 * 知识库问答（RAG）Pinia 状态。
 *
 * 只负责对话状态与「调用 /api/ai/rag/ask」这一件事，不碰任何业务落库。
 * - messages：对话气泡（用户 / 助手），助手消息可带 loading 占位与 sources。
 * - loading：是否正在等待后端。
 * - sendMessage：推入用户消息 → 推入占位助手消息 → 请求 → 回填内容/来源/错误。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

import { askRag } from '@/api/ai';
import type { RagSource } from '@/api/types';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 助手消息附带的检索来源（点击可跳转到文档库 / 笔记） */
  sources?: RagSource[];
  /** 占位消息的请求进行中标记 */
  loading?: boolean;
}

export const useAiChatStore = defineStore('ai-chat', () => {
  const messages = ref<ChatMessage[]>([]);
  const loading = ref(false);
  /** 最近一次错误的可读提示（含「未配置 AI」的引导文案） */
  const error = ref<string | null>(null);

  async function sendMessage(query: string, opts?: { imageText?: string }) {
    const q = (query || '').trim();
    const imageText = (opts?.imageText || '').trim();
    // 允许「纯图片提问」（无文字时默认一句话引导模型描述图片）
    const finalQuery = q || (imageText ? '请描述一下这张图片的内容，并回答相关问题。' : '');
    if (!finalQuery || loading.value) return;

    messages.value.push({ role: 'user', content: q || '（图片提问）' });
    const placeholder: ChatMessage = { role: 'assistant', content: '', loading: true };
    messages.value.push(placeholder);
    loading.value = true;
    error.value = null;

    try {
      const res = await askRag({ query: finalQuery, imageText: imageText || undefined });
      placeholder.content = res.answer;
      placeholder.sources = res.sources;
    } catch (e: unknown) {
      const aiCode = (e as { aiCode?: string })?.aiCode;
      if (aiCode === 'AI_NOT_CONFIGURED') {
        error.value = 'AI 服务尚未配置，请前往「设置 → AI 服务」填写网关地址与密钥后再试。';
      } else {
        error.value = (e as Error)?.message || '问答失败，请稍后重试。';
      }
      placeholder.content = error.value;
    } finally {
      placeholder.loading = false;
      loading.value = false;
    }
  }

  /** 清空对话（保留 store 本身） */
  function reset() {
    messages.value = [];
  }

  return { messages, loading, error, sendMessage, reset };
});
