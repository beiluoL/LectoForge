<template>
  <header class="flex flex-wrap items-center gap-3 px-5 py-3 border-b" :style="{ borderColor: 'var(--kb-border)' }">
    <!-- 左：当前区间标题 -->
    <h1 class="text-lg font-semibold mr-2" :style="{ color: 'var(--kb-foreground)' }">{{ title }}</h1>

    <!-- 中：翻页 + 今天 -->
    <div class="flex items-center gap-1">
      <button type="button" class="wb-icon-btn" title="上一周期" @click="store.shift(-1)">
        <Icon name="chevron-left" size="md" />
      </button>
      <button type="button" class="kb-btn kb-btn-sm" @click="store.goToday()">今天</button>
      <button type="button" class="wb-icon-btn" title="下一周期" @click="store.shift(1)">
        <Icon name="chevron-right" size="md" />
      </button>
    </div>

    <!-- 右：视图模式切换 + 新建 -->
    <div class="flex items-center gap-2 ml-auto">
      <div
        class="inline-flex items-center rounded-lg p-0.5"
        :style="{ background: 'var(--kb-muted)' }"
        role="tablist"
        aria-label="视图模式"
      >
        <button
          v-for="m in modes"
          :key="m.value"
          type="button"
          class="px-3 py-1 rounded-md text-sm font-medium transition-colors"
          :class="store.viewMode === m.value ? 'is-active' : ''"
          :style="store.viewMode === m.value
            ? { background: 'var(--kb-card)', color: 'var(--kb-primary)', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }
            : { color: 'var(--kb-muted-foreground)' }"
          @click="store.setViewMode(m.value)"
        >
          {{ m.label }}
        </button>
      </div>

      <button type="button" class="kb-btn kb-btn-primary" @click="$emit('add')">
        <Icon name="plus" size="sm" />
        <span>新建事件</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
// 日历顶部操作栏：区间标题 + 翻页/今天 + 视图模式切换 + 新建按钮。
// 视图状态全部来自 useCalendarStore（storeToRefs 解构响应式字段），
// 翻页/切模式直接调用 store action；「新建」通过 emit 上浮给 index.vue 打开弹窗。
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
