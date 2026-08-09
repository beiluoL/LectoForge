<template>
  <div class="flex flex-col h-full">
    <!-- 星期表头（周一打头，与 lib/calendar WEEK_START 同步） -->
    <div class="grid grid-cols-7 border-b" :style="{ borderColor: 'var(--kb-border)' }">
      <div
        v-for="w in weekdayLabels"
        :key="w"
        class="py-2 text-center text-xs font-medium"
        :style="{ color: 'var(--kb-muted-foreground)' }"
      >{{ w }}</div>
    </div>

    <!-- 42 格月网格：固定 6 行，翻月高度不跳动 -->
    <div class="grid grid-cols-7 grid-rows-6 flex-1 min-h-0">
      <button
        v-for="cell in cells"
        :key="cell.key"
        type="button"
        class="group relative text-left border-b border-r p-1.5 overflow-hidden transition-colors"
        :class="cell.inMonth ? '' : 'is-out'"
        :style="cellStyle(cell)"
        @click="onCellClick(cell)"
      >
        <!-- 日期数字：今天高亮环 -->
        <div class="flex items-center gap-1 mb-0.5">
          <span
            class="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1 rounded-full text-sm"
            :class="cell.isToday ? 'is-today' : ''"
            :style="dayNumStyle(cell)"
          >{{ cell.dayNum }}</span>
          <span v-if="!cell.inMonth" class="text-[10px]" :style="{ color: 'var(--kb-muted-foreground)' }">
            {{ cell.monthNum }}月
          </span>
        </div>

        <!-- 当日事件列表（最多 3 条，余下 +N） -->
        <div class="space-y-0.5">
          <div
            v-for="ev in visibleEvents(cell.key)"
            :key="ev.id"
            class="event-line truncate rounded px-1 py-0.5 text-[11px] leading-tight cursor-pointer"
            :style="eventLineStyle(ev)"
            :title="ev.title"
            @click.stop="emit('select', ev)"
          >
            <template v-if="ev.isAllDay">📌 {{ ev.title }}</template>
            <template v-else>
              <span class="opacity-80">{{ formatHM(ev.startTime) }}</span> {{ ev.title }}
            </template>
          </div>
          <div
            v-if="overflow(cell.key) > 0"
            class="text-[10px] px-1 cursor-pointer"
            :style="{ color: 'var(--kb-muted-foreground)' }"
            @click.stop="emit('add', cell.key)"
          >+{{ overflow(cell.key) }} 更多</div>
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
import type { CalendarEvent } from '@/api/calendar';

const emit = defineEmits<{
  (e: 'select', ev: CalendarEvent): void;
  (e: 'add', dateKey: string): void;
}>();

const store = useCalendarStore();
const { currentDate, eventsByDate } = storeToRefs(store);

const weekdayLabels = WEEKDAY_LABELS;
const MAX_VISIBLE = 3;

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
    ? 'var(--kb-muted)'
    : cell.isWeekend
    ? 'color-mix(in srgb, var(--kb-card) 92%, var(--kb-muted))'
    : 'var(--kb-card)';
  return { background: bg, borderColor: 'var(--kb-border)' };
}

function dayNumStyle(cell: DayCell): Record<string, string> {
  if (cell.isToday) {
    return {
      background: 'var(--kb-primary)',
      color: '#fff',
      fontWeight: '600',
    };
  }
  return {
    color: cell.inMonth ? 'var(--kb-foreground)' : 'var(--kb-muted-foreground)',
  };
}

/** 事件行样式：全天=实色底白字；定时=浅底 + 左色边 */
function eventLineStyle(ev: CalendarEvent): Record<string, string> {
  if (ev.isAllDay) {
    return { background: ev.color, color: '#fff' };
  }
  return {
    background: `color-mix(in srgb, ${ev.color} 14%, transparent)`,
    color: 'var(--kb-foreground)',
    borderLeft: `3px solid ${ev.color}`,
  };
}

function onCellClick(cell: DayCell) {
  if (!cell.inMonth) {
    // 点击补位格：跳到那个月再开新建，避免把事件建到错误的月份
    store.setCurrentDate(cell.key);
  }
  emit('add', cell.key);
}
</script>
