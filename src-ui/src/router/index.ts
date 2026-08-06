// 桌面端路由：与 Web 端 /workbench/* 路由表逐条对齐（同 path、同 name、同组件），
// 差异仅在于桌面端为本机单用户场景，去掉 requiresAuth 登录守卫。
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/workbench' },
  {
    path: '/workbench',
    name: 'Workbench',
    component: () => import('@/views/Workbench.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    path: '/workbench/capture',
    name: 'WorkbenchCapture',
    component: () => import('@/views/WorkbenchCapture.vue'),
    meta: { layout: 'c', fullscreen: true },
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
    path: '/workbench/palace',
    name: 'WorkbenchPalace',
    component: () => import('@/views/WorkbenchPalace.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    path: '/workbench/palace/:id',
    name: 'WorkbenchPalaceEdit',
    component: () => import('@/views/WorkbenchPalaceEdit.vue'),
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
    // AI 配置中心：独立于学习闭环七模块，从顶栏齿轮入口进入
    path: '/settings/ai',
    name: 'AiSettings',
    component: () => import('@/views/AiSettings.vue'),
    meta: { layout: 'c', fullscreen: true },
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

export default router;
