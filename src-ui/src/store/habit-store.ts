/**
 * useHabitStore —— 习惯打卡全局状态。
 *
 * 设计要点（对齐 schedule-store 的乐观更新套路）：
 * - fetchHabits 拉全部习惯（含今日状态，后端单查询完成）；
 * - toggleLog 乐观翻面 todayStatus，失败回滚并 toast；
 * - createHabit / removeHabit 同样乐观，失败回滚并提示。
 *
 * ID 不可变：defineStore 第一参数 'habits' 是 store 的唯一标识，永不修改。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  createHabit as apiCreateHabit,
  deleteHabit as apiDeleteHabit,
  fetchHabits as apiFetchHabits,
  fetchHabitsSummary as apiFetchHabitsSummary,
  toggleHabitLog as apiToggleHabitLog,
  type CreateHabitInput,
  type Habit,
  type HabitsSummary,
} from '@/api/habit';
import { notify } from '@/utils/toast';

/** 本机时区 YYYY-MM-DD（与后端口径一致，绝不用 toISOString） */
function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export const useHabitStore = defineStore(
  'habits',
  () => {
    const habits = ref<Habit[]>([]);
    const loading = ref(false);
    const submitting = ref(false);
    const error = ref('');
    /** 全局打卡概览（本周 / 本月打卡率），由 fetchHabits 顺带拉取 */
    const summary = ref<HabitsSummary | null>(null);

    /** 今日已打卡数量 */
    const doneCount = computed(() => habits.value.filter((h) => h.todayStatus === 1).length);
    /** 习惯总数 */
    const totalCount = computed(() => habits.value.length);

    /** 拉取全局概览（失败不影响主列表，静默） */
    async function fetchSummary() {
      try {
        summary.value = await apiFetchHabitsSummary();
      } catch {
        /* 概览降级：不阻塞主流程 */
      }
    }

    /** 拉取全部习惯 */
    async function fetchHabits() {
      loading.value = true;
      error.value = '';
      try {
        habits.value = await apiFetchHabits();
        fetchSummary(); // 顺带刷新本周/本月打卡率
      } catch (e) {
        error.value = e instanceof Error ? e.message : '习惯加载失败';
        habits.value = [];
        notify(error.value, 'error');
      } finally {
        loading.value = false;
      }
    }

    /** 新建习惯（乐观：直接把返回项并入列表） */
    async function createHabit(data: CreateHabitInput): Promise<Habit | undefined> {
      submitting.value = true;
      try {
        const created = await apiCreateHabit(data);
        habits.value = [...habits.value, { ...created, todayStatus: 0 }];
        notify('习惯已创建', 'success');
        return created;
      } catch (e) {
        notify(e instanceof Error ? e.message : '创建失败', 'error');
        return undefined;
      } finally {
        submitting.value = false;
      }
    }

    /** 删除习惯（乐观：先从列表摘掉，失败按原索引插回） */
    async function removeHabit(id: number) {
      const idx = habits.value.findIndex((h) => h.id === id);
      if (idx === -1) return;
      const [removed] = habits.value.splice(idx, 1);
      try {
        await apiDeleteHabit(id);
        notify('习惯已删除', 'success');
      } catch (e) {
        habits.value.splice(Math.min(idx, habits.value.length), 0, removed);
        notify(e instanceof Error ? e.message : '删除失败', 'error');
      }
    }

    /**
     * 切换打卡状态（乐观更新 + 失败回滚）。
     * @param habitId 习惯 id
     * @param date 目标日期；缺省为今天。仅当 date 为今天时才翻动卡片上的 todayStatus，
     *             过去的日期由详情抽屉自行管理热力图 UI，不污染今日卡片状态。
     */
    async function toggleLog(habitId: number, date?: string) {
      const target = date ?? todayKey();
      const h = habits.value.find((x) => x.id === habitId);
      if (!h) return;

      const affectsToday = target === todayKey();
      const prev = h.todayStatus ?? 0;
      if (affectsToday) h.todayStatus = prev ? 0 : 1; // 乐观翻面

      try {
        await apiToggleHabitLog(habitId, target);
        fetchSummary(); // 打卡状态变了，顺手刷新本周/本月打卡率
      } catch (e) {
        if (affectsToday) h.todayStatus = prev; // 回滚
        notify(e instanceof Error ? e.message : '打卡失败', 'error');
      }
    }

    return {
      habits,
      loading,
      submitting,
      error,
      summary,
      doneCount,
      totalCount,
      fetchHabits,
      fetchSummary,
      createHabit,
      removeHabit,
      toggleLog,
    };
  },
);
