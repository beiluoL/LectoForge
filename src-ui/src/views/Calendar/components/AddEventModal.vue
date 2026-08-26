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

              <!-- 日期（全天）：触发式按钮 + 定制日历弹窗 -->
              <div>
                <label class="lf-field-label">日期（全天，默认 00:00）</label>
                <button
                  type="button"
                  class="lf-date-trigger"
                  @click="openPicker($event.currentTarget as HTMLElement)"
                >
                  <Icon name="calendar-days" size="md" class="lf-date-trigger-icon" />
                  <span class="lf-date-trigger-text">{{ formatDateLabel(dateModel, true) }}</span>
                  <Icon name="chevron-down" size="sm" class="lf-date-trigger-chevron" />
                </button>
              </div>
              <p class="text-xs" :style="{ color: 'var(--kb-muted-foreground)' }">
                将写入「日程计划 (/schedule)」，并在日历上以灰色全天条目显示；保存到当天若已有同名任务会自动去重。
              </p>
            </template>

            <!-- ============ 日历事件分支 ============ -->
            <template v-else>
              <div>
                <label class="lf-field-label">标题</label>
                <input v-model.trim="form.title" class="kb-input w-full" placeholder="事件标题" required />
              </div>

              <!-- 全天开关：切换时时间选择器平滑切换为“日期”或“日期+时间” -->
              <label class="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" v-model="form.isAllDay" class="accent-[var(--kb-primary)]" />
                <span class="text-sm">全天事件</span>
              </label>

              <!-- 日期 / 日期与时间：触发式按钮 + 定制日历弹窗 -->
              <div>
                <label class="lf-field-label">{{ form.isAllDay ? '日期' : '日期与时间' }}</label>
                <button
                  type="button"
                  class="lf-date-trigger"
                  @click="openPicker($event.currentTarget as HTMLElement)"
                >
                  <Icon :name="form.isAllDay ? 'calendar-days' : 'clock'" size="md" class="lf-date-trigger-icon" />
                  <span class="lf-date-trigger-text">{{ formatDateLabel(dateModel, form.isAllDay) }}</span>
                  <Icon name="chevron-down" size="sm" class="lf-date-trigger-chevron" />
                </button>
              </div>

              <!-- 颜色：6 个预设色圆点，选中以 ring 高亮 -->
              <div>
                <label class="lf-field-label">颜色</label>
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
                <label class="lf-field-label">地点</label>
                <input v-model.trim="form.location" class="kb-input w-full" placeholder="可选" />
              </div>

              <div>
                <label class="lf-field-label">描述</label>
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

  <!-- ============ 定制日期弹窗（Teleport 到 body，fixed 定位锚定触发按钮） ============ -->
  <Teleport to="body">
    <Transition name="lf-pop">
      <div
        v-if="pickerOpen"
        ref="popEl"
        class="lf-date-pop"
        :style="{ position: 'fixed', zIndex: 1100, left: popLeft + 'px', top: popTop + 'px' }"
        @mousedown.self="closePicker"
      >
        <!-- 快捷项：今天 / 明天 / 下周 -->
        <div class="lf-date-quick">
          <button
            v-for="q in quickItems"
            :key="q.label"
            type="button"
            class="lf-date-quick-chip"
            :class="{ 'is-today': q.days === 0 && quickTodayActive }"
            @click="quickPick(q.days)"
          >
            {{ q.label }}
          </button>
        </div>

        <!-- 月份导航 -->
        <div class="lf-date-month">
          <button type="button" class="lf-date-month-nav" aria-label="上个月" @click="shiftMonth(-1)">
            <Icon name="chevron-left" size="sm" />
          </button>
          <span class="lf-date-month-title">{{ viewYear }}年{{ viewMonth + 1 }}月</span>
          <button type="button" class="lf-date-month-nav" aria-label="下个月" @click="shiftMonth(1)">
            <Icon name="chevron-right" size="sm" />
          </button>
        </div>

        <!-- 星期表头（周一为一周起点） -->
        <div class="lf-date-week">
          <span v-for="w in WEEK_LABELS" :key="w" class="lf-date-week-cell">{{ w }}</span>
        </div>

        <!-- 纯 CSS Grid 7 列日历主体 -->
        <div class="lf-date-grid">
          <button
            v-for="cell in cells"
            :key="cell.key"
            type="button"
            class="lf-date-cell"
            :class="{
              'is-muted': cell.monthOffset !== 0,
              'is-selected': cell.isSelected,
              'is-today': cell.isToday,
            }"
            @click="pickDate(cell)"
          >
            {{ cell.day }}
          </button>
        </div>

        <!-- 时间选择区：仅定时模式（日历事件非全天）显示 -->
        <div v-if="showTimePicker" class="lf-date-time">
          <Icon name="clock" size="sm" class="lf-date-time-icon" />
          <input
            v-model="timeStr"
            type="time"
            class="lf-date-time-input"
            aria-label="时间"
          />
        </div>

        <!-- 底部操作：定时模式需点“完成”确认；全天/任务模式选中日期即关闭 -->
        <div v-if="showTimePicker" class="lf-date-actions">
          <button type="button" class="kb-btn kb-btn-sm" @click="closePicker">取消</button>
          <button type="button" class="kb-btn kb-btn-sm kb-btn-primary" @click="confirmPick">完成</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
// 新建 / 编辑弹窗（Teleport 到 body + Transition 淡入）。
// 本次重构（2026-08-26）：
// 1) 彻底移除 @vuepic/vue-datepicker 依赖：日期/日期时间输入改为「触发式按钮 + 定制日历弹窗」——
//    纯 CSS Grid 7 列日历 + 今天/明天/下周快捷 chips + （定时模式）底部时间选择区与「完成」确认，
//    视觉完全走 --kb-* 设计 token，浅色/深色随 data-theme 自动切换，无 dark: 变体、无硬编码色值。
// 2) 交互分流：日程计划任务 / 全天事件 = 只选日期，选中即关闭；定时事件 = 日历 + 时间选择，需点「完成」。
// 3) 数据契约零改动：dateModel 仍是本地 Date，选中日期/时间只改其年月日与时分分量，
//    保存路径（buildEventPayload / saveTask）与 store 调用完全不变。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import dayjs from 'dayjs';
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

/** 日期模型：本地 Date 对象（全天模式 time 部分为 00:00 本地；定时模式携带真实时刻） */
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
    if (props.event) {
      // 编辑：UTC ISO → 本地 Date 回填
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
    closePicker();
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('resize', repositionPop);
});

onUnmounted(() => {
  window.removeEventListener('resize', repositionPop);
});

/* ============ 定制日期弹窗状态 ============ */
const pickerOpen = ref(false);
const popEl = ref<HTMLElement | null>(null);
const popLeft = ref(0);
const popTop = ref(0);
/** 当前日历面板展示的年 / 月（0 基） */
const viewYear = ref(new Date().getFullYear());
const viewMonth = ref(new Date().getMonth());
/** 定时模式下的时间串 HH:mm（仅展示与编辑，确认时写回 dateModel） */
const timeStr = ref('09:00');

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

/** 快捷项（macOS 原生 chip 风格） */
const quickItems = [
  { label: '今天', days: 0 },
  { label: '明天', days: 1 },
  { label: '下周', days: 7 },
];

/** 当前形态是否为“全天”：日程计划任务 / 日历事件全天 */
const isAllDayMode = computed(() => mode.value === 'task' || (mode.value === 'event' && form.value.isAllDay));

/** 是否展示底部时间选择区与「完成」确认（仅定时事件） */
const showTimePicker = computed(() => mode.value === 'event' && !form.value.isAllDay);

/** “今天”快捷项高亮：当前选中日期确实是今天（含时间比较） */
const quickTodayActive = computed(() => {
  const d = dateModel.value;
  return !!d && dateKeyOf(d) === dayjs().format('YYYY-MM-DD');
});

interface DayCell {
  day: number;
  monthOffset: -1 | 0 | 1;
  key: string;
  isToday: boolean;
  isSelected: boolean;
}

/** 42 格（6 行 × 7 列）日历格，周一为一周起点 */
const cells = computed<DayCell[]>(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1);
  const startWeekday = (first.getDay() + 6) % 7; // 周一=0
  const daysInMonth = new Date(viewYear.value, viewMonth.value + 1, 0).getDate();
  const prevDays = new Date(viewYear.value, viewMonth.value, 0).getDate();
  const todayKey = dayjs().format('YYYY-MM-DD');
  const selKey = dateKeyOf(dateModel.value);
  const out: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    let day: number;
    let mo: -1 | 0 | 1;
    if (i < startWeekday) {
      day = prevDays - startWeekday + i + 1;
      mo = -1;
    } else if (i < startWeekday + daysInMonth) {
      day = i - startWeekday + 1;
      mo = 0;
    } else {
      day = i - startWeekday - daysInMonth + 1;
      mo = 1;
    }
    const d = new Date(viewYear.value, viewMonth.value + mo, day);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    out.push({
      day,
      monthOffset: mo,
      key,
      isToday: key === todayKey,
      isSelected: key === selKey,
    });
  }
  return out;
});

/** 打开弹窗：以触发按钮为锚点 fixed 定位 */
async function openPicker(anchor: HTMLElement) {
  const base = dateModel.value ?? new Date();
  viewYear.value = base.getFullYear();
  viewMonth.value = base.getMonth();
  timeStr.value = `${String(base.getHours()).padStart(2, '0')}:${String(base.getMinutes()).padStart(2, '0')}`;
  pickerOpen.value = true;
  await nextTick();
  positionFrom(anchor);
}

function positionFrom(anchor: HTMLElement) {
  const pop = popEl.value;
  if (!pop) return;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const margin = 8;
  // 水平：优先左对齐按钮左缘；右越界则右对齐
  let left = r.left;
  if (left + pw > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - pw - margin);
  // 垂直：优先按钮下方；底部越界则翻到上方
  let top = r.bottom + margin;
  if (top + ph > window.innerHeight - margin) top = Math.max(margin, r.top - ph - margin);
  popLeft.value = Math.round(left);
  popTop.value = Math.round(top);
}

function repositionPop() {
  if (!pickerOpen.value) return;
  // resize 时以当前选中日期所在按钮不可靠，简单重定位到视口右下角安全区即可；
  // 更稳：用上次弹窗位置约束回视口内
  const pop = popEl.value;
  if (!pop) return;
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  popLeft.value = Math.min(popLeft.value, Math.max(8, window.innerWidth - pw - 8));
  popTop.value = Math.min(popTop.value, Math.max(8, window.innerHeight - ph - 8));
}

function shiftMonth(delta: number) {
  const d = new Date(viewYear.value, viewMonth.value + delta, 1);
  viewYear.value = d.getFullYear();
  viewMonth.value = d.getMonth();
}

/** 选中某天：只改 dateModel 的年月日，时间分量保留（全天模式归零） */
function pickDate(cell: DayCell) {
  const d = new Date(viewYear.value, viewMonth.value + cell.monthOffset, cell.day);
  const base = dateModel.value ?? new Date();
  const h = isAllDayMode.value ? 0 : base.getHours();
  const mi = isAllDayMode.value ? 0 : base.getMinutes();
  dateModel.value = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi);
  viewYear.value = d.getFullYear();
  viewMonth.value = d.getMonth();
  // 全天（任务 / 全天事件）：选中即关闭；定时事件：停留在面板等「完成」
  if (isAllDayMode.value) closePicker();
}

/** 快捷项：今天 / 明天 / 下周 */
function quickPick(days: number) {
  const base = dateModel.value ?? new Date();
  const d = dayjs(base).add(days, 'day');
  const h = isAllDayMode.value ? 0 : base.getHours();
  const mi = isAllDayMode.value ? 0 : base.getMinutes();
  dateModel.value = new Date(d.year(), d.month(), d.date(), h, mi);
  viewYear.value = d.year();
  viewMonth.value = d.month();
  if (isAllDayMode.value) closePicker();
}

/** 定时模式「完成」：把时间选择区的时分写回 dateModel 后关闭 */
function confirmPick() {
  const [h, mi] = timeStr.value.split(':').map(Number);
  const base = dateModel.value ?? new Date();
  dateModel.value = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h || 0, mi || 0);
  closePicker();
}

function closePicker() {
  pickerOpen.value = false;
}

/** 触发按钮展示文案：全天 YYYY年M月D日；定时追加 HH:mm */
function formatDateLabel(d: Date | null, allDay: boolean): string {
  const base = d ?? new Date();
  const dateStr = `${base.getFullYear()}年${base.getMonth() + 1}月${base.getDate()}日`;
  if (allDay) return dateStr;
  return `${dateStr} ${String(base.getHours()).padStart(2, '0')}:${String(base.getMinutes()).padStart(2, '0')}`;
}

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

/* 弹层淡入 + 轻微上浮 */
.lf-pop-enter-active,
.lf-pop-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.lf-pop-enter-from,
.lf-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* 表单标签：text-sm + mb-2（替代 kb-label 默认间距，满足新布局） */
.lf-field-label {
  display: block;
  margin-bottom: 8px;
  font-size: var(--kb-fs-body-sm);
  font-weight: 500;
  color: var(--kb-foreground);
}

/* ============ 触发式输入框 ============ */
.lf-date-trigger {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  border: 1px solid transparent;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-muted);
  color: var(--kb-foreground);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.lf-date-trigger:hover {
  background: var(--kb-hover-bg);
}
.lf-date-trigger:focus-visible {
  outline: none;
  border-color: var(--kb-ring);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--kb-ring) 20%, transparent);
}
.lf-date-trigger-icon {
  flex-shrink: 0;
  color: var(--kb-primary);
}
.lf-date-trigger-text {
  flex: 1;
  min-width: 0;
  font-size: var(--kb-fs-body-md);
  font-weight: 500;
  color: var(--kb-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lf-date-trigger-chevron {
  flex-shrink: 0;
  color: var(--kb-muted-foreground);
}

/* ============ 定制日历弹窗 ============ */
.lf-date-pop {
  width: 320px;
  padding: 16px;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-popover);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-lg);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  user-select: none;
  -webkit-user-select: none;
}

/* 快捷 chips（macOS 原生胶囊） */
.lf-date-quick {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}
.lf-date-quick-chip {
  flex: 1;
  padding: 6px 0;
  border: none;
  border-radius: 999px;
  background: var(--kb-muted);
  color: var(--kb-foreground);
  font-size: var(--kb-fs-body-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.lf-date-quick-chip:hover {
  background: var(--kb-hover-bg);
}
/* 今天：高亮主题蓝 */
.lf-date-quick-chip.is-today {
  background: color-mix(in srgb, var(--kb-primary) 14%, transparent);
  color: var(--kb-primary);
  font-weight: 600;
}

/* 月份导航 */
.lf-date-month {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.lf-date-month-title {
  font-size: var(--kb-fs-body-md);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--kb-foreground);
}
.lf-date-month-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--kb-radius-md);
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.lf-date-month-nav:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}

/* 星期表头 */
.lf-date-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  margin-bottom: 4px;
}
.lf-date-week-cell {
  text-align: center;
  font-size: var(--kb-fs-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--kb-muted-foreground);
  padding: 4px 0;
}

/* 纯 CSS Grid 7 列日历主体 */
.lf-date-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.lf-date-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--kb-foreground);
  font-size: var(--kb-fs-body-sm);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.lf-date-cell:hover {
  background: var(--kb-muted);
}
.lf-date-cell.is-muted {
  color: var(--kb-muted-foreground);
}
/* 今日：外圈主题蓝 ring */
.lf-date-cell.is-today {
  box-shadow: inset 0 0 0 1px var(--kb-ring);
}
/* 选中日：主题蓝圆形 + 白字 */
.lf-date-cell.is-selected {
  background: var(--kb-primary);
  color: var(--kb-primary-foreground);
  font-weight: 600;
}
.lf-date-cell.is-selected.is-today {
  box-shadow: inset 0 0 0 2px var(--kb-primary-foreground);
}

/* 时间选择区 */
.lf-date-time {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-muted);
}
.lf-date-time-icon {
  flex-shrink: 0;
  color: var(--kb-primary);
}
.lf-date-time-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--kb-foreground);
  font-size: var(--kb-fs-body-md);
  font-weight: 500;
  outline: none;
}
.lf-date-time-input::-webkit-calendar-picker-indicator {
  opacity: 0.6;
  cursor: pointer;
}

/* 底部操作 */
.lf-date-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
