// 日程计划 API 客户端：对接后端 /api/schedule/*（模板 + 当日任务）。
// 与 pomodoro.ts / inbox.ts 同款：复用 request.ts 的 apiGet/apiPost/apiPut/apiDelete，
// 响应已被拦截器解包为 ApiResult<T>，故直接取 .data 类型。
import { apiGet, apiPost, apiPut, apiDelete } from './request';

/** 重复规则（与后端 types/schedule.ts 同名同构，前端无需再映射） */
export type RepeatRule =
  | { type: 'daily'; interval: number }
  | { type: 'weekly'; days: number[] }
  | { type: 'monthly'; day: number };

/** 模板里的单条任务 */
export interface TemplateTask {
  content: string;
  time?: string;
  repeatRule?: RepeatRule | null;
}

/** 模板 VO */
export interface TaskTemplate {
  id: number;
  name: string;
  tasks: TemplateTask[];
  createdAt: string;
  updatedAt: string;
}

/** 当日任务 VO */
export interface DailyTask {
  id: number;
  targetDate: string;
  content: string;
  completed: boolean;
  parentTemplateId: number | null;
  repeatRule: RepeatRule | null;
  createdAt: string;
  updatedAt: string;
}

/* ===== 查询 / 列表 ===== */

/** 取某天任务（含重复规则按需展开）；date 缺省走后端「今天」 */
export function fetchTasks(date: string) {
  return apiGet<DailyTask[]>('/schedule/tasks', { date });
}

/** 取全部模板 */
export function fetchTemplates() {
  return apiGet<TaskTemplate[]>('/schedule/templates');
}

/* ===== 写操作 ===== */

/** 一键从模板生成某天计划 */
export function generateFromTemplate(templateId: number, targetDate: string) {
  return apiPost<{ created: DailyTask[]; alreadyGenerated: boolean }>('/schedule/generate', {
    templateId,
    targetDate,
  });
}

/** 批量添加多行文本任务 */
export function batchAddTasks(targetDate: string, tasks: string[]) {
  return apiPost<{ created: DailyTask[] }>('/schedule/batch', { targetDate, tasks });
}

/** 局部更新一条任务（内容 / 完成态 / 重复规则），后端按字段缺省做局部更新 */
export function updateTask(id: number, patch: { content?: string; completed?: boolean; repeatRule?: RepeatRule | null }) {
  return apiPut<DailyTask>(`/schedule/tasks/${id}`, patch);
}

/** 删除一条当日任务 */
export function deleteTask(id: number) {
  return apiDelete<void>(`/schedule/tasks/${id}`);
}

/** 新建模板 */
export function createTemplate(name: string, tasks: TemplateTask[]) {
  return apiPost<TaskTemplate>('/schedule/templates', { name, tasks });
}

/** 删除模板 */
export function deleteTemplate(id: number) {
  return apiDelete<void>(`/schedule/templates/${id}`);
}
