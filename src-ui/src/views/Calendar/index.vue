<template>
  <div class="flex flex-col h-full" :style="{ background: 'var(--kb-bg)', color: 'var(--kb-foreground)' }">
    <CalendarHeader @add="openAdd()" />

    <!-- 主体：三态（加载 / 空 / 数据） -->
    <div class="relative flex-1 min-h-0">
      <!-- 加载态：首屏无数据时的骨架 -->
      <div v-if="state === 'loading'" class="absolute inset-0 flex flex-col">
        <div class="grid grid-cols-7 grid-rows-6 h-full">
          <div v-for="n in 42" :key="n" class="border-b border-r p-2" :style="{ borderColor: 'var(--kb-border)' }">
            <div class="skeleton h-4 w-6 rounded"></div>
          </div>
        </div>
      </div>

      <!-- 空态：当前视图区间无事件 -->
      <div v-else-if="state === 'empty'" class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
        <div
          class="w-16 h-16 rounded-2xl flex items-center justify-center"
          :style="{ background: 'var(--kb-muted)' }"
        >
          <Icon name="calendar" size="2xl" :style="{ color: 'var(--kb-muted-foreground)' }" />
        </div>
        <div>
          <p class="font-medium">这段时间还没有安排</p>
          <p class="text-sm mt-1" :style="{ color: 'var(--kb-muted-foreground)' }">
            点击任意日期或右上角「新建事件」开始规划你的日程
          </p>
        </div>
        <button type="button" class="kb-btn kb-btn-primary" @click="openAdd()">
          <Icon name="plus" size="sm" />
          <span>新建事件</span>
        </button>
      </div>

      <!-- 数据态 -->
      <div v-else class="absolute inset-0">
        <CalendarMonthView
          v-if="store.viewMode === 'month'"
          @select="openDetail"
          @add="(d) => openAdd({ dateKey: d })"
        />
        <CalendarTimeGridView
          v-else
          @select="openDetail"
          @add="(p) => openAdd(p)"
        />
      </div>
    </div>

    <!-- 新建 / 编辑弹窗 -->
    <AddEventModal
      :open="addOpen"
      :event="modalEvent"
      :default-date="modalDate"
      :default-time="modalTime"
      @close="onAddClose"
      @saved="onAddSaved"
    />

    <!-- 详情抽屉 -->
    <EventDetailDrawer
      :open="detailOpen"
      :event="detailEvent"
      @close="detailOpen = false"
      @edit="onDrawerEdit"
      @deleted="detailEvent = null"
    />
  </div>
</template>

<script setup lang="ts">
// 日历模块主入口（路由 /calendar）。
// 职责：持有弹窗/抽屉的开合状态，把子组件的「新建/选择」事件翻译成 store 调用，
// 并按 store.loading / events.length 呈现 加载态 / 空态 / 数据态 三态。
// 视图数据全部来自 useCalendarStore（storeToRefs 解构），本组件不持有任何业务状态。
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import Icon from '@/components/ui/Icon.vue';
import { useCalendarStore } from '@/store/calendar-store';
import CalendarHeader from './components/CalendarHeader.vue';
import CalendarMonthView from './components/CalendarMonthView.vue';
import CalendarTimeGridView from './components/CalendarTimeGridView.vue';
import AddEventModal from './components/AddEventModal.vue';
import EventDetailDrawer from './components/EventDetailDrawer.vue';
import type { CalendarEvent } from '@/api/calendar';

const store = useCalendarStore();
const { loading, events, viewMode } = storeToRefs(store);

onMounted(() => {
  store.refreshCurrentView();
});

/** 三态派生：首屏加载且无数据→loading；非加载且无数据→empty；其余→data */
const state = computed<'loading' | 'empty' | 'data'>(() => {
  if (loading.value && events.value.length === 0) return 'loading';
  if (!loading.value && events.value.length === 0) return 'empty';
  return 'data';
});

/* ---------------- 弹窗（新建 / 编辑） ---------------- */
const addOpen = ref(false);
const modalEvent = ref<CalendarEvent | null>(null);
const modalDate = ref<string | undefined>(undefined);
const modalTime = ref<string | undefined>(undefined);

interface AddOpts {
  dateKey?: string;
  time?: string;
  event?: CalendarEvent;
}
function openAdd(opts: AddOpts = {}) {
  modalEvent.value = opts.event ?? null;
  modalDate.value = opts.dateKey ?? store.currentDate;
  modalTime.value = opts.time;
  addOpen.value = true;
}
function onAddClose() {
  addOpen.value = false;
  modalEvent.value = null;
  modalDate.value = undefined;
  modalTime.value = undefined;
}
function onAddSaved() {
  // store 内部已乐观更新 + 重拉当前视图，这里只收起弹窗
  addOpen.value = false;
  modalEvent.value = null;
}

/* ---------------- 详情抽屉 ---------------- */
const detailOpen = ref(false);
const detailEvent = ref<CalendarEvent | null>(null);

function openDetail(ev: CalendarEvent) {
  detailEvent.value = ev;
  detailOpen.value = true;
}
function onDrawerEdit(ev: CalendarEvent) {
  // 编辑：关抽屉、开弹窗（带 event 走 PUT 分支）
  detailOpen.value = false;
  openAdd({ event: ev });
}
</script>

<style scoped>
.skeleton {
  background: linear-gradient(90deg, var(--kb-muted) 25%, var(--kb-border) 37%, var(--kb-muted) 63%);
  background-size: 400% 100%;
  animation: lf-shimmer 1.4s ease infinite;
}
@keyframes lf-shimmer {
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0 50%;
  }
}
</style>
