// 主动智能：每日学习日报 Pinia 状态（组合式写法，store id 固定为 'daily-report'）
import { defineStore } from 'pinia';
import { ref } from 'vue';

import { generateDailyCards, generateDailyReport, getDailyReport } from '@/api/insight';
import { getApiError, notify } from '@/utils/toast';
import type { DailyReportContent, DailyReportStats, GenerateCardsResult } from '@/types/insight';

export const useDailyReportStore = defineStore('daily-report', () => {
  const stats = ref<DailyReportStats | null>(null);
  const content = ref<DailyReportContent | null>(null);

  const loading = ref(false);
  const generating = ref(false);
  const cardBusy = ref(false);
  const error = ref<string | null>(null);
  /** 未配置 AI 时为 true，前端据此引导去设置页 */
  const aiHint = ref(false);

  function resetAiHint() {
    aiHint.value = false;
  }

  async function fetchReport() {
    loading.value = true;
    error.value = null;
    try {
      stats.value = await getDailyReport();
    } catch (e) {
      error.value = getApiError(e, '加载学习日报失败');
    } finally {
      loading.value = false;
    }
  }

  async function generateReport() {
    generating.value = true;
    error.value = null;
    resetAiHint();
    try {
      content.value = await generateDailyReport();
    } catch (e) {
      const msg = getApiError(e, '生成日报失败');
      error.value = msg;
      const err = e as { aiCode?: string };
      if (err?.aiCode === 'AI_NOT_CONFIGURED' || msg.includes('AI 设置') || msg.includes('未配置')) {
        aiHint.value = true;
      }
    } finally {
      generating.value = false;
    }
  }

  /** 生成薄弱点强化复习卡；返回结果（失败返回 null）。内部已处理 Toast。 */
  async function generateCards(): Promise<GenerateCardsResult | null> {
    cardBusy.value = true;
    error.value = null;
    try {
      const res = await generateDailyCards();
      notify(res.message || `已生成 ${res.created} 张复习卡`, res.created > 0 ? 'success' : 'info');
      // 生成后刷新聚合，让薄弱点区域反映最新状态
      await fetchReport();
      return res;
    } catch (e) {
      notify(getApiError(e, '生成复习卡失败'), 'error');
      return null;
    } finally {
      cardBusy.value = false;
    }
  }

  return {
    stats,
    content,
    loading,
    generating,
    cardBusy,
    error,
    aiHint,
    fetchReport,
    generateReport,
    generateCards,
    resetAiHint,
  };
});
