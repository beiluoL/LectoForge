<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- 顶部：星期/日期表头 + 全天事件条 -->
    <div class="flex border-b sticky top-0 z-10" :style="{ borderColor: 'var(--kb-border)', background: 'var(--kb-card)' }">
      <!-- 左侧时间轴占位 -->
      <div class="shrink-0 border-r" :style="{ width: GUTTER + 'px', borderColor: 'var(--kb-border)' }"></div>

      <div class="flex flex-1">
        <div
          v-for="cell in cells"
          :key="cell.key"
          class="flex-1 min-w-[110px] border-r p-2"
          :class="cell.isToday ? 'is-today-col' : ''"
          :style="dayHeaderStyle(cell)"
        >
          <div class="text-xs" :style="{ color: 'var(--kb-muted-foreground)' }">{{ cell.weekdayLabel }}</div>
          <div class="text-base font-semibold" :style="{ color: 'var(--kb-foreground)' }">{{ cell.dayNum }}</div>

          <!-- 全天事件 -->
          <div class="mt-1 space-y-0.5">
            <div
              v-for="ev in allDayOf(cell.key)"
              :key="ev.sourceType === 'daily_task' ? 'dt-' + ev.taskId : ev.id"
              class="truncate rounded px-1 py-0.5 text-[11px] cursor-pointer"
              :class="ev.sourceType === 'daily_task' ? 'dt-task-line' : 'text-white'"
              :style="ev.sourceType === 'daily_task' ? dailyTaskLineStyle : { background: ev.color }"
              :title="ev.title"
              @click.stop="onEventClick(cell.key, ev)"
            ><template v-if="ev.sourceType === 'daily_task'"><span class="dt-dot"></span>{{ ev.title }}</template><template v-else>📌 {{ ev.title }}</template></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 主体：时间轴 + 日列 -->
    <div class="flex-1 overflow-y-auto min-h-0">
      <div class="flex">
        <!-- 左侧小时刻度 -->
        <div class="shrink-0 border-r" :style="{ width: GUTTER + 'px', borderColor: 'var(--kb-border)' }">
          <div
            v-for="h in 24"
            :key="h"
            class="relative text-right pr-2 text-[10px]"
            :style="{ height: HOUR_H + 'px', color: 'var(--kb-muted-foreground)' }"
          >
            <span v-if="h > 1" class="absolute -top-2 right-2">{{ String(h - 1).padStart(2, '0') }}:00</span>
          </div>
        </div>

        <!-- 日列区 -->
        <div class="flex flex-1">
          <div
            v-for="cell in cells"
            :key="cell.key"
            class="relative flex-1 min-w-[110px] border-r"
            :style="{ borderColor: 'var(--kb-border)', height: totalH + 'px' }"
            @click="onColumnClick(cell, $event)"
          >
            <!-- 24 条小时网格线 -->
            <div
              v-for="h in 24"
              :key="h"
              class="absolute left-0 right-0 border-t pointer-events-none"
              :style="{ top: (h - 1) * HOUR_H + 'px', borderColor: 'var(--kb-border)', opacity: h === 1 ? 0 : 0.6 }"
            ></div>

            <!-- 定时事件（绝对定位） -->
            <div
              v-for="pos in timedOf(cell.key)"
              :key="pos.ev.sourceType === 'daily_task' ? 'dt-' + pos.ev.taskId : pos.ev.id"
              class="absolute left-1 right-1 rounded px-1.5 py-0.5 text-[11px] overflow-hidden cursor-pointer shadow-sm"
              :style="timedStyle(pos)"
              :title="pos.ev.title"
              @click.stop="onEventClick(cell.key, pos.ev)"
            >
              <div class="font-medium truncate" style="color:#fff">{{ pos.ev.title }}</div>
              <div class="opacity-90 truncate" style="color:#fff">{{ formatHM(pos.ev.startTime) }}–{{ formatHM(pos.ev.endTime || pos.ev.startTime) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// 周 / 日 共用的时间轴视图。
// - 左侧固定小时刻度（00:00–23:00），右侧每列一天；日视图只有 1 列、周视图 7 列。
// - 全天事件渲染在顶部条；定时事件按「当日可见区间」绝对定位到对应像素（跨天事件会在多列各自截断显示）。
// - 点击空白时间格 → 以落点时刻为起点新建事件（emit add，携带 dateKey + 起始 HH:mm）。
//
// 性能：事件分组只读 store.eventsByDate（按日索引派生），不重复遍历 events 数组。
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import dayjs from 'dayjs';
import { useCalendarStore } from '@/store/calendar-store';
import { buildCells, type DayCell } from '@/lib/calendar';
import { formatHM } from '@/lib/date';
import type { CalendarEvent } from '@/api/calendar';

const emit = defineEmits<{
  (e: 'select', ev: CalendarEvent): void;
  (e: 'add', payload: { dateKey: string; time?: string }): void;
  (e: 'selectTask', payload: { taskId: number; date: string }): void;
}>();

const store = useCalendarStore();
const { currentDate, viewMode, eventsByDate } = storeToRefs(store);

const HOUR_H = 44; // 每小时像素高
const GUTTER = 52; // 左侧时间轴宽度
const totalH = 24 * HOUR_H;

const cells = computed<DayCell[]>(() => buildCells(currentDate.value, viewMode.value));

function dayEvents(key: string): CalendarEvent[] {
  return eventsByDate.value[key] ?? [];
}
function allDayOf(key: string): CalendarEvent[] {
  return dayEvents(key).filter((e) => e.isAllDay === 1);
}
interface TimedPos {
  ev: CalendarEvent;
  top: number;
  height: number;
}
function timedOf(key: string): TimedPos[] {
  const dayStart = dayjs(key).startOf('day');
  const dayEnd = dayStart.add(1, 'day');
  return dayEvents(key)
    .filter((e) => e.isAllDay !== 1)
    .map((ev) => {
      const s = dayjs(ev.startTime);
      const e = ev.endTime ? dayjs(ev.endTime) : s;
      const vs = s.isBefore(dayStart) ? dayStart : s;
      const ve = e.isAfter(dayEnd) ? dayEnd : e;
      const startMin = vs.diff(dayStart, 'minute');
      const durMin = Math.max(ve.diff(vs, 'minute'), 20);
      return { ev, top: (startMin / 1440) * totalH, height: (durMin / 1440) * totalH };
    });
}

function dayHeaderStyle(cell: DayCell): Record<string, string> {
  return cell.isToday
    ? { background: 'color-mix(in srgb, var(--kb-primary) 10%, transparent)' }
    : {};
}

function timedStyle(pos: TimedPos): Record<string, string> {
  // 每日任务不会以定时形态出现（全是全天），这里仅作防御性分支
  if (pos.ev.sourceType === 'daily_task') {
    return {
      top: pos.top + 'px',
      height: pos.height + 'px',
      background: 'color-mix(in srgb, #B0B0B0 14%, transparent)',
      color: 'var(--kb-foreground)',
      borderLeft: '3px solid #B0B0B0',
    };
  }
  return {
    top: pos.top + 'px',
    height: pos.height + 'px',
    background: pos.ev.color,
  };
}

/** 每日任务的极简条样式（灰色，与日历事件区分） */
const dailyTaskLineStyle: Record<string, string> = {
  background: 'color-mix(in srgb, #B0B0B0 14%, transparent)',
  color: 'var(--kb-foreground)',
  borderLeft: '3px solid #B0B0B0',
};

/** 事件点击分流：每日任务跳 /schedule；普通事件弹详情抽屉 */
function onEventClick(dateKey: string, ev: CalendarEvent) {
  if (ev.sourceType === 'daily_task' && ev.taskId != null) {
    emit('selectTask', { taskId: ev.taskId, date: dateKey });
  } else {
    emit('select', ev);
  }
}

/** 点击时间格空白处：用落点 y 推算起始时刻（按 30 分钟吸附），向上抛给 index 打开新建 */
function onColumnClick(cell: DayCell, ev: MouseEvent) {
  const target = ev.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const y = ev.clientY - rect.top;
  const minute = Math.round((y / HOUR_H) * 60 / 30) * 30;
  const hh = String(Math.floor(minute / 60)).padStart(2, '0');
  const mm = String(minute % 60).padStart(2, '0');
  emit('add', { dateKey: cell.key, time: `${hh}:${mm}` });
}
</script>

<style scoped>
/* 时间轴视图里的「日程计划任务」极简条 */
.dt-task-line {
  display: flex;
  align-items: center;
}
.dt-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: #b0b0b0;
  margin-right: 4px;
  flex: none;
}
</style>

