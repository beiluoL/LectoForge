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

    <!-- macOS 中文语音包引导（无中文嗓音时提示，可关闭） -->
    <div v-if="showSpeechHint && !speechHintDismissed" class="ai-speech-hint">
      <Icon name="volume-2" size="sm" />
      <span>{{ SPEECH_HINT }}</span>
      <button type="button" class="ai-speech-hint-x" title="不再提示" @click="speechHintDismissed = true">
        <Icon name="x" size="sm" />
      </button>
    </div>

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
          <!-- 正文（保留换行）+ 朗读按钮 -->
          <div v-else class="ai-content-wrap">
            <div class="ai-content">{{ m.content }}</div>
            <button
              v-if="m.role === 'assistant' && speechSupported"
              type="button"
              class="ai-speak"
              :class="{ 'is-speaking': speakingIdx === i }"
              :title="speakingIdx === i ? '停止朗读' : '朗读这条回答'"
              @click="toggleSpeak(i, m.content)"
            >
              <Icon :name="speakingIdx === i ? 'pause' : 'volume-2'" size="sm" />
            </button>
          </div>

          <!-- 来源药丸胶囊 -->
          <div v-if="m.sources && m.sources.length" class="ai-sources">
            <button
              v-for="(s, j) in m.sources"
              :key="j"
              type="button"
              class="ai-pill"
              :title="s.anchor ? `${s.title} · ${s.anchor}` : s.title"
              @click="openSource(s)"
            >
              <span>{{ s.sourceType === 'doc' ? '📄' : '📝' }}</span>
              <span class="ai-pill-title">{{ s.title }}</span>
              <span v-if="s.anchor" class="ai-pill-anchor">{{ s.anchor }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 错误提示（含「未配置 AI」引导） -->
    <div v-if="store.error" class="ai-error">
      <Icon name="alert-circle" size="sm" />
      <span>{{ store.error }}</span>
      <router-link to="/settings" class="ai-error-link">前往设置</router-link>
    </div>

    <!-- 底部输入栏 -->
    <footer class="ai-input-bar">
      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        class="ai-file-hidden"
        @change="onFilePicked"
      />
      <!-- 已附图片芯片（OCR 文本已就绪，随问题一起发给 AI） -->
      <div v-if="pendingImage" class="ai-img-chip">
        <Icon name="image" size="sm" />
        <span class="ai-img-chip-name">{{ pendingImage.name }}</span>
        <span class="ai-img-chip-tag">OCR 已就绪</span>
        <button type="button" class="ai-img-chip-x" title="移除图片" @click="clearImage">
          <Icon name="x" size="sm" />
        </button>
      </div>
      <div class="ai-input-row">
        <textarea
          v-model="input"
          class="ai-input"
          rows="1"
          :placeholder="store.loading ? '正在生成回答…' : (pendingImage ? '可补充问题，或仅发送图片让 AI 读图…' : '基于你的知识库提问…（Enter 发送，Shift+Enter 换行）')"
          :disabled="store.loading"
          @keydown.enter.exact.prevent="onSend"
          @input="autoGrow"
          ref="taEl"
        ></textarea>
        <button
          type="button"
          class="ai-attach"
          :class="{ 'is-active': !!pendingImage }"
          :disabled="uploading"
          :title="pendingImage ? '已附图片（点 ✕ 可移除）' : '附图片：上传后本地 OCR，由 AI 理解图中文字'"
          @click="onAttachClick"
        >
          <Icon :name="uploading ? 'loader' : 'paperclip'" size="sm" />
        </button>
        <button
          type="button"
          class="ai-send"
          :disabled="store.loading || (!input.trim() && !pendingImage)"
          @click="onSend"
        >
          <Icon name="send" size="sm" />
          <span>发送</span>
        </button>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import Icon from '@/components/ui/Icon.vue';
import type { RagSource } from '@/api/types';
import { useAiChatStore } from '@/store/ai-chat-store';
import { uploadInboxAsset } from '@/api/inbox';
import { recognizeText } from '@/lib/ocr/ocrClient';
import { notify, getApiError } from '@/utils/toast';
import {
  speakText,
  cancelSpeak,
  warmUpSpeech,
  SPEECH_HINT,
  speechSupported,
  hasChineseVoice,
} from '@/utils/speech';

const store = useAiChatStore();
const router = useRouter();

const input = ref('');
const listEl = ref<HTMLElement | null>(null);
const taEl = ref<HTMLTextAreaElement | null>(null);

// 多模态 / TTS 相关状态
const speakingIdx = ref<number | null>(null);
const pendingImage = ref<{ name: string; ocrText: string } | null>(null);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

// macOS 中文语音包缺失提示（可关闭）
const speechHintDismissed = ref(false);
const showSpeechHint = ref(false);
function updateSpeechHint() {
  showSpeechHint.value = speechSupported && !hasChineseVoice();
}

/** 挂载时唤醒底层语音服务（macOS 首句静默规避）；中文嗓音可能异步加载，加载后刷新提示 */
onMounted(() => {
  warmUpSpeech();
  updateSpeechHint();
  if (speechSupported && typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = updateSpeechHint;
  }
});

/** 朗读 / 停止单条 AI 回答（再点一次即打断） */
function toggleSpeak(i: number, text: string) {
  if (speakingIdx.value === i) {
    cancelSpeak();
    speakingIdx.value = null;
    return;
  }
  speakingIdx.value = i;
  speakText(text, () => {
    speakingIdx.value = null;
  });
}

/** 点击附件按钮，触发隐藏的文件选择器 */
function onAttachClick() {
  fileInput.value?.click();
}

/** 选图 → 上传到 /api/inbox/upload/asset → 前端离线 OCR 提取文字（单次限 1 张，防 Node 侧车 OCR 并发） */
async function onFilePicked(e: Event) {
  const inputEl = e.target as HTMLInputElement;
  const file = inputEl.files?.[0];
  inputEl.value = '';
  if (!file) return;
  uploading.value = true;
  try {
    const res = await uploadInboxAsset(file, file.name);
    const blob = await fetch(res.url).then((r) => r.blob());
    const ocrText = await recognizeText(blob);
    if (!ocrText) {
      notify('未能从图片中识别出文字，已忽略该图片', 'info');
      return;
    }
    pendingImage.value = { name: file.name, ocrText };
  } catch (err) {
    notify(getApiError(err, '图片处理失败'), 'error');
  } finally {
    uploading.value = false;
  }
}

/** 移除已附图片 */
function clearImage() {
  pendingImage.value = null;
}

/** 点击来源：跳转到文档库（?doc= + ?highlight= 行号锚点）或康奈尔笔记详情 */
function openSource(s: RagSource) {
  if (!s.link) return;
  // 文档来源：确保带上 highlight 行号锚点，便于文档库精准高亮对应行
  if (s.sourceType === 'doc' && s.anchor) {
    const url = new URL(s.link, window.location.origin);
    url.searchParams.set('highlight', s.anchor);
    router.push(`${url.pathname}${url.search}`);
    return;
  }
  router.push(s.link);
}

/** 发送当前输入（支持「仅图片 / 图文混合」提问：图片 OCR 文本随问题一起发给 AI） */
function onSend() {
  const q = input.value.trim();
  const imageText = pendingImage.value?.ocrText || undefined;
  if (store.loading) return;
  if (!q && !imageText) return;
  input.value = '';
  autoGrow();
  const img = pendingImage.value;
  pendingImage.value = null;
  void store.sendMessage(q, img ? { imageText: img.ocrText } : undefined);
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

/* 中文语音包缺失提示条（macOS） */
.ai-speech-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 24px;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 12px;
  color: var(--kb-muted-foreground);
  background: color-mix(in srgb, var(--kb-primary) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--kb-primary) 20%, transparent);
}
.ai-speech-hint :deep(svg) { flex-shrink: 0; }
.ai-speech-hint-x {
  margin-left: auto;
  display: inline-flex;
  padding: 2px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: 6px;
}
.ai-speech-hint-x:hover { background: color-mix(in srgb, var(--kb-foreground) 10%, transparent); }

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

/* 正文 + 朗读按钮 */
.ai-content-wrap {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.ai-content { flex: 1 1 auto; }
.ai-speak {
  flex-shrink: 0;
  margin-top: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  color: var(--kb-muted-foreground);
  background: transparent;
  border: 1px solid var(--kb-border);
  cursor: pointer;
  transition: color .15s ease, background .15s ease, border-color .15s ease;
}
.ai-speak:hover {
  color: var(--kb-primary);
  border-color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 8%, transparent);
}
.ai-speak.is-speaking {
  color: var(--kb-primary);
  border-color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
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

.ai-pill-anchor {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 9999px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
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
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 14px 24px 18px;
  border-top: 1px solid var(--kb-border);
  background: color-mix(in srgb, var(--kb-card) 80%, transparent);
  backdrop-filter: blur(8px);
}
.ai-file-hidden { display: none; }
/* 已附图片芯片 */
.ai-img-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  max-width: 100%;
  padding: 5px 8px 5px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--kb-card-foreground);
  background: var(--kb-muted);
  border: 1px solid var(--kb-border);
}
.ai-img-chip :deep(svg) { flex-shrink: 0; color: var(--kb-primary); }
.ai-img-chip-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-img-chip-tag {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
}
.ai-img-chip-x {
  display: inline-flex;
  padding: 2px;
  border: none;
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  border-radius: 6px;
}
.ai-img-chip-x:hover {
  color: var(--kb-destructive);
  background: color-mix(in srgb, var(--kb-destructive) 12%, transparent);
}
/* 输入行（textarea + 附件 + 发送） */
.ai-input-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
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
/* 附件按钮 */
.ai-attach {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  color: var(--kb-muted-foreground);
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
  cursor: pointer;
  transition: color .15s ease, background .15s ease, border-color .15s ease;
}
.ai-attach:hover:not(:disabled) {
  color: var(--kb-primary);
  border-color: var(--kb-primary);
}
.ai-attach.is-active {
  color: var(--kb-primary);
  border-color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 8%, transparent);
}
.ai-attach:disabled { opacity: .5; cursor: not-allowed; }

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
