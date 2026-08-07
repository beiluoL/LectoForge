import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { wbNote, wbPalaceLoci } from '../db/schema';
import { CURRENT_USER, nowIso } from '../db';
import { eq, and, or, lte, lt, asc } from 'drizzle-orm';
import { gradeCard } from '../services/sm2';

/** 前端统一的复习卡结构（notes / loci 两类源聚合后都映射成它） */
export interface ReviewCardVO {
  id: number;
  sourceType: 'note' | 'loci';
  front: string;
  back: string;
  dueDate: string;
  masteredLevel: number;
  easeFactor: number;
}

/** rating → SM-2 quality 映射。
 * 注意：项目既有 sm2.gradeCard 会将 quality 钳制到 0~3（PASS_QUALITY=2）。
 * 因此「完美」与「轻松」在排程上等价（均为 quality=3）；若要 4 档差异化需扩展 sm2。
 * 这里 faithful 接入既有算法，不擅自改写。 */
const RATING_TO_QUALITY: Record<string, number> = {
  hard: 1, // q<2 → 视作遗忘（lapse）：间隔重置为 1 天
  good: 2,
  easy: 3,
  perfect: 3,
};

const MAX_DUE = 20;
const EPOCH = '1970-01-01T00:00:00.000Z';

function mapNote(row: any): ReviewCardVO {
  return {
    id: row.id,
    sourceType: 'note',
    // 康奈尔笔记：线索(cue)作为正面回忆提示，笔记/总结作为答案
    front: (row.cueColumn || row.title || '').trim() || '未命名笔记',
    back: [row.noteColumn, row.summaryColumn].filter((s) => s && String(s).trim()).join('\n\n'),
    dueDate: row.dueDate || EPOCH,
    masteredLevel: row.mastery ?? 0,
    easeFactor: row.easeFactor ?? 250,
  };
}

function mapLoci(row: any): ReviewCardVO {
  return {
    id: row.id,
    sourceType: 'loci',
    // 记忆宫殿位点：位点名称作为正面提示，知识要点作为答案
    front: (row.name || '').trim() || '未命名位点',
    back: row.knowledgePoint || '',
    dueDate: row.dueDate || EPOCH,
    masteredLevel: row.masteredLevel ?? 0,
    easeFactor: row.easeFactor ?? 250,
  };
}

export default async function (app: FastifyInstance) {
  /** GET /api/reviews/due —— 拉取待复习卡片（跨 notes + loci 聚合） */
  app.get('/reviews/due', async () => {
    const now = nowIso();
    // notes：dueDate <= now 或 熟练度(mastery) < 3
    const noteRows = db
      .select()
      .from(wbNote)
      .where(
        and(
          eq(wbNote.userId, CURRENT_USER),
          or(lte(wbNote.dueDate, now), lt(wbNote.mastery, 3)),
        ),
      )
      .all();
    // loci：dueDate <= now 或 masteredLevel < 3
    const lociRows = db
      .select()
      .from(wbPalaceLoci)
      .where(
        and(
          eq(wbPalaceLoci.userId, CURRENT_USER),
          or(lte(wbPalaceLoci.dueDate, now), lt(wbPalaceLoci.masteredLevel, 3)),
        ),
      )
      .all();

    const merged: ReviewCardVO[] = [
      ...(noteRows as any[]).map(mapNote),
      ...(lociRows as any[]).map(mapLoci),
    ];
    // ISO 字符串按字典序即时间序；升序 → 最紧急的排最前
    merged.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
    return merged.slice(0, MAX_DUE);
  });

  /** POST /api/reviews/submit —— 提交评分，落 SM-2 数据到对应源表 */
  app.post('/reviews/submit', async (req, reply) => {
    const b = req.body as any;
    if (!b || b.cardId == null || !b.sourceType || !b.rating) {
      return reply.code(400).send({ message: '参数缺失：需要 cardId / sourceType / rating' });
    }
    const quality = RATING_TO_QUALITY[b.rating];
    if (quality === undefined) {
      return reply.code(400).send({ message: 'rating 仅支持 hard / good / easy / perfect' });
    }
    if (b.sourceType !== 'note' && b.sourceType !== 'loci') {
      return reply.code(400).send({ message: 'sourceType 仅支持 note / loci' });
    }

    const now = new Date();
    const nowIsoStr = now.toISOString();

    if (b.sourceType === 'note') {
      const card = db.select().from(wbNote).where(eq(wbNote.id, b.cardId)).get() as any;
      if (!card) return reply.code(404).send({ message: '卡片不存在' });
      const res = gradeCard(
        {
          easeFactor: card.easeFactor,
          repetitions: card.repetitions,
          intervalDay: card.intervalDay,
          lapseCount: card.lapseCount,
          reviewCount: card.reviewCount,
        },
        quality,
      );
      const nextDue = new Date(now.getTime() + res.nextReviewDays * 86400000).toISOString();
      // 熟练度由通过的轮数推导（0~5），与 masteredLevel 语义一致
      const masteredLevel = Math.min(5, Math.max(0, res.repetitions));
      db.update(wbNote)
        .set({
          easeFactor: res.easeFactor,
          repetitions: res.repetitions,
          intervalDay: res.intervalDay,
          reviewCount: res.reviewCount,
          lapseCount: res.lapseCount,
          dueDate: nextDue,
          mastery: masteredLevel,
          lastReviewedAt: nowIsoStr,
          updatedAt: nowIsoStr,
        })
        .where(eq(wbNote.id, b.cardId))
        .run();
      return {
        ok: true,
        sourceType: 'note',
        nextDue,
        masteredLevel,
        easeFactor: res.easeFactor / 100,
        lapsed: res.lapsed,
      };
    }

    // loci
    const card = db.select().from(wbPalaceLoci).where(eq(wbPalaceLoci.id, b.cardId)).get() as any;
    if (!card) return reply.code(404).send({ message: '卡片不存在' });
    const res = gradeCard(
      {
        easeFactor: card.easeFactor,
        repetitions: card.repetitions,
        intervalDay: card.intervalDay,
        lapseCount: card.lapseCount,
        reviewCount: card.reviewCount,
      },
      quality,
    );
    const nextDue = new Date(now.getTime() + res.nextReviewDays * 86400000).toISOString();
    const masteredLevel = Math.min(5, Math.max(0, res.repetitions));
    db.update(wbPalaceLoci)
      .set({
        easeFactor: res.easeFactor,
        repetitions: res.repetitions,
        intervalDay: res.intervalDay,
        reviewCount: res.reviewCount,
        lapseCount: res.lapseCount,
        dueDate: nextDue,
        masteredLevel,
        lastReviewedAt: nowIsoStr,
        updatedAt: nowIsoStr,
      })
      .where(eq(wbPalaceLoci.id, b.cardId))
      .run();
    return {
      ok: true,
      sourceType: 'loci',
      nextDue,
      masteredLevel,
      easeFactor: res.easeFactor / 100,
      lapsed: res.lapsed,
    };
  });
}
