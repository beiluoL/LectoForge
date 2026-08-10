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
      >
        <!-- 日期数字：今天用实心小圆点高亮 -->
        <div class="flex items-center gap-1 px-1.5 pt-1 pb-0.5">
          <span
            class="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-semibold tabular-nums"
            :class="cell.isToday ? 'is-today' : ''"
            :style="dayNumStyle(cell)"
          >
            {{ cell.dayNum }}
          </span>
          <span v-if="!cell.inMonth" class="text-[10px]" :style="{ color: 'var(--kb-muted-foreground)' }">
            {{ cell.monthNum }}月
          </span>
        </div>

        <!-- 当日事件列表（最多 4 条，余下 +N） -->
        <div class="px-1 space-y-0.5">
          <div
            v-for="ev in visibleEvents(cell.key)"
            :key="eventKey(ev)"
            class="event-line truncate rounded px-1 py-[1px] text-[11px] leading-tight cursor-pointer"
            :style="eventLineStyle(ev)"
            :title="ev.title"
            @click.stop="onEventClick(cell.key, ev)"
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
          <div
            v-if="overflow(cell.key) > 0"
            class="text-[10px] px-1 cursor-pointer hover:underline"
            :style="{ color: 'var(--kb-muted-foreground)' }"
            @click.stop="emit('add', cell.key)"
          >
            +{{ overflow(cell.key) }} 更多
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
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useCalendarStore } from '@/store/calendar-store';
import { buildMonthMatrix, WEEKDAY_LABELS, type DayCell } from '@/lib/calendar';
import { formatHM } from '@/lib/date';
import { isTaskSource, type CalendarEvent } from '@/api/calendar';

const emit = defineEmits<{
  (e: 'select', ev: CalendarEvent): void;
  (e: 'add', dateKey: string): void;
  (e: 'selectTask', payload: { taskId: number; date: string }): void;
}>();

const store = useCalendarStore();
const { currentDate, eventsByDate } = storeToRefs(store);

const weekdayLabels = WEEKDAY_LABELS;
const MAX_VISIBLE = 4;

const cells = computed<DayCell[]>(() => buildMonthMatrix(currentDate.value));

function dayEvents(key: string): CalendarEvent[] {
  return eventsByDate.value[key] ?? [];
}
function visibleEvents(key: string): CalendarEvent[] {
  return dayEvents(key).slice(0, MAX_VISIBLE);
}
function overflow(key: string): number {
  return Math.max(0, dayEvents(key).length - MAX_VISIBLE);
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
      color: '#fff',
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
    return { background: ev.color, color: '#fff' };
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

/* 日程计划任务前面的小灰点 */
.ev-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: #b0b0b0;
  margin-right: 4px;
  vertical-align: middle;
}
</style>
