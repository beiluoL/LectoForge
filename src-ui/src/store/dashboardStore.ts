/**
 * useDashboardStore —— 工作台首页聚合统计状态。
 *
 * 首页「学习闭环四步」数字气泡 + 「今日聚焦」四卡的唯一数据源。
 * 数据来自后端 GET /api/dashboard/stats（实时反映 SQLite）。
 *
 * 组件用法：
 * ```ts
 * import { storeToRefs } from 'pinia'
 * import { useDashboardStore } from '@/store/dashboardStore'
 * const store = useDashboardStore()
 * const { stats, loading, loaded } = storeToRefs(store)
 * store.fetchStats()
 * ```
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getDashboardStats, type DashboardStats } from '@/api/dashboard';

/** 所有计数默认 0，避免首屏渲染时读到 undefined */
const EMPTY_STATS: DashboardStats = {
  todayCaptures: 0,
  pendingCaptures: 0,
  dueReviews: 0,
  palaceLoci: 0,
  storyDrafts: 0,
  inboxOverdueCount: 0,
  weeklyFlow: 0,
  loopSteps: { step1Count: 0, step2Count: 0, step3Count: 0, step4Count: 0 },
};

export const useDashboardStore = defineStore('dashboard', () => {
  /** 聚合统计（首屏用空值兜底，拉取成功后覆盖） */
  const stats = ref<DashboardStats>({ ...EMPTY_STATS });
  const loading = ref(false);
  /** 是否已成功拉取过一次（用于骨架屏 / 首屏占位判断） */
  const loaded = ref(false);

  /** 拉取首页聚合统计；失败静默降级为空值（不打断首页渲染） */
  async function fetchStats(): Promise<void> {
    loading.value = true;
    try {
      stats.value = await getDashboardStats();
      loaded.value = true;
    } catch {
      // 后端不可用时保持上一次数据（或空值），首页照常渲染
    } finally {
      loading.value = false;
    }
  }

  return { stats, loading, loaded, fetchStats };
});
