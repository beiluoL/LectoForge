// 任务清单 API 客户端：对接后端 /api/tasks/* 与 /api/lists/*。
// 字段名与后端 DTO 完全一致，前端 store 不再做映射。
import { apiGet, apiPost, apiPut, apiDelete } from './request';

/** 任务状态：对应侧边栏五个智能列表 + 完成态（口径见后端 types/task.ts） */
export type TaskStatus = 'inbox' | 'today' | 'upcoming' | 'someday' | 'logbook' | 'completed';

/** 清单类型：领域（可含子清单）/ 项目（带进度）/ 普通清单 */
export type TaskListType = 'area' | 'project' | 'list';

export interface Task {
  id: number;
  userId: number;
  title: string;
  notes: string | null;
  status: TaskStatus;
  /** 0 未完成 / 1 已完成 */
  completed: number;
  listId: number | null;
  parentTaskId: number | null;
  /** 「什么时候做」YYYY-MM-DD */
  targetDate: string | null;
  /** 「什么时候截止」YYYY-MM-DD */
  dueDate: string | null;
  completedAt: string | null;
  tags: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** 带子任务的树节点（后端已拼好，前端**禁止**再自己 filter 组树；children 也是 TaskNode） */
export interface TaskNode extends Task {
  children: TaskNode[];
}

export interface TaskList {
  id: number;
  userId: number;
  name: string;
  type: TaskListType;
  parentId: number | null;
  iconName: string;
  color: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** 未完成任务数（侧边栏右侧灰色数字） */
  openCount: number;
  /** 任务总数（项目进度条的分母） */
  totalCount: number;
  children: TaskList[];
}

/** 侧边栏五个智能列表的徽标计数 */
export interface TaskCounters {
  inbox: number;
  today: number;
  upcoming: number;
  someday: number;
  logbook: number;
}

export interface CreateTaskInput {
  title: string;
  notes?: string | null;
  status?: TaskStatus;
  listId?: number | null;
  parentTaskId?: number | null;
  targetDate?: string | null;
  dueDate?: string | null;
  tags?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  notes?: string | null;
  status?: TaskStatus;
  completed?: number | boolean;
  listId?: number | null;
  parentTaskId?: number | null;
  targetDate?: string | null;
  dueDate?: string | null;
  tags?: string | null;
  sortOrder?: number;
}

/**
 * 勾选接口的返回。
 *
 * 必须消费 status：勾完之后这条任务该不该从当前视图消失，
 * 由服务端算好告诉前端，前端自己再判一遍必然与后端漂移。
 */
export interface TaskToggleResult {
  id: number;
  completed: number;
  status: TaskStatus;
  completedAt: string | null;
  updatedAt: string;
}

export interface CreateTaskListInput {
  name: string;
  type?: TaskListType;
  parentId?: number | null;
  iconName?: string;
  color?: string;
}

export interface UpdateTaskListInput {
  name?: string;
  type?: TaskListType;
  parentId?: number | null;
  iconName?: string;
  color?: string;
  sortOrder?: number;
}

export interface FetchTasksParams {
  status?: TaskStatus;
  list_id?: number;
  q?: string;
  include_completed?: 1;
}

/** 拉取任务树（子任务随父返回） */
export function fetchTasks(params: FetchTasksParams = {}): Promise<TaskNode[]> {
  return apiGet<TaskNode[]>('/tasks', params);
}

/** 侧边栏徽标计数 */
export function fetchTaskCounters(): Promise<TaskCounters> {
  return apiGet<TaskCounters>('/tasks/counters');
}

/** 新建任务（传 parentTaskId 即为子任务） */
export function createTask(data: CreateTaskInput): Promise<Task> {
  return apiPost<Task>('/tasks', data);
}

/** 局部更新（改标题 / 改日期 / 换清单 / 换状态） */
export function updateTask(id: number, data: UpdateTaskInput): Promise<Task> {
  return apiPut<Task>(`/tasks/${id}`, data);
}

/** 勾选 / 取消勾选：不传 completed 时由服务端读现值翻面 */
export function completeTask(id: number, completed?: boolean): Promise<TaskToggleResult> {
  return apiPut<TaskToggleResult>(`/tasks/${id}/complete`, completed === undefined ? {} : { completed });
}

/** 删除任务（连带其子任务） */
export function deleteTask(id: number): Promise<{ id: number }> {
  return apiDelete(`/tasks/${id}`);
}

/** 清空日志本 */
export function clearLogbook(): Promise<{ removed: number }> {
  return apiPost('/tasks/clear-logbook', {});
}

/** 侧边栏清单树 */
export function fetchLists(): Promise<TaskList[]> {
  return apiGet<TaskList[]>('/lists');
}

export function createList(data: CreateTaskListInput): Promise<TaskList> {
  return apiPost<TaskList>('/lists', data);
}

export function updateList(id: number, data: UpdateTaskListInput): Promise<TaskList> {
  return apiPut<TaskList>(`/lists/${id}`, data);
}

export function deleteList(id: number): Promise<{ id: number }> {
  return apiDelete(`/lists/${id}`);
}
