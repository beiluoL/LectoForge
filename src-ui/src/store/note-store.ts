/**
 * 康奈尔笔记模块状态（Pinia setup store）
 *
 * 职责边界：
 * - 布局：三栏（线索 / 笔记 / 总结）的拖拽比例，落 localStorage 持久化，
 *   保证用户下次进来仍是自己调好的版式；
 * - 视图：列表页「网格卡片 / 紧凑列表」双模式偏好，同样持久化；
 * - 弹窗：全局极速新建笔记浮窗（Cmd/Ctrl+Shift+F）的开关；
 * - 数据：笔记列表的加载 / 删除（列表页统一从这里取数，避免组件内散落 ref）。
 *
 * 持久化说明：pinia-plugin-persistedstate v4 用 `pick`（不是 v3 的 `paths`），
 * 这里只把「用户偏好」入盘，列表数据等运行时状态不落地，避免数据漂移。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  createNote,
  deleteNote,
  getNoteStats,
  listNoteBacklinks,
  listNoteTags,
  listNotes,
  type ListNotesParams,
  type NoteBacklink,
  type NoteStats,
  type NoteTagCount,
} from '@/api/workbench';
import type { WbNote, WbNotePayload } from '@/api/types';

/** 列表视图模式 */
export type NoteViewMode = 'grid' | 'list';

/**
 * 智慧筛选器标识。
 * 之所以用「互斥的单选」而不是多个 boolean：这两条是两种截然不同的复盘动机
 * （攻克薄弱 vs 补完半成品），同时勾选往往筛出空集，反而让用户以为功能坏了。
 */
export type NoteSmartFilter = 'none' | 'lowMastery' | 'noSummary';

/** 「掌握度低」的判定阈值，与后端 mastery_lte 参数对齐 */
export const LOW_MASTERY_THRESHOLD = 30;

/**
 * 列表每页条数，必须与后端 lib/pagination.ts 的 NOTES_PAGE_SIZE 保持一致。
 *
 * 前端显式传值而不是依赖后端默认：一旦两侧默认值哪天不同步，
 * 「已加载数 vs 总数」的比较就会失准，滚动加载要么早停要么空转。
 * 显式传参把这条契约摆到明面上。
 */
export const NOTES_PAGE_SIZE = 30;

/** 三栏比例边界：防止用户把任意一栏拖到不可用尺寸 */
export const CUE_RATIO_MIN = 0.16;
export const CUE_RATIO_MAX = 0.5;
export const SUMMARY_RATIO_MIN = 0.12;
export const SUMMARY_RATIO_MAX = 0.5;

/** 默认版式：线索栏 26% 宽、总结栏 22% 高，贴近康奈尔纸质模板比例 */
export const DEFAULT_CUE_RATIO = 0.26;
export const DEFAULT_SUMMARY_RATIO = 0.22;

/** 三栏布局比例（0~1 的小数，相对编辑区容器） */
export interface CornellLayout {
  /** 线索栏宽度占比 */
  cueRatio: number;
  /** 总结栏高度占比 */
  summaryRatio: number;
}

function clamp(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export const useNoteStore = defineStore(
  'note',
  () => {
    // ==================== 布局（持久化） ====================

    const layout = ref<CornellLayout>({
      cueRatio: DEFAULT_CUE_RATIO,
      summaryRatio: DEFAULT_SUMMARY_RATIO,
    });

    /** 供 CSS 变量直接消费的百分比字符串，避免组件里重复算 */
    const cuePercent = computed(() => `${(layout.value.cueRatio * 100).toFixed(3)}%`);
    const summaryPercent = computed(() => `${(layout.value.summaryRatio * 100).toFixed(3)}%`);

    /** 拖拽垂直分割线：设置线索栏宽度占比 */
    function setCueRatio(ratio: number) {
      layout.value.cueRatio = clamp(ratio, CUE_RATIO_MIN, CUE_RATIO_MAX, DEFAULT_CUE_RATIO);
    }

    /** 拖拽水平分割线：设置总结栏高度占比 */
    function setSummaryRatio(ratio: number) {
      layout.value.summaryRatio = clamp(ratio, SUMMARY_RATIO_MIN, SUMMARY_RATIO_MAX, DEFAULT_SUMMARY_RATIO);
    }

    /** 双击分割线复位到默认版式 */
    function resetLayout() {
      layout.value = { cueRatio: DEFAULT_CUE_RATIO, summaryRatio: DEFAULT_SUMMARY_RATIO };
    }

    // ==================== 列表视图偏好（持久化） ====================

    const viewMode = ref<NoteViewMode>('grid');
    function setViewMode(mode: NoteViewMode) {
      viewMode.value = mode;
    }
    function toggleViewMode() {
      viewMode.value = viewMode.value === 'grid' ? 'list' : 'grid';
    }

    // ==================== 沉浸阅读模式（不持久化） ====================

    /**
     * 全屏阅读开关。刻意不持久化：全屏是「此刻要读」的临时态，
     * 若跨会话保留，用户下次进来会看到一个没有工具栏的页面，误以为编辑功能没了。
     */
    const fullscreenMode = ref(false);
    function enterFullscreen() {
      fullscreenMode.value = true;
    }
    function exitFullscreen() {
      fullscreenMode.value = false;
    }
    function toggleFullscreen() {
      fullscreenMode.value = !fullscreenMode.value;
    }

    // ==================== 极速新建浮窗（不持久化） ====================

    const quickCreateOpen = ref(false);
    function openQuickCreate() {
      quickCreateOpen.value = true;
    }
    function closeQuickCreate() {
      quickCreateOpen.value = false;
    }
    function toggleQuickCreate() {
      quickCreateOpen.value = !quickCreateOpen.value;
    }

    // ==================== 列表数据（不持久化） ====================

    const notes = ref<WbNote[]>([]);
    /** 首屏 / 换筛选条件时的加载（会整屏换骨架屏） */
    const loading = ref(false);
    /** 追加下一页时的加载（只在列表底部显示，不打断已渲染内容） */
    const loadingMore = ref(false);
    const submitting = ref(false);
    const keyword = ref('');
    /** 当前已加载到第几页，从 1 开始 */
    const page = ref(1);

    /**
     * 头部统计。分页之后不能再用 notes.length 之类的本地推导——
     * 那只反映「已加载」的部分，会随下滚一路变大。这四个数由服务端 SQL
     * 聚合直出，套用与列表完全相同的筛选条件。
     */
    const stats = ref<NoteStats>({ total: 0, due: 0, unreviewed: 0, avgMastery: 0 });

    const total = computed(() => stats.value.total);
    /** 待复习数量：已复习过且 due_date 已到期 */
    const dueCount = computed(() => stats.value.due);
    /** 从未复习过的笔记数（语义是「首学」而非「遗忘」） */
    const newCount = computed(() => stats.value.unreviewed);
    /** 平均掌握度，空结果集为 0 */
    const avgMastery = computed(() => stats.value.avgMastery);

    /**
     * 是否还有下一页。
     *
     * 用「已加载条数 < 总数」判定，而不是「上一页是否装满」：
     * 后者在「总数恰好是页大小整数倍」时会多发一次注定为空的请求，
     * 而我们本来就拿得到精确 total，没必要靠猜。
     */
    const hasMore = computed(() => notes.value.length < stats.value.total);

    // ==================== 标签云 & 智慧筛选器（不持久化） ====================

    const tags = ref<NoteTagCount[]>([]);
    const tagsLoading = ref(false);
    /** 当前选中的标签，空串表示不按标签过滤 */
    const activeTag = ref('');
    const smartFilter = ref<NoteSmartFilter>('none');

    /** 是否有任一筛选条件生效（关键词也算），用于列表页显示「清空筛选」 */
    const hasActiveFilter = computed(
      () => !!keyword.value.trim() || !!activeTag.value || smartFilter.value !== 'none',
    );

    /** 标签云里出现频次最高的一批，列表页只渲染前 N 个避免刷屏 */
    function topTags(limit = 24): NoteTagCount[] {
      return tags.value.slice(0, limit);
    }

    async function fetchTags() {
      tagsLoading.value = true;
      try {
        tags.value = await listNoteTags();
      } finally {
        tagsLoading.value = false;
      }
    }

    /** 点同一个标签 = 取消选中，符合「标签云即开关」的直觉 */
    async function selectTag(name: string) {
      activeTag.value = activeTag.value === name ? '' : name;
      await fetchNotes();
    }

    async function setSmartFilter(f: NoteSmartFilter) {
      smartFilter.value = smartFilter.value === f ? 'none' : f;
      await fetchNotes();
    }

    async function clearFilters() {
      keyword.value = '';
      activeTag.value = '';
      smartFilter.value = 'none';
      await fetchNotes();
    }

    /**
     * 拼装当前筛选条件（不含分页）。
     *
     * 列表、下一页、统计三处请求共用同一个出口：任何筛选项只要在这里加一次，
     * 三处就同时生效，不会出现「列表按标签筛了、统计没筛」的错位。
     */
    function buildQuery(kwOverride?: string): ListNotesParams {
      const kw = (kwOverride ?? keyword.value).trim();
      const query: ListNotesParams = {};
      if (kw) query.keyword = kw;
      if (activeTag.value) query.tag = activeTag.value;
      if (smartFilter.value === 'lowMastery') query.mastery_lte = LOW_MASTERY_THRESHOLD;
      if (smartFilter.value === 'noSummary') query.has_summary = false;
      return query;
    }

    /**
     * 拉取第一页并同步统计（换关键词 / 换标签 / 换筛选器都走这里）。
     *
     * 筛选条件一律以查询参数下推到 SQL，不在前端 filter——
     * 标签匹配要处理 JSON / CSV 两种历史格式，前端复刻一遍必然与标签云的计数对不上。
     *
     * 列表与统计并发发出：两者互不依赖，串行只会白白多等一个往返。
     */
    async function fetchNotes(params: { keyword?: string } = {}) {
      loading.value = true;
      page.value = 1;
      try {
        const query = buildQuery(params.keyword);
        const [rows, s] = await Promise.all([
          listNotes({ ...query, page: 1, pageSize: NOTES_PAGE_SIZE }),
          getNoteStats(query),
        ]);
        notes.value = rows;
        stats.value = s;
      } finally {
        loading.value = false;
      }
    }

    /**
     * 追加下一页（滚动到底部时触发）。
     *
     * 三重防护，缺一不可：
     * 1. 并发闸门——观察器在快速滚动时会连发，不拦住会同页重复请求；
     * 2. id 去重——offset 分页期间若有笔记被删/新增，窗口会平移并回带已有行，
     *    直接 push 会产生重复 `:key`，Vue 会渲染错乱并在控制台刷警告；
     * 3. 空返回时把 total 收敛到实际条数——否则 hasMore 恒真，
     *    观察器会永远重试，变成一个静默的请求死循环。
     */
    async function loadMore() {
      if (loading.value || loadingMore.value || !hasMore.value) return;
      loadingMore.value = true;
      const next = page.value + 1;
      try {
        const rows = await listNotes({ ...buildQuery(), page: next, pageSize: NOTES_PAGE_SIZE });
        if (!rows.length) {
          stats.value = { ...stats.value, total: notes.value.length };
          return;
        }
        const seen = new Set(notes.value.map((n) => n.id));
        const fresh = rows.filter((r) => !seen.has(r.id));
        if (fresh.length) notes.value.push(...fresh);
        page.value = next;
      } finally {
        loadingMore.value = false;
      }
    }

    /**
     * 单独刷新统计（删除笔记后调用）。
     * 失败静默：统计是辅助信息，不该因为它拉不到就打断主流程。
     */
    async function refreshStats() {
      try {
        stats.value = await getNoteStats(buildQuery());
      } catch {
        /* 保留上一次的数字，好过闪成 0 */
      }
    }

    // ==================== 反向引用（不持久化） ====================

    const backlinks = ref<NoteBacklink[]>([]);
    const backlinksLoading = ref(false);

    /** 拉取「谁引用了我」；切换笔记时先清空，避免闪现上一篇的引用列表 */
    async function fetchBacklinks(id: number) {
      backlinks.value = [];
      if (!id) return;
      backlinksLoading.value = true;
      try {
        backlinks.value = await listNoteBacklinks(id);
      } catch {
        // 反向引用是增强信息，拉不到就静默留空，不打断笔记编辑主流程
        backlinks.value = [];
      } finally {
        backlinksLoading.value = false;
      }
    }

    /**
     * 删除：乐观移除，失败按原索引回滚。
     *
     * 统计要跟着一起乐观递减，否则头部会短暂出现「共 12 则」但列表只剩 11 条。
     * 成功后再异步校准一次：due / unreviewed / avgMastery 具体掉哪个
     * 取决于被删笔记的状态，前端猜不准，交给服务端重算最省心。
     */
    async function removeNote(id: number) {
      const idx = notes.value.findIndex((n) => n.id === id);
      const snapshot = idx === -1 ? null : notes.value.splice(idx, 1)[0];
      const statsSnapshot = stats.value;
      if (snapshot) stats.value = { ...stats.value, total: Math.max(0, stats.value.total - 1) };
      submitting.value = true;
      try {
        await deleteNote(id);
        void refreshStats();
      } catch (e) {
        if (snapshot) {
          notes.value.splice(idx, 0, snapshot);
          stats.value = statsSnapshot;
        }
        throw e;
      } finally {
        submitting.value = false;
      }
    }

    /** 极速新建：只要标题与笔记列，创建后返回新 id 由调用方跳转 */
    async function quickCreate(payload: WbNotePayload): Promise<number> {
      submitting.value = true;
      try {
        return await createNote(payload);
      } finally {
        submitting.value = false;
      }
    }

    return {
      // 布局
      layout,
      cuePercent,
      summaryPercent,
      setCueRatio,
      setSummaryRatio,
      resetLayout,
      // 视图
      viewMode,
      setViewMode,
      toggleViewMode,
      // 沉浸阅读
      fullscreenMode,
      enterFullscreen,
      exitFullscreen,
      toggleFullscreen,
      // 弹窗
      quickCreateOpen,
      openQuickCreate,
      closeQuickCreate,
      toggleQuickCreate,
      // 数据
      notes,
      loading,
      loadingMore,
      submitting,
      keyword,
      page,
      stats,
      hasMore,
      total,
      dueCount,
      newCount,
      avgMastery,
      fetchNotes,
      loadMore,
      refreshStats,
      removeNote,
      quickCreate,
      // 标签云 & 智慧筛选
      tags,
      tagsLoading,
      activeTag,
      smartFilter,
      hasActiveFilter,
      topTags,
      fetchTags,
      selectTag,
      setSmartFilter,
      clearFilters,
      // 反向引用
      backlinks,
      backlinksLoading,
      fetchBacklinks,
    };
  },
  // v4 用 pick（v3 的 paths 已移除）：只持久化用户偏好，列表数据不入盘
  {
    persist: {
      key: 'kf:note',
      storage: localStorage,
      pick: ['layout', 'viewMode'],
    },
  },
);

/**
 * 笔记的间隔复习状态。
 * - `new`       ：从未复习过（reviewCount 为 0），不打「需复习」红标，避免整屏刷红；
 * - `due`       ：due_date 早于今天 23:59:59，需要今天复习；
 * - `scheduled` ：已排程到未来某天。
 */
export type NoteSrsState = 'new' | 'due' | 'scheduled';

function endOfToday(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function getNoteSrsState(n: Pick<WbNote, 'dueDate' | 'reviewCount'>): NoteSrsState {
  if (!n.reviewCount) return 'new';
  if (!n.dueDate) return 'scheduled';
  const t = new Date(n.dueDate).getTime();
  if (!Number.isFinite(t)) return 'scheduled';
  return t <= endOfToday() ? 'due' : 'scheduled';
}

/**
 * 解析 wb_note.tags。
 *
 * 历史包袱：这一列存在两种格式——收集箱「一键沉淀」写的是 JSON 数组字符串
 * `["灵感","分布式"]`，笔记编辑页写的是逗号分隔 `灵感,分布式`。
 * 读取端一律走这里做容错，避免标签渲染成 `#["灵感"` 这种碎片。
 */
export function parseTags(raw?: string | null): string[] {
  const s = (raw || '').trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        return arr.map((t) => String(t ?? '').trim()).filter(Boolean);
      }
    } catch {
      /* 不是合法 JSON 就退回逗号分隔 */
    }
  }
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}

/** 距离下次复习还有几天（向上取整，最小 1） */
export function daysUntilDue(dueDate?: string): number {
  if (!dueDate) return 0;
  const t = new Date(dueDate).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(1, Math.ceil((t - Date.now()) / 86400000));
}
