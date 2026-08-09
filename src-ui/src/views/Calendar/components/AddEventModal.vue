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
          class="w-full max-w-[500px] rounded-xl border p-5 shadow-2xl"
          :style="{ background: 'var(--kb-card)', borderColor: 'var(--kb-border)', color: 'var(--kb-foreground)' }"
        >
          <!-- 标题 -->
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-base font-semibold">
              {{ isEdit ? '编辑事件' : mode === 'task' ? '新建日程计划任务' : '新建事件' }}
            </h2>
            <button type="button" class="wb-icon-btn" @click="close">
              <Icon name="x" size="md" />
            </button>
          </div>

          <!-- 两栏切换：仅在“新建”时显示，把日程计划与日历融合为同一入口 -->
          <div v-if="!isEdit" class="flex gap-2 mb-4 p-1 rounded-lg" :style="{ background: 'var(--kb-muted)' }">
            <button
              type="button"
              class="flex-1 rounded-md py-2 text-sm font-medium transition-colors"
              :style="mode === 'task'
                ? { background: 'var(--kb-card)', color: 'var(--kb-foreground)', boxShadow: 'var(--shadow-sm)' }
                : { color: 'var(--kb-muted-foreground)' }"
              @click="mode = 'task'"
            >
              📋 日程计划任务
            </button>
            <button
              type="button"
              class="flex-1 rounded-md py-2 text-sm font-medium transition-colors"
              :style="mode === 'event'
                ? { background: 'var(--kb-card)', color: 'var(--kb-foreground)', boxShadow: 'var(--shadow-sm)' }
                : { color: 'var(--kb-muted-foreground)' }"
              @click="mode = 'event'"
            >
              📅 日历事件
            </button>
          </div>

          <form class="space-y-3" @submit.prevent="save">
            <!-- ============ 日程计划任务分支 ============ -->
            <template v-if="mode === 'task'">
              <div>
                <label class="kb-label">任务内容</label>
                <textarea
                  v-model.trim="taskForm.title"
                  class="kb-input w-full"
                  rows="2"
                  placeholder="例如：晨间阅读 30 分钟"
                  required
                ></textarea>
              </div>
              <div>
                <label class="kb-label">日期（全天，默认 00:00）</label>
                <VueDatePicker
                  v-model="dateModel"
                  :enable-time-picker="false"
                  format="yyyy-MM-dd"
                  :dark="isDark"
                  auto-apply
                  :clearable="false"
                  :teleport="true"
                  class="lf-datepicker"
                />
              </div>
              <p class="text-xs" :style="{ color: 'var(--kb-muted-foreground)' }">
                将写入「日程计划 (/schedule)」，并在日历上以灰色全天条目显示；保存到当天若已有同名任务会自动去重。
              </p>
            </template>

            <!-- ============ 日历事件分支 ============ -->
            <template v-else>
              <div>
                <label class="kb-label">标题</label>
                <input v-model.trim="form.title" class="kb-input w-full" placeholder="事件标题" required />
              </div>

              <!-- 全天开关：切换时时间选择器平滑切换为“日期”或“日期+时间” -->
              <label class="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" v-model="form.isAllDay" class="accent-[var(--kb-primary)]" />
                <span class="text-sm">全天事件</span>
              </label>

              <div>
                <label class="kb-label">{{ form.isAllDay ? '日期' : '日期与时间' }}</label>
                <VueDatePicker
                  v-model="dateModel"
                  :enable-time-picker="!form.isAllDay"
                  :format="form.isAllDay ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm'"
                  :is-24="true"
                  :dark="isDark"
                  auto-apply
                  :clearable="false"
                  :teleport="true"
                  class="lf-datepicker"
                />
              </div>

              <!-- 颜色：6 个预设色圆点，选中以 ring 高亮 -->
              <div>
                <label class="kb-label">颜色</label>
                <div class="flex items-center gap-3 mt-1">
                  <button
                    v-for="c in colors"
                    :key="c.value"
                    type="button"
                    class="w-6 h-6 rounded-full transition-transform"
                    :style="{
                      background: c.value,
                      transform: form.color === c.value ? 'scale(1.18)' : 'scale(1)',
                      boxShadow: form.color === c.value
                        ? `0 0 0 2px var(--kb-card), 0 0 0 4px ${c.value}66`
                        : 'none',
                    }"
                    :title="c.label"
                    @click="form.color = c.value"
                  ></button>
                </div>
              </div>

              <div>
                <label class="kb-label">地点</label>
                <input v-model.trim="form.location" class="kb-input w-full" placeholder="可选" />
              </div>

              <div>
                <label class="kb-label">描述</label>
                <textarea v-model.trim="form.description" class="kb-input w-full" rows="3" placeholder="可选"></textarea>
              </div>
            </template>

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
// 新建 / 编辑弹窗（Teleport 到 body + Transition 淡入）。
// 本次重构：
// 1) 时间选择从原生 <input type="date/time"> 换成熟悉的 @vuepic/vue-datepicker，
//    全天模式只选日期、定时模式选「日期+时间」，切换 isAllDay 时输入框平滑切换；
// 2) 顶部两栏切换把「日程计划任务」与「日历事件」融合为同一入口——
//    选“日程计划任务”调用 /schedule/batch（服务端按当天+内容去重），选“日历事件”走原 /calendar/events；
// 3) 时区：Datepicker 内部用本地 Date，保存时把本地分量拼成 local 串交给 store.normalizePayload
//    归一化为 UTC ISO；编辑时把后端 UTC ISO 直接 new Date() 解析成本地 Date 回填，避免“少了 8 小时”。
// 单一组件同时覆盖「新建 / 编辑」「任务 / 事件」四种形态。
import { computed, onMounted, ref, watch } from 'vue';
import dayjs from 'dayjs';
import VueDatePicker from '@vuepic/vue-datepicker';
import '@vuepic/vue-datepicker/dist/main.css';
import Icon from '@/components/ui/Icon.vue';
import { useCalendarStore } from '@/store/calendar-store';
import { EVENT_COLORS, DEFAULT_EVENT_COLOR } from '@/lib/calendar';
import { notify } from '@/utils/toast';
import { batchAddTasks } from '@/api/schedule';
import type { CalendarEvent, CreateCalendarEventInput } from '@/api/calendar';

const props = defineProps<{
  open: boolean;
  /** 编辑目标（日历事件）；为空表示新建 */
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
/** 新建时的形态：日程计划任务 / 日历事件（编辑时强制为事件） */
const mode = ref<'event' | 'task'>('event');

/* 暗色跟随全局 data-theme（:root[data-theme='dark']） */
const isDark = ref(false);
function syncTheme() {
  isDark.value = document.documentElement.getAttribute('data-theme') === 'dark';
}

interface EventForm {
  title: string;
  isAllDay: boolean;
  color: string;
  location: string;
  description: string;
}
interface TaskForm {
  title: string;
}

/** 时间选择器模型：本地 Date 对象（vue-datepicker 默认）。
 * 全天模式时其 time 部分为 00:00 本地；定时模式携带真实时刻。 */
const dateModel = ref<Date | null>(null);
const form = ref<EventForm>(emptyEventForm());
const taskForm = ref<TaskForm>({ title: '' });
const saving = ref(false);

function emptyEventForm(): EventForm {
  return { title: '', isAllDay: false, color: DEFAULT_EVENT_COLOR, location: '', description: '' };
}

/** YYYY-MM-DD 串 → 本地 Date（带缺省/指定时刻） */
function parseToDate(date: string, time?: string): Date {
  const base = time ? `${date}T${time}` : `${date}T09:00`;
  const d = new Date(base);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** 本地 Date → YYYY-MM-DD（用本地年月日，绝不用 toISOString，避免跨时区错位） */
function dateKeyOf(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return dayjs().format('YYYY-MM-DD');
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** open / event / 预填项变化时，重新初始化表单 */
watch(
  () => [props.open, props.event, props.defaultDate, props.defaultTime],
  () => {
    if (!props.open) return;
    syncTheme();
    if (props.event) {
      // 编辑：UTC ISO → 本地 Date 回填，Datepicker 自动按本机时区显示
      mode.value = 'event';
      const ev = props.event;
      dateModel.value = new Date(ev.startTime);
      form.value = {
        title: ev.title,
        isAllDay: ev.isAllDay === 1,
        color: ev.color,
        location: ev.location ?? '',
        description: ev.description ?? '',
      };
    } else {
      const d = props.defaultDate || dayjs().format('YYYY-MM-DD');
      dateModel.value = parseToDate(d, props.defaultTime);
      form.value = emptyEventForm();
      taskForm.value = { title: '' };
      // 新建默认回到“日历事件”；用户可在两栏里切到“日程计划任务”
      mode.value = 'event';
    }
  },
  { immediate: true },
);

onMounted(syncTheme);

/** 组装日历事件载荷（本地串，由 store.normalizePayload 转 UTC ISO） */
function buildEventPayload(): CreateCalendarEventInput {
  const d = dateModel.value;
  const dateStr = dateKeyOf(d);
  const base = {
    title: form.value.title,
    color: form.value.color,
    location: form.value.location || null,
    description: form.value.description || null,
  };
  if (form.value.isAllDay) {
    return { ...base, isAllDay: 1, startTime: dateStr, endTime: dateStr };
  }
  const hh = String(d!.getHours()).padStart(2, '0');
  const mi = String(d!.getMinutes()).padStart(2, '0');
  return { ...base, isAllDay: 0, startTime: `${dateStr}T${hh}:${mi}` };
}

async function saveEvent() {
  if (!form.value.title.trim() || !dateModel.value) return;
  saving.value = true;
  try {
    const payload = buildEventPayload();
    if (isEdit.value && props.event) {
      await store.updateEvent(props.event.id, payload);
    } else {
      await store.createEvent(payload);
    }
    emit('saved');
    close();
  } finally {
    saving.value = false;
  }
}

/** 新建日程计划任务：走 /schedule/batch，服务端按 (当天, 内容) 去重 */
async function saveTask() {
  const content = taskForm.value.title.trim();
  if (!content || !dateModel.value) return;
  saving.value = true;
  try {
    const date = dateKeyOf(dateModel.value);
    const res = await batchAddTasks(date, [content]);
    if (!res.created.length) {
      notify('当天已存在同名任务，未重复添加', 'info');
    } else {
      notify('已添加到日程计划', 'success');
    }
    // 日历视图的合并接口现在包含每日任务，重拉当前区间即可显示新条目
    await store.refreshCurrentView();
    emit('saved');
    close();
  } catch (e) {
    notify(e instanceof Error ? e.message : '添加失败', 'error');
  } finally {
    saving.value = false;
  }
}

async function save() {
  if (mode.value === 'task') await saveTask();
  else await saveEvent();
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
