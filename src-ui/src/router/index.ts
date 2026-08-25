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
    /* 任务清单（对标 Things 3）：收件箱 / 今天 / 计划 / 随时 / 某天 / 日志本 + 自定义清单。
     *
     * 🔴 主路由固定为 /tasks，任何情况下不得更名——深链、日历跳转、命令面板
     *    以及旧 /schedule 的重定向全部指向它。
     *
     * 与 /quadrant 的分工：任务清单回答「有哪些事、什么时候做」，
     * 四象限回答「先做哪个」。两者共用不了一张表，也共用不了一个页面。 */
    path: '/tasks',
    name: 'Tasks',
    component: () => import('@/views/Tasks/index.vue'),
    // fullscreen：铺满宽度（取消居中）；fill：额外撑满高度 + 内部自管滚动，
    // 消除透明窗口底部间隙。fill 目前用于「任务清单 / AI 对话 / 日历」三类需要铺满整屏的页面，
    // 其余 fullscreen 页面仍走"铺满宽度 + 原生滚动"（px-4 py-6 内边距）。
    meta: { layout: 'c', fullscreen: true, fill: true },
  },
  {
    /* 旧「日程计划」整体让位给任务清单。
     *
     * 保留这条重定向而不是直接删路由：外部深链、用户书签、日历里的历史跳转
     * 都还写着 /schedule，删掉会让它们统统撞上兜底路由掉回工作台，
     * 用户只会觉得「点了没反应」。query 一并透传，日历带过来的 ?date= 不会丢。 */
    path: '/schedule',
    redirect: (to) => ({ path: '/tasks', query: to.query }),
  },
  {
    // 番茄钟历史统计：vue-chartjs 柱状图 + 三张总结卡。
    path: '/pomodoro/stats',
    name: 'PomodoroStats',
    component: () => import('@/views/Pomodoro/Stats.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 习惯打卡（每日微习惯 + 连续打卡热力图）。
    // 路径刻意挂在 /habits 下（前缀不加 /workbench），与 /inbox、/schedule、/library、/mindmap 同理，
    // 避免顶栏 isActive 用 startsWith 时被「工作台」误吞高亮；高亮走独立 matches('/habits')。
    path: '/habits',
    name: 'Habits',
    component: () => import('@/views/Habits/index.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 四象限（艾森豪威尔矩阵）：紧急 × 重要 的 2×2 任务网格。
    // 同 /habits、/schedule 的理由挂在顶层而非 /workbench 下，避免顶栏 isActive
    // 的 startsWith 把「工作台」一起点亮；高亮走独立 match(['/quadrant'])。
    path: '/quadrant',
    name: 'Quadrant',
    component: () => import('@/views/Quadrant/index.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 日历视图（类 TickTick 月/周/日）：月网格 + 时间轴 + 新建/编辑/详情闭环。
    // 刻意挂在顶层 /calendar（不进 /workbench），与 /schedule、/quadrant、/habits 同理，
    // 避免顶栏 isActive 的 startsWith 把「工作台」误点亮；高亮走「规划」分组的 match(['/calendar'])。
    path: '/calendar',
    name: 'Calendar',
    component: () => import('@/views/Calendar/index.vue'),
    // fill：与任务清单一致，铺满整屏、内部自管滚动，去除四周内边距
    meta: { layout: 'c', fullscreen: true, fill: true },
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
    // 绘图工具 / 流程图（类 ProcessOn / Draw.io 白板）：独立的图文件系统，
    // 整图存库、自动保存。路径刻意不挂在 /workbench 下，与 /library、/mindmap 同理
    // （isActive 用 startsWith，避免被「工作台」误吞高亮）；高亮走「规划」分组的 match。
    // 内核已切到 AntV X6 自研实现（/diagram-x6-playground 验证台迁移而来，P2 末收尾）。
    path: '/diagram',
    name: 'Diagram',
    component: () => import('@/views/Diagram/x6/DiagramPlayground.vue'),
    // fill：铺满整屏、内部自管滚动，去除四周内边距，让流程图画布占满视口
    meta: { layout: 'c', fill: true },
  },
  {
    // [开发验证] X6 内核 playground：方案 B（AntV X6 自研升级）迁移用，非正式编辑器，
    // 不在任何导航入口展示；用于验证 X6 在 Vue3 + Tauri 环境下能正常挂载/渲染/撤销。
    path: '/diagram-x6-playground',
    name: 'DiagramX6Playground',
    component: () => import('@/views/Diagram/x6/DiagramPlayground.vue'),
    meta: { layout: 'c', fill: true },
  },
  {
    // 知识库问答（RAG）：检索文档库 + 康奈尔笔记后由 AI 作答。
    // 挂在顶层 /ai-chat（不进 /workbench），与 /library、/interview 等同理，
    // 避免顶栏 isActive 用 startsWith 时被「工作台」误吞高亮。
    path: '/ai-chat',
    name: 'AiChat',
    component: () => import('@/views/AiChat/index.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // AI 助手 / 多轮对话（对标 DeepSeek 网页端）：会话管理 + 流式多轮 + Markdown + 消息反馈 + 悬浮大纲。
    // 与 /ai-chat 同源挂在顶层，避免顶栏 isActive 被「工作台」误吞高亮。
    path: '/ai-assistant',
    name: 'AiAssistant',
    component: () => import('@/views/AiAssistant/index.vue'),
    // fill：与任务清单一致，铺满整屏、内部自管滚动，去除四周内边距
    meta: { layout: 'c', fullscreen: true, fill: true },
  },
  {
    // 离线模拟面试 / 语音通话：全屏沉浸式，顶栏保留（非 standalone）。
    path: '/interview',
    name: 'Interview',
    component: () => import('@/views/Interview.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 面试题库管理：导入面经（MD/PDF）+ 从复习卡/笔记汇入 + 列表。
    path: '/interview-bank',
    name: 'InterviewBank',
    component: () => import('@/views/InterviewBank.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 旧 AI 配置中心已合并进统一设置页 /settings（2026-08-08 重构），
    // 这里保留重定向兜住历史链接与外部书签，避免 404。
    path: '/settings/ai',
    redirect: '/settings',
  },
  {
    // 托盘「快捷键设置」入口：直达设置中心的快捷键分区（?section=shortcut 由设置页消费）
    path: '/settings/shortcut',
    redirect: '/settings?section=shortcut',
  },
  {
    // AI 学习洞察（P2-G1/C2）：周报与薄弱点诊断，从 AI 设置页能力清单进入
    path: '/insights/ai',
    name: 'AiInsights',
    component: () => import('@/views/AiInsights.vue'),
    meta: { layout: 'c', fullscreen: true },
  },
  {
    // 主动智能：每日学习日报与知识闪卡联动（AI 助手组下）
    path: '/daily-report',
    name: 'DailyReport',
    component: () => import('@/views/Insights/DailyReport.vue'),
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
