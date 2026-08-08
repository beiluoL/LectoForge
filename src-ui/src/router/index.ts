// 桌面端路由：与 Web 端 /workbench/* 路由表逐条对齐（同 path、同 name、同组件），
// 差异仅在于桌面端为本机单用户场景，去掉 requiresAuth 登录守卫。
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useAppStore } from '@/store/app-store';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/workbench' },
  {
    // 新手引导：首启 / 重新运行专用，全屏无顶栏（standalone）。
    // rerun=1 时由设置中心跳入，守卫需放行（见 beforeEach）。
    path: '/onboarding',
    name: 'Onboarding',
    component: () => import('@/views/Onboarding/index.vue'),
    meta: { standalone: true },
  },
  {
    // 全局设置中心：数据目录 + AI 服务 + 关于，同样无顶栏聚焦展示。
    path: '/settings',
    name: 'Settings',
    component: () => import('@/views/Settings/index.vue'),
    meta: { standalone: true },
  },
  {
    path: '/workbench',
    name: 'Workbench',
    component: () => import('@/views/Workbench.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 收集箱（知识闭环第一步）：极速输入 → 先积累再沉淀。
    // 与 /library、/mindmap 同理，刻意不挂在 /workbench 下——顶栏 isActive 用
    // startsWith 判断，挂进去会和「工作台」互相误高亮。
    path: '/inbox',
    name: 'Inbox',
    component: () => import('@/views/Inbox/index.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 旧收集箱路径（WorkbenchCapture）已于 2026-08-07 迁移到 /inbox，
    // 这里保留重定向兜住历史链接与外部书签，旧组件已归档到 views/archive/。
    path: '/workbench/capture',
    redirect: '/inbox',
  },
  {
    path: '/workbench/notes',
    name: 'WorkbenchNotes',
    component: () => import('@/views/WorkbenchNotes.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    path: '/workbench/notes/:id',
    name: 'WorkbenchNoteEdit',
    component: () => import('@/views/WorkbenchNoteEdit.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    path: '/workbench/review',
    name: 'WorkbenchReview',
    component: () => import('@/views/WorkbenchReview.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 旧系统传统卡组（wb_review_card）：从复习驾驶舱入口卡片下沉到此，
    // 路径刻意挂在 /workbench/review 下，与驾驶舱同属「复习」上下文。
    path: '/workbench/review/card-list',
    name: 'WorkbenchReviewCards',
    component: () => import('@/views/WorkbenchReviewCards.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 间隔重复闪卡复习系统：跨 notes + loci 的沉浸式 SM-2 卡牌（独立路由，非 standalone，保留顶栏）。
    path: '/review',
    name: 'Review',
    component: () => import('@/views/Review/index.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 闪卡专注模式别名：与 /review 共用同一组件（纯刷卡页），供「开始今日复习」等深链直达。
    path: '/review/flashcard',
    name: 'ReviewFlashcard',
    component: () => import('@/views/Review/index.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 番茄钟完整页：专注计时 + 白噪音 + 提示音设置（计时引擎在 pomodoroStore，跨页面常驻）。
    // 日常「开始 / 暂停 / 重置」已下沉到顶栏内嵌胶囊（TimerCapsule），此页专注设置与大盘展示。
    // 注：原 /pomodoro-popup 路由（pomodoro_popup 透明弹窗窗口）已于 2026-08-08 随弹窗形态一并删除。
    path: '/pomodoro',
    name: 'Pomodoro',
    component: () => import('@/views/Pomodoro/index.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 番茄钟历史统计：vue-chartjs 柱状图 + 三张总结卡。
    path: '/pomodoro/stats',
    name: 'PomodoroStats',
    component: () => import('@/views/Pomodoro/Stats.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    path: '/workbench/palace',
    name: 'WorkbenchPalace',
    component: () => import('@/views/MemoryPalace/index.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    path: '/workbench/palace/:id',
    name: 'WorkbenchPalaceEdit',
    component: () => import('@/views/MemoryPalace/index.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    path: '/workbench/recall',
    name: 'WorkbenchRecall',
    component: () => import('@/views/WorkbenchRecall.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    path: '/workbench/story',
    name: 'WorkbenchStory',
    component: () => import('@/views/WorkbenchStory.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    path: '/workbench/story/:id',
    name: 'WorkbenchStoryEdit',
    component: () => import('@/views/WorkbenchStoryEdit.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 文档库：Obsidian 式本地 Markdown 工作台（左目录树 / 中双栏编辑 / 右大纲）。
    // 路径刻意不挂在 /workbench 下——顶栏 isActive 用 startsWith 判断，
    // 挂进去会让「工作台」以外的同级项互相误高亮。
    path: '/library',
    name: 'DocLibrary',
    component: () => import('@/views/DocLibrary/index.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 思维导图：大纲笔记 / markmap 导图 / vue-flow 流程图三视图共用一份文档。
    // 同样刻意不挂在 /workbench 下，理由与 /library 一致（isActive 用 startsWith）。
    path: '/mindmap',
    name: 'MindMap',
    component: () => import('@/views/MindMap/index.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 旧 AI 配置中心已合并进统一设置页 /settings（2026-08-08 重构），
    // 这里保留重定向兜住历史链接与外部书签，避免 404。
    path: '/settings/ai',
    redirect: '/settings',
  },
  {
    // AI 学习洞察（P2-G1/C2）：周报与薄弱点诊断，从 AI 设置页能力清单进入
    path: '/insights/ai',
    name: 'AiInsights',
    component: () => import('@/views/AiInsights.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  { path: '/:pathMatch(.*)*', redirect: '/workbench' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

// 全局前置守卫：首次引导门禁。
// - 未引导且目标不是 /onboarding → 强制定向到引导页；
// - 已引导且目标是 /onboarding（非 rerun）→ 回工作台，避免重复引导；
// - rerun=1 由设置中心「重新运行新手引导」带出，需放行。
// 进入守卫前先与后端 /api/config 对齐一次（后端为权威来源），覆盖 localStorage 水合值，
// 处理「本地缓存被清但后端 config.json 已标记完成」的边界情况。
router.beforeEach(async (to) => {
  const store = useAppStore();
  if (!store.initialized) {
    await store.initFromBackend();
  }
  const { hasOnboarded } = storeToRefs(store);

  if (!hasOnboarded.value && to.path !== '/onboarding') {
    return '/onboarding';
  }
  if (hasOnboarded.value && to.path === '/onboarding' && to.query.rerun !== '1') {
    return '/workbench';
  }
});

export default router;
