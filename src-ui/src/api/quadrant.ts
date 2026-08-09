// 四象限 API 客户端：对接后端 /api/quadrant/*。
// 字段名与后端 DTO 完全一致，前端 store 不再做映射。
import { apiGet, apiPost, apiPut, apiDelete } from './request';

/** 象限业务枚举（连字符写法，与库里 quadrant 列一致） */
export type QuadrantKey =
  | 'urgent-important'
  | 'not-urgent-important'
  | 'urgent-not-important'
  | 'not-urgent-not-important';

/** 分组键（下划线写法，GET 响应的四个字段名） */
export type QuadrantGroupKey =
  | 'urgent_important'
  | 'not_urgent_important'
  | 'urgent_not_important'
  | 'not_urgent_not_important';

export interface QuadrantTask {
  id: number;
  userId: number;
  title: string;
  description: string | null;
  quadrant: QuadrantKey;
  /** 0 未完成 / 1 已完成 */
  completed: number;
  /** 计划时间 ISO 字符串；null 表示未排期 */
  scheduledAt: string | null;
  /** 逗号分隔标签串 */
  tags: string | null;
  source: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** 四个桶——后端一次查询分好，前端**禁止**再对全量做 filter */
export type QuadrantGrouped = Record<QuadrantGroupKey, QuadrantTask[]>;

export interface CreateQuadrantTaskInput {
  title: string;
  quadrant: QuadrantKey;
  description?: string | null;
  scheduledAt?: string | null;
  tags?: string | null;
  source?: string | null;
}

export interface UpdateQuadrantTaskInput {
  title?: string;
  quadrant?: QuadrantKey;
  description?: string | null;
  completed?: number | boolean;
  scheduledAt?: string | null;
  tags?: string | null;
  sortOrder?: number;
}

/** 拉取四象限全量（已分组） */
export function fetchQuadrantTasks(): Promise<QuadrantGrouped> {
  return apiGet<QuadrantGrouped>('/quadrant/tasks');
}

/** 新建任务 */
export function createQuadrantTask(data: CreateQuadrantTaskInput): Promise<QuadrantTask> {
  return apiPost<QuadrantTask>('/quadrant/tasks', data);
}

/** 局部更新（改标题 / 换象限 / 改提醒时间） */
export function updateQuadrantTask(id: number, data: UpdateQuadrantTaskInput): Promise<QuadrantTask> {
  return apiPut<QuadrantTask>(`/quadrant/tasks/${id}`, data);
}

/** 切换完成状态：服务端以库里当前值翻面，返回最终状态 */
export function toggleQuadrantTask(id: number): Promise<{ id: number; completed: number; updatedAt: string }> {
  return apiPut(`/quadrant/tasks/${id}/toggle`, {});
}

/** 删除任务 */
export function deleteQuadrantTask(id: number): Promise<{ ok: true }> {
  return apiDelete(`/quadrant/tasks/${id}`);
}

/** 清空某象限的已完成项 */
export function clearQuadrantCompleted(quadrant: QuadrantKey): Promise<{ removed: number }> {
  return apiPost('/quadrant/clear-completed', { quadrant });
}
