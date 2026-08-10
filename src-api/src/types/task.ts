/* 任务清单（Things 3 模型）模块 DTO / VO。
 *
 * 字段一律 camelCase，与 wb_habit / wb_quadrant_task 等既有模块口径一致，
 * 前端 store 拿到即用、两侧零映射。
 *
 * ⚠️ 本文件是**纯类型层**，禁止出现任何运行时值（常量数组、映射表、函数）。
 *    状态枚举数组、默认排序表一律放 services/taskService.ts。
 */

import type { PageQuery } from './pagination';

/**
 * 任务状态：对应 Things 3 侧边栏的五个「智能列表」+ 一个完成态。
 *
 * - inbox     收件箱：还没想好归属，什么都没填
 * - today     今天：今天要做（含已过期未完成的，会浮上来）
 * - upcoming  计划：排了未来某一天
 * - someday   某天：想做但不排期（Things 3 的 Someday）
 * - logbook   日志本：已完成并归档
 * - completed 兼容态：某些入口只标完成不归档，读取时与 logbook 同义
 */
export type TaskStatus = 'inbox' | 'today' | 'upcoming' | 'someday' | 'logbook' | 'completed';

/** 清单类型：领域（可含子清单）/ 项目（带进度）/ 普通清单 */
export type TaskListType = 'area' | 'project' | 'list';

/** 库表行（wb_task），也是单条任务对外的 VO */
export interface TaskRow {
  id: number;
  userId: number;
  title: string;
  notes: string | null;
  status: TaskStatus;
  /** 0 未完成 / 1 已完成 */
  completed: number;
  listId: number | null;
  parentTaskId: number | null;
  /** 「什么时候做」YYYY-MM-DD 本机自然日 */
  targetDate: string | null;
  /** 「什么时候截止」YYYY-MM-DD */
  dueDate: string | null;
  completedAt: string | null;
  tags: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 带子任务的树节点（自引用：children 也是 TaskNode）。
 *
 * 虽然业务上子任务只有**一层**（Things 3 的 Checklist 语义，createTask 已禁止
 * 拿子任务当爹再嵌套），但把类型写成自引用的 TaskNode[] 能让前端递归组件
 * 的类型与运行时都自洽：每个节点都保证带着一个（可能为空的）children 数组，
 * 叶节点也不会在 `child.children.length` 时踩到 undefined。
 *
 * 树在 Service 的 JS 层拼装而非 SQL 递归 CTE：better-sqlite3 是同步 API，
 * 一次全量取回再 O(n) 分组，比递归 CTE 更快也更好读。
 */
export interface TaskNode extends TaskRow {
  children: TaskNode[];
}

/** 库表行（wb_task_list） */
export interface TaskListRow {
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
}

/** 侧边栏用的清单 VO：带上任务计数，省掉前端 N+1 次查询 */
export interface TaskListVO extends TaskListRow {
  /** 该清单下未完成任务数（不含已归档），侧边栏右侧的灰色数字 */
  openCount: number;
  /** 该清单下任务总数，项目进度条的分母 */
  totalCount: number;
  /** area 类型下挂的子清单；list / project 恒为空数组 */
  children: TaskListVO[];
}

/** GET /tasks 查询参数 */
export interface ListTasksQuery extends PageQuery {
  /** 按智能列表过滤；不传则不限状态 */
  status?: TaskStatus;
  /** 按清单过滤 */
  list_id?: number | string;
  /** 关键字（标题 / 备注 模糊匹配） */
  q?: string;
  /** '1' 时把已完成项也带上（默认按 status 语义自动决定） */
  include_completed?: string | number | boolean;
}

export interface TaskCreateInput {
  title: string;
  notes?: string | null;
  status?: TaskStatus;
  listId?: number | null;
  parentTaskId?: number | null;
  targetDate?: string | null;
  dueDate?: string | null;
  tags?: string | null;
}

export interface TaskUpdateInput {
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
 * PUT /tasks/:id/complete 的返回。
 *
 * 除了 completed，**必须带回 status**：勾选完成会把任务从 today 挪进 logbook，
 * 取消勾选又会按日期回推。前端只有拿到服务端算好的 status，
 * 才知道这条任务该不该从当前视图里消失——自己在前端再算一遍必然与后端漂移。
 */
export interface TaskToggleResult {
  id: number;
  completed: number;
  status: TaskStatus;
  completedAt: string | null;
  updatedAt: string;
}

export interface TaskListCreateInput {
  name: string;
  type?: TaskListType;
  parentId?: number | null;
  iconName?: string;
  color?: string;
}

export interface TaskListUpdateInput {
  name?: string;
  type?: TaskListType;
  parentId?: number | null;
  iconName?: string;
  color?: string;
  sortOrder?: number;
}

/** 侧边栏五个智能列表的徽标计数，一次查询返回 */
export interface TaskCounters {
  inbox: number;
  today: number;
  upcoming: number;
  someday: number;
  logbook: number;
}
