/**
 * useReviewStore —— 复习模块统一状态（闪卡会话 + 待复习清单 + 复习驾驶舱看板）。
 *
 * 2026-08-07 架构收敛后本 store 承担三类职责，刻意合并在一起以共用热力图/遗忘曲线缓存：
 *
 * 1) 闪卡会话（/review）：
 *    queue 是一份「待复习快照」，每处理完一张就 splice 掉队列头，currentIndex 恒为 0，
 *    这样「移除当前卡 + 跳到下一张」天然统一（下一张会滑落到 index 0）。会话状态不持久化。
 *
 * 2) 待复习清单（抽屉）：
 *    pendingList 独立于 queue —— 清单要看全量（100 张），队列只装本批 20 张，
 *    两者共用同一份 API 但生命周期不同，混用会导致「关掉抽屉后队列被撑大」。
 *
 * 3) 复习驾驶舱（/workbench/review）：
 *    heatmap / forgettingCurve / legacyDueCount 三份看板数据，由 loadDashboard() 拉取。
 *
 * ⚠️ 本轮（队列卡死修复）的三条核心不变量，改动时务必保持：
 *  A. **出队与网络结果解耦**：submitRating 无论成功、业务软失败还是抛异常，都会出队。
 *     单张卡的网络问题绝不能把用户锁死在复习界面。
 *  B. **进度分母固定**：totalCount 取自 /reviews/due-stats（与驾驶舱同源），
 *     不再用 queue.length 反推，否则自动续批后分母会跳变。
 *  C. **续批必须去重**：processedKeys 记录本会话已处理过的卡，
 *     续批时过滤掉它们——否则「保存失败但已出队」的卡会被重新拉回来，形成死循环。
 *
 * 组件用法：
 * ```ts
 * import { storeToRefs } from 'pinia'
 * import { useReviewStore } from '@/store/review-store'
 * const store = useReviewStore()
 * const { queue, current, isLoading, submitting, cardSide, stats, totalCount } = storeToRefs(store)
 * store.loadQueue(); store.flipCard(); store.submitRating('good'); store.restartSession()
 * ```
 */
import { defineStore } from 'pinia';
import { ref, reactive, computed } from 'vue';
import {
  getDueReviews,
  getDueStats,
  getReviewDay,
  batchReviews,
  submitReview,
  snoozeReview,
  adoptMnemonic,
  getReviewHeatmap,
  getReviewForgettingCurve,
  type ReviewCard,
  type ReviewRating,
  type ReviewSourceType,
  type ReviewDayResult,
  type ReviewHeatmapResult,
  type ReviewForgettingCurveResult,
} from '@/api/review';
import { getAiStatus } from '@/api/ai';
import { getReviewDueCount } from '@/api/workbench';
import { notify, getApiError } from '@/utils/toast';

/** 单批拉取张数：与后端 DEFAULT_DUE_LIMIT 对齐 */
const BATCH_SIZE = 20;
/** 清单抽屉一次看多少张 */
const LIST_SIZE = 100;

/** 卡片唯一键：id 在 note / loci 两张表里各自自增，必须带 sourceType 才唯一 */
function cardKey(sourceType: ReviewSourceType, id: number): string {
  return `${sourceType}:${id}`;
}

/** 本轮评为 hard 的卡，用于结束时生成 AI 简报 */
interface HardCardRecord {
  front: string;
  back: string;
  rating: string;
}

export const useReviewStore = defineStore('review', () => {
  /* ==================== 一、闪卡会话状态 ==================== */

  /** 当前批次的待复习卡片队列（每批最多 20 张，刷完自动续下一批） */
  const queue = ref<ReviewCard[]>([]);
  /** 当前卡片在队列中的索引（始终指向队列头，处理完即 splice 移除） */
  const currentIndex = ref(0);
  const isLoading = ref(false);
  /** 评分提交中：防连点 + 驱动按钮 loading 态。⚠️ 它不阻塞出队，只阻塞重复提交 */
  const submitting = ref(false);
  /** 正在续取下一批（队列见底但总量还没刷完） */
  const loadingMore = ref(false);
  /** 队列见底且无更多批次 → 结束视图 */
  const isFinished = ref(false);
  /** 当前卡显示正面还是反面 */
  const cardSide = ref<'front' | 'back'>('front');
  /** 本次会话开始时的**待复习总量**（进度条分母，取自 /reviews/due-stats） */
  const totalCount = ref(0);
  /** 已处理张数（评分 + 挂起），进度条分子。独立计数，不由 queue.length 反推 */
  const processedCount = ref(0);
  /** 本次会话统计：已复习张数 + 各评分档计数（结束页小统计用） */
  const stats = reactive({ reviewed: 0, hard: 0, good: 0, easy: 0, perfect: 0, snoozed: 0 });
  /** 本会话已处理过的卡片键，续批时据此去重（不变量 C） */
  const processedKeys = ref<Set<string>>(new Set());
  /** 本轮没记住的卡，结束时喂给 AI 简报 */
  const hardCards = ref<HardCardRecord[]>([]);
  /** 会话开始时间戳，用于简报里的「用时约 N 分钟」 */
  const sessionStartAt = ref(0);

  /** 当前正在复习的卡片（队列空时为 null） */
  const current = computed<ReviewCard | null>(() => queue.value[currentIndex.value] ?? null);

  /** 进度百分比：已处理 / 会话开始时的待复习总量 */
  const progressPct = computed(() =>
    totalCount.value > 0
      ? Math.min(100, Math.round((processedCount.value / totalCount.value) * 100))
      : 0,
  );
  /** 还剩多少张没处理（分母 - 分子，不为负） */
  const remainingCount = computed(() => Math.max(0, totalCount.value - processedCount.value));
  /** 本轮用时（分钟，向上取整，至少 1） */
  const elapsedMinutes = computed(() =>
    sessionStartAt.value ? Math.max(1, Math.round((Date.now() - sessionStartAt.value) / 60000)) : 0,
  );

  /* ==================== 二、待复习清单（抽屉）状态 ==================== */

  const pendingList = ref<ReviewCard[]>([]);
  const pendingLoading = ref(false);
  /** 抽屉开关，放 store 里是为了让顶栏、驾驶舱、刷题页三处都能唤起同一个抽屉 */
  const queueListVisible = ref(false);

  /* ==================== 三、驾驶舱看板状态 ==================== */

  /** 热力图数据（驾驶舱顶部展示用） */
  const heatmap = ref<ReviewHeatmapResult | null>(null);
  const heatmapLoading = ref(false);
  /** 遗忘曲线数据（驾驶舱折叠面板用） */
  const forgettingCurve = ref<ReviewForgettingCurveResult | null>(null);
  const curveLoading = ref(false);
  const curveDays = ref(30);
  /** 旧系统（wb_review_card 传统卡组）待复习张数，驾驶舱摘要标签用 */
  const legacyDueCount = ref(0);
  const legacyDueLoading = ref(false);
  /** 单日复盘（点热力图/曲线某天后弹出） */
  const dayDetail = ref<ReviewDayResult | null>(null);
  const dayDetailLoading = ref(false);
  const dayDetailVisible = ref(false);

  /* ==================== 四、AI 可用性 ==================== */

  /** AI 是否已配置可用；false 时前端隐藏/禁用 AI 按钮，避免用户点了才发现没配 Key */
  const aiReady = ref(false);
  const aiChecked = ref(false);

  /** 轻量探测，不产生模型调用；失败静默当作不可用 */
  async function ensureAiStatus(force = false): Promise<boolean> {
    if (aiChecked.value && !force) return aiReady.value;
    try {
      const s = await getAiStatus();
      aiReady.value = Boolean(s?.ready);
    } catch {
      aiReady.value = false;
    } finally {
      aiChecked.value = true;
    }
    return aiReady.value;
  }

  /* ==================== 五、闪卡会话 actions ==================== */

  /** 清空会话状态（不发请求）：路由在驾驶舱 ↔ 闪卡之间来回切时防止读到上一轮残留 */
  function resetSession(): void {
    queue.value = [];
    currentIndex.value = 0;
    cardSide.value = 'front';
    totalCount.value = 0;
    processedCount.value = 0;
    isFinished.value = false;
    submitting.value = false;
    loadingMore.value = false;
    processedKeys.value = new Set();
    hardCards.value = [];
    sessionStartAt.value = 0;
    stats.reviewed = 0;
    stats.hard = stats.good = stats.easy = stats.perfect = 0;
    stats.snoozed = 0;
  }

  /** 过滤掉本会话已处理过的卡（不变量 C：防止失败卡被续批拉回造成死循环） */
  function excludeProcessed(list: ReviewCard[]): ReviewCard[] {
    return list.filter((c) => !processedKeys.value.has(cardKey(c.sourceType, c.id)));
  }

  /**
   * 拉取首批卡片并初始化会话。
   * 队列与总量并行请求：总量失败不影响刷题（分母退化为本批张数），反之亦然。
   */
  async function loadQueue(): Promise<void> {
    isLoading.value = true;
    resetSession();
    sessionStartAt.value = Date.now();
    try {
      const [list, statsRes] = await Promise.all([
        getDueReviews(BATCH_SIZE),
        // 分母拿不到不算致命错误，兜底用本批张数，进度条仍可用
        getDueStats().catch(() => null),
      ]);
      queue.value = Array.isArray(list) ? list : [];
      totalCount.value = statsRes?.total ?? queue.value.length;
      isFinished.value = queue.value.length === 0;
    } catch (e) {
      notify(getApiError(e, '加载待复习卡片失败'), 'error');
      queue.value = [];
      isFinished.value = true;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 队列见底时续取下一批（「无限滚动」）。
   *
   * 终止条件有两道保险：
   *  ① 后端返回空数组 → 真的没有到期卡了；
   *  ② 去重后为空 → 剩下的都是本会话处理过、但因保存失败仍挂在到期列表里的卡，
   *    再拉也是同一批，直接收尾，绝不重复投喂。
   */
  async function loadNextBatch(): Promise<boolean> {
    if (loadingMore.value) return false;
    loadingMore.value = true;
    try {
      const list = await getDueReviews(BATCH_SIZE);
      const fresh = excludeProcessed(Array.isArray(list) ? list : []);
      if (fresh.length === 0) {
        isFinished.value = true;
        return false;
      }
      queue.value = fresh;
      currentIndex.value = 0;
      cardSide.value = 'front';
      return true;
    } catch (e) {
      // 续批失败不该把用户卡在空白页，直接进结束页，让他手动「再来一轮」
      notify(getApiError(e, '加载下一批失败'), 'error');
      isFinished.value = true;
      return false;
    } finally {
      loadingMore.value = false;
    }
  }

  /**
   * 出队 + 推进。所有「处理完一张卡」的路径都收敛到这里，保证行为一致。
   * ⚠️ 调用方必须在**卡片飞出动画结束之后**才调用，否则会看到卡片瞬间闪变。
   */
  async function advanceQueue(card: ReviewCard): Promise<void> {
    processedKeys.value.add(cardKey(card.sourceType, card.id));
    processedCount.value += 1;
    queue.value.splice(currentIndex.value, 1);
    cardSide.value = 'front';
    // 同步把这张从清单里摘掉，抽屉再打开时不会出现幽灵卡
    const li = pendingList.value.findIndex(
      (c) => c.id === card.id && c.sourceType === card.sourceType,
    );
    if (li >= 0) pendingList.value.splice(li, 1);

    if (queue.value.length === 0) {
      // 分母还没走完就续批；走完了直接收尾（避免多打一次无用请求）
      if (processedCount.value < totalCount.value) await loadNextBatch();
      else isFinished.value = true;
    }
  }

  /** 翻转当前卡（正面 ↔ 反面） */
  function flipCard(): void {
    if (!current.value) return;
    cardSide.value = cardSide.value === 'front' ? 'back' : 'front';
  }

  /**
   * 提交评分：调后端推进 SM-2，**无论结果如何都出队**（不变量 A）。
   *
   * 三条路径：
   *  - 200 且 ok=true   → 正常计入统计；
   *  - 200 且 ok=false  → 卡片已被删除 / 服务端落库失败，Toast 告知，仍出队；
   *  - 抛异常（超时、断网、5xx）→ Toast「保存评分失败」，仍出队。
   *
   * 返回值只表示「评分是否成功保存」，不表示「是否出队」——出队是无条件的。
   */
  async function submitRating(rating: ReviewRating): Promise<boolean> {
    const c = current.value;
    if (!c) return false;
    if (submitting.value) return false; // 防连点重复提交同一张
    submitting.value = true;

    let saved = false;
    try {
      const res = await submitReview({ cardId: c.id, sourceType: c.sourceType, rating });
      if (res && res.ok === false) {
        // 业务软失败：后端刻意用 200 回报，这里只提示不阻断
        notify(res.message || '该卡片已跳过', 'warning');
      } else {
        saved = true;
        stats.reviewed += 1;
        stats[rating] += 1;
        if (rating === 'hard') {
          hardCards.value.push({ front: c.front, back: c.back, rating });
        }
      }
    } catch (e) {
      // ⚠️ 关键：网络/超时异常也必须继续出队，否则用户被锁死在这张卡上
      notify(getApiError(e, '保存评分失败，已跳过该卡'), 'error');
    } finally {
      submitting.value = false;
    }

    await advanceQueue(c);
    return saved;
  }

  /**
   * 挂起（稍后再背）：顺延 24h，不计入评分，但同样出队推进进度。
   * @param silentToast 「换一批」按钮批量触发时不弹成功提示，避免刷屏
   */
  async function snoozeCard(
    cardId: number,
    sourceType: ReviewSourceType,
    silentToast = false,
  ): Promise<boolean> {
    const target =
      queue.value.find((c) => c.id === cardId && c.sourceType === sourceType) ||
      pendingList.value.find((c) => c.id === cardId && c.sourceType === sourceType);
    try {
      await snoozeReview({ cardId, sourceType });
      stats.snoozed += 1;
      if (!silentToast) notify('已挂起 24 小时', 'success');
    } catch (e) {
      // 429（1 小时内重复挂起）也走这里：提示即可，卡片照样跳过，不阻断刷题
      notify(getApiError(e, '挂起失败，已跳过该卡'), 'error');
    }

    // 挂起的是当前卡 → 走统一出队；否则只从清单里摘掉
    if (target && current.value && current.value.id === cardId && current.value.sourceType === sourceType) {
      await advanceQueue(target);
    } else {
      const li = pendingList.value.findIndex(
        (c) => c.id === cardId && c.sourceType === sourceType,
      );
      if (li >= 0) pendingList.value.splice(li, 1);
      const qi = queue.value.findIndex((c) => c.id === cardId && c.sourceType === sourceType);
      if (qi >= 0) {
        // 挂起的是队列里靠后的卡：直接摘掉并计入已处理，保持分子分母一致
        processedKeys.value.add(cardKey(sourceType, cardId));
        processedCount.value += 1;
        queue.value.splice(qi, 1);
      }
    }
    return true;
  }

  /** 「换一批」：不评分，直接把当前卡挂起 24h 并跳下一张 */
  async function shuffleCurrent(): Promise<void> {
    const c = current.value;
    if (!c || submitting.value) return;
    submitting.value = true;
    try {
      await snoozeCard(c.id, c.sourceType, true);
      notify('已换下一张，该卡 24 小时后再见', 'info');
    } finally {
      submitting.value = false;
    }
  }

  /* ==================== 六、待复习清单 actions ==================== */

  /** 拉取全量待复习清单（抽屉用，最多 100 张） */
  async function loadPendingList(): Promise<void> {
    pendingLoading.value = true;
    try {
      const list = await getDueReviews(LIST_SIZE);
      pendingList.value = Array.isArray(list) ? list : [];
    } catch (e) {
      notify(getApiError(e, '加载待复习清单失败'), 'error');
      pendingList.value = [];
    } finally {
      pendingLoading.value = false;
    }
  }

  /** 批量操作（待复习清单多选）：标记已掌握 / 挂起，成功后重拉清单 */
  async function batchAction(
    items: { cardId: number; sourceType: ReviewSourceType }[],
    action: 'mastered' | 'snooze',
    days?: number,
  ): Promise<void> {
    if (!items.length) return
    try {
      const res = await batchReviews(items, action, days)
      notify(`已处理 ${res.ok} 张卡片${res.skipped ? `，跳过 ${res.skipped} 张` : ''}`, 'success')
      await loadPendingList()
    } catch (e) {
      notify(getApiError(e, '批量操作失败'), 'error')
    }
  }

  function openQueueList(): void {
    queueListVisible.value = true;
    void loadPendingList();
  }
  function closeQueueList(): void {
    queueListVisible.value = false;
  }

  /**
   * 把指定卡片顶到队首（清单里点某张 → 跳到刷题页优先复习它）。
   *
   * 两种情况：
   *  - 卡已在当前批队列里 → 原地挪到 index 0；
   *  - 不在（属于后面批次）→ 直接 unshift 进去，它就是下一张。
   * 无论哪种都重置为正面，避免继承上一张的翻面状态。
   */
  function promoteCard(card: ReviewCard): void {
    const i = queue.value.findIndex((c) => c.id === card.id && c.sourceType === card.sourceType);
    if (i > 0) {
      const [target] = queue.value.splice(i, 1);
      queue.value.unshift(target);
    } else if (i < 0) {
      queue.value.unshift(card);
    }
    currentIndex.value = 0;
    cardSide.value = 'front';
    isFinished.value = false;
  }

  /* ==================== 七、助记口诀 ==================== */

  /**
   * 采纳助记口诀 → 写入源表 image_hint，并同步更新本地队列/清单里的副本，
   * 这样用户不用刷新就能在卡片底部看到「已采纳」。
   */
  async function applyMnemonic(
    cardId: number,
    sourceType: ReviewSourceType,
    mnemonic: string,
  ): Promise<boolean> {
    try {
      await adoptMnemonic({ cardId, sourceType, mnemonic });
      const patch = (list: ReviewCard[]) => {
        const c = list.find((x) => x.id === cardId && x.sourceType === sourceType);
        if (c) c.imageHint = mnemonic || null;
      };
      patch(queue.value);
      patch(pendingList.value);
      notify('口诀已保存到卡片', 'success');
      return true;
    } catch (e) {
      notify(getApiError(e, '保存口诀失败'), 'error');
      return false;
    }
  }

  /* ==================== 八、驾驶舱看板 actions ==================== */

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

  /** 点某天 → 拉当日明细并打开弹窗。空数据也照常开窗，弹窗内自己渲染空态 */
  async function openDayDetail(date: string): Promise<void> {
    dayDetailVisible.value = true;
    dayDetailLoading.value = true;
    dayDetail.value = null;
    try {
      dayDetail.value = await getReviewDay(date);
    } catch (e) {
      notify(getApiError(e, '加载当日复习明细失败'), 'error');
      dayDetailVisible.value = false;
    } finally {
      dayDetailLoading.value = false;
    }
  }

  function closeDayDetail(): void {
    dayDetailVisible.value = false;
    dayDetail.value = null;
  }

  /** 加载旧系统待复习数；失败静默降级为 0，不打断驾驶舱渲染 */
  async function loadLegacyDueCount(): Promise<void> {
    legacyDueLoading.value = true;
    try {
      const res = await getReviewDueCount();
      legacyDueCount.value = res?.count ?? 0;
    } catch {
      legacyDueCount.value = 0;
    } finally {
      legacyDueLoading.value = false;
    }
  }

  /**
   * 驾驶舱首屏聚合加载：热力图由 ReviewHeatmap 组件自行按格子数请求，
   * 这里只补齐「旧系统计数」，遗忘曲线留给折叠面板懒加载（省一次请求）。
   */
  async function loadDashboard(): Promise<void> {
    await loadLegacyDueCount();
  }

  /** 重新开始：清空并重新拉取 */
  async function restartSession(): Promise<void> {
    await loadQueue();
  }

  return {
    // 闪卡会话
    queue,
    currentIndex,
    isLoading,
    submitting,
    loadingMore,
    isFinished,
    cardSide,
    totalCount,
    processedCount,
    stats,
    hardCards,
    current,
    progressPct,
    remainingCount,
    elapsedMinutes,
    resetSession,
    loadQueue,
    loadNextBatch,
    flipCard,
    submitRating,
    snoozeCard,
    shuffleCurrent,
    restartSession,
    // 待复习清单
    pendingList,
    pendingLoading,
    queueListVisible,
    loadPendingList,
    openQueueList,
    closeQueueList,
    promoteCard,
    batchAction,
    // 助记口诀
    applyMnemonic,
    // AI 可用性
    aiReady,
    aiChecked,
    ensureAiStatus,
    // 驾驶舱看板
    heatmap,
    heatmapLoading,
    forgettingCurve,
    curveLoading,
    curveDays,
    legacyDueCount,
    legacyDueLoading,
    dayDetail,
    dayDetailLoading,
    dayDetailVisible,
    loadHeatmap,
    loadForgettingCurve,
    openDayDetail,
    closeDayDetail,
    loadLegacyDueCount,
    loadDashboard,
  };
});
