<template>
  <Teleport to="body">
    <Transition name="lf-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-[1000] flex items-center justify-center p-4"
        :style="{ background: 'rgba(0,0,0,0.45)' }"
        @click.self="close"
      >
        <div
          class="w-full max-w-md rounded-xl border p-5 shadow-2xl"
          :style="{ background: 'var(--kb-card)', borderColor: 'var(--kb-border)', color: 'var(--kb-foreground)' }"
        >
          <!-- 标题 -->
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-base font-semibold">{{ isEdit ? '编辑事件' : '新建事件' }}</h2>
            <button type="button" class="wb-icon-btn" @click="close">
              <Icon name="x" size="md" />
            </button>
          </div>

          <form class="space-y-3" @submit.prevent="save">
            <!-- 标题 -->
            <div>
              <label class="kb-label">标题</label>
              <input v-model.trim="form.title" class="kb-input w-full" placeholder="事件标题" required />
            </div>

            <!-- 全天开关 -->
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" v-model="form.isAllDay" class="accent-[var(--kb-primary)]" />
              <span class="text-sm">全天事件</span>
            </label>

            <!-- 日期 / 时间 -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="kb-label">{{ form.isAllDay ? '开始日期' : '开始日期' }}</label>
                <input type="date" v-model="form.startDate" class="kb-input w-full" required />
              </div>
              <div v-if="!form.isAllDay">
                <label class="kb-label">开始时间</label>
                <input type="time" v-model="form.startTime" class="kb-input w-full" />
              </div>
              <div>
                <label class="kb-label">{{ form.isAllDay ? '结束日期' : '结束日期' }}</label>
                <input type="date" v-model="form.endDate" class="kb-input w-full" :required="form.isAllDay" />
              </div>
              <div v-if="!form.isAllDay">
                <label class="kb-label">结束时间</label>
                <input type="time" v-model="form.endTime" class="kb-input w-full" />
              </div>
            </div>

            <!-- 颜色 -->
            <div>
              <label class="kb-label">颜色</label>
              <div class="flex items-center gap-2 mt-1">
                <button
                  v-for="c in colors"
                  :key="c.value"
                  type="button"
                  class="w-6 h-6 rounded-full border-2 transition-transform"
                  :style="{
                    background: c.value,
                    borderColor: form.color === c.value ? 'var(--kb-foreground)' : 'transparent',
                    transform: form.color === c.value ? 'scale(1.15)' : 'scale(1)',
                  }"
                  :title="c.label"
                  @click="form.color = c.value"
                ></button>
              </div>
            </div>

            <!-- 地点 -->
            <div>
              <label class="kb-label">地点</label>
              <input v-model.trim="form.location" class="kb-input w-full" placeholder="可选" />
            </div>

            <!-- 描述 -->
            <div>
              <label class="kb-label">描述</label>
              <textarea v-model.trim="form.description" class="kb-input w-full" rows="3" placeholder="可选"></textarea>
            </div>

            <!-- 操作 -->
            <div class="flex items-center justify-end gap-2 pt-2">
              <button type="button" class="kb-btn" @click="close">取消</button>
              <button type="submit" class="kb-btn kb-btn-primary" :disabled="saving">
                {{ saving ? '保存中…' : '保存' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
// 新建 / 编辑事件弹窗（Teleport 到 body + Transition 淡入）。
// 单一组件同时覆盖「新建」与「编辑」两种形态：传入 event 走 PUT，否则走 POST。
// 时间拼接规则：定时事件拼成本地 datetime-local 串（YYYY-MM-DDTHH:mm），
// 全天事件只传日期——两者都交给 store.normalizePayload 统一转成库里要的 UTC ISO。
import { ref, watch, computed } from 'vue';
import dayjs from 'dayjs';
import Icon from '@/components/ui/Icon.vue';
import { useCalendarStore } from '@/store/calendar-store';
import { EVENT_COLORS, DEFAULT_EVENT_COLOR } from '@/lib/calendar';
import type { CalendarEvent, CreateCalendarEventInput } from '@/api/calendar';

const props = defineProps<{
  open: boolean;
  /** 编辑目标；为空表示新建 */
  event?: CalendarEvent | null;
  /** 新建时预填的日期键 YYYY-MM-DD */
  defaultDate?: string;
  /** 新建时预填的起始时刻 HH:mm（时间轴点击带出） */
  defaultTime?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved'): void;
}>();

const store = useCalendarStore();
const colors = EVENT_COLORS;

const isEdit = computed(() => !!props.event);

interface FormState {
  title: string;
  isAllDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  color: string;
  location: string;
  description: string;
}
const form = ref<FormState>(emptyForm());
const saving = ref(false);

function emptyForm(): FormState {
  const today = dayjs().format('YYYY-MM-DD');
  return {
    title: '',
    isAllDay: false,
    startDate: today,
    startTime: '09:00',
    endDate: today,
    endTime: '10:00',
    color: DEFAULT_EVENT_COLOR,
    location: '',
    description: '',
  };
}

/** open / event / 预填项变化时，重新初始化表单 */
watch(
  () => [props.open, props.event, props.defaultDate, props.defaultTime],
  () => {
    if (!props.open) return;
    if (props.event) {
      const ev = props.event;
      const s = dayjs(ev.startTime);
      const e = ev.endTime ? dayjs(ev.endTime) : null;
      form.value = {
        title: ev.title,
        isAllDay: ev.isAllDay === 1,
        startDate: s.format('YYYY-MM-DD'),
        startTime: s.format('HH:mm'),
        endDate: e ? e.format('YYYY-MM-DD') : s.format('YYYY-MM-DD'),
        endTime: e ? e.format('HH:mm') : s.format('HH:mm'),
        color: ev.color,
        location: ev.location ?? '',
        description: ev.description ?? '',
      };
    } else {
      const d = props.defaultDate || dayjs().format('YYYY-MM-DD');
      form.value = {
        ...emptyForm(),
        startDate: d,
        endDate: d,
        startTime: props.defaultTime || '09:00',
      };
    }
  },
  { immediate: true },
);

/** 组装成 store 能吃的载荷（本地串，由 store 转 UTC ISO） */
function buildPayload(): CreateCalendarEventInput {
  const f = form.value;
  if (f.isAllDay) {
    return {
      title: f.title,
      isAllDay: 1,
      startTime: f.startDate,
      endTime: f.endDate,
      color: f.color,
      location: f.location || null,
      description: f.description || null,
    };
  }
  const payload: CreateCalendarEventInput = {
    title: f.title,
    isAllDay: 0,
    startTime: `${f.startDate}T${f.startTime || '00:00'}`,
    color: f.color,
    location: f.location || null,
    description: f.description || null,
  };
  if (f.endDate && f.endTime) {
    payload.endTime = `${f.endDate}T${f.endTime}`;
  }
  return payload;
}

async function save() {
  if (!form.value.title) return;
  saving.value = true;
  try {
    if (isEdit.value && props.event) {
      await store.updateEvent(props.event.id, buildPayload());
    } else {
      await store.createEvent(buildPayload());
    }
    emit('saved');
    close();
  } finally {
    saving.value = false;
  }
}

function close() {
  emit('close');
}
</script>

<style scoped>
.lf-fade-enter-active,
.lf-fade-leave-active {
  transition: opacity 0.18s ease;
}
.lf-fade-enter-from,
.lf-fade-leave-to {
  opacity: 0;
}
</style>
