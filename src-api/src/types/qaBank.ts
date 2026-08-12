/**
 * 模拟面试题库（wb_qa_bank）对外类型。
 * 注意 createdAt 为 epoch 毫秒整数（非 ISO 串），与 db/schema.ts 一致。
 */

/** 来源类型：手动/面经导入 | 复习卡 | 康奈尔笔记 */
export type QaSourceType = 'import' | 'review_card' | 'note';

/** 题库行（与 wb_qa_bank 列一一对应） */
export interface QaBankRow {
  id: number;
  question: string;
  referenceAnswer: string;
  scoringPoints: string | null;
  sourceType: QaSourceType;
  sourceId: number | null;
  tags: string | null;
  difficulty: number;
  createdAt: number;
  idx: number | null;
}

/** 筛选条件（listBanks / randomNext 共用） */
export interface QaBankFilter {
  /** 按来源类型过滤 */
  sourceType?: QaSourceType;
  /** 按单个标签过滤（逗号分隔串中命中即匹配） */
  tag?: string;
  /** 按难度过滤 */
  difficulty?: number;
  /** 排除指定 id（面试编排用，避免重复抽题） */
  excludeIds?: number[];
}

/** 导入 Markdown / PDF 的请求体 */
export interface ImportMarkdownDTO {
  text: string;
}

/** 打标签请求体 */
export interface TagBankDTO {
  id: number;
  /** 标签数组，将被合并去重后写入 tags 列（逗号分隔） */
  tags: string[];
}
