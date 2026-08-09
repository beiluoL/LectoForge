/**
 * useQuadrantStore —— 四象限（艾森豪威尔矩阵）全局状态。
 *
 * 设计要点：
 * - tasks 直接就是后端返回的**四个桶**。前端全程不做 filter 分组——
 *   分组是后端一次查询的产物，这是本模块的性能红线；
 * - toggleTask / deleteTask / moveTask 全部乐观更新 + 失败回滚，
 *   勾选框是高频操作，等一个 HTTP 往返再翻面会让人觉得卡；
 * - createTask 走「成功后重拉」：新任务要插到哪个桶的第几位由后端排序规则
 *   决定（未完成优先 + sortOrder + createdAt），前端猜位置一定会猜错。
 *
 * ID 不可变：defineStore 第一参数 'quadrant' 是 store 的唯一标识，永不修改。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  clearQuadrantCompleted as apiClearCompleted,
  createQuadrantTask as apiCreateTask,
  deleteQuadrantTask as apiDeleteTask,
  fetchQuadrantTasks as apiFetchTasks,
  toggleQuadrantTask as apiToggleTask,
  updateQuadrantTask as apiUpdateTask,
  type CreateQuadrantTaskInput,
  type QuadrantGrouped,
  type QuadrantGroupKey,
  type QuadrantKey,
  type QuadrantTask,
  type UpdateQuadrantTaskInput,
} from '@/api/quadrant';
import { notify } from '@/utils/toast';

/**
 * 象限枚举（连字符）→ 分组键（下划线）。
 * 与后端 quadrantService.QUADRANT_KEYS 一一对应，改一边必须同步另一边。
 */
export const GROUP_OF: Record<QuadrantKey, QuadrantGroupKey> = {
  'urgent-important': 'urgent_important',
  'not-urgent-important': 'not_urgent_important',
  'urgent-not-important': 'urgent_not_important',
  'not-urgent-not-important': 'not_urgent_not_important',
};

/** 四个空桶。任何时候 tasks 都必须有全部四个键，视图层不做判空。 */
function emptyGroups(): QuadrantGrouped {
  return {
    urgent_important: [],
    not_urgent_important: [],
    urgent_not_important: [],
    not_urgent_not_important: [],
  };
}

const GROUP_KEYS = Object.values(GROUP_OF);

export const useQuadrantStore = defineStore('quadrant', () => {
  const tasks = ref<QuadrantGrouped>(emptyGroups());
  const loading = ref(false);
  const submitting = ref(false);
  const error = ref('');

  /** 全部任务的扁平视图，只用于统计（不用于渲染，渲染一律读各自的桶） */
  const allTasks = computed<QuadrantTask[]>(() => GROUP_KEYS.flatMap((k) => tasks.value[k]));
  const totalCount = computed(() => allTasks.value.length);
  const doneCount = computed(() => allTasks.value.filter((t) => t.completed === 1).length);
  const pendingCount = computed(() => totalCount.value - doneCount.value);

  /** 在四个桶里定位一条任务，返回 { key, index }；找不到返回 null */
  function locate(id: number): { key: QuadrantGroupKey; index: number } | null {
    for (const key of GROUP_KEYS) {
      const index = tasks.value[key].findIndex((t) => t.id === id);
      if (index !== -1) return { key, index };
    }
    return null;
  }

  /** 拉取四象限全量 */
  async function fetchTasks() {
    loading.value = true;
    error.value = '';
    try {
      tasks.value = await apiFetchTasks();
    } catch (e) {
      error.value = e instanceof Error ? e.message : '四象限加载失败';
      tasks.value = emptyGroups();
      notify(error.value, 'error');
    } finally {
      loading.value = false;
    }
  }

  /** 新建任务（成功后重拉，让排序完全由后端决定） */
  async function createTask(data: CreateQuadrantTaskInput): Promise<QuadrantTask | undefined> {
    submitting.value = true;
    try {
      const created = await apiCreateTask(data);
      await fetchTasks();
      notify('任务已添加', 'success');
      return created;
    } catch (e) {
      notify(e instanceof Error ? e.message : '创建失败', 'error');
      return undefined;
    } finally {
      submitting.value = false;
    }
  }

  /**
   * 局部更新。若改动涉及象限（拖拽换格）则重拉，否则就地替换对象。
   * 就地替换能避免整页闪一下，改象限时则必须重拉——任务要从一个桶挪到另一个。
   */
  async function updateTask(id: number, data: UpdateQuadrantTaskInput): Promise<QuadrantTask | undefined> {
    submitting.value = true;
    try {
      const updated = await apiUpdateTask(id, data);
      if (data.quadrant !== undefined) {
        await fetchTasks();
      } else {
        const pos = locate(id);
        if (pos) tasks.value[pos.key][pos.index] = updated;
      }
      return updated;
    } catch (e) {
      notify(e instanceof Error ? e.message : '更新失败', 'error');
      return undefined;
    } finally {
      submitting.value = false;
    }
  }

  /** 切换完成状态（乐观翻面，失败回滚） */
  async function toggleTask(id: number) {
    const pos = locate(id);
    if (!pos) return;
    const task = tasks.value[pos.key][pos.index];
    const prev = task.completed;
    task.completed = prev ? 0 : 1; // 乐观翻面

    try {
      const res = await apiToggleTask(id);
      // 以服务端结果为准对齐（并发双击时前端的猜测可能与库里不一致）
      task.completed = res.completed;
      task.updatedAt = res.updatedAt;
    } catch (e) {
      task.completed = prev; // 回滚
      notify(e instanceof Error ? e.message : '状态切换失败', 'error');
    }
  }

  /** 删除任务（乐观摘除，失败按原索引插回） */
  async function deleteTask(id: number) {
    const pos = locate(id);
    if (!pos) return;
    const [removed] = tasks.value[pos.key].splice(pos.index, 1);
    try {
      await apiDeleteTask(id);
      notify('任务已删除', 'success');
    } catch (e) {
      const bucket = tasks.value[pos.key];
      bucket.splice(Math.min(pos.index, bucket.length), 0, removed);
      notify(e instanceof Error ? e.message : '删除失败', 'error');
    }
  }

  /**
   * 拖拽换象限（乐观搬桶，失败原路搬回）。
   * 这是四象限最核心的交互——「重新评估优先级」本质上就是把卡片挪个格子。
   */
  async function moveTask(id: number, target: QuadrantKey) {
    const pos = locate(id);
    if (!pos) return;
    const task = tasks.value[pos.key][pos.index];
    const targetKey = GROUP_OF[target];
    if (pos.key === targetKey) return;

    const prevQuadrant = task.quadrant;
    tasks.value[pos.key].splice(pos.index, 1);
    task.quadrant = target;
    // 未完成的插到桶顶（刚挪过来的通常正要处理），已完成的仍排在末尾
    if (task.completed) tasks.value[targetKey].push(task);
    else tasks.value[targetKey].unshift(task);

    try {
      await apiUpdateTask(id, { quadrant: target });
    } catch (e) {
      const back = tasks.value[targetKey].findIndex((t) => t.id === id);
      if (back !== -1) tasks.value[targetKey].splice(back, 1);
      task.quadrant = prevQuadrant;
      tasks.value[pos.key].splice(Math.min(pos.index, tasks.value[pos.key].length), 0, task);
      notify(e instanceof Error ? e.message : '移动失败', 'error');
    }
  }

  /** 清空某象限的已完成项 */
  async function clearCompleted(quadrant: QuadrantKey) {
    const key = GROUP_OF[quadrant];
    const backup = [...tasks.value[key]];
    tasks.value[key] = tasks.value[key].filter((t) => t.completed !== 1);
    try {
      const res = await apiClearCompleted(quadrant);
      notify(res.removed ? `已清理 ${res.removed} 条已完成任务` : '没有可清理的已完成任务', 'success');
    } catch (e) {
      tasks.value[key] = backup;
      notify(e instanceof Error ? e.message : '清理失败', 'error');
    }
  }

  return {
    tasks,
    loading,
    submitting,
    error,
    totalCount,
    doneCount,
    pendingCount,
    fetchTasks,
    createTask,
    updateTask,
    toggleTask,
    deleteTask,
    moveTask,
    clearCompleted,
  };
});
