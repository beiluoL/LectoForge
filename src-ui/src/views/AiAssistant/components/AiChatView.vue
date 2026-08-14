<template>
  <!-- 对话主区：标题 + 消息流 + 底部输入。AI 气泡经 @/lib/markdown 唯一渲染源渲染 Markdown。 -->
  <section class="lf-chat">
    <!-- 顶部标题 -->
    <header class="lf-chat-head">
      <div class="lf-chat-title">
        <Icon name="sparkles" size="md" />
        <span>{{ currentTitle }}</span>
      </div>
      <button type="button" class="lf-new2" @click="store.createNew()">
        <Icon name="plus" size="sm" /> 新建
      </button>
    </header>

    <!-- 错误条（含「未配置 AI」引导） -->
    <div v-if="store.error" class="lf-error">
      <Icon name="alert-circle" size="sm" />
      <span class="lf-error-msg">{{ store.error }}</span>
      <router-link to="/settings" class="lf-error-link">检查 AI 设置</router-link>
    </div>

    <!-- 消息流（滚动容器） -->
    <div ref="listEl" class="lf-msgs" @click="onListClick">
      <div v-if="!store.messages.length" class="lf-empty">
        <Icon name="message-circle" size="xl" />
        <p class="lf-empty-title">开始和 AI 助手对话</p>
        <p class="lf-empty-sub">支持多轮追问、Markdown 渲染、知识库溯源与消息反馈。</p>
      </div>

      <div
        v-for="(m, i) in store.messages"
        :key="m.id ?? `tmp-${i}`"
        class="lf-msg"
        :class="m.role"
        :data-msg-index="i"
      >
        <div class="lf-bubble" :class="m.role">
          <!-- 思考中占位 -->
          <div v-if="m.loading && !m.content" class="lf-typing">
            思考中<span class="lf-dots"><i></i><i></i><i></i></span>
          </div>

          <!-- 正文 -->
          <div v-else class="lf-body" :class="{ 'lf-md': m.role === 'assistant' }" v-html="rendered(m)"></div>

          <!-- 来源胶囊 -->
          <div v-if="m.sourceRefs && m.sourceRefs.length" class="lf-sources">
            <button
              v-for="(s, j) in m.sourceRefs"
              :key="j"
              type="button"
              class="lf-pill"
              :title="s.anchor ? `${s.title} · ${s.anchor}` : s.title"
              @click="openSource(s)"
            >
              <span>{{ s.sourceType === 'doc' ? '📄' : '📝' }}</span>
              <span class="lf-pill-title">{{ s.title }}</span>
              <span v-if="s.anchor" class="lf-pill-anchor">{{ s.anchor }}</span>
            </button>
          </div>

          <!-- 操作栏（hover） -->
          <div class="lf-ops" :class="{ 'is-user': m.role === 'user' }">
            <button v-if="m.role === 'assistant'" type="button" title="复制" @click="copy(m.content)">
              <Icon name="copy" size="sm" />
            </button>
            <button
              v-if="m.role === 'assistant' && m.id"
              type="button"
              title="重新生成"
              :disabled="store.loading"
              @click="store.regenerateMessage(m.id!)"
            >
              <Icon name="refresh-cw" size="sm" />
            </button>
            <button
              v-if="m.role === 'assistant' && m.id"
              type="button"
              title="赞"
              :class="{ on: m.rating === 'like' }"
              @click="rate(m.id!, 'like')"
            >
              <Icon name="thumbs-up" size="sm" />
            </button>
            <button
              v-if="m.role === 'assistant' && m.id"
              type="button"
              title="踩"
              :class="{ on: m.rating === 'dislike' }"
              @click="rate(m.id!, 'dislike')"
            >
              <Icon name="thumbs-down" size="sm" />
            </button>
            <button type="button" title="分享" @click="share(m)">
              <Icon name="share-2" size="sm" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部输入栏 -->
    <footer class="lf-input-bar">
      <div class="lf-input-row">
        <textarea
          ref="taEl"
          v-model="input"
          class="lf-input"
          rows="1"
          :placeholder="store.loading ? '正在生成回答…' : '发消息给 AI 助手…（Enter 发送，Shift+Enter 换行）'"
          :disabled="store.loading"
          @keydown.enter.exact.prevent="onSend"
          @input="autoGrow"
        ></textarea>
        <button
          type="button"
          class="lf-send"
          :disabled="store.loading || !input.trim()"
          @click="onSend"
        >
          <Icon name="send" size="sm" />
          <span>发送</span>
        </button>
      </div>
    </footer>

    <!-- 悬浮大纲 -->
    <AiTimeline :messages="store.messages" @jump="jumpTo" />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import Icon from '@/components/ui/Icon.vue';
import { renderMarkdown } from '@/lib/markdown';
import { useAiAssistantStore, type ChatMessage } from '@/store/ai-assistant-store';
import type { RagSource } from '@/api/types';
import { notify } from '@/utils/toast';
import AiTimeline from './AiTimeline.vue';

const store = useAiAssistantStore();
const router = useRouter();

const input = ref('');
const listEl = ref<HTMLElement | null>(null);
const taEl = ref<HTMLTextAreaElement | null>(null);

const currentTitle = computed(() => {
  const c = store.conversations.find((x) => x.id === store.currentConversationId);
  return c?.title || 'AI 助手';
});

/** Markdown 渲染（唯一来源：@/lib/markdown）。用户消息按纯文本展示。 */
function rendered(m: ChatMessage): string {
  if (m.role !== 'assistant') return escapeHtml(m.content);
  return renderMarkdown(m.content);
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 点击来源胶囊：跳转文档库（带行号高亮）或笔记 */
function openSource(s: RagSource) {
  if (!s.link) return;
  if (s.sourceType === 'doc' && s.anchor) {
    const url = new URL(s.link, window.location.origin);
    url.searchParams.set('highlight', s.anchor);
    router.push(`${url.pathname}${url.search}`);
    return;
  }
  router.push(s.link);
}

// ===================== 发送 =====================
function onSend() {
  const q = input.value.trim();
  if (store.loading || !q) return;
  input.value = '';
  autoGrow();
  void store.sendMessage(q);
}

function autoGrow() {
  const el = taEl.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
}

// ===================== 消息反馈 / 操作 =====================
function rate(id: number, rating: 'like' | 'dislike') {
  const m = store.messages.find((x) => x.id === id);
  const next = m?.rating === rating ? 'none' : rating;
  void store.rateMessage(id, next);
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify('已复制', 'success');
  } catch {
    notify('复制失败', 'error');
  }
}

async function share(m: ChatMessage) {
  const text = m.sourceRefs?.length
    ? `${m.content}\n\n参考来源：\n${m.sourceRefs.map((s) => `- ${s.title}${s.anchor ? ` (${s.anchor})` : ''}`).join('\n')}`
    : m.content;
  try {
    await navigator.clipboard.writeText(text);
    notify('已复制到剪贴板', 'success');
  } catch {
    notify('复制失败', 'error');
  }
}

/** 代码块复制按钮（markdown fence 渲染出的 .code-copy-btn 由全局样式提供外观） */
function onListClick(e: MouseEvent) {
  const t = e.target as HTMLElement;
  const btn = t.closest('.code-copy-btn') as HTMLElement | null;
  if (!btn) return;
  const wrap = btn.closest('.code-block-wrapper');
  const code = wrap?.querySelector('pre code')?.textContent || '';
  navigator.clipboard
    .writeText(code)
    .then(() => notify('代码已复制', 'success'))
    .catch(() => notify('复制失败', 'error'));
}

// ===================== 滚动 =====================
function scrollToBottom() {
  nextTick(() => {
    const el = listEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}
// 每条消息内容长度 / loading 变化都触发滚动（含流式逐字）
watch(
  () => store.messages.map((m) => `${m.id ?? -1}:${m.content.length}:${m.loading ? 1 : 0}`).join('|'),
  scrollToBottom,
);

/** 大纲跳转：滚动到指定消息索引 */
function jumpTo(index: number) {
  nextTick(() => {
    const el = listEl.value?.querySelector(`[data-msg-index="${index}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}
</script>

<style scoped>
.lf-chat {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--kb-background);
  color: var(--kb-foreground);
}

.lf-chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px 10px;
  border-bottom: 1px solid var(--kb-border);
}
.lf-chat-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--kb-foreground);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lf-chat-title :deep(svg) {
  color: var(--kb-primary);
  flex-shrink: 0;
}
.lf-new2 {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 7px 12px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  color: var(--kb-primary-foreground);
  background: var(--kb-primary);
  border: none;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.lf-new2:hover {
  opacity: 0.9;
}

.lf-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 24px;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  color: var(--kb-destructive, #d92d20);
  background: color-mix(in srgb, var(--kb-destructive, #d92d20) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--kb-destructive, #d92d20) 30%, transparent);
}
.lf-error :deep(svg) {
  flex-shrink: 0;
}
.lf-error-msg {
  flex: 1;
  min-width: 0;
}
.lf-error-link {
  margin-left: auto;
  font-weight: 600;
  color: var(--kb-primary);
  text-decoration: none;
  flex-shrink: 0;
}
.lf-error-link:hover {
  text-decoration: underline;
}

.lf-msgs {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.lf-empty {
  margin: auto;
  text-align: center;
  color: var(--kb-muted-foreground);
}
.lf-empty :deep(svg) {
  color: var(--kb-border);
}
.lf-empty-title {
  margin: 12px 0 4px;
  font-size: 15px;
  font-weight: 600;
  color: var(--kb-foreground);
}
.lf-empty-sub {
  margin: 0;
  font-size: 13px;
}

.lf-msg {
  display: flex;
}
.lf-msg.user {
  justify-content: flex-end;
}
.lf-msg.assistant {
  justify-content: flex-start;
}
.lf-bubble {
  position: relative;
  max-width: min(780px, 92%);
  padding: 12px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.65;
}
.lf-bubble.user {
  background: var(--kb-primary);
  color: var(--kb-primary-foreground);
  border-bottom-right-radius: 4px;
  white-space: pre-wrap;
  word-break: break-word;
}
.lf-bubble.assistant {
  background: var(--kb-card);
  color: var(--kb-card-foreground);
  border: 1px solid var(--kb-border);
  border-bottom-left-radius: 4px;
}
.lf-body.lf-md :deep(p) {
  margin: 0 0 10px;
}
.lf-body.lf-md :deep(p:last-child) {
  margin-bottom: 0;
}
.lf-body.lf-md :deep(ul),
.lf-body.lf-md :deep(ol) {
  margin: 0 0 10px;
  padding-left: 22px;
}
.lf-body.lf-md :deep(h1),
.lf-body.lf-md :deep(h2),
.lf-body.lf-md :deep(h3),
.lf-body.lf-md :deep(h4) {
  margin: 14px 0 8px;
  line-height: 1.3;
}
.lf-body.lf-md :deep(a) {
  color: var(--kb-primary);
}
.lf-body.lf-md :deep(code):not(.hljs) {
  padding: 1px 5px;
  border-radius: 5px;
  font-size: 0.9em;
  background: var(--kb-muted);
  font-family: var(--font-mono);
}
.lf-body.lf-md :deep(pre) {
  margin: 0;
}
.lf-body.lf-md :deep(table) {
  border-collapse: collapse;
}
.lf-body.lf-md :deep(th),
.lf-body.lf-md :deep(td) {
  border: 1px solid var(--kb-border);
  padding: 4px 8px;
}

.lf-typing {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--kb-muted-foreground);
}
.lf-dots {
  display: inline-flex;
  gap: 3px;
}
.lf-dots i {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: var(--kb-muted-foreground);
  animation: lf-bounce 1s infinite ease-in-out;
}
.lf-dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.lf-dots i:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes lf-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
  40% { transform: translateY(-4px); opacity: 1; }
}

.lf-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.lf-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 240px;
  padding: 3px 9px;
  border-radius: 9999px;
  font-size: 12px;
  color: var(--kb-muted-foreground);
  background: var(--kb-muted);
  border: 1px solid var(--kb-border);
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}
.lf-pill:hover {
  color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 10%, transparent);
}
.lf-pill-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lf-pill-anchor {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 9999px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
}

.lf-ops {
  position: absolute;
  top: -14px;
  right: 8px;
  display: none;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 9px;
  background: var(--kb-popover, var(--kb-card));
  border: 1px solid var(--kb-border);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
}
.lf-ops.is-user {
  right: auto;
  left: 8px;
}
.lf-msg:hover .lf-ops {
  display: flex;
}
.lf-ops button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  color: var(--kb-muted-foreground);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.12s ease, background 0.12s ease;
}
.lf-ops button:hover:not(:disabled) {
  color: var(--kb-primary);
  background: var(--kb-muted);
}
.lf-ops button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.lf-ops button.on {
  color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 14%, transparent);
}

.lf-input-bar {
  padding: 12px 24px 18px;
  border-top: 1px solid var(--kb-border);
  background: color-mix(in srgb, var(--kb-card) 80%, transparent);
}
.lf-input-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.lf-input {
  flex: 1 1 auto;
  resize: none;
  max-height: 140px;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
  font-family: inherit;
  color: var(--kb-foreground);
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
  outline: none;
}
.lf-input:focus {
  border-color: var(--kb-primary);
}
.lf-send {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 10px 16px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--kb-primary-foreground);
  background: var(--kb-primary);
  border: none;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.lf-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
