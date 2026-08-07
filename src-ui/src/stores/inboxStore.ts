import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  archiveInbox,
  clipUrl,
  createInbox,
  deleteInbox,
  fetchInboxList,
  fetchMetadata,
  processInbox,
  suggestTags as apiSuggestTags,
  updateInbox,
  type ClipResult,
  type CreateInboxPayload,
  type InboxItem,
  type ProcessOptions,
  type ProcessResult,
  type ProcessTarget,
  type TagSuggestResult,
} from '@/api/inbox';

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
    function openQuickCapture() {
      quickOpen.value = true;
    }
    function closeQuickCapture() {
      quickOpen.value = false;
    }
    function toggleQuickCapture() {
      quickOpen.value = !quickOpen.value;
    }

    /** 列表排序：desc=最新优先（默认），asc=最旧优先（收件箱积压视图） */
    const sort = ref<'desc' | 'asc'>('desc');
    /** 用户筛选 / 视图偏好（仅此 ref 持久化） */
    const filters = ref<{ sort: 'desc' | 'asc' }>({ sort: 'desc' });

    /** 未处理条目数量（顶栏 / 首页气泡可复用） */
    const total = computed(() => items.value.length);

    /** 全部出现过的标签，供 QuickCapture 的标签选择器做候选 */
    const allTags = computed(() => {
      const set = new Set<string>();
      items.value.forEach((it) => it.tags.forEach((t) => set.add(t)));
      return Array.from(set);
    });

    /** 拉取未处理列表 */
    async function loadInbox(overrideSort?: 'desc' | 'asc') {
      const useSort = overrideSort || filters.value.sort || sort.value;
      sort.value = useSort;
      loading.value = true;
      error.value = '';
      try {
        items.value = await fetchInboxList(useSort);
      } catch (e: any) {
        error.value = e?.message || '收集箱加载失败';
        items.value = [];
      } finally {
        loading.value = false;
      }
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

  return {
    items,
    loading,
    submitting,
    clipping,
    error,
    quickOpen,
    sort,
    filters,
    total,
    allTags,
    loadInbox,
    clip,
    clipMeta,
    suggestTags,
    openQuickCapture,
    closeQuickCapture,
    toggleQuickCapture,
    addItem,
    patchItem,
    archive,
    remove,
    process,
  };
},
  // 仅持久化筛选/排序偏好，列表等运行时状态不入盘（pinia-plugin-persistedstate v4：用 pick 指定键）
  { persist: { pick: ['filters'] } },
);
