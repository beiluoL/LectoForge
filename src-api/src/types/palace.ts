export interface PalaceVO {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  /** 库表列可空（历史行可能没有主题），与 DB 保持一致 */
  theme: string | null;
  coverColor: string | null;
  categoryId: number | null;
  createTime: string;
  updateTime: string;
}

export interface LociVO {
  id: number;
  userId: number;
  palaceId: number;
  captureId: number | null;
  noteId: number | null;
  categoryId: number | null;
  name: string;
  knowledgePoint: string | null;
  imageHint: string | null;
  icon: string | null;
  posX: number | null;
  posY: number | null;
  sortOrder: number | null;
  masteredLevel: number | null;
  lastReviewedAt: string | null;
  createTime: string;
  updateTime: string;
}

export interface CreatePalaceDTO {
  name: string;
  description?: string | null;
  theme?: string;
  coverColor?: string | null;
  categoryId?: number | null;
}

export type UpdatePalaceDTO = Partial<CreatePalaceDTO>;

export interface CreateLociDTO {
  palaceId: number;
  name: string;
  knowledgePoint?: string | null;
  imageHint?: string | null;
  icon?: string | null;
  posX?: number;
  posY?: number;
  sortOrder?: number;
  captureId?: number | null;
  noteId?: number | null;
  categoryId?: number | null;
}

export interface UpdateLociDTO {
  palaceId?: number;
  name?: string;
  knowledgePoint?: string | null;
  imageHint?: string | null;
  icon?: string | null;
  posX?: number;
  posY?: number;
  sortOrder?: number;
  masteredLevel?: number;
  lastReviewedAt?: string | null;
  captureId?: number | null;
  noteId?: number | null;
  categoryId?: number | null;
}
