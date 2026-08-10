<template>
  <div class="flex flex-col h-full" :style="{ background: 'var(--kb-bg)', color: 'var(--kb-foreground)' }">
    <CalendarHeader @add="openAdd()" />

    <!-- 主体：三态（加载 / 空 / 数据） -->
    <div class="relative flex-1 min-h-0 flex flex-col">
      <!-- 加载态：首屏无数据时的骨架 -->
      <div v-if="state === 'loading'" class="absolute inset-0 flex flex-col">
        <div class="grid grid-cols-7 grid-rows-6 h-full">
          <div v-for="n in 42" :key="n" class="border-b border-r p-2" :style="{ borderColor: 'var(--kb-border)' }">
            <div class="skeleton h-4 w-6 rounded"></div>
          </div>
        </div>
      </div>

      <!-- 数据态 / 空态：都渲染底层网格，空态时顶部叠加 compact 提示 -->
      <template v-else>
        <!-- 空态：紧凑提示条，不覆盖整屏，保留日历网格骨架可见 -->
        <div
          v-if="state === 'empty'"
          class="shrink-0 px-3 py-2 border-b"
          :style="{ borderColor: 'var(--kb-border)' }"
        >
          <div
            class="flex items-center gap-3 rounded-lg px-3 py-2"
            :style="{ background: 'color-mix(in srgb, var(--kb-primary) 5%, transparent)' }"
          >
            <Icon name="calendar" size="md" :style="{ color: 'var(--kb-primary)' }" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium">暂无日程</p>
              <p class="text-xs truncate" :style="{ color: 'var(--kb-muted-foreground)' }">
                点击日期或右上角「新建」添加事件
              </p>
            </div>
            <button type="button" class="kb-btn kb-btn-primary kb-btn-sm" @click="openAdd()">
              <Icon name="plus" size="xs" />
              <span>新建</span>
            </button>
          </div>
        </div>

        <!-- 视图：月 / 周 / 日 -->
        <div class="flex-1 min-h-0">
          <CalendarMonthView
            v-if="store.viewMode === 'month'"
            @select="openDetail"
            @add="(d) => openAdd({ dateKey: d })"
            @select-task="openDailyTask"
          />
          <CalendarTimeGridView
            v-else
            @select="openDetail"
            @add="(p) => openAdd(p)"
            @select-task="openDailyTask"
          />
        </div>
      </template>
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
// 空态不再用 absolute inset-0 全屏居中，而是顶部 compact 提示条 + 保留底层日历网格，
// 避免 TickTick 式日历在无事件时中间一大片空白。
// 视图数据全部来自 useCalendarStore（storeToRefs 解构），本组件不持有任何业务状态。
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
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
const router = useRouter();

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

/** 点击「日程计划任务」：跳转到 /schedule 并带 date + taskId，由 Schedule 页高亮对应任务 */
function openDailyTask(payload: { taskId: number; date: string }) {
  router.push({ path: '/schedule', query: { date: payload.date, taskId: String(payload.taskId) } });
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
