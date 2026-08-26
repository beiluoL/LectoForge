<template>
  <Teleport to="body">
    <Transition name="qm-modal">
      <div v-if="open" class="qm-mask" @click.self="close">
        <div class="qm-modal" role="dialog" aria-modal="true">
          <header class="qm-head">
            <span class="qm-title">
              <Icon :name="isEdit ? 'pencil' : 'plus-circle'" :size="'md'" />
              {{ isEdit ? '编辑任务' : '新建任务' }}
            </span>
            <button class="qm-close" @click="close">
              <Icon name="x" :size="'15px'" />
            </button>
          </header>

          <div class="qm-body">
            <!-- 标题 -->
            <label class="qm-field">
              <span class="qm-label">任务标题</span>
              <input
                ref="titleRef"
                v-model="form.title"
                class="qm-input"
                maxlength="200"
                placeholder="要做什么？可以用 Emoji 开头，例如 🔥 修复线上告警"
                @keydown.enter.prevent="submit"
              />
            </label>

            <!-- 象限选择 -->
            <div class="qm-field">
              <span class="qm-label">放进哪个象限</span>
              <div class="qm-quads">
                <button
                  v-for="q in quadrants"
                  :key="q.key"
                  type="button"
                  class="qm-quad"
                  :class="{ 'is-active': form.quadrant === q.key }"
                  :style="{
                    '--q-color': q.color,
                    '--q-soft': `color-mix(in srgb, ${q.color} 12%, transparent)`,
                  }"
                  @click="form.quadrant = q.key"
                >
                  <span class="qm-quad-badge">{{ q.order }}</span>
                  <span class="qm-quad-text">
                    <span class="qm-quad-label">{{ q.label }}</span>
                    <span class="qm-quad-hint">{{ q.hint }}</span>
                  </span>
                  <Icon v-if="form.quadrant === q.key" name="check" :size="'sm'" class="qm-quad-check" />
                </button>
              </div>
            </div>

            <div class="qm-row">
              <!-- 提醒时间 -->
              <label class="qm-field qm-flex">
                <span class="qm-label">提醒时间（可选）</span>
                <input v-model="form.scheduledAt" class="qm-input" type="datetime-local" />
              </label>

              <!-- 标签 -->
              <label class="qm-field qm-flex">
                <span class="qm-label">标签（逗号分隔，可选）</span>
                <input v-model="form.tags" class="qm-input" maxlength="120" placeholder="工作, 会议" />
              </label>
            </div>

            <!-- 备注 -->
            <label class="qm-field">
              <span class="qm-label">备注（可选）</span>
              <textarea
                v-model="form.description"
                class="qm-input qm-textarea"
                rows="2"
                maxlength="500"
                placeholder="补充一句上下文，方便回头看时想起来为什么要做"
              ></textarea>
            </label>
          </div>

          <footer class="qm-foot">
            <button class="kb-btn" @click="close">取消</button>
            <button class="kb-btn kb-btn-primary" :disabled="saving || !form.title.trim()" @click="submit">
              <Icon v-if="saving" name="loader" :size="'15px'" class="qm-spin" />
              {{ saving ? '保存中…' : isEdit ? '保存修改' : '添加任务' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import type { QuadrantKey, QuadrantTask } from '@/api/quadrant';
import type { QuadrantMeta } from '../types';
import { notify } from '@/utils/toast';

const props = defineProps<{
  open: boolean;
  /** 传入表示编辑既有任务，null / undefined 为新建 */
  edit?: QuadrantTask | null;
  /** 新建时预选的象限（从某个卡片的 + 号进来时用） */
  defaultQuadrant?: QuadrantKey;
  /** 四象限元数据，由父页面统一维护后传入 */
  quadrants: QuadrantMeta[];
}>();

const emit = defineEmits<{
  'update:open': [boolean];
  /** 提交表单：父页面负责调 store，弹窗只管收集数据 */
  submit: [{ id?: number; title: string; quadrant: QuadrantKey; description: string | null; scheduledAt: string | null; tags: string | null }];
}>();

const isEdit = computed(() => !!props.edit);
const saving = ref(false);
const titleRef = ref<HTMLInputElement | null>(null);

const form = reactive<{
  title: string;
  quadrant: QuadrantKey;
  /** datetime-local 的值格式是 'YYYY-MM-DDTHH:mm'，与 ISO 的互转见下方两个函数 */
  scheduledAt: string;
  tags: string;
  description: string;
}>({
  title: '',
  quadrant: 'urgent-important',
  scheduledAt: '',
  tags: '',
  description: '',
});

/**
 * ISO → datetime-local 输入值。
 * 不能直接 slice ISO 串：toISOString 是 UTC，东八区会凭空少 8 小时。
 * 这里按**本地时区**逐段取值，保证「库里 14:30，输入框也显示 14:30」。
 */
function isoToLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** datetime-local 输入值 → ISO。空串一律 null（表示未排期，而不是 1970） */
function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

watch(
  () => [props.open, props.edit, props.defaultQuadrant] as const,
  ([o]) => {
    if (!o) return;
    if (props.edit) {
      form.title = props.edit.title;
      form.quadrant = props.edit.quadrant;
      form.scheduledAt = isoToLocalInput(props.edit.scheduledAt);
      form.tags = props.edit.tags ?? '';
      form.description = props.edit.description ?? '';
    } else {
      form.title = '';
      form.quadrant = props.defaultQuadrant ?? 'urgent-important';
      form.scheduledAt = '';
      form.tags = '';
      form.description = '';
    }
    // 打开即聚焦标题：快速添加是高频动作，多一次点击就少一次记录
    nextTick(() => titleRef.value?.focus());
  },
  { immediate: true },
);

function close() {
  emit('update:open', false);
}

async function submit() {
  const title = form.title.trim();
  if (!title) {
    notify('请填写任务标题', 'warning');
    return;
  }
  saving.value = true;
  try {
    emit('submit', {
      id: props.edit?.id,
      title,
      quadrant: form.quadrant,
      description: form.description.trim() || null,
      scheduledAt: localInputToIso(form.scheduledAt),
      tags: form.tags.trim() || null,
    });
    close();
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.qm-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 18, 24, 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.qm-modal {
  width: 520px;
  max-width: 94vw;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.qm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px;
  border-bottom: 1px solid var(--kb-border);
}
.qm-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 700;
  color: var(--kb-foreground);
}
.qm-close {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--kb-radius-sm);
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
}
.qm-close:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}

.qm-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}
.qm-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.qm-flex {
  flex: 1;
  min-width: 190px;
}
.qm-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.qm-label {
  font-size: var(--kb-fs-body-sm);
  font-weight: 600;
  color: var(--kb-muted-foreground);
}
.qm-input {
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
  color: var(--kb-foreground);
  font: inherit;
  outline: none;
  transition: border-color 0.15s ease;
}
.qm-input:focus {
  border-color: var(--kb-primary);
}
.qm-textarea {
  resize: vertical;
  line-height: 1.6;
}

/* 象限选择：2×2，与主页面的网格布局同构，选起来所见即所得 */
.qm-quads {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.qm-quad {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--kb-radius-md);
  border: 1.5px solid var(--kb-border);
  background: var(--kb-background);
  cursor: pointer;
  text-align: left;
  transition: all 0.12s ease;
}
.qm-quad:hover {
  border-color: var(--q-color);
}
.qm-quad.is-active {
  border-color: var(--q-color);
  background: var(--q-soft);
}
.qm-quad-badge {
  flex: none;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: var(--q-soft);
  color: var(--q-color);
  font-size: 11px;
  font-weight: 700;
  font-family: var(--font-mono);
}
.qm-quad-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.qm-quad-label {
  font-size: var(--kb-fs-body-sm);
  font-weight: 600;
  color: var(--kb-foreground);
}
.qm-quad-hint {
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
}
.qm-quad-check {
  flex: none;
  color: var(--q-color);
}

.qm-foot {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 16px;
  border-top: 1px solid var(--kb-border);
}

.qm-spin {
  animation: qm-spin 0.9s linear infinite;
}
@keyframes qm-spin {
  to {
    transform: rotate(360deg);
  }
}

.qm-modal-enter-active,
.qm-modal-leave-active {
  transition: opacity 0.18s ease;
}
.qm-modal-enter-active .qm-modal,
.qm-modal-leave-active .qm-modal {
  transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.qm-modal-enter-from,
.qm-modal-leave-to {
  opacity: 0;
}
.qm-modal-enter-from .qm-modal,
.qm-modal-leave-to .qm-modal {
  transform: translateY(12px) scale(0.98);
}
</style>
