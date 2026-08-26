<template>
  <Teleport to="body">
    <Transition name="hb-modal">
      <div v-if="open" class="hb-mask" @click.self="close">
        <div class="hb-modal" role="dialog" aria-modal="true">
          <header class="hb-modal-head">
            <span class="hb-modal-title">
              <Icon :name="isEdit ? 'pencil' : 'plus-circle'" :size="'md'" />
              {{ isEdit ? '编辑习惯' : '新建习惯' }}
            </span>
            <button class="qcm-close" @click="close">
              <Icon name="x" :size="'15px'" />
            </button>
          </header>

          <div class="hb-modal-body">
            <!-- 名称 -->
            <label class="hb-field">
              <span class="hb-label">习惯名称</span>
              <input
                v-model="form.name"
                class="hb-input"
                maxlength="40"
                placeholder="例如：每日阅读 / 早起打卡"
                @keydown.enter="submit"
              />
            </label>

            <!-- 描述 -->
            <label class="hb-field">
              <span class="hb-label">描述（可选）</span>
              <textarea
                v-model="form.description"
                class="hb-textarea"
                rows="2"
                maxlength="120"
                placeholder="一句话提醒自己为什么要坚持"
              ></textarea>
            </label>

            <!-- 图标 -->
            <div class="hb-field">
              <span class="hb-label">图标</span>
              <div class="hb-icon-grid">
                <button
                  v-for="ic in ICONS"
                  :key="ic"
                  type="button"
                  class="hb-icon-opt"
                  :class="{ 'is-active': form.iconName === ic }"
                  :style="form.iconName === ic ? { borderColor: form.color, color: form.color } : {}"
                  @click="form.iconName = ic"
                >
                  <Icon :name="ic" :size="'lg'" />
                </button>
              </div>
            </div>

            <!-- 颜色（macOS 风格色板） -->
            <div class="hb-field">
              <span class="hb-label">颜色</span>
              <div class="hb-color-row">
                <button
                  v-for="c in COLORS"
                  :key="c"
                  type="button"
                  class="hb-color-opt"
                  :class="{ 'is-active': form.color === c }"
                  :style="{ background: c }"
                  @click="form.color = c"
                >
                  <Icon v-if="form.color === c" name="check" :size="'sm'" />
                </button>
              </div>
            </div>
          </div>

          <footer class="hb-modal-foot">
            <button class="kb-btn" @click="close">取消</button>
            <button class="kb-btn kb-btn-primary" :disabled="saving || !form.name.trim()" @click="submit">
              <Icon v-if="saving" name="loader" :size="'15px'" class="hb-spin" />
              {{ saving ? '保存中…' : isEdit ? '保存修改' : '创建习惯' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import { createHabit, updateHabit, type CreateHabitInput, type Habit } from '@/api/habit';
import { notify } from '@/utils/toast';
import { chartColor, cssToken } from '@/utils/palette';

const props = defineProps<{ open: boolean; edit?: Habit | null }>();
const emit = defineEmits<{ 'update:open': [boolean]; saved: [] }>();

const isEdit = computed(() => !!props.edit);

const COLORS = computed(() => [
  cssToken('--kb-highlight', '#FF6B35'),
  cssToken('--kb-destructive', '#EF4444'),
  chartColor(3),
  chartColor(2),
  chartColor(0),
  chartColor(1),
  chartColor(4),
  chartColor(5),
]);
const ICONS = [
  'book-open',
  'sun',
  'moon',
  'droplet',
  'dumbbell',
  'apple',
  'coffee',
  'pencil',
  'music',
  'heart',
  'brain',
  'leaf',
  'zap',
  'smile',
  'target',
  'flame',
];

const form = reactive<{ name: string; description: string; iconName: string; color: string }>({
  name: '',
  description: '',
  iconName: 'check-circle',
  color: COLORS.value[4],
});
const saving = ref(false);

watch(
  () => [props.open, props.edit] as const,
  ([o]) => {
    if (!o) return;
    if (props.edit) {
      form.name = props.edit.name;
      form.description = props.edit.description ?? '';
      form.iconName = props.edit.iconName || 'check-circle';
      form.color = props.edit.color || COLORS.value[4];
    } else {
      form.name = '';
      form.description = '';
      form.iconName = 'check-circle';
      form.color = COLORS.value[4];
    }
  },
  { immediate: true },
);

function close() {
  emit('update:open', false);
}

async function submit() {
  const name = form.name.trim();
  if (!name) {
    notify('请填写习惯名称', 'warning');
    return;
  }
  const payload: CreateHabitInput = {
    name,
    description: form.description.trim() || null,
    iconName: form.iconName,
    color: form.color,
    frequency: 'DAILY',
  };
  saving.value = true;
  try {
    if (props.edit) {
      await updateHabit(props.edit.id, payload);
      notify('已保存', 'success');
    } else {
      await createHabit(payload);
    }
    emit('saved');
    close();
  } catch (e) {
    notify(e instanceof Error ? e.message : '保存失败', 'error');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.hb-mask {
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
.hb-modal {
  width: 440px;
  max-width: 94vw;
  display: flex;
  flex-direction: column;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.hb-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px;
  border-bottom: 1px solid var(--kb-border);
}
.hb-modal-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 700;
  color: var(--kb-foreground);
}
.hb-modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.hb-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hb-label {
  font-size: var(--kb-fs-body-sm);
  font-weight: 600;
  color: var(--kb-muted-foreground);
}
.hb-input,
.hb-textarea {
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
.hb-input:focus,
.hb-textarea:focus {
  border-color: var(--kb-primary);
}
.hb-textarea {
  resize: vertical;
  line-height: 1.6;
}

/* 图标选择 */
.hb-icon-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 8px;
}
.hb-icon-opt {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  border: 1.5px solid var(--kb-border);
  background: var(--kb-background);
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: all 0.12s ease;
}
.hb-icon-opt:hover {
  border-color: var(--kb-primary);
}
.hb-icon-opt.is-active {
  background: color-mix(in srgb, var(--kb-primary) 10%, transparent);
}

/* 颜色选择 */
.hb-color-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.hb-color-opt {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  transition: transform 0.12s ease;
}
.hb-color-opt:hover {
  transform: scale(1.1);
}
.hb-color-opt.is-active {
  box-shadow: 0 0 0 2px var(--kb-card), 0 0 0 4px currentColor;
}

.hb-modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 16px;
  border-top: 1px solid var(--kb-border);
}

.hb-spin {
  animation: hb-spin 0.9s linear infinite;
}
@keyframes hb-spin {
  to {
    transform: rotate(360deg);
  }
}

.hb-modal-enter-active,
.hb-modal-leave-active {
  transition: opacity 0.18s ease;
}
.hb-modal-enter-active .hb-modal,
.hb-modal-leave-active .hb-modal {
  transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.hb-modal-enter-from,
.hb-modal-leave-to {
  opacity: 0;
}
.hb-modal-enter-from .hb-modal,
.hb-modal-leave-to .hb-modal {
  transform: translateY(12px) scale(0.98);
}
</style>
