import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { CURRENT_USER, db, nowIso } from '../db';
import { wbPalace, wbPalaceLoci } from '../db/schema';
import type { CreateLociDTO, CreatePalaceDTO, LociVO, PalaceVO, UpdateLociDTO, UpdatePalaceDTO } from '../types/palace';

type PalaceRow = typeof wbPalace.$inferSelect;
type LociRow = typeof wbPalaceLoci.$inferSelect;

function palaceVO(p: PalaceRow): PalaceVO {
  return {
    id: p.id,
    userId: p.userId,
    name: p.name,
    description: p.description,
    theme: p.theme,
    coverColor: p.coverColor,
    categoryId: p.categoryId,
    createTime: p.createdAt,
    updateTime: p.updatedAt,
  };
}

function lociVO(l: LociRow): LociVO {
  return {
    id: l.id,
    userId: l.userId,
    palaceId: l.palaceId,
    captureId: l.captureId,
    noteId: l.noteId,
    categoryId: l.categoryId,
    name: l.name,
    knowledgePoint: l.knowledgePoint,
    imageHint: l.imageHint,
    icon: l.icon,
    posX: l.posX,
    posY: l.posY,
    sortOrder: l.sortOrder,
    masteredLevel: l.masteredLevel,
    lastReviewedAt: l.lastReviewedAt,
    createTime: l.createdAt,
    updateTime: l.updatedAt,
  };
}

export function listPalaces(): PalaceVO[] {
  return db
    .select()
    .from(wbPalace)
    .where(eq(wbPalace.userId, CURRENT_USER))
    .orderBy(desc(wbPalace.updatedAt))
    .all()
    .map(palaceVO);
}

export function getPalaceWithLoci(id: number): (PalaceVO & { loci: LociVO[] }) | null {
  const palace = db.select().from(wbPalace).where(eq(wbPalace.id, id)).get();
  if (!palace) return null;
  const loci = db
    .select()
    .from(wbPalaceLoci)
    .where(eq(wbPalaceLoci.palaceId, id))
    .orderBy(asc(wbPalaceLoci.sortOrder), asc(wbPalaceLoci.id))
    .all();
  return { ...palaceVO(palace), loci: loci.map(lociVO) };
}

export function createPalace(b: CreatePalaceDTO): number {
  const now = nowIso();
  const row = db
    .insert(wbPalace)
    .values({
      userId: CURRENT_USER,
      name: b.name,
      description: b.description ?? null,
      theme: b.theme ?? 'ROOM',
      coverColor: b.coverColor ?? null,
      categoryId: b.categoryId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return row.id;
}

export function updatePalace(id: number, b: UpdatePalaceDTO): PalaceVO | null {
  const ex = db.select().from(wbPalace).where(eq(wbPalace.id, id)).get();
  if (!ex) return null;
  db.update(wbPalace)
    .set({
      name: b.name ?? ex.name,
      description: b.description ?? ex.description,
      theme: b.theme ?? ex.theme,
      coverColor: b.coverColor ?? ex.coverColor,
      categoryId: b.categoryId !== undefined ? b.categoryId : ex.categoryId,
      updatedAt: nowIso(),
    })
    .where(eq(wbPalace.id, id))
    .run();
  const updated = db.select().from(wbPalace).where(eq(wbPalace.id, id)).get();
  return updated ? palaceVO(updated) : null;
}

export function deletePalace(id: number): void {
  db.delete(wbPalaceLoci).where(eq(wbPalaceLoci.palaceId, id)).run();
  db.delete(wbPalace).where(eq(wbPalace.id, id)).run();
}

export function listLoci(palaceId: number): LociVO[] {
  return db
    .select()
    .from(wbPalaceLoci)
    .where(eq(wbPalaceLoci.palaceId, palaceId))
    .orderBy(asc(wbPalaceLoci.sortOrder), asc(wbPalaceLoci.id))
    .all()
    .map(lociVO);
}

export function createLoci(b: CreateLociDTO): number {
  const now = nowIso();
  const maxIdx = db
    .select({ m: sql<number>`COALESCE(MAX(${wbPalaceLoci.sortOrder}), -1)` })
    .from(wbPalaceLoci)
    .where(eq(wbPalaceLoci.palaceId, Number(b.palaceId)))
    .get();
  const row = db
    .insert(wbPalaceLoci)
    .values({
      palaceId: Number(b.palaceId),
      userId: CURRENT_USER,
      name: b.name,
      knowledgePoint: b.knowledgePoint ?? null,
      imageHint: b.imageHint ?? null,
      icon: b.icon ?? null,
      posX: b.posX ?? 50,
      posY: b.posY ?? 50,
      sortOrder: b.sortOrder ?? (maxIdx?.m ?? -1) + 1,
      captureId: b.captureId ?? null,
      noteId: b.noteId ?? null,
      categoryId: b.categoryId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return row.id;
}

export function updateLoci(id: number, b: UpdateLociDTO): LociVO | null {
  const ex = db.select().from(wbPalaceLoci).where(eq(wbPalaceLoci.id, id)).get();
  if (!ex) return null;
  db.update(wbPalaceLoci)
    .set({
      palaceId: b.palaceId !== undefined ? Number(b.palaceId) : ex.palaceId,
      name: b.name ?? ex.name,
      knowledgePoint: b.knowledgePoint ?? ex.knowledgePoint,
      imageHint: b.imageHint ?? ex.imageHint,
      icon: b.icon ?? ex.icon,
      posX: b.posX !== undefined ? b.posX : ex.posX,
      posY: b.posY !== undefined ? b.posY : ex.posY,
      sortOrder: b.sortOrder !== undefined ? b.sortOrder : ex.sortOrder,
      masteredLevel: b.masteredLevel !== undefined ? b.masteredLevel : ex.masteredLevel,
      lastReviewedAt: b.lastReviewedAt !== undefined ? b.lastReviewedAt : ex.lastReviewedAt,
      captureId: b.captureId !== undefined ? b.captureId : ex.captureId,
      noteId: b.noteId !== undefined ? b.noteId : ex.noteId,
      categoryId: b.categoryId !== undefined ? b.categoryId : ex.categoryId,
      updatedAt: nowIso(),
    })
    .where(eq(wbPalaceLoci.id, id))
    .run();
  const updated = db.select().from(wbPalaceLoci).where(eq(wbPalaceLoci.id, id)).get();
  return updated ? lociVO(updated) : null;
}

export function listDueLoci(id: number): LociVO[] {
  return db
    .select()
    .from(wbPalaceLoci)
    .where(and(eq(wbPalaceLoci.palaceId, id), sql`${wbPalaceLoci.masteredLevel} < 3`))
    .orderBy(asc(wbPalaceLoci.sortOrder), asc(wbPalaceLoci.id))
    .all()
    .map(lociVO);
}

export function deleteLoci(id: number): void {
  db.delete(wbPalaceLoci).where(eq(wbPalaceLoci.id, id)).run();
}
