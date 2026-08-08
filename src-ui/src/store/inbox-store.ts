import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  archiveInbox,
  batchProcessInbox,
  checkDuplicate,
  clipUrl,
  createInbox,
  deleteInbox,
  fetchInboxList,
  fetchMetadata,
  processInbox,
  suggestTags as apiSuggestTags,
  updateInbox,
  uploadInboxAsset,
  uploadInboxAudio,
  type BatchProcessResult,
  type BatchTarget,
  type ClipResult,
  type CreateInboxPayload,
  type DuplicateCheckPayload,
  type DuplicateCheckResult,
  type InboxFilter,
  type InboxItem,
  type ProcessOptions,
  type ProcessResult,
  type ProcessTarget,
  type TagSuggestResult,
  type UploadResult,
} from '@/api/inbox';

/** 速记弹窗预填内容（浏览器剪藏深链 lectoforge://capture 唤起时携带） */
export interface QuickPrefill {
  title?: string;
  content?: string;
  sourceUrl?: string;
  tags?: string[];
}

/**
 * 收集箱状态（知识闭环第一步）。
 *
 * 设计要点：
 * - 列表只装「未处理」条目；归档 / 删除 / 沉淀后立刻从本地数组摘掉（乐观更新），
 *   不重新拉全量，避免卡片流闪一下。失败时回滚并抛错给调用方弹 toast。
 * - clip() 只负责抓取、不落库，抓取结果交给 QuickCapture 填表单，用户确认后才 create()。
 * - 全局速记弹窗（Cmd/Ctrl+Shift+I）的开关收敛到本 store（openQuickCapture/closeQuickCapture），
 *   由 App.vue 的 keydown 调用；filters 通过 persistedstate 持久化（仅筛选/排序偏好）。
 */
export const useInboxStore = defineStore(
  'inbox',
  () => {
    const items = ref<InboxItem[]>([]);
    const loading = ref(false);
    /** 提交 / 沉淀 / 删除等写操作的进行中标记，用于禁用按钮防重复点击 */
    const submitting = ref(false);
    /** 剪藏抓取中（URL 粘贴后的防抖结束到结果返回这段） */
    const clipping = ref(false);
    const error = ref('');

    /** 全局速记弹窗开关（Cmd/Ctrl+Shift+I 唤起） */
    const quickOpen = ref(false);
    /**
     * 弹窗预填内容。由浏览器剪藏深链（lectoforge://capture?url=...&title=...）写入，
     * QuickCapture 挂载时读取并 consume 掉，避免下次手动唤起还残留上次的剪藏内容。
     */
    const quickPrefill = ref<QuickPrefill | null>(null);

    function openQuickCapture(prefill?: QuickPrefill) {
      if (prefill) quickPrefill.value = prefill;
      quickOpen.value = true;
    }
    function closeQuickCapture() {
      quickOpen.value = false;
      quickPrefill.value = null;
    }
    function toggleQuickCapture() {
      if (quickOpen.value) closeQuickCapture();
      else openQuickCapture();
    }
    /** 取出预填内容并立刻清空（一次性消费语义，防止残留） */
    function consumePrefill(): QuickPrefill | null {
      const p = quickPrefill.value;
      quickPrefill.value = null;
      return p;
    }

    /** 列表排序：desc=最新优先（默认），asc=最旧优先（收件箱积压视图） */
    const sort = ref<'desc' | 'asc'>('desc');
    /** 智能过滤维度：全部 / 今天 / 本周 / 未打标签（服务端过滤，避免前端翻全量） */
    const filter = ref<InboxFilter>('all');
    /** 用户筛选 / 视图偏好（仅此 ref 持久化） */
    const filters = ref<{ sort: 'desc' | 'asc'; filter: InboxFilter }>({ sort: 'desc', filter: 'all' });

    /* ===== 批量操作模式 =====
     * selectedIds 用 Set 而非数组：勾选/取消是高频操作，Set 的 has/delete 是 O(1)，
     * 且天然去重。对外再暴露一个 selectedCount 计算属性给工具栏显示。 */
    const isBatchMode = ref(false);
    const selectedIds = ref<Set<number>>(new Set());
    const selectedCount = computed(() => selectedIds.value.size);
    /** 当前列表是否已全选（列表为空时视为未全选，避免"全选"按钮在空列表上高亮） */
    const isAllSelected = computed(
      () => items.value.length > 0 && selectedIds.value.size === items.value.length,
    );

    function isSelected(id: number) {
      return selectedIds.value.has(id);
    }
    function toggleSelect(id: number) {
      // Set 是浅响应的，必须整体换引用才能触发依赖更新
      const next = new Set(selectedIds.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      selectedIds.value = next;
    }
    function selectAll() {
      selectedIds.value = new Set(items.value.map((it) => it.id));
    }
    function clearSelection() {
      selectedIds.value = new Set();
    }
    function toggleSelectAll() {
      if (isAllSelected.value) clearSelection();
      else selectAll();
    }
    /** 进入 / 退出多选模式；退出时一并清空已勾选，避免下次进入残留 */
    function setBatchMode(on: boolean) {
      isBatchMode.value = on;
      if (!on) clearSelection();
    }
    function toggleBatchMode() {
      setBatchMode(!isBatchMode.value);
    }

    /** 未处理条目数量（顶栏 / 首页气泡可复用） */
    const total = computed(() => items.value.length);

    /** 全部出现过的标签，供 QuickCapture 的标签选择器做候选 */
    const allTags = computed(() => {
      const set = new Set<string>();
      items.value.forEach((it) => it.tags.forEach((t) => set.add(t)));
      return Array.from(set);
    });

    /** 拉取未处理列表（排序 + 智能过滤都在服务端做） */
    async function loadInbox(overrideSort?: 'desc' | 'asc', overrideFilter?: InboxFilter) {
      const useSort = overrideSort || filters.value.sort || sort.value;
      const useFilter = overrideFilter || filters.value.filter || filter.value;
      sort.value = useSort;
      filter.value = useFilter;
      filters.value = { sort: useSort, filter: useFilter };
      loading.value = true;
      error.value = '';
      try {
        items.value = await fetchInboxList(useSort, useFilter);
      } catch (e) {
        // api/request.ts 的四个失败出口抛的都是 Error（含 AxiosError 子类），故窄化后语义不变
        error.value = (e instanceof Error ? e.message : '') || '收集箱加载失败';
        items.value = [];
      } finally {
        /* 过滤后列表内容变了，已勾选的 id 可能已不在视野内。
         * 保留仍然可见的那部分，剔除已被过滤掉的，避免"看不见却被批量删掉"。 */
        if (selectedIds.value.size) {
          const visible = new Set(items.value.map((it) => it.id));
          selectedIds.value = new Set([...selectedIds.value].filter((id) => visible.has(id)));
        }
        loading.value = false;
      }
    }

    /** 切换智能过滤维度并立即重新拉取 */
    async function setFilter(next: InboxFilter) {
      if (filter.value === next) return;
      await loadInbox(undefined, next);
    }

    /** 抓取网页元数据（/clip，摘要 120 字，不落库）；后端已优雅降级，这里只管 loading 开关 */
    async function clip(url: string): Promise<ClipResult | null> {
      clipping.value = true;
      try {
        return await clipUrl(url);
      } catch {
        return null;
      } finally {
        clipping.value = false;
      }
    }

    /** 抓取网页元数据（/metadata，摘要 200 字，用于「将摘要作为初稿」）；同样优雅降级 */
    async function clipMeta(url: string): Promise<ClipResult | null> {
      clipping.value = true;
      try {
        return await fetchMetadata(url);
      } catch {
        return null;
      } finally {
        clipping.value = false;
      }
    }

    /** AI 智能分类建议：返回推荐标签（与归类），由调用方决定是否采纳 */
    async function suggestTags(title: string, content: string): Promise<string[]> {
      try {
        const r = (await apiSuggestTags(title, content)) as TagSuggestResult;
        return r?.tags || [];
      } catch {
        return [];
      }
    }

  /** 新建收集项：成功后插到列表最前（与后端「时间倒序」一致） */
  async function addItem(payload: CreateInboxPayload): Promise<InboxItem> {
    submitting.value = true;
    try {
      const created = await createInbox(payload);
      items.value.unshift(created);
      return created;
    } finally {
      submitting.value = false;
    }
  }

  /** 就地更新一条（改标签 / 改内容），成功后同步本地数组 */
  async function patchItem(id: number, payload: Parameters<typeof updateInbox>[1]) {
    const updated = await updateInbox(id, payload);
    const idx = items.value.findIndex((it) => it.id === id);
    if (idx > -1) items.value[idx] = updated;
    return updated;
  }

  /** 从本地列表移除一条（乐观更新用），返回被移除的项与原索引以便回滚 */
  function removeLocal(id: number) {
    const idx = items.value.findIndex((it) => it.id === id);
    if (idx === -1) return null;
    const [removed] = items.value.splice(idx, 1);
    return { removed, idx };
  }

  /** 归档：不沉淀，直接收走 */
  async function archive(id: number) {
    const snapshot = removeLocal(id);
    submitting.value = true;
    try {
      await archiveInbox(id);
    } catch (e) {
      if (snapshot) items.value.splice(snapshot.idx, 0, snapshot.removed);
      throw e;
    } finally {
      submitting.value = false;
    }
  }

  /** 删除：软删除进回收站 */
  async function remove(id: number) {
    const snapshot = removeLocal(id);
    submitting.value = true;
    try {
      await deleteInbox(id);
    } catch (e) {
      if (snapshot) items.value.splice(snapshot.idx, 0, snapshot.removed);
      throw e;
    } finally {
      submitting.value = false;
    }
  }

  /** 沉淀为笔记 / 文档 / 宫殿 / 故事：成功后该条自动归档，从列表移除 */
  async function process(id: number, target: ProcessTarget, options?: ProcessOptions): Promise<ProcessResult> {
    const snapshot = removeLocal(id);
    submitting.value = true;
    try {
      return await processInbox(id, target, options);
    } catch (e) {
      // 常见失败：未选择文档库目录（409），需要把卡片放回去让用户重试
      if (snapshot) items.value.splice(snapshot.idx, 0, snapshot.removed);
      throw e;
    } finally {
      submitting.value = false;
    }
  }

  /* ===========================================================================
   * 批量操作
   * ======================================================================== */

  /**
   * 对当前勾选项执行批量操作。
   *
   * 与单条操作一样走乐观更新：先把命中的卡片从本地数组摘掉，失败整体回滚。
   * 三种 target 都会让条目离开「未处理」视图，所以移除逻辑是统一的。
   */
  async function batchRun(target: BatchTarget): Promise<BatchProcessResult> {
    const ids = [...selectedIds.value];
    if (!ids.length) throw new Error('请先选择要处理的条目');

    // 快照：记录每条的原索引，失败时按索引升序插回，顺序不乱
    const snapshots = ids
      .map((id) => {
        const idx = items.value.findIndex((it) => it.id === id);
        return idx === -1 ? null : { item: items.value[idx], idx };
      })
      .filter((x): x is { item: InboxItem; idx: number } => x !== null)
      .sort((a, b) => a.idx - b.idx);

    const hitIds = new Set(snapshots.map((s) => s.item.id));
    items.value = items.value.filter((it) => !hitIds.has(it.id));

    submitting.value = true;
    try {
      const res = await batchProcessInbox(ids, target);
      clearSelection();
      /* 后端可能跳过部分条目（内容为空无法沉淀等），把它们放回列表，
       * 否则用户会以为处理成功了、刷新后又冒出来。 */
      if (res.skipped?.length) {
        const skipped = new Set(res.skipped);
        snapshots
          .filter((s) => skipped.has(s.item.id))
          .forEach((s) => items.value.splice(Math.min(s.idx, items.value.length), 0, s.item));
      }
      return res;
    } catch (e) {
      snapshots.forEach((s) => items.value.splice(Math.min(s.idx, items.value.length), 0, s.item));
      throw e;
    } finally {
      submitting.value = false;
    }
  }

  /* ===========================================================================
   * 附件上传（语音 / 图片 / 通用文件）
   * ======================================================================== */

  /** 上传进度占位：MediaRecorder 停止到 URL 返回这段，用于按钮转圈 */
  const uploading = ref(false);

  /** 上传录音，返回同源可播放的 /uploads/audio/xxx.webm */
  async function uploadAudio(blob: Blob, fileName?: string): Promise<UploadResult> {
    uploading.value = true;
    try {
      return await uploadInboxAudio(blob, fileName);
    } finally {
      uploading.value = false;
    }
  }

  /** 上传图片 / 附件，返回同源 /uploads/assets/xxx */
  async function uploadAsset(file: File | Blob, fileName?: string): Promise<UploadResult> {
    uploading.value = true;
    try {
      return await uploadInboxAsset(file, fileName);
    } finally {
      uploading.value = false;
    }
  }

  /* ===========================================================================
   * 智能去重
   * ======================================================================== */

  /** 最近一次去重检测结果（QuickCapture 的黄色警告条直接读它） */
  const duplicate = ref<DuplicateCheckResult | null>(null);
  const checkingDuplicate = ref(false);
  /** 去重检测的防抖定时器与请求序号（丢弃过期响应，防止旧结果覆盖新结果） */
  let dupTimer: ReturnType<typeof setTimeout> | null = null;
  let dupSeq = 0;

  function clearDuplicate() {
    duplicate.value = null;
    if (dupTimer) {
      clearTimeout(dupTimer);
      dupTimer = null;
    }
  }

  /** 立即检测（失焦时用） */
  async function detectDuplicate(payload: DuplicateCheckPayload): Promise<DuplicateCheckResult | null> {
    const text = (payload.content || '').trim();
    if (!text && !payload.sourceUrl) {
      duplicate.value = null;
      return null;
    }
    const seq = ++dupSeq;
    checkingDuplicate.value = true;
    try {
      const res = await checkDuplicate(payload);
      if (seq !== dupSeq) return null; // 已有更新的检测在跑，丢弃本次
      duplicate.value = res.isDuplicate ? res : null;
      return res;
    } catch {
      // 去重只是锦上添花，任何失败都静默降级为"无重复"
      if (seq === dupSeq) duplicate.value = null;
      return null;
    } finally {
      if (seq === dupSeq) checkingDuplicate.value = false;
    }
  }

  /** 防抖检测（输入 / 粘贴时用），默认 600ms */
  function detectDuplicateDebounced(payload: DuplicateCheckPayload, wait = 600) {
    if (dupTimer) clearTimeout(dupTimer);
    dupTimer = setTimeout(() => {
      dupTimer = null;
      void detectDuplicate(payload);
    }, wait);
  }

  return {
    items,
    loading,
    submitting,
    clipping,
    uploading,
    error,
    quickOpen,
    quickPrefill,
    sort,
    filter,
    filters,
    total,
    allTags,
    // 批量
    isBatchMode,
    selectedIds,
    selectedCount,
    isAllSelected,
    // 去重
    duplicate,
    checkingDuplicate,
    loadInbox,
    setFilter,
    clip,
    clipMeta,
    suggestTags,
    openQuickCapture,
    closeQuickCapture,
    toggleQuickCapture,
    consumePrefill,
    addItem,
    patchItem,
    archive,
    remove,
    process,
    isSelected,
    toggleSelect,
    selectAll,
    clearSelection,
    toggleSelectAll,
    setBatchMode,
    toggleBatchMode,
    batchRun,
    uploadAudio,
    uploadAsset,
    detectDuplicate,
    detectDuplicateDebounced,
    clearDuplicate,
  };
},
  // 仅持久化筛选/排序偏好，列表等运行时状态不入盘（pinia-plugin-persistedstate v4：用 pick 指定键）
  { persist: { pick: ['filters'] } },
);
