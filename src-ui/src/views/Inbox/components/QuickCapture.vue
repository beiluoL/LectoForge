<template>
  <section class="qc">
    <!-- 输入区 -->
    <div class="qc-box" :class="{ 'is-focus': focused }">
      <textarea
        ref="taRef"
        v-model="text"
        class="qc-textarea"
        :placeholder="placeholder"
        rows="3"
        @focus="focused = true"
        @blur="focused = false"
        @keydown="onKeydown"
      ></textarea>

      <!-- 剪藏预览：抓取中骨架 / 抓取结果卡片 -->
      <div v-if="clipping" class="qc-clip qc-clip-loading">
        <span class="qc-spinner" aria-hidden="true"></span>
        <span class="qc-clip-tip">正在抓取网页信息…</span>
      </div>

      <div v-else-if="clip" class="qc-clip" :class="{ 'is-fallback': !clip.ok }">
        <img v-if="clip.image" :src="clip.image" class="qc-clip-img" alt="" @error="onImgError" />
        <div v-else class="qc-clip-img qc-clip-img-ph">
          <Icon name="link" :size="18" />
        </div>
        <div class="qc-clip-main">
          <input v-model="clipTitle" class="qc-clip-title" placeholder="网页标题" />
          <p class="qc-clip-desc">{{ clip.description || clip.snippet || '未抓取到描述' }}</p>
          <span class="qc-clip-url">{{ clip.url }}</span>
        </div>
        <button class="qc-clip-close" title="取消剪藏" @click="clearClip">
          <Icon name="x" :size="14" />
        </button>
      </div>
    </div>

    <!-- 工具条：标签 + 提交 -->
    <div class="qc-tools">
      <div class="qc-tags">
        <button
          v-for="t in tagOptions"
          :key="t"
          class="qc-tag"
          :class="{ 'is-on': selectedTags.includes(t) }"
          type="button"
          @click="toggleTag(t)"
        >
          <Icon v-if="selectedTags.includes(t)" name="check" :size="11" />
          {{ t }}
        </button>

        <!-- 自定义标签 -->
        <input
          v-if="customing"
          ref="customRef"
          v-model="customTag"
          class="qc-tag-input"
          placeholder="标签名，回车确认"
          @keydown.enter.prevent="commitCustomTag"
          @keydown.esc="cancelCustomTag"
          @blur="commitCustomTag"
        />
        <button v-else class="qc-tag qc-tag-add" type="button" @click="startCustomTag">
          <Icon name="plus" :size="11" /> 标签
        </button>
      </div>

      <div class="qc-actions">
        <span class="qc-hint">{{ hint }}</span>
        <button
          class="kb-btn kb-btn-primary qc-submit"
          :disabled="!canSubmit || submitting"
          @click="submit"
        >
          <Icon :name="submitting ? 'loader' : 'send-horizontal'" :size="14" :class="{ 'qc-spin': submitting }" />
          {{ submitting ? '收集中' : '收集' }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 极速输入框：收集箱的入口组件。
 *
 * 两条输入路径：
 * 1) 纯文本速记 —— 直接敲字，Ctrl/Cmd + Enter 提交；
 * 2) 网页剪藏  —— 内容里出现 http(s) 链接时，600ms 防抖后自动抓取
 *    标题/描述/封面图并展示预览卡，用户可改标题后再提交。
 *
 * 抓取只发生在「内容中的第一个 URL 发生变化」时，避免用户继续打字时反复请求。
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import Icon from '@/components/ui/Icon.vue';
import { useInboxStore } from '@/stores/inboxStore';
import { notify, getApiError } from '@/utils/toast';
import type { ClipResult, InboxType } from '@/api/inbox';

const props = withDefaults(
  defineProps<{
    /** 内嵌在弹窗里时自动聚焦 */
    autofocus?: boolean;
    placeholder?: string;
  }>(),
  {
    autofocus: false,
    placeholder: '记下一个念头，或粘贴一个网址自动剪藏…（⌘/Ctrl + Enter 收集）',
  },
);

const emit = defineEmits<{ (e: 'created'): void }>();

const store = useInboxStore();

const taRef = ref<HTMLTextAreaElement | null>(null);
const customRef = ref<HTMLInputElement | null>(null);

const text = ref('');
const focused = ref(false);
const submitting = ref(false);

/** 剪藏结果与可编辑标题 */
const clip = ref<ClipResult | null>(null);
const clipTitle = ref('');
const clipping = computed(() => store.clipping);
/** 已抓取过的 URL，避免同一链接重复请求 */
const clippedUrl = ref('');

/** 标签：内置常用 + 历史出现过的 + 用户临时新增 */
const customing = ref(false);
const customTag = ref('');
const extraTags = ref<string[]>([]);
const selectedTags = ref<string[]>([]);

const PRESET_TAGS = ['灵感', '待读', '架构', '学习方法'];

const tagOptions = computed(() => {
  const set = new Set<string>([...PRESET_TAGS, ...store.allTags, ...extraTags.value]);
  return Array.from(set);
});

const canSubmit = computed(() => text.value.trim().length > 0 || Boolean(clip.value));

const hint = computed(() => {
  if (clip.value) return clip.value.ok ? '已识别网页，可修改标题后收集' : '未抓取到网页信息，可手动填写标题';
  return '⌘/Ctrl + Enter 快速收集';
});

/** 提取内容里的第一个 http(s) 链接 */
function firstUrl(s: string): string {
  const m = s.match(/https?:\/\/[^\s<>"')]+/i);
  return m ? m[0] : '';
}

/** 真正发起抓取（已被 600ms 防抖包装） */
const doClip = useDebounceFn(async (url: string) => {
  if (!url || url === clippedUrl.value) return;
  const res = await store.clip(url);
  // 抓取回来时用户可能已经把链接删了，丢弃过期结果
  if (!res || firstUrl(text.value) !== url) return;
  clippedUrl.value = url;
  clip.value = res;
  clipTitle.value = res.title || '';
}, 600);

// 监听输入：链接变化才触发抓取；链接被删则清掉预览
watch(text, (val) => {
  const url = firstUrl(val);
  if (!url) {
    if (clip.value) clearClip();
    return;
  }
  if (url !== clippedUrl.value) doClip(url);
});

function clearClip() {
  clip.value = null;
  clipTitle.value = '';
  clippedUrl.value = '';
}

function onImgError(e: Event) {
  // 封面图挂了就隐藏，不让破图占位（常见于防盗链的 og:image）
  if (clip.value) clip.value.image = null;
  (e.target as HTMLImageElement).style.display = 'none';
}

function toggleTag(t: string) {
  const i = selectedTags.value.indexOf(t);
  if (i > -1) selectedTags.value.splice(i, 1);
  else selectedTags.value.push(t);
}

async function startCustomTag() {
  customing.value = true;
  await nextTick();
  customRef.value?.focus();
}

function commitCustomTag() {
  const t = customTag.value.trim();
  if (t) {
    if (!extraTags.value.includes(t)) extraTags.value.push(t);
    if (!selectedTags.value.includes(t)) selectedTags.value.push(t);
  }
  customTag.value = '';
  customing.value = false;
}

function cancelCustomTag() {
  customTag.value = '';
  customing.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    submit();
  }
}

async function submit() {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  try {
    const url = clip.value?.url || firstUrl(text.value);
    const type: InboxType = clip.value || url ? 'link' : 'text';
    // 剪藏时正文优先用抓取到的描述/摘要，用户自己敲的字作为补充留在前面
    const typed = text.value.trim();
    const body = clip.value
      ? [typed.replace(url, '').trim(), clip.value.description || clip.value.snippet]
          .filter(Boolean)
          .join('\n\n')
      : typed;

    await store.addItem({
      content: body,
      title: clip.value ? clipTitle.value.trim() || clip.value.title : '',
      type,
      sourceUrl: url,
      coverImage: clip.value?.image || '',
      tags: [...selectedTags.value],
    });

    // 复位：标签保留选中（连续收集同类内容更顺手），只清内容与剪藏
    text.value = '';
    clearClip();
    notify('已收进收集箱', 'success');
    emit('created');
    await nextTick();
    taRef.value?.focus();
  } catch (e) {
    notify(getApiError(e, '收集失败，请重试'), 'error');
  } finally {
    submitting.value = false;
  }
}

// 弹窗模式：挂载后自动聚焦
watch(
  () => props.autofocus,
  (v) => {
    if (v) nextTick(() => taRef.value?.focus());
  },
  { immediate: true },
);

defineExpose({ focus: () => taRef.value?.focus() });
</script>

<style scoped>
.qc {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ===== 输入框 ===== */
.qc-box {
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  overflow: hidden;
}
.qc-box.is-focus {
  border-color: var(--kb-primary);
  box-shadow: 0 0 0 3px rgba(59, 111, 224, 0.1);
}
.qc-textarea {
  display: block;
  width: 100%;
  padding: 12px 14px;
  border: none;
  outline: none;
  resize: vertical;
  min-height: 76px;
  background: transparent;
  color: var(--kb-foreground);
  font-family: inherit;
  font-size: var(--kb-fs-body-md);
  line-height: 1.7;
}
.qc-textarea::placeholder {
  color: var(--kb-muted-foreground);
}

/* ===== 剪藏预览 ===== */
.qc-clip {
  position: relative;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin: 0 12px 12px;
  padding: 10px;
  border-radius: var(--kb-radius-sm);
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
}
.qc-clip.is-fallback {
  border-style: dashed;
}
.qc-clip-loading {
  align-items: center;
  gap: 8px;
  color: var(--kb-muted-foreground);
  font-size: var(--kb-fs-body-sm);
}
.qc-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--kb-border);
  border-top-color: var(--kb-primary);
  border-radius: 50%;
  animation: qc-rotate 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes qc-rotate {
  to { transform: rotate(360deg); }
}
.qc-clip-img {
  width: 68px;
  height: 68px;
  object-fit: cover;
  border-radius: var(--kb-radius-sm);
  flex-shrink: 0;
  background: var(--kb-muted);
}
.qc-clip-img-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--kb-muted-foreground);
}
.qc-clip-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.qc-clip-title {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  padding: 2px 0;
  color: var(--kb-foreground);
  font-family: inherit;
  font-size: var(--kb-fs-body-md);
  font-weight: 600;
  border-bottom: 1px dashed transparent;
}
.qc-clip-title:hover,
.qc-clip-title:focus {
  border-bottom-color: var(--kb-border);
}
.qc-clip-desc {
  margin: 0;
  font-size: var(--kb-fs-caption);
  color: var(--kb-muted-foreground);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.qc-clip-url {
  font-family: var(--font-mono);
  font-size: var(--kb-fs-xs);
  color: var(--kb-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.qc-clip-close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--kb-radius-sm);
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.qc-clip-close:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}

/* ===== 工具条 ===== */
.qc-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.qc-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.qc-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
  color: var(--kb-muted-foreground);
  font-family: inherit;
  font-size: var(--kb-fs-caption);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}
.qc-tag:hover {
  border-color: var(--kb-primary);
  color: var(--kb-foreground);
}
.qc-tag:active { transform: translateY(1px); }
.qc-tag.is-on {
  background: color-mix(in srgb, var(--kb-primary) 10%, transparent);
  border-color: var(--kb-primary);
  color: var(--kb-primary);
}
.qc-tag-add {
  border-style: dashed;
}
.qc-tag-input {
  height: 26px;
  width: 128px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--kb-primary);
  background: var(--kb-card);
  color: var(--kb-foreground);
  font-family: inherit;
  font-size: var(--kb-fs-caption);
  outline: none;
}
.qc-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}
.qc-hint {
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
  white-space: nowrap;
}
.qc-submit {
  min-width: 88px;
}
.qc-spin {
  animation: qc-rotate 0.7s linear infinite;
}

@media (max-width: 720px) {
  .qc-hint { display: none; }
  .qc-actions { width: 100%; justify-content: flex-end; }
}
</style>
