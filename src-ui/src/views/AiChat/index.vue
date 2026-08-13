<template>
  <!-- 知识库问答（RAG）：极简对话式 UI，布局走 Tailwind，配色全部用 --kb-* token（明暗同源）。 -->
  <div class="ai-chat" :style="{ background: 'var(--kb-background)', color: 'var(--kb-foreground)' }">
    <!-- 顶部标题区 -->
    <header class="ai-header">
      <div class="ai-header-title">
        <Icon name="brain-circuit" size="md" />
        <span>知识库问答</span>
      </div>
      <p class="ai-header-desc">
        基于本地文档库（.md）与康奈尔笔记进行检索生成。AI 只回答知识库中的内容，未检索到时会如实告知。
      </p>
    </header>

    <!-- 对话气泡列表 -->
    <div ref="listEl" class="ai-list">
      <!-- 空态引导 -->
      <div v-if="!store.messages.length" class="ai-empty">
        <Icon name="message-circle" size="xl" />
        <p class="ai-empty-title">向你的知识库提问</p>
        <p class="ai-empty-sub">例如：「多线程里 volatile 有什么用？」「复习计划该怎么排？」</p>
      </div>

      <div
        v-for="(m, i) in store.messages"
        :key="i"
        class="ai-row"
        :class="m.role"
      >
        <div class="ai-bubble" :class="m.role">
          <!-- 占位：思考中 -->
          <div v-if="m.loading" class="ai-typing">
            思考中<span class="ai-dots"><i></i><i></i><i></i></span>
          </div>
          <!-- 正文（保留换行） -->
          <div v-else class="ai-content">{{ m.content }}</div>

          <!-- 来源药丸胶囊 -->
          <div v-if="m.sources && m.sources.length" class="ai-sources">
            <button
              v-for="(s, j) in m.sources"
              :key="j"
              type="button"
              class="ai-pill"
              :title="s.link"
              @click="openSource(s.link)"
            >
              <span>{{ s.sourceType === 'doc' ? '📄' : '📝' }}</span>
              <span class="ai-pill-title">{{ s.title }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 错误提示（含「未配置 AI」引导） -->
    <div v-if="store.error" class="ai-error">
      <Icon name="alert-triangle" size="sm" />
      <span>{{ store.error }}</span>
      <router-link to="/settings" class="ai-error-link">前往设置</router-link>
    </div>

    <!-- 底部输入栏 -->
    <footer class="ai-input-bar">
      <textarea
        v-model="input"
        class="ai-input"
        rows="1"
        :placeholder="store.loading ? '正在生成回答…' : '基于你的知识库提问…（Enter 发送，Shift+Enter 换行）'"
        :disabled="store.loading"
        @keydown.enter.exact.prevent="onSend"
        @input="autoGrow"
        ref="taEl"
      ></textarea>
      <button
        type="button"
        class="ai-send"
        :disabled="store.loading || !input.trim()"
        @click="onSend"
      >
        <Icon name="send" size="sm" />
        <span>发送</span>
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import Icon from '@/components/ui/Icon.vue';
import { useAiChatStore } from '@/store/ai-chat-store';

const store = useAiChatStore();
const router = useRouter();

const input = ref('');
const listEl = ref<HTMLElement | null>(null);
const taEl = ref<HTMLTextAreaElement | null>(null);

/** 点击来源：跳转到文档库（?doc=）或康奈尔笔记详情 */
function openSource(link: string) {
  if (link) router.push(link);
}

/** 发送当前输入 */
function onSend() {
  const q = input.value.trim();
  if (!q || store.loading) return;
  input.value = '';
  autoGrow();
  void store.sendMessage(q);
}

/** 输入框随内容自适应高度（最高 ~6 行） */
function autoGrow() {
  const el = taEl.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
}

/** 新消息 / loading 变化时滚动到底部 */
function scrollToBottom() {
  nextTick(() => {
    const el = listEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}
watch(() => store.messages.length, scrollToBottom);
watch(() => store.loading, scrollToBottom);
</script>

<style scoped>
.ai-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* 顶部标题 */
.ai-header {
  padding: 18px 24px 12px;
  border-bottom: 1px solid var(--kb-border);
}
.ai-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
  font-weight: 600;
  color: var(--kb-foreground);
}
.ai-header-title :deep(svg) {
  color: var(--kb-primary);
}
.ai-header-desc {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--kb-muted-foreground);
}

/* 对话列表 */
.ai-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 空态 */
.ai-empty {
  margin: auto;
  text-align: center;
  color: var(--kb-muted-foreground);
}
.ai-empty :deep(svg) {
  color: var(--kb-border);
}
.ai-empty-title {
  margin: 12px 0 4px;
  font-size: 15px;
  font-weight: 600;
  color: var(--kb-foreground);
}
.ai-empty-sub {
  margin: 0;
  font-size: 13px;
}

/* 气泡行 */
.ai-row {
  display: flex;
}
.ai-row.user {
  justify-content: flex-end;
}
.ai-row.assistant {
  justify-content: flex-start;
}
.ai-bubble {
  max-width: min(760px, 92%);
  padding: 12px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-bubble.user {
  background: var(--kb-primary);
  color: var(--kb-primary-foreground);
  border-bottom-right-radius: 4px;
}
.ai-bubble.assistant {
  background: var(--kb-card);
  color: var(--kb-card-foreground);
  border: 1px solid var(--kb-border);
  border-bottom-left-radius: 4px;
}

/* 思考中动画 */
.ai-typing {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--kb-muted-foreground);
}
.ai-dots {
  display: inline-flex;
  gap: 3px;
}
.ai-dots i {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: var(--kb-muted-foreground);
  animation: ai-bounce 1s infinite ease-in-out;
}
.ai-dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.ai-dots i:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes ai-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
  40% { transform: translateY(-4px); opacity: 1; }
}

/* 来源胶囊 */
.ai-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.ai-pill {
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
.ai-pill:hover {
  color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 10%, transparent);
}
.ai-pill-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 错误条 */
.ai-error {
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
.ai-error :deep(svg) {
  flex-shrink: 0;
}
.ai-error-link {
  margin-left: auto;
  font-weight: 600;
  color: var(--kb-primary);
  text-decoration: none;
}

/* 输入栏 */
.ai-input-bar {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 14px 24px 18px;
  border-top: 1px solid var(--kb-border);
  background: color-mix(in srgb, var(--kb-card) 80%, transparent);
  backdrop-filter: blur(8px);
}
.ai-input {
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
.ai-input:focus {
  border-color: var(--kb-primary);
}
.ai-send {
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
.ai-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
