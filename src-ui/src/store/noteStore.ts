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
import { createNote, deleteNote, listNotes } from '@/api/workbench';
import type { WbNote, WbNotePayload } from '@/api/types';

/** 列表视图模式 */
export type NoteViewMode = 'grid' | 'list';

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
    const loading = ref(false);
    const submitting = ref(false);
    const keyword = ref('');

    const total = computed(() => notes.value.length);

    /** 待复习数量：due_date 已到期且此前复习过的笔记 */
    const dueCount = computed(
      () => notes.value.filter((n) => isNoteDue(n)).length,
    );

    /** 从未复习过的笔记数（dueDate 默认是 1970，天然在队列里，但语义是「首学」而非「遗忘」） */
    const newCount = computed(
      () => notes.value.filter((n) => getNoteSrsState(n) === 'new').length,
    );

    /** 平均掌握度，用于列表页概览；空列表返回 0 */
    const avgMastery = computed(() => {
      if (!notes.value.length) return 0;
      const sum = notes.value.reduce((acc, n) => acc + (n.mastery || 0), 0);
      return Math.round(sum / notes.value.length);
    });

    async function fetchNotes(params: { keyword?: string } = {}) {
      loading.value = true;
      try {
        const kw = (params.keyword ?? keyword.value).trim();
        notes.value = await listNotes(kw ? { keyword: kw } : {});
      } finally {
        loading.value = false;
      }
    }

    /** 删除：乐观移除，失败按原索引回滚 */
    async function removeNote(id: number) {
      const idx = notes.value.findIndex((n) => n.id === id);
      const snapshot = idx === -1 ? null : notes.value.splice(idx, 1)[0];
      submitting.value = true;
      try {
        await deleteNote(id);
      } catch (e) {
        if (snapshot) notes.value.splice(idx, 0, snapshot);
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
      // 弹窗
      quickCreateOpen,
      openQuickCreate,
      closeQuickCreate,
      toggleQuickCreate,
      // 数据
      notes,
      loading,
      submitting,
      keyword,
      total,
      dueCount,
      newCount,
      avgMastery,
      fetchNotes,
      removeNote,
      quickCreate,
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

export function isNoteDue(n: Pick<WbNote, 'dueDate' | 'reviewCount'>): boolean {
  return getNoteSrsState(n) === 'due';
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
