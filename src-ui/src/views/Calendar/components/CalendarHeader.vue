<template>
  <header
    class="flex items-center justify-between gap-3 px-4 h-12 shrink-0 border-b"
    :style="{ borderColor: 'var(--kb-border)', background: 'var(--kb-card)' }"
  >
    <!-- 左：标题 + 今天 + 翻页 -->
    <div class="flex items-center gap-2">
      <h1 class="text-[15px] font-semibold tabular-nums" :style="{ color: 'var(--kb-foreground)' }">
        {{ title }}
      </h1>

      <button
        type="button"
        class="kb-btn kb-btn-sm ml-1"
        @click="store.goToday()"
      >
        今天
      </button>

      <div class="flex items-center">
        <button
          type="button"
          class="cal-nav-btn"
          title="上一周期"
          @click="store.shift(-1)"
        >
          <Icon name="chevron-left" size="sm" />
        </button>
        <button
          type="button"
          class="cal-nav-btn"
          title="下一周期"
          @click="store.shift(1)"
        >
          <Icon name="chevron-right" size="sm" />
        </button>
      </div>
    </div>

    <!-- 右：视图模式切换 + 新建 -->
    <div class="flex items-center gap-2">
      <div
        class="inline-flex items-center rounded-md p-0.5"
        :style="{ background: 'var(--kb-muted)' }"
        role="tablist"
        aria-label="视图模式"
      >
        <button
          v-for="m in modes"
          :key="m.value"
          type="button"
          class="px-2.5 py-1 rounded-[5px] text-xs font-medium transition-all"
          :class="store.viewMode === m.value ? 'is-active' : ''"
          :style="store.viewMode === m.value
            ? { background: 'var(--kb-card)', color: 'var(--kb-primary)', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }
            : { color: 'var(--kb-muted-foreground)' }"
          @click="store.setViewMode(m.value)"
        >
          {{ m.label }}
        </button>
      </div>

      <button type="button" class="kb-btn kb-btn-primary" @click="$emit('add')">
        <Icon name="plus" size="sm" />
        <span>新建</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
// 日历顶部操作栏（TickTick 风格）：紧凑单行 48px，不 wrap。
// 标题 + 今天 + 翻页居左；视图分段控件 + 新建居右。
// 所有视图状态来自 useCalendarStore；「新建」通过 emit 上浮给 index.vue。
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import dayjs from 'dayjs';
import Icon from '@/components/ui/Icon.vue';
import { useCalendarStore } from '@/store/calendar-store';
import { buildCells, type CalendarViewMode } from '@/lib/calendar';
import { formatYearMonth, formatYearMonthDay } from '@/lib/date';

const emit = defineEmits<{ (e: 'add'): void }>();

const store = useCalendarStore();
const { currentDate, viewMode } = storeToRefs(store);

const modes: { value: CalendarViewMode; label: string }[] = [
  { value: 'month', label: '月' },
  { value: 'week', label: '周' },
  { value: 'day', label: '日' },
];

/** 标题随视图模式变化：月→「2026年8月」，周→「8月3日 - 8月9日」，日→「2026年8月9日 周日」 */
const title = computed(() => {
  const cells = buildCells(currentDate.value, viewMode.value);
  if (viewMode.value === 'month') return formatYearMonth(currentDate.value);
  if (viewMode.value === 'day') return formatYearMonthDay(currentDate.value);
  // 周：取首尾格，跨月时显示「M月D日 - M月D日」
  const first = dayjs(cells[0].key);
  const last = dayjs(cells[cells.length - 1].key);
  const fmt = (d: dayjs.Dayjs) => `${d.format('M月D日')}`;
  return `${fmt(first)} - ${fmt(last)}`;
});
</script>

<style scoped>
.cal-nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--kb-radius-sm);
  color: var(--kb-muted-foreground);
  transition: background 0.15s ease, color 0.15s ease;
}
.cal-nav-btn:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}
</style>
