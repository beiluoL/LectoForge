import type { PageQuery } from './pagination';

export interface StoryVO {
  id: number;
  userId: number;
  captureId: number | null;
  noteId: number | null;
  categoryId: number | null;
  title: string;
  /** 库表列可空，保持与 DB 一致，避免序列化结果偏移 */
  audience: string | null;
  metaphor: string | null;
  content: string;
  gapNote: string | null;
  status: string;
  clarityScore: number | null;
  /** 库表列可空（历史行可能未回填字数） */
  wordCount: number | null;
  createTime: string;
  updateTime: string;
}

export interface ListStoryQuery extends PageQuery {
  status?: string;
  categoryId?: number;
  keyword?: string;
}

export interface CreateStoryDTO {
  title: string;
  captureId?: number | null;
  noteId?: number | null;
  categoryId?: number | null;
  audience?: string;
  metaphor?: string | null;
  content?: string;
  gapNote?: string | null;
  status?: string;
  clarityScore?: number | null;
}

export type UpdateStoryDTO = Partial<CreateStoryDTO>;
