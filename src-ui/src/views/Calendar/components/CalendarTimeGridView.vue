<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- 顶部：星期/日期表头 + 全天事件条 -->
    <div
      class="flex border-b shrink-0"
      :style="{ borderColor: 'var(--kb-border)', background: 'var(--kb-card)' }"
    >
      <!-- 左侧时间轴占位 -->
      <div
        class="shrink-0 border-r"
        :style="{ width: GUTTER + 'px', borderColor: 'var(--kb-border)' }"
      ></div>

      <div class="flex flex-1">
        <div
          v-for="cell in cells"
          :key="cell.key"
          class="flex-1 min-w-[100px] border-r py-1.5 px-1"
          :class="cell.isToday ? 'is-today-col' : ''"
          :style="dayHeaderStyle(cell)"
        >
          <div class="text-center">
            <div class="text-[11px]" :style="{ color: 'var(--kb-muted-foreground)' }">
              {{ cell.weekdayLabel }}
            </div>
            <div class="inline-flex items-center justify-center gap-1 mt-0.5">
              <!-- 今日：主题色圆形；若恰逢节日，圆环色跟随节日（红/橙） -->
              <span
                class="inline-flex items-center justify-center w-6 h-6 rounded-full text-sm font-semibold tabular-nums"
                :style="dayNumStyle(cell)"
              >
                {{ cell.dayNum }}
              </span>
              <!-- 节日名称（带图标）：18 周三 中秋 -->
              <span
                v-if="festivalOf(cell.key)"
                class="festival-label"
                :class="festivalToneClass(cell.key)"
                :title="festivalOf(cell.key)!.name"
              >
                <Icon :name="festivalOf(cell.key)!.icon || 'sparkles'" size="xs" />
                {{ festivalOf(cell.key)!.shortName }}
              </span>
            </div>
            <!-- 纪念日 Heart 徽章 -->
            <div
              v-if="anniversaryCountOf(cell.key) > 0"
              class="mt-0.5 inline-flex items-center gap-0.5"
              :title="`${anniversaryCountOf(cell.key)} 个纪念日`"
            >
              <Icon name="heart" size="xs" class="festival-heart-icon" />
              <span v-if="anniversaryCountOf(cell.key) > 1" class="festival-heart-count">{{ anniversaryCountOf(cell.key) }}</span>
            </div>
          </div>

          <!-- 全天事件：按需渲染，没有时占 0 高度 -->
          <div v-if="allDayCount(cell.key) > 0" class="mt-1 space-y-[2px]">
            <div
              v-for="ev in allDayOf(cell.key)"
              :key="eventKey(ev)"
              class="truncate rounded px-1 py-[1px] text-[11px] cursor-pointer"
              :class="[isTaskSource(ev) ? 'dt-task-line' : 'dt-event-chip', ev.taskCompleted === 1 ? 'line-through opacity-55' : '']"
              :style="isTaskSource(ev) ? taskLineStyle(ev) : { background: ev.color }"
              :title="ev.title"
              @click.stop="onEventClick(cell.key, ev)"
            >
              <template v-if="isTaskSource(ev)">
                <span class="dt-dot" :style="{ background: ev.color }"></span>{{ ev.title }}
              </template>
              <template v-else>📌 {{ ev.title }}</template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 主体：时间轴 + 日列 -->
    <div class="flex-1 overflow-y-auto min-h-0 relative">
      <div class="flex">
        <!-- 左侧小时刻度 -->
        <div
          class="shrink-0 border-r"
          :style="{ width: GUTTER + 'px', borderColor: 'var(--kb-border)' }"
        >
          <div
            v-for="h in 24"
            :key="h"
            class="relative text-right pr-2 text-[11px]"
            :style="{ height: HOUR_H + 'px', color: 'var(--kb-muted-foreground)' }"
          >
            <span v-if="h > 1" class="absolute -top-2 right-2 tabular-nums">{{ String(h - 1).padStart(2, '0') }}:00</span>
          </div>
        </div>

        <!-- 日列区 -->
        <div class="flex flex-1 relative">
          <div
            v-for="cell in cells"
            :key="cell.key"
            class="relative flex-1 min-w-[100px] border-r"
            :style="columnStyle(cell)"
            @click="onColumnClick(cell, $event)"
          >
            <!-- 24 条小时网格线 -->
            <div
              v-for="h in 24"
              :key="h"
              class="absolute left-0 right-0 border-t pointer-events-none"
              :style="{ top: (h - 1) * HOUR_H + 'px', borderColor: 'var(--kb-border)', opacity: h === 1 ? 0 : 0.45 }"
            ></div>

            <!-- 定时事件（绝对定位） -->
            <div
              v-for="pos in timedOf(cell.key)"
              :key="eventKey(pos.ev)"
              class="absolute left-1 right-1 rounded px-1.5 py-[1px] text-[11px] overflow-hidden cursor-pointer shadow-sm"
              :style="timedStyle(pos)"
              :title="pos.ev.title"
              @click.stop="onEventClick(cell.key, pos.ev)"
            >
              <div class="font-medium truncate" style="color:#1A1D23">{{ pos.ev.title }}</div>
              <div class="opacity-90 truncate text-[11px]" style="color:#1A1D23">{{ formatHM(pos.ev.startTime) }}–{{ formatHM(pos.ev.endTime || pos.ev.startTime) }}</div>
            </div>
          </div>

          <!-- 当前时间红线：跨列悬浮，仅在当前视图包含今天时显示 -->
          <div
            v-if="currentTimeVisible"
            class="pointer-events-none absolute left-0 right-0 z-10"
            :style="{ top: currentTimeTop + 'px' }"
          >
            <div class="relative w-full h-px" :style="{ background: 'var(--kb-destructive)' }">
              <span
                class="absolute -left-[5px] -top-[2.5px] w-[5px] h-[5px] rounded-full"
                :style="{ background: 'var(--kb-destructive)' }"
              ></span>
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
// - 全天事件渲染在顶部条，无全天事件时表头高度自动收缩。
// - 定时事件按「当日可见区间」绝对定位到对应像素（跨天事件会在多列各自截断显示）。
// - 新增当前时间红线，帮助快速定位「现在」。
// - 点击空白时间格 → 以落点时刻为起点新建事件（emit add，携带 dateKey + 起始 HH:mm）。
//
// 性能：事件分组只读 store.eventsByDate（按日索引派生），不重复遍历 events 数组。
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import dayjs from 'dayjs';
import { useCalendarStore } from '@/store/calendar-store';
import { useCalendarFestivals } from '@/composables/useCalendarFestivals';
import { anniversaryHitsOn, buildCells, type DayCell } from '@/lib/calendar';
import { formatHM } from '@/lib/date';
import { isTaskSource, type Anniversary, type CalendarEvent } from '@/api/calendar';

const emit = defineEmits<{
  (e: 'select', ev: CalendarEvent): void;
  (e: 'add', payload: { dateKey: string; time?: string }): void;
  (e: 'selectTask', payload: { taskId: number; date: string }): void;
}>();

const store = useCalendarStore();
const { currentDate, viewMode, eventsByDate, anniversaries } = storeToRefs(store);

const HOUR_H = 40; // 每小时像素高（紧凑）
const GUTTER = 48; // 左侧时间轴宽度
const totalH = 24 * HOUR_H;

const cells = computed<DayCell[]>(() => buildCells(currentDate.value, viewMode.value));

/** 节日组合式：每日节日信息（法定/传统/现代/动态） */
const { festivalOf } = useCalendarFestivals(currentDate, viewMode);

/** 某天命中纪念日数量（粉色 Heart 徽章） */
function anniversaryCountOf(key: string): number {
  return anniversaries.value.filter((a) => anniversaryHitsOn(key, a.date, a.repeatRule, a.year)).length;
}

/** 节日名称的 tone class：法定休红 / 补班橙 / 传统节日主题蓝 */
function festivalToneClass(key: string): string {
  const f = festivalOf(key);
  if (!f) return '';
  if (f.type === 'statutory') return f.isOffDay ? 'is-off' : 'is-work';
  return 'is-observance';
}

/** 今日高亮圆环：恰逢节日时边框跟随节日色（红/橙），否则主题蓝 */
function dayNumStyle(cell: DayCell): Record<string, string> {
  if (!cell.isToday) {
    return { color: 'var(--kb-foreground)' };
  }
  const f = festivalOf(cell.key);
  if (f?.type === 'statutory') {
    const ring = f.isOffDay ? 'var(--kb-destructive)' : 'var(--kb-warning)';
    return {
      background: 'var(--kb-primary)',
      color: 'var(--kb-primary-foreground)',
      boxShadow: `inset 0 0 0 2px ${ring}`,
    };
  }
  return { background: 'var(--kb-primary)', color: 'var(--kb-primary-foreground)' };
}

/** 日列背景：法定休 → 极浅红铺底；今天 → 主题蓝 3% */
function columnStyle(cell: DayCell): Record<string, string> {
  const base: Record<string, string> = { borderColor: 'var(--kb-border)', height: totalH + 'px' };
  const f = festivalOf(cell.key);
  if (f?.type === 'statutory' && f.isOffDay) {
    base.background = 'color-mix(in srgb, var(--kb-destructive) 5%, transparent)';
    return base;
  }
  if (cell.isToday) {
    base.background = 'color-mix(in srgb, var(--kb-primary) 3%, transparent)';
  }
  return base;
}

function dayEvents(key: string): CalendarEvent[] {
  return eventsByDate.value[key] ?? [];
}
function allDayOf(key: string): CalendarEvent[] {
  return dayEvents(key).filter((e) => e.isAllDay === 1);
}
function allDayCount(key: string): number {
  return allDayOf(key).length;
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

/** 节假日标签：休（红粉胶囊）/ 班（橙灰胶囊）；无节假日返回空串不渲染 */
function dayHeaderStyle(cell: DayCell): Record<string, string> {
  return cell.isToday
    ? { background: 'color-mix(in srgb, var(--kb-primary) 8%, transparent)', borderColor: 'var(--kb-border)' }
    : { borderColor: 'var(--kb-border)' };
}

function timedStyle(pos: TimedPos): Record<string, string> {
  // 任务类来源通常是全天形态，这里仅作防御性分支：万一以定时形态出现，
  // 也用其来源色（柔和底 + 左条），与月视图的渲染口径一致。
  if (isTaskSource(pos.ev)) {
    return {
      top: pos.top + 'px',
      height: pos.height + 'px',
      ...taskLineStyle(pos.ev),
    };
  }
  return {
    top: pos.top + 'px',
    height: pos.height + 'px',
    background: pos.ev.color,
  };
}

/** 任务类来源（daily_task / task / task_due）的极简条样式：用来源色柔和化，与普通事件区分 */
function taskLineStyle(ev: CalendarEvent): Record<string, string> {
  return {
    background: `color-mix(in srgb, ${ev.color} 14%, transparent)`,
    color: 'var(--kb-foreground)',
    borderLeft: `3px solid ${ev.color}`,
  };
}

/** 事件点击分流：任务类来源（daily_task / task / task_due）跳 /tasks；普通事件弹详情抽屉 */
function onEventClick(dateKey: string, ev: CalendarEvent) {
  if (isTaskSource(ev) && ev.taskId != null) {
    emit('selectTask', { taskId: ev.taskId, date: dateKey });
  } else {
    emit('select', ev);
  }
}

/** 日历事件唯一 key：任务类用「来源+任务 id」（去重且跨天稳定），普通事件用 id */
function eventKey(ev: CalendarEvent): string {
  return isTaskSource(ev) ? `${ev.sourceType}-${ev.taskId}` : `cal-${ev.id}`;
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

/* ---------------- 当前时间红线 ---------------- */
const nowMinute = ref(dayjs().diff(dayjs().startOf('day'), 'minute'));
let timeTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  timeTimer = setInterval(() => {
    nowMinute.value = dayjs().diff(dayjs().startOf('day'), 'minute');
  }, 60000);
});
onUnmounted(() => {
  if (timeTimer) clearInterval(timeTimer);
});

const todayKeyStr = computed(() => dayjs().format('YYYY-MM-DD'));
const currentTimeVisible = computed(() => {
  return cells.value.some((c) => c.key === todayKeyStr.value);
});
const currentTimeTop = computed(() => {
  return (nowMinute.value / 1440) * totalH;
});
</script>

<style scoped>
/* 时间轴视图里的「日程计划任务」极简条 */
.dt-task-line {
  display: flex;
  align-items: center;
}
.dt-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--kb-muted-foreground) 65%, transparent);
  margin-right: 4px;
  flex: none;
}
.dt-event-chip {
  color: #1A1D23;
}

/* 节日名称标签（日期数字旁，带图标）：如「18 周三 中秋」 */
.festival-label {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 64px;
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 法定休：红粉底白字 */
.festival-label.is-off {
  background: color-mix(in srgb, var(--kb-destructive) 82%, transparent);
  color: var(--kb-destructive-foreground);
}
/* 补班：橙底深字 */
.festival-label.is-work {
  background: color-mix(in srgb, var(--kb-warning) 26%, transparent);
  color: var(--kb-warning-foreground);
}
/* 传统/现代节日：主题蓝软底蓝字 */
.festival-label.is-observance {
  background: var(--kb-primary-soft);
  color: var(--kb-primary);
}

/* 纪念日 Heart 徽章 */
.festival-heart-icon {
  flex-shrink: 0;
  color: var(--kb-chart-5);
}
.festival-heart-count {
  font-size: 9px;
  font-weight: 600;
  color: var(--kb-chart-5);
}
</style>
