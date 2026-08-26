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

      <!-- 新建：下拉菜单（新建事件 / 添加纪念日） -->
      <div class="relative" @mouseleave="addMenuOpen = false">
        <button
          type="button"
          class="kb-btn kb-btn-primary"
          aria-haspopup="menu"
          :aria-expanded="addMenuOpen"
          @click="onAddClick"
        >
          <Icon name="plus" size="sm" />
          <span>新建</span>
          <Icon name="chevron-down" size="xs" class="opacity-70" />
        </button>
        <Transition name="dropdown">
          <div v-if="addMenuOpen" class="absolute right-0 top-full z-50 pt-2">
            <div
              class="w-44 rounded-xl border p-1.5 shadow-2xl backdrop-blur-xl"
              :style="{ background: 'color-mix(in srgb, var(--kb-popover) 88%, transparent)', borderColor: 'var(--kb-border)' }"
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                class="cal-menu-item"
                @click="chooseAdd('event')"
              >
                <Icon name="calendar-plus" size="sm" />
                <span>新建事件</span>
              </button>
              <button
                type="button"
                role="menuitem"
                class="cal-menu-item"
                @click="chooseAdd('anniversary')"
              >
                <Icon name="heart" size="sm" />
                <span>🎂 添加纪念日</span>
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
// 日历顶部操作栏（TickTick 风格）：紧凑单行 48px，不 wrap。
// 标题 + 今天 + 翻页居左；视图分段控件 + 新建居右。
// 所有视图状态来自 useCalendarStore；「新建」通过 emit 上浮给 index.vue。
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import dayjs from 'dayjs';
import Icon from '@/components/ui/Icon.vue';
import { useCalendarStore } from '@/store/calendar-store';
import { buildCells, type CalendarViewMode } from '@/lib/calendar';
import { formatYearMonth, formatYearMonthDay } from '@/lib/date';

const emit = defineEmits<{
  (e: 'add'): void;
  (e: 'addAnniversary'): void;
}>();

const store = useCalendarStore();
const { currentDate, viewMode } = storeToRefs(store);

/** 「新建」下拉开合 */
const addMenuOpen = ref(false);

/** 点主按钮：直接开「新建事件」（与历史行为一致） */
function onAddClick() {
  addMenuOpen.value = !addMenuOpen.value;
}
/** 菜单项选择：事件直接 emit add；纪念日 emit addAnniversary */
function chooseAdd(kind: 'event' | 'anniversary') {
  addMenuOpen.value = false;
  if (kind === 'event') emit('add');
  else emit('addAnniversary');
}

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

/* 「新建」下拉菜单项 */
.cal-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: var(--kb-radius-md);
  background: transparent;
  color: var(--kb-foreground);
  font-size: var(--kb-fs-body-sm);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease;
}
.cal-menu-item:hover {
  background: var(--kb-muted);
  color: var(--kb-primary);
}
.cal-menu-item :deep(svg) {
  color: var(--kb-primary);
}

/* 下拉展开过渡 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
