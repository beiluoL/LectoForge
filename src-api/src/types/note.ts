import type { PageQuery } from './pagination';

/**
 * 康奈尔笔记模块的出入参类型。
 * 字段可空性严格对齐 wb_note 表定义，避免序列化结果与重构前产生偏移。
 */
export interface NoteVO {
  id: number;
  userId: number;
  captureId: number | null;
  categoryId: number | null;
  title: string;
  cueColumn: string;
  noteColumn: string;
  summaryColumn: string;
  tags: string | null;
  mastery: number;
  /** SRS 排程字段：与 /api/reviews/* 读写同一批列，保持单一事实源 */
  dueDate: string;
  easeFactor: number;
  repetitions: number;
  intervalDay: number;
  lapseCount: number;
  reviewCount: number;
  lastReviewedAt: string | null;
  createTime: string;
  updateTime: string;
}

/** 标签云一行：标签名 + 去重后的笔记数 */
export interface TagCountVO {
  name: string;
  count: number;
}

/** 反向引用一行：谁引用了我 + 命中处上下文摘要 */
export interface BacklinkVO {
  id: number;
  title: string;
  excerpt: string;
}

/** 双链解析结果：命中不了返回 exists:false，前端渲染「未创建」样式 */
export interface ResolveNoteVO {
  exists: boolean;
  id: number | null;
  title: string;
}

/**
 * 列表查询条件（已由 Controller 完成解析与归一化）。
 * 注：masteryLte / hasSummary 在 HTTP 层同时接受 snake_case 与 camelCase 两种写法。
 */
export interface ListNoteQuery extends PageQuery {
  captureId?: number;
  categoryId?: number;
  keyword?: string;
  tag?: string;
  masteryLte?: number;
  hasSummary?: boolean;
}

/**
 * 笔记列表页头部的四个统计数。
 *
 * 存在的理由：列表接口分页后，前端再也不能用「已加载数组的长度」当总数——
 * 那会随着用户往下滚而不断变大，是明显的错误信息。
 * 这四个数一律由 SQL 聚合直出，且套用与列表**完全相同**的筛选条件，
 * 保证「共 N 则」与实际能筛出的条数永远对得上。
 */
export interface NoteStatsVO {
  /** 当前筛选条件下的笔记总数 */
  total: number;
  /** 已复习过且已到期（need review today） */
  due: number;
  /** 从未复习过（reviewCount = 0），语义是「首学」而非「遗忘」 */
  unreviewed: number;
  /** 平均掌握度，0~100 整数；空结果集返回 0 */
  avgMastery: number;
}

export interface CreateNoteDTO {
  title: string;
  captureId?: number | null;
  categoryId?: number | null;
  cueColumn?: string;
  noteColumn?: string;
  summaryColumn?: string;
  tags?: string | null;
  mastery?: number;
}

export type UpdateNoteDTO = Partial<CreateNoteDTO>;
