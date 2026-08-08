/**
 * 间隔复习业务层（新 SRS 系统，跨 wb_note + wb_palace_loci 聚合）。
 *
 * ⚠️ 与 services/reviewsService.ts 区分：本文件服务 /api/reviews/*，
 * 另一个服务 /api/workbench/reviews/*（wb_review_card 旧体系）。两套并存，勿合并。
 *
 * SM-2 计算统一委托 services/sm2.ts —— 该文件是算法唯一实现源，本轮重构只读不改，
 * 这里仅搬运调用点，入参与出参的用法与重构前逐字一致。
 */
import { and, eq, gte, lt, lte, or } from 'drizzle-orm';

import { CURRENT_USER, db, nowIso } from '../db';
import { wbNote, wbPalaceLoci, wbReviewLog } from '../db/schema';
import { gradeCard } from './sm2';
import type {
  HeatmapVO,
  ReviewCardVO,
  ReviewForgettingCurveVO,
  ReviewSourceType,
  SnoozeOutcome,
  SubmitReviewVO,
} from '../types/review';

type NoteRow = typeof wbNote.$inferSelect;
type LociRow = typeof wbPalaceLoci.$inferSelect;

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

/** 评分档位 → SM-2 quality；未知档位返回 undefined（由 controller 转 400） */
export function ratingToQuality(rating: string): number | undefined {
  return RATING_TO_QUALITY[rating];
}

function mapNote(row: NoteRow): ReviewCardVO {
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

function mapLoci(row: LociRow): ReviewCardVO {
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

/** 拉取待复习卡片（跨 notes + loci 聚合，最多 MAX_DUE 张） */
export function listDueCards(): ReviewCardVO[] {
  const now = nowIso();
  // notes：dueDate <= now 或 熟练度(mastery) < 3
  const noteRows = db
    .select()
    .from(wbNote)
    .where(and(eq(wbNote.userId, CURRENT_USER), or(lte(wbNote.dueDate, now), lt(wbNote.mastery, 3))))
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

  const merged: ReviewCardVO[] = [...noteRows.map(mapNote), ...lociRows.map(mapLoci)];
  // ISO 字符串按字典序即时间序；升序 → 最紧急的排最前
  merged.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  return merged.slice(0, MAX_DUE);
}

/** 写复习流水，供热力图 / 遗忘曲线聚合（新系统统一从这里取数） */
function writeReviewLog(cardId: number, quality: number, intervalDay: number, easeFactor: number, at: string) {
  db.insert(wbReviewLog)
    .values({
      userId: CURRENT_USER,
      cardId,
      quality,
      intervalDay,
      easeFactor,
      reviewedAt: at,
    })
    .run();
}

/**
 * 提交评分，落 SM-2 数据到对应源表。卡片不存在时返回 null（由 controller 转 404）。
 *
 * 两个分支的差异仅在「目标表」与「熟练度列名」（note 用 mastery，loci 用 masteredLevel），
 * 其余字段集合、写入顺序（先更新源表、再写流水）与返回体均与重构前逐字一致。
 */
export function submitReview(
  cardId: number,
  sourceType: ReviewSourceType,
  quality: number,
): SubmitReviewVO | null {
  const now = new Date();
  const nowIsoStr = now.toISOString();

  const card: NoteRow | LociRow | undefined =
    sourceType === 'note'
      ? db.select().from(wbNote).where(eq(wbNote.id, cardId)).get()
      : db.select().from(wbPalaceLoci).where(eq(wbPalaceLoci.id, cardId)).get();
  if (!card) return null;

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

  if (sourceType === 'note') {
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
      .where(eq(wbNote.id, cardId))
      .run();
  } else {
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
      .where(eq(wbPalaceLoci.id, cardId))
      .run();
  }

  writeReviewLog(cardId, quality, res.intervalDay, res.easeFactor, nowIsoStr);

  return {
    ok: true,
    sourceType,
    nextDue,
    masteredLevel,
    easeFactor: res.easeFactor / 100,
    lapsed: res.lapsed,
  };
}

/** 挂起（稍后再背）防刷守卫：同一张卡片 1 小时内不允许重复挂起。
 *  进程内状态，侧车单进程足够；重启后重置可接受（与重构前语义一致）。 */
const SNOOZE_GUARD = new Map<string, number>();
const SNOOZE_WINDOW_MS = 60 * 60 * 1000;

/** 挂起：due_date 顺延 24h，不动 SRS 字段。返回三态供 controller 翻译状态码 */
export function snoozeCard(cardId: number, sourceType: ReviewSourceType): SnoozeOutcome {
  const key = `${sourceType}:${cardId}`;
  const nowMs = Date.now();
  const last = SNOOZE_GUARD.get(key);
  if (last !== undefined && nowMs - last < SNOOZE_WINDOW_MS) {
    return { kind: 'throttled', retryAfterSec: Math.ceil((SNOOZE_WINDOW_MS - (nowMs - last)) / 1000) };
  }

  const nextDue = new Date(nowMs + 24 * 3600 * 1000).toISOString();
  if (sourceType === 'note') {
    const card = db.select().from(wbNote).where(eq(wbNote.id, cardId)).get();
    if (!card) return { kind: 'notFound' };
    db.update(wbNote)
      .set({ dueDate: nextDue, updatedAt: new Date().toISOString() })
      .where(eq(wbNote.id, cardId))
      .run();
  } else {
    const card = db.select().from(wbPalaceLoci).where(eq(wbPalaceLoci.id, cardId)).get();
    if (!card) return { kind: 'notFound' };
    db.update(wbPalaceLoci)
      .set({ dueDate: nextDue, updatedAt: new Date().toISOString() })
      .where(eq(wbPalaceLoci.id, cardId))
      .run();
  }

  SNOOZE_GUARD.set(key, nowMs);
  return { kind: 'ok', data: { ok: true, sourceType, cardId, nextDue } };
}

/** 归一化 days 参数：1~365，缺省 30 */
function normalizeDays(rawDays: unknown): number {
  return Math.max(1, Math.min(365, Number(rawDays) || 30));
}

/** GitHub 风格日活跃热力图。
 *  主源：新系统每次复习写入的 wb_review_log；并以源表 last_reviewed_at 作补充（避免历史上未记日志的复习漏算）。 */
export function getHeatmap(rawDays: unknown): HeatmapVO {
  const days = normalizeDays(rawDays);
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const startIso = start.toISOString();

  const logs = db
    .select({ cardId: wbReviewLog.cardId, reviewedAt: wbReviewLog.reviewedAt })
    .from(wbReviewLog)
    .where(and(eq(wbReviewLog.userId, CURRENT_USER), gte(wbReviewLog.reviewedAt, startIso)))
    .all();
  const notes = db
    .select({ id: wbNote.id, lastReviewedAt: wbNote.lastReviewedAt })
    .from(wbNote)
    .where(and(eq(wbNote.userId, CURRENT_USER), gte(wbNote.lastReviewedAt, startIso)))
    .all();
  const locis = db
    .select({ id: wbPalaceLoci.id, lastReviewedAt: wbPalaceLoci.lastReviewedAt })
    .from(wbPalaceLoci)
    .where(and(eq(wbPalaceLoci.userId, CURRENT_USER), gte(wbPalaceLoci.lastReviewedAt, startIso)))
    .all();

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
}

/** 遗忘曲线：源数据来自新系统的复习流水（wb_review_log，submit 时写入），
 *  按日聚合复习量 / 遗忘量 / 遗忘率 / 新卡数；
 *  若流水为空（老用户历史数据），回退到 wb_note + wb_palace_loci 的 last_reviewed_at / review_count 聚合。 */
export function getForgettingCurve(rawDays: unknown): ReviewForgettingCurveVO {
  const days = normalizeDays(rawDays);
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
    .all();

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
      ...db
        .select({ id: wbNote.id, lastReviewedAt: wbNote.lastReviewedAt, reviewCount: wbNote.reviewCount })
        .from(wbNote)
        .where(and(eq(wbNote.userId, CURRENT_USER), gte(wbNote.lastReviewedAt, startIso)))
        .all(),
      ...db
        .select({
          id: wbPalaceLoci.id,
          lastReviewedAt: wbPalaceLoci.lastReviewedAt,
          reviewCount: wbPalaceLoci.reviewCount,
        })
        .from(wbPalaceLoci)
        .where(and(eq(wbPalaceLoci.userId, CURRENT_USER), gte(wbPalaceLoci.lastReviewedAt, startIso)))
        .all(),
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
}
