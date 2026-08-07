import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { wbNote, wbCapture } from '../db/schema';
import { CURRENT_USER, nowIso } from '../db';
import { eq, and, or, desc, like, sql } from 'drizzle-orm';

function toVO(r: any) {
  return {
    id: r.id,
    userId: r.userId,
    captureId: r.captureId,
    categoryId: r.categoryId,
    title: r.title,
    cueColumn: r.cueColumn,
    noteColumn: r.noteColumn,
    summaryColumn: r.summaryColumn,
    tags: r.tags,
    mastery: r.mastery,
    // SRS 排程字段：列表页据此渲染「需复习」徽章与下次复习时间，
    // 与 /api/reviews/*（新复习系统）读写同一批列，保持单一事实源。
    dueDate: r.dueDate,
    easeFactor: r.easeFactor,
    repetitions: r.repetitions,
    intervalDay: r.intervalDay,
    lapseCount: r.lapseCount,
    reviewCount: r.reviewCount,
    lastReviewedAt: r.lastReviewedAt,
    createTime: r.createdAt,
    updateTime: r.updatedAt,
  };
}

/** 整理笔记时把来源收集箱流转为「已整理」(PROCESSED)。 */
function markCaptureProcessed(captureId: number) {
  const c = db.select().from(wbCapture).where(eq(wbCapture.id, captureId)).get() as any;
  if (c && c.status !== 'ARCHIVED') {
    db.update(wbCapture).set({ status: 'PROCESSED', updatedAt: nowIso() }).where(eq(wbCapture.id, captureId)).run();
  }
}

export default async function (app: FastifyInstance) {
  app.get('/notes', async (req) => {
    const q = req.query as any;
    const conds: any[] = [eq(wbNote.userId, CURRENT_USER)];
    if (q.captureId) conds.push(eq(wbNote.captureId, Number(q.captureId)));
    if (q.categoryId) conds.push(eq(wbNote.categoryId, Number(q.categoryId)));
    // 关键词跨「标题 + 康奈尔三栏」检索：wb_note 没有单一 content 列，
    // 正文散在 cue/note/summary 三列，只搜标题会让用户以为笔记丢了。
    if (q.keyword) {
      const kw = `%${q.keyword}%`;
      conds.push(
        or(
          like(wbNote.title, kw),
          like(wbNote.cueColumn, kw),
          like(wbNote.noteColumn, kw),
          like(wbNote.summaryColumn, kw),
        ),
      );
    }
    const rows = db.select().from(wbNote).where(and(...conds)).orderBy(desc(wbNote.updatedAt)).all();
    return rows.map(toVO);
  });

  app.get('/notes/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const row = db.select().from(wbNote).where(eq(wbNote.id, id)).get() as any;
    if (!row) return reply.code(404).send({ message: 'not found' });
    return toVO(row);
  });

  app.post('/notes', async (req, reply) => {
    const b = req.body as any;
    if (!b.title) return reply.code(400).send({ message: 'title required' });
    const now = nowIso();
    const row = db
      .insert(wbNote)
      .values({
        userId: CURRENT_USER,
        captureId: b.captureId ?? null,
        categoryId: b.categoryId ?? null,
        title: b.title,
        cueColumn: b.cueColumn ?? '',
        noteColumn: b.noteColumn ?? '',
        summaryColumn: b.summaryColumn ?? '',
        tags: b.tags ?? null,
        mastery: b.mastery ?? 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    if (b.captureId != null) markCaptureProcessed(Number(b.captureId));
    return row.id;
  });

  app.put('/notes/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const b = req.body as any;
    const ex = db.select().from(wbNote).where(eq(wbNote.id, id)).get() as any;
    if (!ex) return reply.code(404).send({ message: 'not found' });
    db.update(wbNote)
      .set({
        captureId: b.captureId !== undefined ? b.captureId : ex.captureId,
        categoryId: b.categoryId !== undefined ? b.categoryId : ex.categoryId,
        title: b.title ?? ex.title,
        cueColumn: b.cueColumn ?? ex.cueColumn,
        noteColumn: b.noteColumn ?? ex.noteColumn,
        summaryColumn: b.summaryColumn ?? ex.summaryColumn,
        tags: b.tags !== undefined ? b.tags : ex.tags,
        mastery: b.mastery !== undefined ? b.mastery : ex.mastery,
        updatedAt: nowIso(),
      })
      .where(eq(wbNote.id, id))
      .run();
    if (b.captureId != null) markCaptureProcessed(Number(b.captureId));
    return toVO(db.select().from(wbNote).where(eq(wbNote.id, id)).get() as any);
  });

  app.delete('/notes/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    db.delete(wbNote).where(eq(wbNote.id, id)).run();
    return reply.code(204).send();
  });
}
