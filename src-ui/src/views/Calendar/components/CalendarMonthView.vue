<template>
  <div class="flex flex-col h-full">
    <!-- 星期表头：紧凑，与网格左边缘严格对齐 -->
    <div
      class="grid grid-cols-7 shrink-0 border-b"
      :style="{ borderColor: 'var(--kb-border)', background: 'var(--kb-card)' }"
    >
      <div
        v-for="w in weekdayLabels"
        :key="w"
        class="py-1.5 text-center text-[11px] font-medium"
        :style="{ color: 'var(--kb-muted-foreground)' }"
      >
        {{ w }}
      </div>
    </div>

    <!-- 42 格月网格：固定 6 行，翻月高度不跳动 -->
    <!-- 父容器负责上/左边框，子格负责下/右边框，避免边框重叠导致 2px -->
    <div
      class="grid grid-cols-7 grid-rows-6 flex-1 min-h-0 border-t border-l"
      :style="{ borderColor: 'var(--kb-border)' }"
    >
      <button
        v-for="cell in cells"
        :key="cell.key"
        type="button"
        class="group relative text-left border-b border-r overflow-hidden transition-colors focus:outline-none"
        :class="cell.inMonth ? 'is-in-month' : 'is-out'"
        :style="cellStyle(cell)"
        @click="onCellClick(cell)"
        @dragover.prevent="onCellDragOver"
        @drop.prevent.stop="onCellDrop(cell)"
      >
        <!-- 日期数字：今天用实心小圆点高亮；节日胶囊（休/班/节名）在数字下方 -->
        <div class="px-1.5 pt-1 pb-0.5 flex items-center gap-1">
          <span
            class="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-semibold tabular-nums"
            :class="cell.isToday ? 'is-today' : ''"
            :style="dayNumStyle(cell)"
          >
            {{ cell.dayNum }}
          </span>
          <span v-if="!cell.inMonth" class="text-[11px]" :style="{ color: 'var(--kb-muted-foreground)' }">
            {{ cell.monthNum }}月
          </span>
        </div>

        <!-- 节日胶囊（法定休红 / 补班橙 / 传统节日蓝），最多 2 个 + 溢出计数 -->
        <div v-if="festivalChips(cell.key).length" class="px-1.5 pb-0.5 flex items-center gap-0.5 flex-wrap">
          <span
            v-for="chip in festivalChips(cell.key)"
            :key="chip.label"
            class="festival-chip"
            :class="chip.tone"
            :title="chip.title"
          >
            {{ chip.label }}
          </span>
        </div>

        <!-- 纪念日 Heart 徽章（粉色，数量 >0 时显示） -->
        <div
          v-if="anniversaryCountOf(cell.key) > 0"
          class="px-1.5 pb-0.5 flex items-center"
          :title="`${anniversaryCountOf(cell.key)} 个纪念日`"
        >
          <Icon name="heart" size="xs" class="festival-heart-icon" />
          <span v-if="anniversaryCountOf(cell.key) > 1" class="festival-heart-count">{{ anniversaryCountOf(cell.key) }}</span>
        </div>

        <!-- 当日事件列表（默认 2 条，点击「+N 更多」展开全部） -->
        <div class="px-1 space-y-0.5">
          <div
            v-for="(ev, i) in visibleEvents(cell.key)"
            :key="eventKey(ev)"
            v-show="i < MAX_VISIBLE || expandedDays[cell.key]"
            class="event-line truncate rounded px-1 py-[1px] text-[11px] leading-tight cursor-pointer"
            :draggable="!isTaskSource(ev)"
            :style="eventLineStyle(ev)"
            :title="ev.title"
            @click.stop="onEventClick(cell.key, ev)"
            @dragstart.stop="onEventDragStart(ev, $event)"
            @dragend="onEventDragEnd"
          >
            <!-- 任务类条目：极简样式（圆点 + 左边框），点击跳转 /tasks -->
            <template v-if="isTaskSource(ev)">
              <span class="ev-dot" :style="{ background: ev.color }"></span>
              <span :class="{ 'line-through opacity-55': ev.taskCompleted === 1 }">{{ ev.title }}</span>
            </template>
            <template v-else-if="ev.isAllDay">📌 {{ ev.title }}</template>
            <template v-else>
              <span class="opacity-80">{{ formatHM(ev.startTime) }}</span> {{ ev.title }}
            </template>
          </div>
          <button
            v-if="dayEvents(cell.key).length > MAX_VISIBLE"
            type="button"
            class="text-[11px] px-1 cursor-pointer hover:underline"
            :style="{ color: 'var(--kb-muted-foreground)' }"
            @click.stop="toggleExpand(cell.key)"
          >
            {{ expandedDays[cell.key] ? '收起' : `+${overflow(cell.key)} 更多` }}
          </button>

          <!-- 纪念日卡片：浅粉背景 + 左侧粉边 + Heart 图标 -->
          <div
            v-for="a in anniversariesOf(cell.key)"
            :key="`anniv-${a.id}`"
            class="anniv-line truncate rounded px-1 py-[1px] text-[11px] leading-tight"
            :title="a.name"
          >
            <Icon name="heart" size="xs" class="anniv-icon" />
            <span>{{ a.name }}</span>
          </div>
        </div>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// 月视图：42 格 CSS Grid（6×7），跨月补位格灰显且不可交互，今天高亮环，
// 事件按「全天 / 定时」两种形态渲染，卡片圆角 + 左边界线。
// 点击空白格 → 在该日新建；点击事件 → 打开详情抽屉；点击「+N 更多」→ 在该日新建。
//
// 性能：事件分组只读 store.eventsByDate（按日索引的派生，避免 42 格各自 filter 一遍 events）。
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useCalendarStore } from '@/store/calendar-store';
import { useCalendarFestivals } from '@/composables/useCalendarFestivals';
import { anniversaryHitsOn, buildMonthMatrix, WEEKDAY_LABELS, type DayCell } from '@/lib/calendar';
import { formatHM } from '@/lib/date';
import { isTaskSource, type Anniversary, type CalendarEvent } from '@/api/calendar';
import type { Festival } from '@/lib/festival';

const emit = defineEmits<{
  (e: 'select', ev: CalendarEvent): void;
  (e: 'add', dateKey: string): void;
  (e: 'selectTask', payload: { taskId: number; date: string }): void;
}>();

const store = useCalendarStore();
const { currentDate, eventsByDate, anniversaries } = storeToRefs(store);

const weekdayLabels = WEEKDAY_LABELS;
const MAX_VISIBLE = 2;
/** 已展开全部事件的日期（点「+N 更多」切换） */
const expandedDays = ref<Record<string, boolean>>({});

/** 节日组合式：每日节日信息（法定/传统/现代/动态） */
const { festivalOf } = useCalendarFestivals(currentDate, storeToRefs(store).viewMode);

/** 某天命中纪念日数量（粉色 Heart 徽章） */
function anniversaryCountOf(key: string): number {
  return anniversaries.value.filter((a) => anniversaryHitsOn(key, a.date, a.repeatRule, a.year)).length;
}

const cells = computed<DayCell[]>(() => buildMonthMatrix(currentDate.value));

function dayEvents(key: string): CalendarEvent[] {
  return eventsByDate.value[key] ?? [];
}
function visibleEvents(key: string): CalendarEvent[] {
  return dayEvents(key);
}
function overflow(key: string): number {
  return Math.max(0, dayEvents(key).length - MAX_VISIBLE);
}

function toggleExpand(key: string): void {
  expandedDays.value[key] = !expandedDays.value[key]
}

/** 节日胶囊（最多 2 个 + 溢出计数）：
 * - 法定休 → 红色「休」；法定班 → 橙色「班」；
 * - 传统/现代节日（observance）→ 主题蓝胶囊显示 shortName（如 中秋 / 母亲节）。
 */
function festivalChips(key: string): { label: string; title: string; tone: 'is-off' | 'is-work' | 'is-observance' }[] {
  const f = festivalOf(key);
  if (!f) return [];
  const chips: { label: string; title: string; tone: 'is-off' | 'is-work' | 'is-observance' }[] = [];
  if (f.type === 'statutory') {
    chips.push({
      label: f.isOffDay ? '休' : '班',
      title: f.name,
      tone: f.isOffDay ? 'is-off' : 'is-work',
    });
    // 法定休的节日名（如春节）额外给一个蓝胶囊（若还有空间）
    if (f.isOffDay && f.shortName !== '休') {
      chips.push({ label: f.shortName, title: f.name, tone: 'is-observance' });
    }
  } else {
    chips.push({ label: f.shortName, title: f.name, tone: 'is-observance' });
  }
  return chips.slice(0, 2);
}

/** 命中的纪念日（每年/每月重复，按名称排序保证稳定） */
function anniversariesOf(key: string): Anniversary[] {
  return anniversaries.value
    .filter((a) => anniversaryHitsOn(key, a.date, a.repeatRule, a.year))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

/** 事件拖拽改期：仅普通事件（任务类来自任务表，不允许拖） */
const dragEv = ref<CalendarEvent | null>(null)

function onEventDragStart(ev: CalendarEvent, e: DragEvent) {
  if (isTaskSource(ev)) return
  dragEv.value = ev
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(ev.id))
  }
}
function onEventDragEnd() {
  dragEv.value = null
}
function onCellDragOver() {
  /* prevent 即允许放置 */
}
function onCellDrop(cell: DayCell) {
  const ev = dragEv.value
  dragEv.value = null
  if (!ev || isTaskSource(ev)) return
  // 目标日 = 落点格日期，保留原开始时刻
  const target = new Date(`${cell.key}T00:00:00`)
  const orig = new Date(ev.startTime)
  target.setHours(orig.getHours(), orig.getMinutes(), orig.getSeconds(), 0)
  const startIso = target.toISOString()
  let endIso: string | null = null
  if (ev.endTime) {
    const durationMs = new Date(ev.endTime).getTime() - orig.getTime()
    endIso = new Date(target.getTime() + Math.max(durationMs, 0)).toISOString()
  }
  void store.updateEvent(ev.id, { startTime: startIso, endTime: endIso })
}

function cellStyle(cell: DayCell): Record<string, string> {
  const bg = !cell.inMonth
    ? 'var(--kb-background)'
    : cell.isWeekend
    ? 'color-mix(in srgb, var(--kb-card) 96%, var(--kb-muted))'
    : 'var(--kb-card)';
  return {
    background: bg,
    borderColor: 'var(--kb-border)',
  };
}

function dayNumStyle(cell: DayCell): Record<string, string> {
  if (cell.isToday) {
    return {
      background: 'var(--kb-primary)',
      color: 'var(--kb-primary-foreground)',
    };
  }
  return {
    color: cell.inMonth ? 'var(--kb-foreground)' : 'var(--kb-muted-foreground)',
  };
}

/**
 * v-for 的 key。
 *
 * 任务类条目的 id 来自 wb_task / wb_daily_task，与 wb_calendar_event 的 id 是
 * **两套自增序列**，直接用 ev.id 必然撞车（日历事件 3 和任务 3 同一天）。
 * 而且一条任务可能同时产出 target 与 due 两条，再带上 sourceType 才唯一。
 */
function eventKey(ev: CalendarEvent): string {
  return isTaskSource(ev) ? `${ev.sourceType}-${ev.taskId}` : `cal-${ev.id}`;
}

/** 事件行样式：
 * - 任务类：以来源色做 12% 柔和底 + 左色边 + 圆点，极简风格，与日历事件明显区分；
 * - 普通事件：全天=实色底白字；定时=浅底 + 左色边。 */
function eventLineStyle(ev: CalendarEvent): Record<string, string> {
  if (isTaskSource(ev)) {
    return {
      background: `color-mix(in srgb, ${ev.color} 12%, transparent)`,
      color: 'var(--kb-foreground)',
      borderLeft: `2px solid ${ev.color}`,
    };
  }
  if (ev.isAllDay) {
    return { background: ev.color, color: '#1A1D23' };
  }
  return {
    background: `color-mix(in srgb, ${ev.color} 12%, transparent)`,
    color: 'var(--kb-foreground)',
    borderLeft: `2px solid ${ev.color}`,
  };
}

/** 事件点击分流：任务类跳 /tasks；普通事件弹详情抽屉 */
function onEventClick(dateKey: string, ev: CalendarEvent) {
  if (isTaskSource(ev) && ev.taskId != null) {
    emit('selectTask', { taskId: ev.taskId, date: dateKey });
  } else {
    emit('select', ev);
  }
}

function onCellClick(cell: DayCell) {
  if (!cell.inMonth) {
    // 点击补位格：跳到那个月再开新建，避免把事件建到错误的月份
    store.setCurrentDate(cell.key);
  }
  emit('add', cell.key);
}
</script>

<style scoped>
/* hover：当月格悬停时轻微加深，补位格不响应 */
.is-in-month:hover {
  background: color-mix(in srgb, var(--kb-muted) 35%, var(--kb-card)) !important;
}
.is-out:hover {
  background: color-mix(in srgb, var(--kb-border) 25%, var(--kb-background)) !important;
}
.event-line:hover {
  filter: brightness(0.96);
}

/* 日程计划任务前面的小灰点 */
.ev-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--kb-muted-foreground) 65%, transparent);
  margin-right: 4px;
  vertical-align: middle;
}

/* 节日胶囊：极小字号、圆角、不干扰事件行 */
.festival-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 15px;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  flex-shrink: 0;
  max-width: 48px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* 休：红粉底白字（法定休息日） */
.festival-chip.is-off {
  background: color-mix(in srgb, var(--kb-destructive) 82%, transparent);
  color: var(--kb-destructive-foreground);
}
/* 班：橙底深字（调休补班，用橙色避免误读为休息） */
.festival-chip.is-work {
  background: color-mix(in srgb, var(--kb-warning) 26%, transparent);
  color: var(--kb-warning-foreground);
}
/* 传统/现代节日：主题蓝软底蓝字 */
.festival-chip.is-observance {
  background: var(--kb-primary-soft);
  color: var(--kb-primary);
}

/* 纪念日 Heart 徽章：粉色图标 + 数量 */
.festival-heart-icon {
  flex-shrink: 0;
  color: var(--kb-chart-5);
}
.festival-heart-count {
  margin-left: 2px;
  font-size: 9px;
  font-weight: 600;
  color: var(--kb-chart-5);
}

/* 纪念日卡片：浅粉底 + 左侧粉边 + Heart 小图标（与事件明显区分）。
   粉色走 --kb-chart-5（#EC4899，色板第五档），软底/边用 color-mix 派生 */
.anniv-line {
  display: flex;
  align-items: center;
  gap: 3px;
  background: var(--kb-chart-5-soft);
  color: var(--kb-foreground);
  border-left: 2px solid var(--kb-chart-5);
  margin-top: 1px;
}
.anniv-icon {
  flex-shrink: 0;
  color: var(--kb-chart-5);
}
</style>
