/**
 * Pinia Store 统一出口（登记表）。
 *
 * 【为什么需要它】
 * 重构前 store 散在 `stores/`（2 个）与 `store/`（6 个）两个目录、命名也不统一，
 * 新人根本看不出「这个项目到底有几个全局状态」。这里作为唯一登记处：
 * 新增 store 必须在此登记一行，否则视为未纳入全局状态管理。
 *
 * 【为什么业务代码仍从具体文件 import 而不是从这里桶导入】
 * 从桶文件导入会把全部 8 个 store 拉进同一个 chunk，Vite 的按路由代码分割随之失效，
 * 首屏要多下载几十 KB 与当前页面无关的状态逻辑。所以页面/组件一律写
 * `from '@/store/note-store'`，本文件只承担「清单 + 对外统一出口」的职责。
 *
 * 【命名与持久化约定】
 * - 文件名 kebab-case，一律 `<域>-store.ts`；
 * - `defineStore()` 的第一个参数（store id）是 pinia-plugin-persistedstate 的
 *   localStorage key，**任何情况下都不许改动**，改了等于清空老用户的引导状态、
 *   记忆宫殿熟练度与收集箱筛选偏好；
 * - 持久化用 v4 的 `pick`（v3 的 `paths` 已移除）。
 */
export { useAppStore } from './app-store';
export { useDashboardStore } from './dashboard-store';
export { useInboxStore } from './inbox-store';
export { useMemoryPalaceStore } from './memory-palace-store';
export { useNoteStore } from './note-store';
export { usePomodoroStore } from './pomodoro-store';
export { useReviewStore } from './review-store';
export { useSearchStore } from './search-store';
