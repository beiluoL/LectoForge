/** 收集项出参（VO）。字段与响应字节完全对齐现状 toVO()，不得增删改名。 */
export interface CaptureVO {
  id: number;
  userId: number;
  title: string | null;
  content: string | null;
  /** 库列允许 null，但业务上恒为非空字符串（MANUAL/text/...），此处如实标注可空 */
  sourceType: string | null;
  sourceUrl: string | null;
  docId: number | null;
  categoryId: number | null;
  tags: string | null;
  /** 库列允许 null，但业务上恒为非空字符串（INBOX/PROCESSED/...），此处如实标注可空 */
  status: string | null;
  starred: number;
  /** 注意：出参名是 createTime / updateTime，与库字段 createdAt / updatedAt 不同名，保持原样 */
  createTime: string;
  updateTime: string;
}

/** 列表查询入参（DTO） */
export interface ListCaptureQuery {
  status?: string;
  categoryId?: number;
  keyword?: string;
}

/** 创建入参（DTO） */
export interface CreateCaptureDTO {
  title: string;
  content?: string | null;
  sourceType?: string;
  sourceUrl?: string | null;
  docId?: number | null;
  categoryId?: number | null;
  tags?: string | null;
  starred?: number;
}

export type UpdateCaptureDTO = Partial<CreateCaptureDTO> & { status?: string };
