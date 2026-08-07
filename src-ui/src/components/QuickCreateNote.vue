<template>
  <!-- 极速新建康奈尔笔记：挂到 body，任意页面 Ctrl/⌘ + Shift + F 都能唤起 -->
  <Teleport to="body">
    <Transition name="qcn">
      <div v-if="store.quickCreateOpen" class="qcn-overlay" @click.self="close">
        <div class="qcn-card" role="dialog" aria-modal="true" aria-label="极速新建笔记">
          <header class="qcn-head">
            <span class="qcn-title">
              <Icon name="pen-line" :size="16" />
              极速新建笔记
            </span>
            <span class="qcn-hint">先落笔，线索与总结稍后补</span>
            <button class="qcn-close" title="关闭 (Esc)" @click="close">
              <Icon name="x" :size="15" />
            </button>
          </header>

          <div class="qcn-body">
            <div class="qcn-field">
              <label class="kb-label" for="qcn-title">笔记标题 <span class="qcn-req">*</span></label>
              <input
                id="qcn-title"
                ref="titleRef"
                v-model="title"
                class="kb-input qcn-title-input"
                placeholder="这则笔记讲什么？"
                maxlength="120"
                @keydown.enter.prevent="focusBody"
                @keydown.meta.enter.prevent="submit"
                @keydown.ctrl.enter.prevent="submit"
              />
            </div>

            <div class="qcn-field">
              <label class="kb-label" for="qcn-note">笔记栏内容</label>
              <textarea
                id="qcn-note"
                ref="bodyRef"
                v-model="noteColumn"
                class="kb-input qcn-note-input"
                rows="6"
                placeholder="把要点先倒出来，进详情页再整理成康奈尔三栏…"
                @keydown.meta.enter.prevent="submit"
                @keydown.ctrl.enter.prevent="submit"
              ></textarea>
            </div>

            <p v-if="error" class="qcn-err">
              <Icon name="alert-circle" :size="13" /> {{ error }}
            </p>
          </div>

          <footer class="qcn-foot">
            <span class="qcn-kbd-tip">
              <kbd>⌘/Ctrl</kbd> + <kbd>Enter</kbd> 创建并进入 · <kbd>Esc</kbd> 关闭
            </span>
            <button class="kb-btn kb-btn-primary qcn-submit" :disabled="!canSubmit" @click="submit">
              <Icon :name="store.submitting ? 'loader' : 'arrow-right'" :size="14" :class="{ 'qcn-spin': store.submitting }" />
              {{ store.submitting ? '创建中…' : '创建并进入' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 极速新建康奈尔笔记（Ctrl/⌘ + Shift + F）。
 *
 * 定位与收集箱速记互补：速记是「先攒着」，这里是「已经想清楚要写成一则笔记」。
 * 所以只问最小必要信息（标题 + 笔记栏），创建后立刻跳详情页继续补线索与总结，
 * 不在弹窗里堆分类、标签、掌握度——那些在详情页做效率更高。
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Icon from '@/components/ui/Icon.vue';
import { notify, getApiError } from '@/utils/toast';
import { useNoteStore } from '@/store/noteStore';

const router = useRouter();
const store = useNoteStore();

const titleRef = ref<HTMLInputElement | null>(null);
const bodyRef = ref<HTMLTextAreaElement | null>(null);
const title = ref('');
const noteColumn = ref('');
const error = ref('');

const canSubmit = computed(() => !!title.value.trim() && !store.submitting);

/** 每次打开都清空上次残留，并把焦点交给标题框 */
watch(
  () => store.quickCreateOpen,
  async (open) => {
    if (!open) return;
    title.value = '';
    noteColumn.value = '';
    error.value = '';
    await nextTick();
    titleRef.value?.focus();
  },
);

function close() {
  store.closeQuickCreate();
}

/** 标题框回车不提交，而是跳到正文——符合「先写标题再写内容」的输入直觉 */
function focusBody() {
  bodyRef.value?.focus();
}

async function submit() {
  if (!canSubmit.value) {
    if (!title.value.trim()) {
      error.value = '标题不能为空';
      titleRef.value?.focus();
    }
    return;
  }
  error.value = '';
  try {
    const id = await store.quickCreate({
      title: title.value.trim(),
      // 详情页笔记栏是 contenteditable，这里把纯文本换行转成 <br> 以对齐富文本格式
      noteColumn: toHtml(noteColumn.value),
      cueColumn: '',
      summaryColumn: '',
      tags: '',
      mastery: 0,
    });
    close();
    notify('笔记已创建，继续补充线索与总结吧', 'success');
    router.push(`/workbench/notes/${id}`);
  } catch (e) {
    error.value = getApiError(e, '创建失败，请重试');
  }
}

/** 纯文本 → 编辑器可识别的 HTML：先转义再换行，避免用户粘贴的尖括号被当标签 */
function toHtml(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const escaped = t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\n/g, '<br>');
}
</script>

<style scoped>
.qcn-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 14vh;
  background: rgba(15, 18, 24, 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.qcn-card {
  width: 620px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.qcn-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--kb-border);
}
.qcn-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-serif);
  font-size: var(--kb-fs-body-md);
  font-weight: 700;
  color: var(--kb-foreground);
}
.qcn-hint {
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
}
.qcn-close {
  margin-left: auto;
  width: 26px;
  height: 26px;
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
.qcn-close:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}

.qcn-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}
.qcn-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.qcn-req {
  color: var(--kb-destructive);
}
.qcn-title-input {
  font-family: var(--font-serif);
  font-size: var(--kb-fs-body-md);
  font-weight: 600;
}
.qcn-note-input {
  resize: vertical;
  min-height: 120px;
  font-size: var(--kb-fs-body-sm);
  line-height: 1.7;
}
.qcn-err {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  font-size: var(--kb-fs-xs);
  font-weight: 500;
  color: var(--kb-destructive);
}

.qcn-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 14px;
  border-top: 1px solid var(--kb-border);
  background: var(--kb-background);
}
.qcn-kbd-tip {
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
}
.qcn-kbd-tip kbd {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--kb-foreground);
}
.qcn-submit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  font-size: var(--kb-fs-body-sm);
}
.qcn-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.qcn-spin {
  animation: qcn-rotate 0.9s linear infinite;
}
@keyframes qcn-rotate {
  to { transform: rotate(360deg); }
}

/* 入场/出场：与速记弹窗、命令面板同款节奏，保持全局弹层观感一致 */
.qcn-enter-active,
.qcn-leave-active {
  transition: opacity 0.18s ease;
}
.qcn-enter-active .qcn-card,
.qcn-leave-active .qcn-card {
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}
.qcn-enter-from,
.qcn-leave-to {
  opacity: 0;
}
.qcn-enter-from .qcn-card,
.qcn-leave-to .qcn-card {
  transform: scale(0.96);
  opacity: 0;
}
</style>
