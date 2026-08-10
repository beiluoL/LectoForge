/**
 * useTaskStore —— 任务清单（Things 3 模型）全局状态。
 *
 * 设计要点：
 * - tasks 直接就是后端拼好的**任务树**（父任务 + 一层子任务）。
 *   前端全程不做 parentTaskId 分组——那是后端一次查询的产物；
 * - toggleComplete / deleteTask 乐观更新 + 失败回滚。勾选框是全应用最高频的
 *   点击，等一个 HTTP 往返再翻面会让人觉得整个应用是卡的；
 * - createTask 走「成功后重拉」：新任务插在哪个位置由后端的 sortOrder 规则决定，
 *   前端猜位置一定会猜错；
 * - 关键字过滤在**本地**做（computed），不发请求。当前视图的数据量最多几百条，
 *   本地过滤是零延迟的，边打字边发请求反而会闪。
 *
 * ID 不可变：defineStore 第一参数 'tasks' 是 store 的唯一标识，永不修改。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import {
  clearLogbook as apiClearLogbook,
  completeTask as apiCompleteTask,
  createList as apiCreateList,
  createTask as apiCreateTask,
  deleteList as apiDeleteList,
  deleteTask as apiDeleteTask,
  fetchLists as apiFetchLists,
  fetchTaskCounters as apiFetchCounters,
  fetchTasks as apiFetchTasks,
  updateList as apiUpdateList,
  updateTask as apiUpdateTask,
  type CreateTaskInput,
  type CreateTaskListInput,
  type Task,
  type TaskCounters,
  type TaskList,
  type TaskNode,
  type TaskStatus,
  type UpdateTaskInput,
  type UpdateTaskListInput,
} from '@/api/task';
import { notify } from '@/utils/toast';

/**
 * 当前视图标识：要么是五个智能列表之一，要么是 `list:<id>`。
 *
 * 用一个可序列化的字符串而不是 `{ kind, id }` 对象，是为了让它能直接进 URL query、
 * 直接做 `v-for` 的 key、直接用 `===` 比较高亮态，省掉三处解构。
 */
export type TaskViewKey = TaskStatus | `list:${number}`;

/** 五个智能列表的展示名，视图层的标题与空态文案都读这里，不各写一份 */
export const SMART_VIEW_LABEL: Record<string, string> = {
  inbox: '收件箱',
  today: '今天',
  upcoming: '计划',
  someday: '某天',
  logbook: '日志本',
};

function emptyCounters(): TaskCounters {
  return { inbox: 0, today: 0, upcoming: 0, someday: 0, logbook: 0 };
}

export const useTaskStore = defineStore('tasks', () => {
  /** 当前视图的任务树（后端已按视图语义排好序，前端不再排） */
  const tasks = ref<TaskNode[]>([]);
  /** 侧边栏清单树 */
  const lists = ref<TaskList[]>([]);
  /** 侧边栏徽标计数 */
  const counters = ref<TaskCounters>(emptyCounters());

  const currentView = ref<TaskViewKey>('today');
  /** 本地过滤条件：keyword 即时过滤，不发请求 */
  const filters = ref<{ keyword: string }>({ keyword: '' });

  const loading = ref(false);
  const submitting = ref(false);
  const error = ref('');

  /** 当前视图指向的清单 id；智能列表时为 null */
  const currentListId = computed<number | null>(() => {
    const v = currentView.value;
    return v.startsWith('list:') ? Number(v.slice(5)) : null;
  });

  /** 当前视图对应的 status；清单视图时为 undefined（不按状态过滤） */
  const currentStatus = computed<TaskStatus | undefined>(() =>
    currentListId.value === null ? (currentView.value as TaskStatus) : undefined,
  );

  /** 把清单树拍平，供「按 id 找清单」用（侧边栏是树，查找不该递归） */
  const flatLists = computed<TaskList[]>(() => {
    const out: TaskList[] = [];
    const walk = (arr: TaskList[]) => {
      arr.forEach((l) => {
        out.push(l);
        if (l.children.length) walk(l.children);
      });
    };
    walk(lists.value);
    return out;
  });

  /** 当前视图标题：智能列表读常量表，清单视图读清单名 */
  const currentTitle = computed<string>(() => {
    if (currentListId.value !== null) {
      return flatLists.value.find((l) => l.id === currentListId.value)?.name ?? '清单';
    }
    return SMART_VIEW_LABEL[currentView.value] ?? '任务';
  });

  /**
   * 参与渲染的任务列表：只做关键字过滤。
   *
   * 过滤时**父任务命中即整棵保留**，子任务命中则把父任务也带出来——
   * 只显示一条孤零零的子任务会让人完全看不懂它属于哪件事。
   */
  const visibleTasks = computed<TaskNode[]>(() => {
    const kw = filters.value.keyword.trim().toLowerCase();
    if (!kw) return tasks.value;
    const hit = (t: Task) =>
      t.title.toLowerCase().includes(kw) || (t.notes ?? '').toLowerCase().includes(kw);
    return tasks.value.filter((t) => hit(t) || t.children.some(hit));
  });

  const totalCount = computed(() => visibleTasks.value.length);
  const doneCount = computed(() => visibleTasks.value.filter((t) => t.completed === 1).length);
  /** 进度百分比（0–100）。列表为空时返回 0，视图层不做除零判断。 */
  const progress = computed(() =>
    totalCount.value === 0 ? 0 : Math.round((doneCount.value / totalCount.value) * 100),
  );

  /** 在树里定位一条任务（含子任务），返回其所在数组与下标 */
  function locate(id: number): { bucket: Task[]; index: number } | null {
    const rootIndex = tasks.value.findIndex((t) => t.id === id);
    if (rootIndex !== -1) return { bucket: tasks.value as Task[], index: rootIndex };
    for (const parent of tasks.value) {
      const i = parent.children.findIndex((c) => c.id === id);
      if (i !== -1) return { bucket: parent.children, index: i };
    }
    return null;
  }

  /* ---------------------------------------------------------------- *
   * 读
   * ---------------------------------------------------------------- */

  /**
   * 拉取当前视图的任务。
   *
   * 传 status 时会顺带切换 currentView，让「点侧边栏」这一个动作只调一个方法。
   */
  async function fetchTasks(status?: TaskStatus) {
    if (status) currentView.value = status;
    loading.value = true;
    error.value = '';
    try {
      const listId = currentListId.value;
      tasks.value = await apiFetchTasks(
        listId !== null
          ? { list_id: listId, include_completed: 1 }
          : { status: currentStatus.value ?? 'today' },
      );
    } catch (e) {
      error.value = e instanceof Error ? e.message : '任务加载失败';
      tasks.value = [];
      notify(error.value, 'error');
    } finally {
      loading.value = false;
    }
  }

  async function fetchLists() {
    try {
      lists.value = await apiFetchLists();
    } catch (e) {
      notify(e instanceof Error ? e.message : '清单加载失败', 'error');
    }
  }

  async function fetchCounters() {
    try {
      counters.value = await apiFetchCounters();
    } catch {
      // 徽标数字加载失败不值得打断用户：静默保留上一次的值即可
    }
  }

  /** 切换视图：更新标识 + 重新拉取；清单树与徽标一起刷新，保证计数不过期 */
  async function selectView(view: TaskViewKey) {
    currentView.value = view;
    filters.value.keyword = '';
    await Promise.all([fetchTasks(), fetchCounters()]);
  }

  /** 首屏：清单树 + 徽标 + 当前视图任务，一次并发拉齐 */
  async function bootstrap() {
    await Promise.all([fetchLists(), fetchCounters(), fetchTasks()]);
  }

  /* ---------------------------------------------------------------- *
   * 写
   * ---------------------------------------------------------------- */

  /**
   * 新建任务。
   *
   * 不传 status / listId 时按当前视图自动归位——在「今天」里敲回车新建的任务
   * 就该出现在今天，而不是掉进收件箱让用户再拖一次。
   */
  async function createTask(data: CreateTaskInput): Promise<Task | undefined> {
    submitting.value = true;
    try {
      const listId = currentListId.value;
      const payload: CreateTaskInput = { ...data };
      if (payload.parentTaskId == null) {
        if (listId !== null && payload.listId === undefined) payload.listId = listId;
        if (payload.status === undefined && listId === null) {
          const v = currentStatus.value;
          // 日志本是「已完成归档区」，不能作为新任务的落点，兜底回收件箱
          payload.status = v && v !== 'logbook' && v !== 'completed' ? v : 'inbox';
        }
      }
      const created = await apiCreateTask(payload);
      await Promise.all([fetchTasks(), fetchCounters()]);
      return created;
    } catch (e) {
      notify(e instanceof Error ? e.message : '创建失败', 'error');
      return undefined;
    } finally {
      submitting.value = false;
    }
  }

  /**
   * 局部更新。改了 status / targetDate / listId 这类**会让任务换视图**的字段就重拉，
   * 否则就地替换对象——后者不会让整页闪一下。
   */
  async function updateTask(id: number, data: UpdateTaskInput): Promise<Task | undefined> {
    submitting.value = true;
    try {
      const updated = await apiUpdateTask(id, data);
      const moves = data.status !== undefined || data.targetDate !== undefined || data.listId !== undefined;
      if (moves) {
        await Promise.all([fetchTasks(), fetchCounters()]);
      } else {
        const pos = locate(id);
        if (pos) pos.bucket[pos.index] = { ...pos.bucket[pos.index], ...updated };
      }
      return updated;
    } catch (e) {
      notify(e instanceof Error ? e.message : '更新失败', 'error');
      return undefined;
    } finally {
      submitting.value = false;
    }
  }

  /**
   * 勾选 / 取消勾选（乐观翻面，失败回滚）。
   *
   * 勾完**不立刻重拉**：让条目留在原地带着删除线，用户能看清自己刚点了什么、
   * 也能马上点回去撤销。真正的归位交给下一次 fetch（切视图或手动刷新）。
   * 徽标计数则立刻对齐服务端，否则侧边栏数字会滞后一拍。
   */
  async function toggleComplete(id: number) {
    const pos = locate(id);
    if (!pos) return;
    const task = pos.bucket[pos.index];
    const prev = task.completed;
    const next = prev ? 0 : 1;
    task.completed = next;

    // 父任务勾选连带子任务，与后端事务保持一致，避免前端显示与库里错位
    const parent = tasks.value.find((t) => t.id === id);
    const childBackup = parent ? parent.children.map((c) => c.completed) : [];
    if (parent) parent.children.forEach((c) => (c.completed = next));

    try {
      const res = await apiCompleteTask(id);
      // 以服务端结果为准（并发双击时前端的猜测可能与库里不一致）
      task.completed = res.completed;
      task.status = res.status;
      task.completedAt = res.completedAt;
      task.updatedAt = res.updatedAt;
      void fetchCounters();
    } catch (e) {
      task.completed = prev;
      if (parent) parent.children.forEach((c, i) => (c.completed = childBackup[i]));
      notify(e instanceof Error ? e.message : '状态切换失败', 'error');
    }
  }

  /** 删除任务（乐观摘除，失败按原索引插回） */
  async function deleteTask(id: number) {
    const pos = locate(id);
    if (!pos) return;
    const [removed] = pos.bucket.splice(pos.index, 1);
    try {
      await apiDeleteTask(id);
      void fetchCounters();
    } catch (e) {
      pos.bucket.splice(Math.min(pos.index, pos.bucket.length), 0, removed);
      notify(e instanceof Error ? e.message : '删除失败', 'error');
    }
  }

  /** 清空日志本 */
  async function clearLogbook() {
    try {
      const res = await apiClearLogbook();
      await Promise.all([fetchTasks(), fetchCounters()]);
      notify(res.removed ? `已清理 ${res.removed} 条已完成任务` : '日志本已经是空的', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : '清理失败', 'error');
    }
  }

  /* ---- 清单容器 ---- */

  async function createList(data: CreateTaskListInput): Promise<TaskList | undefined> {
    try {
      const created = await apiCreateList(data);
      await fetchLists();
      return created;
    } catch (e) {
      notify(e instanceof Error ? e.message : '清单创建失败', 'error');
      return undefined;
    }
  }

  async function updateList(id: number, data: UpdateTaskListInput) {
    try {
      await apiUpdateList(id, data);
      await fetchLists();
    } catch (e) {
      notify(e instanceof Error ? e.message : '清单更新失败', 'error');
    }
  }

  /** 删除清单：若正停在该清单视图上，先退回「今天」再删，避免停在一个不存在的视图 */
  async function removeList(id: number) {
    try {
      await apiDeleteList(id);
      if (currentListId.value === id) {
        currentView.value = 'today';
      }
      await Promise.all([fetchLists(), fetchTasks(), fetchCounters()]);
      notify('清单已删除，其中的任务已回到收件箱', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : '清单删除失败', 'error');
    }
  }

  return {
    tasks,
    lists,
    counters,
    currentView,
    filters,
    loading,
    submitting,
    error,
    currentListId,
    currentStatus,
    currentTitle,
    flatLists,
    visibleTasks,
    totalCount,
    doneCount,
    progress,
    bootstrap,
    fetchTasks,
    fetchLists,
    fetchCounters,
    selectView,
    createTask,
    updateTask,
    toggleComplete,
    deleteTask,
    clearLogbook,
    createList,
    updateList,
    removeList,
  };
});
