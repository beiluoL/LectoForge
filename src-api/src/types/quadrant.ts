/* 四象限（艾森豪威尔矩阵）模块 DTO / VO。
 *
 * 命名口径（两套写法并存，各有各的理由，不要「顺手统一」）：
 * - **任务字段**用 camelCase（scheduledAt / createdAt / sortOrder），与 wb_habit、
 *   wb_note 等既有模块完全一致，前端 store 拿到即用、两侧零映射；
 * - **分组键**用 snake_case（urgent_important…），这是 GET /quadrant/tasks 的
 *   对外契约，与库里 quadrant 列的连字符枚举（urgent-important）刻意区分：
 *   前者是 JSON 字段名，后者是业务枚举值，混用会让人分不清在读哪一层。
 *
 * ⚠️ 本文件是**纯类型层**，禁止出现任何运行时值（常量、函数）。
 *    枚举数组、映射表一律放 services/quadrantService.ts。
 */

/** 象限业务枚举（库里 quadrant 列的取值，连字符写法） */
export type QuadrantKey =
  | 'urgent-important'
  | 'not-urgent-important'
  | 'urgent-not-important'
  | 'not-urgent-not-important';

/** 库表行（wb_quadrant_task），也是单条任务对外的 VO */
export interface QuadrantTaskRow {
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

/**
 * GET /quadrant/tasks 的响应体：四个桶，一次查询在服务端分好。
 *
 * 前端拿到就是「四个数组」，绝不允许再对全量列表做 filter —— 那正是这个
 * 返回结构存在的意义（性能红线：分组只在后端做一次）。
 */
export interface QuadrantGrouped {
  urgent_important: QuadrantTaskRow[];
  not_urgent_important: QuadrantTaskRow[];
  urgent_not_important: QuadrantTaskRow[];
  not_urgent_not_important: QuadrantTaskRow[];
}

export interface QuadrantTaskCreateInput {
  title: string;
  quadrant?: QuadrantKey;
  description?: string | null;
  scheduledAt?: string | null;
  tags?: string | null;
  source?: string | null;
}

export interface QuadrantTaskUpdateInput {
  title?: string;
  quadrant?: QuadrantKey;
  description?: string | null;
  completed?: number | boolean;
  scheduledAt?: string | null;
  tags?: string | null;
  sortOrder?: number;
}

/** PUT /quadrant/tasks/:id/toggle 的返回：只回最小必要状态，前端据此对齐乐观更新 */
export interface QuadrantToggleResult {
  id: number;
  completed: number;
  updatedAt: string;
}
