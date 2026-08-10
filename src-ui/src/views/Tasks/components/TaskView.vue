<template>
  <section
    class="task-view flex h-full min-h-0 flex-1 flex-col"
    :style="{ background: 'var(--kb-card)' }"
  >
    <!-- 头部：标题 + 计数（左） / 搜索 + 清空（右）水平对齐
         macOS 原生做法：不画分割线，靠 pb-4 + 列表 pt-2 的 24px 留白做视觉分区 -->
    <header
      class="task-view-header flex shrink-0 items-center justify-between gap-3 px-6 pb-4 pt-5"
    >
      <div class="flex min-w-0 items-center gap-2">
        <h1
          class="truncate text-[length:var(--kb-fs-h4)] font-semibold"
          :style="{ color: 'var(--kb-foreground)' }"
        >
          {{ store.currentTitle }}
        </h1>
        <span
          class="tabular-nums text-[length:var(--kb-fs-body-sm)]"
          :style="{ color: 'var(--kb-muted-foreground)' }"
        >
          {{ store.doneCount }}/{{ store.totalCount }}
        </span>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <!-- 搜索：左对齐带图标的内联输入框，宽度不撑满 -->
        <div class="relative">
          <Icon
            name="search"
            size="xs"
            class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
            :style="{ color: 'var(--kb-muted-foreground)' }"
          />
          <input
            v-model="store.filters.keyword"
            class="h-8 w-44 rounded-md border border-transparent bg-[var(--kb-background)] pl-8 pr-2 text-[length:var(--kb-fs-body-sm)] text-[var(--kb-foreground)] outline-none transition-colors placeholder:text-[var(--kb-muted-foreground)] focus:border-[var(--kb-primary)] focus:ring-2 focus:ring-[var(--kb-primary)]"
            placeholder="搜索任务"
          />
        </div>

        <!-- 日志本：清空已完成 -->
        <button
          v-if="store.currentView === 'logbook'"
          type="button"
          class="kb-btn kb-btn-sm"
          :disabled="store.totalCount === 0"
          @click="store.clearLogbook()"
        >
          <Icon name="trash-2" size="xs" />
          <span>清空</span>
        </button>
      </div>
    </header>

    <!-- 进度条（今天 / 计划视图给出真实进度） -->
    <div
      v-if="showProgress"
      class="shrink-0 px-6 pb-1"
    >
      <div
        class="h-1.5 overflow-hidden rounded-full"
        :style="{ background: 'var(--kb-muted)' }"
      >
        <div
          class="h-full rounded-full transition-all duration-300"
          :style="{ width: store.progress + '%', background: 'var(--kb-primary)' }"
        ></div>
      </div>
    </div>

    <!-- 主体：任务列表（滚动） -->
    <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-3 pt-2">
      <!-- 加载态 -->
      <div
        v-if="store.loading && store.visibleTasks.length === 0"
        class="py-10 text-center text-[length:var(--kb-fs-body-sm)]"
        :style="{ color: 'var(--kb-muted-foreground)' }"
      >
        加载中…
      </div>

      <!-- 空态 -->
      <div
        v-else-if="store.visibleTasks.length === 0"
        class="mt-[20%] flex flex-col items-center py-16 text-center"
      >
        <Icon name="list-checks" size="56" class="text-gray-300 dark:text-neutral-700" />
        <p class="mt-3 text-sm font-medium text-gray-600 dark:text-neutral-300">
          {{ emptyTitle }}
        </p>
        <p class="mt-1 text-sm text-gray-400 dark:text-neutral-500">
          {{ emptyHint }}
        </p>
      </div>

      <!-- 任务树 -->
      <div v-else class="space-y-0.5">
        <TaskItem
          v-for="task in store.visibleTasks"
          :key="task.id"
          :task="task"
          :highlight-id="highlightId"
        />
      </div>
    </div>

    <!-- 底部内联新建栏：mt-auto 顶到视图最底部，消除底部留白 -->
    <TaskFooter class="mt-auto shrink-0" />
  </section>
</template>

<script setup lang="ts">
// 任务主视图：标题 + 进度 + 搜索 + 清空（日志本）+ 任务树 + 底部内联新建。
// 数据全部来自 useTaskStore（storeToRefs 解构），本组件不持有业务状态；
// 任务行由 TaskItem 递归渲染，过滤后的列表在 store 内 computed（visibleTasks）。
// 仅做布局/视觉重构：头部水平对齐、内容区填满、新建栏用 mt-auto 钉底。
import { computed } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import TaskItem from './TaskItem.vue';
import TaskFooter from './TaskFooter.vue';
import { useTaskStore } from '@/store/task-store';

const store = useTaskStore();

const props = withDefaults(defineProps<{ highlightId?: number | null }>(), { highlightId: null });

/** 仅在「今天 / 计划」展示进度条（日志本是归档区，inbox/someday 无进度语义） */
const showProgress = computed(
  () => store.currentView === 'today' || store.currentView === 'upcoming',
);

const emptyTitle = computed(() => {
  if (store.filters.keyword.trim()) return '没有匹配的任务';
  switch (store.currentView) {
    case 'inbox':
      return '收件箱是空的';
    case 'today':
      return '今天没有安排';
    case 'upcoming':
      return '没有计划中的任务';
    case 'someday':
      return '某天清单是空的';
    case 'logbook':
      return '日志本是空的';
    default:
      return '这个清单还没有任务';
  }
});
const emptyHint = computed(() => {
  if (store.filters.keyword.trim()) return '换个关键词，或清空搜索框';
  return '在底部输入框敲下第一条任务';
});
</script>

<style scoped>
.task-view-header {
  background: var(--kb-card);
}
</style>
