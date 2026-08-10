<template>
  <div class="tasks-root flex h-full min-h-0" :style="{ background: 'var(--kb-background)' }">
    <TaskSidebar />
    <TaskView :highlight-id="highlightId" />
    <TaskFooter />
  </div>
</template>

<script setup lang="ts">
// 任务清单主入口（路由 /tasks，对标 Things 3）。
// 左：智能列表 + 自定义清单（TaskSidebar）；中：当前视图任务树（TaskView）；
// 底：常驻新建栏（TaskFooter）。三栏由本组件拼装，业务状态全在 useTaskStore。
//
// 深链：从日历点任务色块跳入时带 ?date=<YYYY-MM-DD>&taskId=<n>，
//   - date 决定落到哪个智能列表（今天 / 计划 / 日志本）；
//   - taskId 触发高亮并滚动定位。
// 旧 /schedule 已在 router 重定向到 /tasks 且 query 透传，故这里统一处理两种来源。
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import dayjs from 'dayjs';
import TaskSidebar from './components/TaskSidebar.vue';
import TaskView from './components/TaskView.vue';
import TaskFooter from './components/TaskFooter.vue';
import { useTaskStore, type TaskViewKey } from '@/store/task-store';

const store = useTaskStore();
const route = useRoute();
const highlightId = ref<number | null>(null);

onMounted(async () => {
  await store.bootstrap();

  const q = route.query;
  if (typeof q.taskId === 'string') highlightId.value = Number(q.taskId);

  if (typeof q.date === 'string') {
    const d = q.date;
    const today = dayjs().format('YYYY-MM-DD');
    let view: TaskViewKey = 'today';
    if (d > today) view = 'upcoming';
    else if (d < today) view = 'logbook';
    await store.selectView(view);
  }
});
</script>

<style scoped>
.tasks-root {
  /* 让三栏在布局容器内正确占满；左右两栏各自管理自己的滚动 */
  overflow: hidden;
}
</style>
