import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { wbNote, wbPalaceLoci, wbReviewLog } from '../db/schema';
import { CURRENT_USER, nowIso } from '../db';
import { eq, and, or, lte, lt, gte } from 'drizzle-orm';
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
  /** SM-2 已复习轮数（0 = 新卡，>=1 = 复习卡） */
  repetitions: number;
  /** 累计遗忘次数（>2 标记易忘卡） */
  lapseCount: number;
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
    repetitions: row.repetitions ?? 0,
    lapseCount: row.lapseCount ?? 0,
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
    repetitions: row.repetitions ?? 0,
    lapseCount: row.lapseCount ?? 0,
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
      // 写复习流水，供热力图 / 遗忘曲线聚合（新系统统一从这里取数）
      db.insert(wbReviewLog)
        .values({
          userId: CURRENT_USER,
          cardId: b.cardId,
          quality,
          intervalDay: res.intervalDay,
          easeFactor: res.easeFactor,
          reviewedAt: nowIsoStr,
        })
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
    db.insert(wbReviewLog)
      .values({
        userId: CURRENT_USER,
        cardId: b.cardId,
        quality,
        intervalDay: res.intervalDay,
        easeFactor: res.easeFactor,
        reviewedAt: nowIsoStr,
      })
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

  /** PUT /api/reviews/snooze —— 挂起（稍后再背）：due_date 顺延 24h，不动 SRS 字段。
   *  防刷：同一张卡片 1 小时内不允许重复挂起（进程内守卫，侧车单进程足够；重启后重置可接受）。 */
  const SNOOZE_GUARD = new Map<string, number>();
  const SNOOZE_WINDOW_MS = 60 * 60 * 1000;
  app.put('/reviews/snooze', async (req, reply) => {
    const b = req.body as any;
    if (!b || b.cardId == null || !b.sourceType) {
      return reply.code(400).send({ message: '参数缺失：需要 cardId / sourceType' });
    }
    if (b.sourceType !== 'note' && b.sourceType !== 'loci') {
      return reply.code(400).send({ message: 'sourceType 仅支持 note / loci' });
    }
    const key = `${b.sourceType}:${b.cardId}`;
    const nowMs = Date.now();
    const last = SNOOZE_GUARD.get(key);
    if (last !== undefined && nowMs - last < SNOOZE_WINDOW_MS) {
      const retryAfter = Math.ceil((SNOOZE_WINDOW_MS - (nowMs - last)) / 1000);
      return reply.code(429).send({ message: '同一张卡片 1 小时内不可重复挂起', retryAfterSec: retryAfter });
    }
    const table = b.sourceType === 'note' ? wbNote : wbPalaceLoci;
    const card = db.select().from(table).where(eq((table as any).id, b.cardId)).get() as any;
    if (!card) return reply.code(404).send({ message: '卡片不存在' });
    const nextDue = new Date(nowMs + 24 * 3600 * 1000).toISOString();
    db.update(table)
      .set({ dueDate: nextDue, updatedAt: new Date().toISOString() })
      .where(eq((table as any).id, b.cardId))
      .run();
    SNOOZE_GUARD.set(key, nowMs);
    return { ok: true, sourceType: b.sourceType, cardId: b.cardId, nextDue };
  });

  /** GET /api/reviews/heatmap —— GitHub 风格日活跃热力图数据。
   *  主源：新系统每次复习写入的 wb_review_log；并以源表 last_reviewed_at 作补充（避免历史上未记日志的复习漏算）。 */
  app.get('/reviews/heatmap', async (req) => {
    const days = Math.max(1, Math.min(365, Number((req.query as any).days) || 30));
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    const startIso = start.toISOString();

    const logs = db
      .select({ cardId: wbReviewLog.cardId, reviewedAt: wbReviewLog.reviewedAt })
      .from(wbReviewLog)
      .where(and(eq(wbReviewLog.userId, CURRENT_USER), gte(wbReviewLog.reviewedAt, startIso)))
      .all() as any[];
    const notes = db
      .select({ id: wbNote.id, lastReviewedAt: wbNote.lastReviewedAt })
      .from(wbNote)
      .where(and(eq(wbNote.userId, CURRENT_USER), gte(wbNote.lastReviewedAt, startIso)))
      .all() as any[];
    const locis = db
      .select({ id: wbPalaceLoci.id, lastReviewedAt: wbPalaceLoci.lastReviewedAt })
      .from(wbPalaceLoci)
      .where(and(eq(wbPalaceLoci.userId, CURRENT_USER), gte(wbPalaceLoci.lastReviewedAt, startIso)))
      .all() as any[];

    const seen = new Set<string>();
    const counts: Record<string, number> = {};
    for (const l of logs) {
      const d = (l.reviewedAt || '').slice(0, 10);
      if (!d) continue;
      counts[d] = (counts[d] || 0) + 1;
      seen.add(`${d}|${l.cardId}`);
    }
    for (const n of [...notes, ...locis]) {
      const d = (n.lastReviewedAt || '').slice(0, 10);
      if (!d) continue;
      const k = `${d}|${n.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      counts[d] = (counts[d] || 0) + 1;
    }

    const data: { date: string; count: number }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
      data.push({ date: d, count: counts[d] || 0 });
    }
    return { startDate, endDate, days, data };
  });

  /** GET /api/reviews/forgetting-curve —— 通过 Drizzle 重新实现旧 /api/workbench/reviews/forgetting-curve。
   *  源数据来自新系统的复习流水（wb_review_log，submit 时写入），按日聚合复习量 / 遗忘量 / 遗忘率 / 新卡数；
   *  若流水为空（老用户历史数据），回退到 wb_note + wb_palace_loci 的 last_reviewed_at / review_count 聚合。 */
  app.get('/reviews/forgetting-curve', async (req) => {
    const days = Math.max(1, Math.min(365, Number((req.query as any).days) || 30));
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    const startIso = start.toISOString();

    const bucket: Record<string, { reviews: number; lapses: number; newCards: number }> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
      bucket[d] = { reviews: 0, lapses: 0, newCards: 0 };
    }

    const logs = db
      .select({ cardId: wbReviewLog.cardId, reviewedAt: wbReviewLog.reviewedAt, quality: wbReviewLog.quality })
      .from(wbReviewLog)
      .where(and(eq(wbReviewLog.userId, CURRENT_USER), gte(wbReviewLog.reviewedAt, startIso)))
      .all() as any[];

    const seenCards = new Set<number>();
    let totalReviews = 0;
    let totalLapses = 0;
    for (const log of logs) {
      const d = (log.reviewedAt || '').slice(0, 10);
      const p = bucket[d];
      if (!p) continue;
      p.reviews += 1;
      // 新系统 quality：hard=1(<2 视为遗忘) / good=2 / easy|perfect=3
      if (log.quality < 2) p.lapses += 1;
      if (log.cardId != null && !seenCards.has(log.cardId)) {
        seenCards.add(log.cardId);
        p.newCards += 1;
      }
      totalReviews += 1;
      if (log.quality < 2) totalLapses += 1;
    }

    // 回退：流水为空时，用源表 last_reviewed_at 聚合（reviews / newCards，lapses 不可得置 0）
    if (logs.length === 0) {
      const cards = [
        ...(db
          .select({ id: wbNote.id, lastReviewedAt: wbNote.lastReviewedAt, reviewCount: wbNote.reviewCount })
          .from(wbNote)
          .where(and(eq(wbNote.userId, CURRENT_USER), gte(wbNote.lastReviewedAt, startIso)))
          .all() as any[]),
        ...(db
          .select({ id: wbPalaceLoci.id, lastReviewedAt: wbPalaceLoci.lastReviewedAt, reviewCount: wbPalaceLoci.reviewCount })
          .from(wbPalaceLoci)
          .where(and(eq(wbPalaceLoci.userId, CURRENT_USER), gte(wbPalaceLoci.lastReviewedAt, startIso)))
          .all() as any[]),
      ];
      for (const c of cards) {
        const d = (c.lastReviewedAt || '').slice(0, 10);
        const p = bucket[d];
        if (!p) continue;
        p.reviews += 1;
        if ((c.reviewCount ?? 0) <= 1) p.newCards += 1;
      }
    }

    const points = Object.keys(bucket).map((date) => {
      const p = bucket[date];
      return {
        date,
        reviews: p.reviews,
        lapses: p.lapses,
        lapseRate: p.reviews === 0 ? 0 : p.lapses / p.reviews,
        newCards: p.newCards,
      };
    });
    const overallLapseRate = totalReviews === 0 ? 0 : totalLapses / totalReviews;
    return { startDate, endDate, points, totalReviews, totalLapses, overallLapseRate };
  });
}
