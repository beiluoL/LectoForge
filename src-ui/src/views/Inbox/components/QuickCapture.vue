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
        @blur="onBlur"
        @keydown="onKeydown"
        @paste="onPaste"
      ></textarea>

      <!-- 智能去重提醒：近 7 天内已有高度相似的条目 -->
      <Transition name="qc-excerpt">
        <div v-if="duplicate" class="qc-dup">
          <Icon name="copy-check" :size="15" class="qc-dup-icon" />
          <div class="qc-dup-main">
            <strong>可能重复收集</strong>
            <span>
              {{ duplicate.reason === 'url' ? '同一个网址' : `相似度 ${Math.round(duplicate.similarity * 100)}%` }}
              ——「{{ duplicate.existingTitle || '未命名条目' }}」
              <em v-if="duplicate.existingCreatedAt">· {{ fromNow(duplicate.existingCreatedAt) }}</em>
            </span>
          </div>
          <button class="qc-dup-btn" type="button" @click="gotoDuplicate">查看原条目</button>
          <button class="qc-dup-close" type="button" title="忽略" @click="store.clearDuplicate()">
            <Icon name="x" :size="13" />
          </button>
        </div>
      </Transition>

      <!-- 附件条：已上传的录音 / 图片 / 文件 -->
      <div v-if="attachments.length" class="qc-attach">
        <div v-for="(a, i) in attachments" :key="a.url" class="qc-attach-item">
          <Icon :name="a.kind === 'audio' ? 'mic' : a.isImage ? 'image' : 'paperclip'" :size="13" />
          <span class="qc-attach-name" :title="a.originalName">{{ a.originalName }}</span>
          <span class="qc-attach-size">{{ prettySize(a.size) }}</span>
          <audio v-if="a.kind === 'audio'" class="qc-attach-audio" controls preload="none" :src="a.url"></audio>
          <button class="qc-attach-del" title="移除该附件" @click="removeAttachment(i)">
            <Icon name="x" :size="12" />
          </button>
        </div>
      </div>

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

    <!-- 摘录模式浮层：粘贴网页里高亮复制的精华片段，归入 content -->
    <Transition name="qc-excerpt">
      <div v-if="excerptMode" class="qc-excerpt">
        <div class="qc-excerpt-head">
          <span><Icon name="highlighter" :size="13" /> 摘录模式 · 粘贴网页中高亮复制的精华</span>
          <button class="qc-excerpt-close" title="关闭" @click="excerptMode = false">
            <Icon name="x" :size="13" />
          </button>
        </div>
        <textarea
          ref="excerptRef"
          v-model="excerptText"
          class="qc-excerpt-area"
          rows="3"
          placeholder="在此粘贴你从网页复制的精华片段，提交时会并入收集内容…"
        ></textarea>
        <div class="qc-excerpt-foot">
          <span class="qc-excerpt-tip">片段将作为正文的一部分保存</span>
          <button class="kb-btn kb-btn-sm" @click="excerptMode = false">完成</button>
        </div>
      </div>
    </Transition>

    <!-- 工具条：标签 + 提交 -->
    <div class="qc-tools">
      <!-- AI 智能建议标签：无标签且正文足够长时自动请求，用户点一下即采纳 -->
      <div v-if="suggestedTags.length" class="qc-suggest">
        <span class="qc-suggest-label"><Icon name="sparkles" :size="12" /> AI 建议</span>
        <button
          v-for="t in suggestedTags"
          :key="t"
          class="qc-tag qc-suggest-tag"
          type="button"
          @click="adoptSuggestion(t)"
        >
          {{ t }}
          <Icon name="plus" :size="10" />
        </button>
        <button class="qc-suggest-dismiss" title="忽略建议" @click="suggestedTags = []">忽略</button>
      </div>

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
        <!-- 剪藏时显示「将摘要作为初稿」勾选 -->
        <label v-if="clip && clip.ok" class="qc-draft-toggle">
          <input type="checkbox" v-model="useSummaryAsDraft" />
          <span>将摘要作为初稿</span>
        </label>
        <!-- 语音灵感：录音中变为红色脉冲 + 计时，再点一次停止并自动上传 -->
        <button
          class="kb-btn kb-btn-sm qc-mic"
          :class="{ 'is-rec': recording }"
          type="button"
          :disabled="uploading"
          :title="recording ? '停止录音并收集' : '语音灵感：录下来，稍后再整理'"
          @click="toggleRecord"
        >
          <Icon :name="recording ? 'square' : 'mic'" :size="12" />
          {{ recording ? elapsedText : '语音' }}
        </button>
        <button
          v-if="recording"
          class="kb-btn kb-btn-sm"
          type="button"
          title="放弃这段录音"
          @click="discardRecord"
        >
          <Icon name="trash-2" :size="12" />
        </button>

        <!-- 附件：图片 / PDF / 任意文件，也支持直接往输入框粘贴截图 -->
        <button
          class="kb-btn kb-btn-sm"
          type="button"
          :disabled="uploading"
          title="添加附件（也可直接 ⌘V 粘贴截图）"
          @click="fileRef?.click()"
        >
          <Icon :name="uploading ? 'loader' : 'paperclip'" :size="12" :class="{ 'qc-spin': uploading }" />
          附件
        </button>
        <input
          ref="fileRef"
          type="file"
          class="qc-file"
          multiple
          accept="image/*,audio/*,.pdf,.txt,.md,.csv,.json,.zip"
          @change="onFilePicked"
        />

        <button class="kb-btn kb-btn-sm" type="button" title="摘录模式" @click="openExcerpt">
          <Icon name="highlighter" :size="12" /> 摘录
        </button>
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
 *
 * 进阶能力：
 * - 语音灵感：MediaRecorder 录音 → 上传 → 以 type:'audio' 直接落一条收集项（不占输入框）；
 * - 多格式附件：文件选择 + 粘贴板图片 → 上传 → 以 Markdown 形式并入正文；
 * - 智能去重：失焦 / 粘贴后检测近 7 天的相似条目，命中则显示黄色提醒条（不阻断提交）；
 * - 深链预填：浏览器剪藏 lectoforge://capture 唤起时，从 store 消费预填内容。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import Icon from '@/components/ui/Icon.vue';
import { useInboxStore } from '@/store/inbox-store';
import { useVoiceRecorder } from '@/composables/useVoiceRecorder';
import { notify, getApiError } from '@/utils/toast';
import { fromNow } from '@/lib/date';
import type { ClipResult, InboxType, UploadResult } from '@/api/inbox';

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
const { duplicate, uploading } = storeToRefs(store);

const taRef = ref<HTMLTextAreaElement | null>(null);
const customRef = ref<HTMLInputElement | null>(null);
const fileRef = ref<HTMLInputElement | null>(null);

const text = ref('');
const focused = ref(false);
const submitting = ref(false);

/** 已上传待提交的附件（提交时统一并入正文 Markdown） */
interface Attachment extends UploadResult {
  isImage: boolean;
}
const attachments = ref<Attachment[]>([]);

/** 录音器（麦克风释放、格式探测、时长统计都在 composable 里） */
const { recording, elapsedText, start: startRec, stop: stopRec, cancel: cancelRec, error: recError } =
  useVoiceRecorder();

/** 剪藏结果与可编辑标题 */
const clip = ref<ClipResult | null>(null);
const clipTitle = ref('');
const clipping = computed(() => store.clipping);
/** 已抓取过的 URL，避免同一链接重复请求 */
const clippedUrl = ref('');

/** 剪藏增强：将网页摘要作为初稿进入收集箱 */
const useSummaryAsDraft = ref(false);
/** 摘录模式：粘贴网页高亮精华片段 */
const excerptMode = ref(false);
const excerptText = ref('');
const excerptRef = ref<HTMLTextAreaElement | null>(null);
/** AI 自动建议的标签（用户尚未采纳），2s 防抖后悄悄请求 */
const suggestedTags = ref<string[]>([]);

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

const canSubmit = computed(
  () => text.value.trim().length > 0 || Boolean(clip.value) || attachments.value.length > 0,
);

const hint = computed(() => {
  if (recording.value) return '正在录音，再点一次结束并收集';
  if (uploading.value) return '正在上传附件…';
  if (clip.value) return clip.value.ok ? '已识别网页，可修改标题后收集' : '未抓取到网页信息，可手动填写标题';
  return '⌘/Ctrl + Enter 快速收集';
});

/** 提取内容里的第一个 http(s) 链接 */
function firstUrl(s: string): string {
  const m = s.match(/https?:\/\/[^\s<>"')]+/i);
  return m ? m[0] : '';
}

/** 真正发起抓取（已被 800ms 防抖包装）：剪藏增强走 /metadata，摘要取前 200 字 */
const doClip = useDebounceFn(async (url: string) => {
  if (!url || url === clippedUrl.value) return;
  const res = await store.clipMeta(url);
  // 抓取回来时用户可能已经把链接删了，丢弃过期结果
  if (!res || firstUrl(text.value) !== url) return;
  clippedUrl.value = url;
  clip.value = res;
  clipTitle.value = res.title || '';
}, 800);

/** 延时 2s 自动触发 AI 标签建议：仅在用户尚未打标签且正文足够长时悄悄请求（智能路由 C） */
const autoSuggest = useDebounceFn(async () => {
  const body = text.value.trim();
  if (body.length < 20 || selectedTags.value.length || suggestedTags.value.length) return;
  const firstLine = body.split('\n').map((s) => s.trim()).find(Boolean) || '';
  const tags = await store.suggestTags(firstLine, body);
  if (tags.length && !selectedTags.value.length) {
    suggestedTags.value = tags.filter((t) => !selectedTags.value.includes(t));
  }
}, 2000);

// 监听输入：链接变化才触发抓取；链接被删则清掉预览；并静默尝试 AI 标签建议
watch(text, (val) => {
  const url = firstUrl(val);
  if (!url) {
    if (clip.value) clearClip();
  } else if (url !== clippedUrl.value) {
    doClip(url);
  }
  autoSuggest();
  /* 去重检测：正文太短没有判别意义（后端也有 8 字下限），
   * 但只要出现了 URL 就立即检测——同一个网址被剪藏两次是最高频的重复场景。 */
  if (val.trim().length >= 8 || url) {
    store.detectDuplicateDebounced({ content: val, sourceUrl: url || undefined });
  } else {
    store.clearDuplicate();
  }
});

function clearClip() {
  clip.value = null;
  clipTitle.value = '';
  clippedUrl.value = '';
  useSummaryAsDraft.value = false;
  suggestedTags.value = [];
}

/* ===========================================================================
 * 智能去重
 * ======================================================================== */

/** 失焦时立即检测一次（用户停笔的时刻，比防抖更及时） */
function onBlur() {
  focused.value = false;
  const body = text.value.trim();
  const url = firstUrl(body);
  if (body.length >= 8 || url) {
    void store.detectDuplicate({ content: body, sourceUrl: url || undefined });
  }
}

/** 跳到重复的原条目：收集箱没有详情页，滚动到列表里那张卡并高亮 */
function gotoDuplicate() {
  const id = duplicate.value?.existingId;
  if (!id) return;
  const el = document.querySelector<HTMLElement>(`[data-inbox-id="${id}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('is-flash');
    setTimeout(() => el.classList.remove('is-flash'), 1600);
  } else {
    notify('原条目可能已归档或不在当前筛选范围内', 'info');
  }
  store.clearDuplicate();
}

/* ===========================================================================
 * 语音灵感
 * ======================================================================== */

/** 点一次开始、再点一次结束；结束后直接落一条 type:'audio' 的收集项 */
async function toggleRecord() {
  if (recording.value) {
    const rec = await stopRec();
    if (!rec) {
      notify('没有录到声音，已放弃', 'info');
      return;
    }
    try {
      const up = await store.uploadAudio(rec.blob, rec.fileName);
      // 语音是独立的一条灵感，不塞进输入框——正在打的字不该被打断
      const title = `语音灵感 · ${rec.seconds}s`;
      await store.addItem({
        content: `[${title}](${up.url})`,
        title,
        type: 'audio',
        sourceUrl: up.url,
        tags: [...selectedTags.value],
      });
      notify(`语音已收集（${rec.seconds} 秒）`, 'success');
      emit('created');
    } catch (e) {
      notify(getApiError(e, '语音上传失败'), 'error');
    }
    return;
  }

  const ok = await startRec();
  if (!ok) notify(recError.value || '无法开始录音', 'error');
}

/** 放弃当前录音（不上传、不落库） */
function discardRecord() {
  cancelRec();
  notify('已放弃这段录音', 'info');
}

/* ===========================================================================
 * 多格式附件与实况截图
 * ======================================================================== */

const IMAGE_RE = /^image\//i;

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 上传一批文件并记入附件条；单个失败不影响其余 */
async function uploadFiles(files: File[]) {
  for (const f of files) {
    try {
      const up = await store.uploadAsset(f, f.name);
      attachments.value.push({ ...up, isImage: IMAGE_RE.test(f.type) });
    } catch (e) {
      notify(getApiError(e, `「${f.name}」上传失败`), 'error');
    }
  }
}

async function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  // 立刻清空 input.value，否则连续选同一个文件不会再触发 change
  input.value = '';
  if (files.length) await uploadFiles(files);
}

/**
 * 粘贴板处理：截图（image/*）直接上传，其余交给浏览器默认的文本粘贴。
 * 注意要 preventDefault，否则 Chromium 会在插入图片的同时又把文件名塞进 textarea。
 */
async function onPaste(e: ClipboardEvent) {
  const items = Array.from(e.clipboardData?.items || []);
  const images = items
    .filter((it) => it.kind === 'file' && IMAGE_RE.test(it.type))
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f);
  if (!images.length) {
    // 纯文本粘贴：立即做一次去重检测（粘贴长文是重复收集的高发场景）
    setTimeout(() => {
      const body = text.value.trim();
      const url = firstUrl(body);
      if (body.length >= 8 || url) {
        store.detectDuplicateDebounced({ content: body, sourceUrl: url || undefined }, 200);
      }
    }, 0);
    return;
  }
  e.preventDefault();
  const stamp = Date.now();
  await uploadFiles(
    images.map((f, i) =>
      f.name && f.name !== 'image.png' ? f : new File([f], `screenshot-${stamp}-${i}.png`, { type: f.type }),
    ),
  );
}

function removeAttachment(i: number) {
  attachments.value.splice(i, 1);
}

/** 附件转 Markdown：图片用 `![]()`，其余用普通链接 */
function attachmentsMarkdown(): string {
  return attachments.value
    .map((a) => (a.isImage ? `![${a.originalName}](${a.url})` : `[${a.originalName}](${a.url})`))
    .join('\n');
}

/** 打开摘录模式浮层并聚焦输入框 */
async function openExcerpt() {
  excerptMode.value = true;
  await nextTick();
  excerptRef.value?.focus();
}

/** 采纳一条 AI 建议标签 */
function adoptSuggestion(t: string) {
  if (!selectedTags.value.includes(t)) selectedTags.value.push(t);
  const i = suggestedTags.value.indexOf(t);
  if (i > -1) suggestedTags.value.splice(i, 1);
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
    const typed = text.value.trim();

    // 正文组装：剪藏摘要是否作为初稿 / 摘录片段是否并入，分别处理
    let body: string;
    if (useSummaryAsDraft.value && clip.value) {
      body = [clip.value.description || clip.value.snippet, typed.replace(url, '').trim()]
        .filter(Boolean)
        .join('\n\n');
    } else if (clip.value) {
      body = [typed.replace(url, '').trim(), clip.value.description || clip.value.snippet]
        .filter(Boolean)
        .join('\n\n');
    } else {
      body = typed;
    }
    // 摘录模式里粘贴的精华片段，统一并入正文
    const excerpt = excerptText.value.trim();
    if (excerpt) body = [body, excerpt].filter(Boolean).join('\n\n');

    // 附件以 Markdown 追加到正文末尾（wb_capture 没有独立附件列，富媒体一律走正文）
    const attachMd = attachmentsMarkdown();
    if (attachMd) body = [body, attachMd].filter(Boolean).join('\n\n');

    /* 类型判定优先级：链接 > 图片 > 附件 > 纯文本。
     * 带附件时把首个附件地址写进 sourceUrl，列表卡片可以据此直接渲染缩略图 / 播放器。 */
    const first = attachments.value[0];
    const finalType: InboxType = clip.value || url
      ? 'link'
      : first
        ? first.isImage
          ? 'image'
          : first.kind === 'audio'
            ? 'audio'
            : 'file'
        : type;

    await store.addItem({
      content: body,
      title: clip.value ? clipTitle.value.trim() || clip.value.title : '',
      type: finalType,
      sourceUrl: url || (first && !clip.value ? first.url : ''),
      coverImage: clip.value?.image || (first?.isImage ? first.url : ''),
      tags: [...selectedTags.value],
    });

    // 复位：标签保留选中（连续收集同类内容更顺手），只清内容与剪藏/摘录/建议/附件
    text.value = '';
    excerptText.value = '';
    excerptMode.value = false;
    useSummaryAsDraft.value = false;
    suggestedTags.value = [];
    attachments.value = [];
    store.clearDuplicate();
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

/* 深链预填（lectoforge://capture?url=...&title=...）：
 * 唤起弹窗时 store 里已写好预填内容，这里一次性消费掉并组装成输入框文本。
 * 用 consumePrefill 而不是直接读，避免用户手动再开弹窗时又冒出上次剪藏的内容。 */
onMounted(() => {
  const p = store.consumePrefill();
  if (!p) return;
  const parts = [p.title, p.sourceUrl, p.content].map((s) => (s || '').trim()).filter(Boolean);
  if (!parts.length) return;
  text.value = parts.join('\n');
  if (p.tags?.length) {
    p.tags.forEach((t) => {
      if (!extraTags.value.includes(t)) extraTags.value.push(t);
      if (!selectedTags.value.includes(t)) selectedTags.value.push(t);
    });
  }
  // 有网址就立刻抓取，用户打开弹窗时预览卡已经在了
  const url = p.sourceUrl || firstUrl(text.value);
  if (url) doClip(url);
  nextTick(() => taRef.value?.focus());
});

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

/* ===== 摘录模式浮层 ===== */
.qc-excerpt {
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-md);
  background: var(--kb-background);
  overflow: hidden;
}
.qc-excerpt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: var(--kb-fs-caption);
  font-weight: 600;
  color: var(--kb-foreground);
  background: color-mix(in srgb, var(--kb-highlight) 10%, transparent);
}
.qc-excerpt-head span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.qc-excerpt-close {
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
}
.qc-excerpt-close:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}
.qc-excerpt-area {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: none;
  outline: none;
  resize: vertical;
  min-height: 64px;
  background: transparent;
  color: var(--kb-foreground);
  font-family: inherit;
  font-size: var(--kb-fs-body-sm);
  line-height: 1.6;
}
.qc-excerpt-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px 10px;
}
.qc-excerpt-tip {
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
}
.qc-excerpt-enter-active,
.qc-excerpt-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.qc-excerpt-enter-from,
.qc-excerpt-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ===== AI 建议标签 ===== */
.qc-suggest {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--kb-radius-sm);
  background: color-mix(in srgb, var(--kb-highlight) 8%, transparent);
  border: 1px dashed color-mix(in srgb, var(--kb-highlight) 40%, transparent);
}
.qc-suggest-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--kb-fs-xs);
  font-weight: 600;
  color: var(--kb-highlight);
}
.qc-suggest-tag {
  border-color: color-mix(in srgb, var(--kb-highlight) 50%, transparent);
  color: var(--kb-highlight);
}
.qc-suggest-tag:hover {
  background: color-mix(in srgb, var(--kb-highlight) 14%, transparent);
  border-color: var(--kb-highlight);
}
.qc-suggest-dismiss {
  margin-left: auto;
  border: none;
  background: transparent;
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
  cursor: pointer;
  text-decoration: underline;
}

/* ===== 智能去重提醒条 ===== */
.qc-dup {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 12px 12px;
  padding: 9px 34px 9px 11px;
  border-radius: var(--kb-radius-sm);
  background: color-mix(in srgb, var(--kb-highlight) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--kb-highlight) 45%, transparent);
}
.qc-dup-icon {
  flex-shrink: 0;
  color: var(--kb-highlight);
}
.qc-dup-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.qc-dup-main strong {
  font-size: var(--kb-fs-caption);
  font-weight: 600;
  color: var(--kb-foreground);
}
.qc-dup-main span {
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qc-dup-main em {
  font-style: normal;
  opacity: 0.8;
}
.qc-dup-btn {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--kb-primary);
  font-family: inherit;
  font-size: var(--kb-fs-xs);
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}
.qc-dup-close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--kb-radius-sm);
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
}
.qc-dup-close:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}

/* ===== 附件条 ===== */
.qc-attach {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 12px 12px;
}
.qc-attach-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--kb-radius-sm);
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
  color: var(--kb-muted-foreground);
  font-size: var(--kb-fs-xs);
}
.qc-attach-name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--kb-foreground);
  font-weight: 500;
}
.qc-attach-size {
  font-family: var(--font-mono);
  opacity: 0.8;
}
.qc-attach-audio {
  height: 28px;
  max-width: 240px;
  margin-left: 4px;
}
.qc-attach-del {
  margin-left: auto;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--kb-radius-sm);
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
}
.qc-attach-del:hover {
  background: var(--kb-muted);
  color: var(--kb-destructive);
}

/* ===== 录音按钮 ===== */
.qc-file {
  display: none;
}
.qc-mic.is-rec {
  border-color: var(--kb-destructive);
  color: var(--kb-destructive);
  background: color-mix(in srgb, var(--kb-destructive) 10%, transparent);
  font-variant-numeric: tabular-nums;
  animation: qc-pulse 1.4s ease-in-out infinite;
}
@keyframes qc-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--kb-destructive) 35%, transparent); }
  50% { box-shadow: 0 0 0 5px transparent; }
}

/* ===== 摘要初稿勾选 ===== */
.qc-draft-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
  cursor: pointer;
  white-space: nowrap;
}
.qc-draft-toggle input {
  accent-color: var(--kb-primary);
}

@media (max-width: 720px) {
  .qc-hint { display: none; }
  .qc-actions { width: 100%; justify-content: flex-end; }
}
</style>
