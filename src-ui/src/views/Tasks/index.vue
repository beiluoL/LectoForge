<template>
  <!-- 全屏三栏：左智能列表+清单 / 中任务树 / 底内联新建（已并入 TaskView）。
       fullscreen 路由被 App 包在 <main class="flex-1 min-h-0"> + <div class="w-full h-full"> 内，
       父链已用 flex-col+h-screen 撑满 100vh，故本组件直接 h-full 填满剩余空间即可，
       不再依赖 calc(100vh - 6.5rem) 等脆弱计算；内部滚动由各栏自理。 -->
  <div
    class="tasks-shell flex overflow-hidden h-full"
    :style="{ background: 'var(--kb-background)' }"
  >
    <TaskSidebar />
    <TaskView :highlight-id="highlightId" />
  </div>
</template>

<script setup lang="ts">
// 任务清单主入口（路由 /tasks，对标 Things 3）。
// 左：智能列表 + 自定义清单（TaskSidebar）；中：当前视图任务树（TaskView）。
// 底：常驻新建栏已并入 TaskView（mt-auto 顶到底部），本组件只拼装两栏。
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
