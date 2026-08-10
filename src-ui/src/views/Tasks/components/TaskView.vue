<template>
  <section class="task-view flex flex-col min-h-0 flex-1">
    <!-- 头部：标题 + 进度 + 搜索 + 清空日志本 -->
    <header class="task-view-header shrink-0 border-b px-6 py-4" :style="{ borderColor: 'var(--kb-border)' }">
      <div class="flex items-center gap-3">
        <h1 class="text-xl font-semibold truncate" :style="{ color: 'var(--kb-foreground)' }">
          {{ store.currentTitle }}
        </h1>
        <span class="text-xs tabular-nums" :style="{ color: 'var(--kb-muted-foreground)' }">
          {{ store.doneCount }}/{{ store.totalCount }}
        </span>

        <div class="flex-1"></div>

        <!-- 搜索：本地即时过滤，不发请求 -->
        <div class="relative">
          <Icon
            name="search"
            size="xs"
            class="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            :style="{ color: 'var(--kb-muted-foreground)' }"
          />
          <input
            v-model="store.filters.keyword"
            class="kb-input text-sm"
            :style="{ paddingLeft: '28px', width: '180px' }"
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

      <!-- 进度条（今天 / 计划视图给出真实进度） -->
      <div
        v-if="showProgress"
        class="mt-3 h-1.5 rounded-full overflow-hidden"
        :style="{ background: 'var(--kb-muted)' }"
      >
        <div
          class="h-full rounded-full transition-all duration-300"
          :style="{ width: store.progress + '%', background: 'var(--kb-primary)' }"
        ></div>
      </div>
    </header>

    <!-- 主体：任务列表（滚动） -->
    <div class="flex-1 min-h-0 overflow-y-auto px-6 py-3">
      <!-- 加载态 -->
      <div v-if="store.loading && store.visibleTasks.length === 0" class="py-10 text-center text-sm"
           :style="{ color: 'var(--kb-muted-foreground)' }">
        加载中…
      </div>

      <!-- 空态 -->
      <div
        v-else-if="store.visibleTasks.length === 0"
        class="py-16 flex flex-col items-center text-center"
      >
        <Icon name="list-checks" size="2xl" :style="{ color: 'var(--kb-border)' }" />
        <p class="mt-3 text-sm font-medium" :style="{ color: 'var(--kb-foreground)' }">{{ emptyTitle }}</p>
        <p class="mt-1 text-xs" :style="{ color: 'var(--kb-muted-foreground)' }">{{ emptyHint }}</p>
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
  </section>
</template>

<script setup lang="ts">
// 任务主视图：标题 + 进度 + 搜索 + 清空（日志本）+ 任务树。
// 数据全部来自 useTaskStore（storeToRefs 解构），本组件不持有业务状态；
// 任务行由 TaskItem 递归渲染，过滤后的列表在 store 内 computed（visibleTasks）。
import { computed } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import TaskItem from './TaskItem.vue';
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
