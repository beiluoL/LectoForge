import { and, desc, eq, like, type SQL } from 'drizzle-orm';
import { CURRENT_USER, db, nowIso } from '../db';
import { wbCapture } from '../db/schema';
import type {
  CaptureVO,
  CreateCaptureDTO,
  ListCaptureQuery,
  UpdateCaptureDTO,
} from '../types/capture';

type CaptureRow = typeof wbCapture.$inferSelect;

/** 行 → VO 映射：原 routes/captures.ts 的 toVO()，原样搬运，字段一字不改 */
function toVO(r: CaptureRow): CaptureVO {
  return {
    id: r.id,
    userId: r.userId,
    title: r.title,
    content: r.content,
    sourceType: r.sourceType,
    sourceUrl: r.sourceUrl,
    docId: r.docId,
    categoryId: r.categoryId,
    tags: r.tags,
    status: r.status,
    starred: r.starred,
    createTime: r.createdAt,
    updateTime: r.updatedAt,
  };
}

export function listCaptures(q: ListCaptureQuery): CaptureVO[] {
  const conds: SQL[] = [eq(wbCapture.userId, CURRENT_USER)];
  if (q.status) conds.push(eq(wbCapture.status, String(q.status)));
  if (q.categoryId) conds.push(eq(wbCapture.categoryId, Number(q.categoryId)));
  if (q.keyword) conds.push(like(wbCapture.title, `%${q.keyword}%`));
  return db
    .select()
    .from(wbCapture)
    .where(and(...conds))
    .orderBy(desc(wbCapture.starred), desc(wbCapture.createdAt))
    .all()
    .map(toVO);
}

export function findCapture(id: number): CaptureVO | null {
  const row = db
    .select()
    .from(wbCapture)
    .where(and(eq(wbCapture.id, id), eq(wbCapture.userId, CURRENT_USER)))
    .get();
  return row ? toVO(row) : null;
}

export function createCapture(b: CreateCaptureDTO): number {
  const now = nowIso();
  const row = db
    .insert(wbCapture)
    .values({
      userId: CURRENT_USER,
      title: b.title,
      content: b.content ?? null,
      sourceType: b.sourceType ?? 'MANUAL',
      sourceUrl: b.sourceUrl ?? null,
      docId: b.docId ?? null,
      categoryId: b.categoryId ?? null,
      tags: b.tags ?? null,
      status: 'INBOX',
      starred: b.starred ?? 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return row.id;
}

export function updateCapture(id: number, b: UpdateCaptureDTO): CaptureVO | null {
  const ex = db.select().from(wbCapture).where(eq(wbCapture.id, id)).get();
  if (!ex) return null;
  db.update(wbCapture)
    .set({
      title: b.title ?? ex.title,
      content: b.content ?? ex.content,
      sourceType: b.sourceType ?? ex.sourceType,
      sourceUrl: b.sourceUrl ?? ex.sourceUrl,
      docId: b.docId !== undefined ? b.docId : ex.docId,
      categoryId: b.categoryId !== undefined ? b.categoryId : ex.categoryId,
      tags: b.tags !== undefined ? b.tags : ex.tags,
      status: b.status ?? ex.status,
      starred: b.starred !== undefined ? b.starred : ex.starred,
      updatedAt: nowIso(),
    })
    .where(eq(wbCapture.id, id))
    .run();
  const updated = db.select().from(wbCapture).where(eq(wbCapture.id, id)).get();
  return updated ? toVO(updated) : null;
}

export function deleteCapture(id: number): void {
  db.delete(wbCapture).where(eq(wbCapture.id, id)).run();
}

export function setCaptureStatus(id: number, status: string): void {
  db
    .update(wbCapture)
    .set({ status: String(status), updatedAt: nowIso() })
    .where(eq(wbCapture.id, id))
    .run();
}

/** 切换星标。返回 false 表示记录不存在（由 controller 决定翻译成 404） */
export function toggleStar(id: number): boolean {
  const row = db.select().from(wbCapture).where(eq(wbCapture.id, id)).get();
  if (!row) return false;
  db.update(wbCapture)
    .set({ starred: row.starred ? 0 : 1, updatedAt: nowIso() })
    .where(eq(wbCapture.id, id))
    .run();
  return true;
}
