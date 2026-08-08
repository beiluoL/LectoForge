import { defineStore } from 'pinia';
import { ref } from 'vue';
import { searchAll, type SearchResult } from '@/api/search';

/**
 * 全局命令面板 / 搜索状态。
 * - isOpen：面板是否可见（由 App.vue 的 Cmd/Ctrl+K 切换）
 * - query：当前搜索词（与 CommandPalette 输入框 v-model 双向绑定）
 * - results / loading：查询结果与加载态
 */
export const useSearchStore = defineStore('search', () => {
  const isOpen = ref(false);
  const query = ref('');
  const results = ref<SearchResult[]>([]);
  const loading = ref(false);

  /** 打开面板：清空输入与结果，等待组件聚焦输入框 */
  function openPalette() {
    isOpen.value = true;
    query.value = '';
    results.value = [];
  }

  /** 关闭面板 */
  function closePalette() {
    isOpen.value = false;
  }

  /** 执行搜索：trim 后为空直接清空；否则置 loading 并调用后端 /api/search */
  async function performSearch(queryStr: string) {
    query.value = queryStr;
    const q = queryStr.trim();
    if (!q) {
      results.value = [];
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      results.value = await searchAll(q);
    } catch (e) {
      // 搜索失败不应阻塞面板，降级为空结果
      results.value = [];
      console.error('[search] 查询失败', e);
    } finally {
      loading.value = false;
    }
  }

  return { isOpen, query, results, loading, openPalette, closePalette, performSearch };
});
