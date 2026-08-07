/**
 * useReviewStore —— 间隔重复闪卡复习会话状态。
 *
 * 设计：单次复习会话（session）内的状态，不持久化（下次进入重新拉取）。
 * queue 是一份「待复习快照」，每评完一张就 splice 掉当前卡，currentIndex 指向队列头部，
 * 这样「移除当前卡 + 跳到下一张」天然统一（下一张会滑落到 index 0）。
 *
 * 组件用法：
 * ```ts
 * import { storeToRefs } from 'pinia'
 * import { useReviewStore } from '@/store/reviewStore'
 * const store = useReviewStore()
 * const { queue, current, isLoading, isFinished, cardSide, stats, totalCount } = storeToRefs(store)
 * store.loadQueue(); store.flipCard(); store.submitRating('good'); store.restartSession()
 * ```
 */
import { defineStore } from 'pinia';
import { ref, reactive, computed } from 'vue';
import {
  getDueReviews,
  submitReview,
  snoozeReview,
  getReviewHeatmap,
  getReviewForgettingCurve,
  type ReviewCard,
  type ReviewRating,
  type ReviewSourceType,
  type ReviewHeatmapResult,
  type ReviewForgettingCurveResult,
} from '@/api/review';
import { notify, getApiError } from '@/utils/toast';

export const useReviewStore = defineStore('review', () => {
  /** 待复习卡片队列（后端已按紧急度裁剪，最多 20 张） */
  const queue = ref<ReviewCard[]>([]);
  /** 当前卡片在队列中的索引（始终指向队列头，评完即 splice 移除） */
  const currentIndex = ref(0);
  const isLoading = ref(false);
  /** 队列见底 → 结束视图 */
  const isFinished = ref(false);
  /** 当前卡显示正面还是反面 */
  const cardSide = ref<'front' | 'back'>('front');
  /** 本次会话拉取时的总待复习数（进度条分母） */
  const totalCount = ref(0);
  /** 本次会话统计：已复习张数 + 各评分档计数（结束页小统计用） */
  const stats = reactive({ reviewed: 0, hard: 0, good: 0, easy: 0, perfect: 0, snoozed: 0 });

  /** 当前正在复习的卡片（队列空时为 null） */
  const current = computed<ReviewCard | null>(() => queue.value[currentIndex.value] ?? null);

  /** 进度：已处理（已评分 + 已挂起）占总数比例；用队列剩余反推，snooze 同样推进进度 */
  const processedCount = computed(() => Math.max(0, totalCount.value - queue.value.length));
  const progressPct = computed(() =>
    totalCount.value > 0 ? Math.round((processedCount.value / totalCount.value) * 100) : 0,
  );

  /** 热力图数据（底部展示用） */
  const heatmap = ref<ReviewHeatmapResult | null>(null);
  const heatmapLoading = ref(false);
  /** 遗忘曲线数据（底部折叠面板用） */
  const forgettingCurve = ref<ReviewForgettingCurveResult | null>(null);
  const curveLoading = ref(false);
  const curveDays = ref(30);

  /** 拉取待复习卡片，重置会话状态 */
  async function loadQueue(): Promise<void> {
    isLoading.value = true;
    try {
      const list = await getDueReviews();
      queue.value = Array.isArray(list) ? list : [];
      totalCount.value = queue.value.length;
      currentIndex.value = 0;
      cardSide.value = 'front';
      isFinished.value = queue.value.length === 0;
      stats.reviewed = 0;
      stats.hard = stats.good = stats.easy = stats.perfect = 0;
      stats.snoozed = 0;
    } catch (e) {
      notify(getApiError(e, '加载待复习卡片失败'), 'error');
      queue.value = [];
      isFinished.value = true;
    } finally {
      isLoading.value = false;
    }
  }

  /** 翻转当前卡（正面 ↔ 反面） */
  function flipCard(): void {
    if (!current.value) return;
    cardSide.value = cardSide.value === 'front' ? 'back' : 'front';
  }

  /** 提交评分：调后端推进 SM-2，成功后移除当前卡并切下一张。返回是否成功移除 */
  async function submitRating(rating: ReviewRating): Promise<boolean> {
    const c = current.value;
    if (!c) return false;
    try {
      await submitReview({ cardId: c.id, sourceType: c.sourceType, rating });
      // 统计
      stats.reviewed += 1;
      stats[rating] += 1;
      // 移除当前卡（下一张滑落到 index 0），重置为正面
      queue.value.splice(currentIndex.value, 1);
      cardSide.value = 'front';
      if (queue.value.length === 0) isFinished.value = true;
      return true;
    } catch (e) {
      notify(getApiError(e, '提交评分失败，请重试'), 'error');
      return false;
    }
  }

  /** 挂起（稍后再背）：顺延 24h，不计入评分，但同样移除当前卡推进进度 */
  async function snoozeCard(cardId: number, sourceType: ReviewSourceType): Promise<boolean> {
    try {
      await snoozeReview({ cardId, sourceType });
      stats.snoozed += 1;
      queue.value.splice(currentIndex.value, 1);
      cardSide.value = 'front';
      if (queue.value.length === 0) isFinished.value = true;
      return true;
    } catch (e) {
      notify(getApiError(e, '挂起失败，请重试'), 'error');
      return false;
    }
  }

  /** 加载复习热力图（默认近 30 天） */
  async function loadHeatmap(days = 30): Promise<void> {
    heatmapLoading.value = true;
    try {
      heatmap.value = await getReviewHeatmap(days);
    } catch (e) {
      heatmap.value = null;
      notify(getApiError(e, '加载热力图失败'), 'error');
    } finally {
      heatmapLoading.value = false;
    }
  }

  /** 加载遗忘曲线（默认近 30 天） */
  async function loadForgettingCurve(days = curveDays.value): Promise<void> {
    curveLoading.value = true;
    try {
      forgettingCurve.value = await getReviewForgettingCurve(days);
    } catch (e) {
      forgettingCurve.value = null;
      notify(getApiError(e, '加载遗忘曲线失败'), 'error');
    } finally {
      curveLoading.value = false;
    }
  }

  /** 重新开始：清空并重新拉取 */
  async function restartSession(): Promise<void> {
    await loadQueue();
  }

  return {
    queue,
    currentIndex,
    isLoading,
    isFinished,
    cardSide,
    totalCount,
    stats,
    current,
    processedCount,
    progressPct,
    heatmap,
    heatmapLoading,
    forgettingCurve,
    curveLoading,
    curveDays,
    loadQueue,
    flipCard,
    submitRating,
    snoozeCard,
    loadHeatmap,
    loadForgettingCurve,
    restartSession,
  };
});
