import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  batchAddTasks as apiBatchAdd,
  createTemplate as apiCreateTemplate,
  deleteTask as apiDeleteTask,
  deleteTemplate as apiDeleteTemplate,
  fetchTasks as apiFetchTasks,
  fetchTemplates as apiFetchTemplates,
  generateFromTemplate as apiGenerate,
  updateTask as apiUpdateTask,
  type DailyTask,
  type RepeatRule,
  type TaskTemplate,
  type TemplateTask,
} from '@/api/schedule';
import { notify } from '@/utils/toast';

/** 本机时区 YYYY-MM-DD（与后端口径一致，绝不用 toISOString） */
function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 日程计划状态。
 *
 * 设计要点（对齐 inbox-store 的乐观更新套路）：
 * - fetchTasks 拉的是「某一天」的任务，切日期即重拉，不缓存其它日期；
 * - toggleTask / removeTask / setRepeat 全部乐观更新本地数组，失败回滚并 toast；
 * - submitting / generating / savingTemplate 标记写操作进行中，禁用按钮防重复点击。
 */
export const useScheduleStore = defineStore(
  'schedule',
  () => {
    /** 当前查看的日期（YYYY-MM-DD），默认今天 */
    const currentDate = ref<string>(todayKey());
    const tasks = ref<DailyTask[]>([]);
    const templates = ref<TaskTemplate[]>([]);

    const loading = ref(false);
    const generating = ref(false);
    const submitting = ref(false);
    const savingTemplate = ref(false);
    const error = ref('');

    /** 当前日期是否为今天 */
    const isToday = computed(() => currentDate.value === todayKey());
    /** 已完成数量 */
    const completedCount = computed(() => tasks.value.filter((t) => t.completed).length);
    /** 总数量 */
    const totalCount = computed(() => tasks.value.length);
    /** 完成进度 0-1 */
    const progress = computed(() => (totalCount.value ? completedCount.value / totalCount.value : 0));

    /** 拉取当前日期的任务（含重复任务按需展开） */
    async function fetchTasks(date?: string) {
      if (date) currentDate.value = date;
      loading.value = true;
      error.value = '';
      try {
        tasks.value = await apiFetchTasks(currentDate.value);
      } catch (e) {
        error.value = e instanceof Error ? e.message : '任务加载失败';
        tasks.value = [];
      } finally {
        loading.value = false;
      }
    }

    /** 拉取全部模板 */
    async function fetchTemplates() {
      try {
        templates.value = await apiFetchTemplates();
      } catch {
        templates.value = [];
      }
    }

    /** 一键从模板生成计划（乐观：先乐观把新建项插到未完成的末尾，失败回滚） */
    async function generateFromTemplate(templateId: number, date?: string) {
      const targetDate = date || currentDate.value;
      generating.value = true;
      try {
        const res = await apiGenerate(templateId, targetDate);
        if (res.alreadyGenerated) {
          notify('今日计划已生成，无需重复', 'info');
        } else {
          notify(`已生成 ${res.created.length} 项任务`, 'success');
        }
        // 以服务器为准刷新，保证重复展开/去重后的真实状态
        if (targetDate === currentDate.value) await fetchTasks(targetDate);
        return res;
      } catch (e) {
        notify(e instanceof Error ? e.message : '生成失败', 'error');
        throw e;
      } finally {
        generating.value = false;
      }
    }

    /**
     * 切换完成态（乐观更新）。
     * 先翻本地，再上报；失败把该行翻回原值并提示。
     */
    async function toggleTask(id: number) {
      const idx = tasks.value.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const prev = tasks.value[idx].completed;
      // 乐观：本地立刻翻面（排序会随 completed 变化，这里同步改数组触发响应式）
      tasks.value[idx] = { ...tasks.value[idx], completed: !prev };
      try {
        await apiUpdateTask(id, { completed: !prev });
      } catch (e) {
        tasks.value[idx] = { ...tasks.value[idx], completed: prev };
        notify(e instanceof Error ? e.message : '更新失败', 'error');
      }
    }

    /** 删除一条任务（乐观更新：先从列表摘掉，失败按原索引插回） */
    async function removeTask(id: number) {
      const idx = tasks.value.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const [removed] = tasks.value.splice(idx, 1);
      try {
        await apiDeleteTask(id);
      } catch (e) {
        tasks.value.splice(Math.min(idx, tasks.value.length), 0, removed);
        notify(e instanceof Error ? e.message : '删除失败', 'error');
      }
    }

    /** 设置某任务的重复规则（null 表示清除） */
    async function setRepeat(id: number, rule: RepeatRule | null) {
      const idx = tasks.value.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const prev = tasks.value[idx].repeatRule;
      tasks.value[idx] = { ...tasks.value[idx], repeatRule: rule };
      try {
        await apiUpdateTask(id, { repeatRule: rule });
      } catch (e) {
        tasks.value[idx] = { ...tasks.value[idx], repeatRule: prev };
        notify(e instanceof Error ? e.message : '更新重复规则失败', 'error');
      }
    }

    /**
     * 批量添加任务：按换行拆分、去空、去重（与现有列表内容比较）。
     * 后端用事务原子插入，这里只负责把返回的新行合并进本地列表。
     */
    async function batchAddTasks(date: string, text: string) {
      const lines = (text || '')
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean);
      if (!lines.length) return;
      // 前端轻量去重：与当前日期已有内容比对，避免明显重复（后端仍按模板维度去重）
      const existed = new Set(tasks.value.map((t) => t.content));
      const fresh = lines.filter((l) => !existed.has(l));
      if (!fresh.length) {
        notify('这些内容今天已添加', 'info');
        return;
      }
      submitting.value = true;
      try {
        const res = await apiBatchAdd(date, fresh);
        // 新行追加到列表末尾（未完成区），保持响应式
        tasks.value = [...tasks.value, ...res.created];
        notify(`已添加 ${res.created.length} 项`, 'success');
      } catch (e) {
        notify(e instanceof Error ? e.message : '批量添加失败', 'error');
        throw e;
      } finally {
        submitting.value = false;
      }
    }

    /**
     * 把「当前日期的任务」存为模板（saveAsTemplate）。
     * 提取每条的内容与重复规则，模板任务结构与当日任务一致（repeatRule 透传）。
     */
    async function saveAsTemplate(name: string) {
      if (!name.trim()) {
        notify('请填写模板名称', 'warning');
        return;
      }
      const tasksToSave: TemplateTask[] = tasks.value.map((t) => ({
        content: t.content,
        repeatRule: t.repeatRule,
      }));
      savingTemplate.value = true;
      try {
        const tpl = await apiCreateTemplate(name.trim(), tasksToSave);
        templates.value = [...templates.value, tpl];
        notify(`已保存模板「${tpl.name}」`, 'success');
        return tpl;
      } catch (e) {
        notify(e instanceof Error ? e.message : '保存模板失败', 'error');
        throw e;
      } finally {
        savingTemplate.value = false;
      }
    }

    /** 删除模板（已生成的当日任务保留） */
    async function removeTemplate(id: number) {
      const snapshot = templates.value.find((t) => t.id === id);
      if (!snapshot) return;
      templates.value = templates.value.filter((t) => t.id !== id);
      try {
        await apiDeleteTemplate(id);
        notify('模板已删除', 'success');
      } catch (e) {
        templates.value = [...templates.value, snapshot].sort((a, b) => a.id - b.id);
        notify(e instanceof Error ? e.message : '删除模板失败', 'error');
      }
    }

    return {
      currentDate,
      tasks,
      templates,
      loading,
      generating,
      submitting,
      savingTemplate,
      error,
      isToday,
      completedCount,
      totalCount,
      progress,
      fetchTasks,
      fetchTemplates,
      generateFromTemplate,
      toggleTask,
      removeTask,
      setRepeat,
      batchAddTasks,
      saveAsTemplate,
      removeTemplate,
    };
  },
  // 仅持久化当前查看的日期，列表/模板等运行时状态不入盘
  { persist: { pick: ['currentDate'] } },
);
