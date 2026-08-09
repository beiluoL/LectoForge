<template>
  <Teleport to="body">
    <Transition name="sch-fade">
      <div v-if="open" class="sch-mask" @click.self="close">
        <div class="sch-modal" role="dialog" aria-modal="true" aria-label="设置重复规则">
          <header class="sch-modal-head">
            <span class="sch-modal-title">
              <Icon name="repeat" :size="16" />
              重复规则
            </span>
            <button class="qcm-close" @click="close">
              <Icon name="x" :size="15" />
            </button>
          </header>

          <div class="sch-modal-body">
            <!-- 模式单选 -->
            <div class="sch-mode">
              <button
                v-for="m in modes"
                :key="m.value"
                class="sch-mode-item"
                :class="{ 'is-active': draft.mode === m.value }"
                @click="draft.mode = m.value"
              >
                <Icon :name="m.icon" :size="15" />
                {{ m.label }}
              </button>
            </div>

            <!-- 自定义周期：每 X 天 -->
            <div v-if="draft.mode === 'custom'" class="sch-field-box">
              <label class="wb-label">每</label>
              <div class="sch-inline">
                <input
                  v-model.number="draft.interval"
                  class="kb-input sch-num"
                  type="number"
                  min="2"
                  max="365"
                />
                <span class="sch-unit">天重复一次</span>
              </div>
            </div>

            <!-- 每周：多选周几 -->
            <div v-if="draft.mode === 'weekly'" class="sch-field-box">
              <label class="wb-label">选择重复的星期</label>
              <div class="sch-week">
                <button
                  v-for="d in WEEKDAYS"
                  :key="d.value"
                  class="sch-week-day"
                  :class="{ 'is-on': draft.days.includes(d.value) }"
                  @click="toggleDay(d.value)"
                >
                  {{ d.label }}
                </button>
              </div>
              <p v-if="draft.mode === 'weekly' && !draft.days.length" class="sch-warn">
                至少选择一天
              </p>
            </div>

            <!-- 每月：每月 X 号 -->
            <div v-if="draft.mode === 'monthly'" class="sch-field-box">
              <label class="wb-label">每月</label>
              <div class="sch-inline">
                <input
                  v-model.number="draft.day"
                  class="kb-input sch-num"
                  type="number"
                  min="1"
                  max="31"
                />
                <span class="sch-unit">号重复</span>
              </div>
            </div>
          </div>

          <footer class="sch-modal-foot">
            <button class="kb-btn" @click="clearRule">清除重复</button>
            <div class="sch-foot-right">
              <button class="kb-btn" @click="close">取消</button>
              <button
                class="kb-btn kb-btn-primary"
                :disabled="!canSave"
                @click="save"
              >
                保存
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import type { RepeatRule } from '@/api/schedule';

const props = defineProps<{
  open: boolean;
  /** 当前任务的重复规则（编辑时带入），null 表示非重复 */
  initial: RepeatRule | null;
}>();

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void;
  (e: 'save', rule: RepeatRule | null): void;
}>();

type Mode = 'none' | 'daily' | 'custom' | 'weekly' | 'monthly';

const modes: { value: Mode; label: string; icon: string }[] = [
  { value: 'none', label: '不重复', icon: 'ban' },
  { value: 'daily', label: '每天', icon: 'repeat' },
  { value: 'custom', label: '每 N 天', icon: 'calendar-clock' },
  { value: 'weekly', label: '每周', icon: 'calendar-days' },
  { value: 'monthly', label: '每月', icon: 'calendar-range' },
];

// 周一..周日 → getDay() 值（1-6,0）
const WEEKDAYS = [
  { label: '一', value: 1 },
  { label: '二', value: 2 },
  { label: '三', value: 3 },
  { label: '四', value: 4 },
  { label: '五', value: 5 },
  { label: '六', value: 6 },
  { label: '日', value: 0 },
];

const draft = reactive<{
  mode: Mode;
  interval: number;
  days: number[];
  day: number;
}>({
  mode: 'none',
  interval: 2,
  days: [],
  day: 1,
});

/** 从 initial 推导初始 draft（打开时调用） */
function hydrate() {
  const r = props.initial;
  if (!r) {
    draft.mode = 'none';
    draft.interval = 2;
    draft.days = [];
    draft.day = 1;
    return;
  }
  switch (r.type) {
    case 'daily':
      draft.mode = r.interval <= 1 ? 'daily' : 'custom';
      draft.interval = r.interval;
      break;
    case 'weekly':
      draft.mode = 'weekly';
      draft.days = [...r.days];
      break;
    case 'monthly':
      draft.mode = 'monthly';
      draft.day = r.day;
      break;
  }
}

function toggleDay(v: number) {
  const i = draft.days.indexOf(v);
  if (i === -1) draft.days.push(v);
  else draft.days.splice(i, 1);
}

const canSave = computed(() => {
  if (draft.mode === 'weekly') return draft.days.length > 0;
  if (draft.mode === 'custom') return draft.interval >= 2;
  if (draft.mode === 'monthly') return draft.day >= 1 && draft.day <= 31;
  return true;
});

function buildRule(): RepeatRule | null {
  switch (draft.mode) {
    case 'none':
      return null;
    case 'daily':
      return { type: 'daily', interval: 1 };
    case 'custom':
      return { type: 'daily', interval: Math.max(2, Math.floor(draft.interval || 2)) };
    case 'weekly':
      return { type: 'weekly', days: [...draft.days] };
    case 'monthly':
      return { type: 'monthly', day: Math.min(31, Math.max(1, Math.floor(draft.day || 1))) };
    default:
      return null;
  }
}

function save() {
  if (!canSave.value) return;
  emit('save', buildRule());
}

function clearRule() {
  emit('save', null);
}

function close() {
  emit('update:open', false);
}

watch(
  () => props.open,
  (v) => {
    if (v) hydrate();
  },
);
</script>

<style scoped>
.sch-modal {
  width: 420px;
  max-width: 92vw;
}
.sch-modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.sch-mode {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.sch-mode-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 12px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
  color: var(--kb-foreground);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}
.sch-mode-item:hover {
  border-color: color-mix(in srgb, var(--kb-primary) 40%, var(--kb-border));
}
.sch-mode-item.is-active {
  background: var(--kb-primary);
  border-color: var(--kb-primary);
  color: #fff;
  font-weight: 600;
}

.sch-field-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sch-inline {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sch-num {
  width: 90px;
}
.sch-unit {
  font-size: 13px;
  color: var(--kb-muted-foreground);
}
.sch-week {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.sch-week-day {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
  color: var(--kb-foreground);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.sch-week-day.is-on {
  background: var(--kb-primary);
  border-color: var(--kb-primary);
  color: #fff;
}
.sch-warn {
  margin: 0;
  font-size: 12px;
  color: var(--kb-warning);
}

.sch-modal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-top: 1px solid var(--kb-border);
  background: var(--kb-card);
}
.sch-foot-right {
  display: flex;
  gap: 8px;
}

.sch-fade-enter-active,
.sch-fade-leave-active {
  transition: opacity 0.18s ease;
}
.sch-fade-enter-from,
.sch-fade-leave-to {
  opacity: 0;
}
</style>
