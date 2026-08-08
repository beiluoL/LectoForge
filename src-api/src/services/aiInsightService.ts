/**
 * AI 洞察层服务：学习周报、薄弱点诊断、默写趋势建议、智能复习推荐。
 *
 * 本文件全程**只读聚合**，绝不写任何业务表——排程仍由 SM-2 与既有 submit 接口决定，
 * AI 只负责把统计数字讲成人话。
 */
import { and, eq, gte, sql } from 'drizzle-orm';

import { CURRENT_USER, db } from '../db';
import { wbCapture, wbNote, wbRecallSession, wbReviewCard, wbReviewLog, wbStory } from '../db/schema';
import { chatJson } from '../lib/llm';
import { normalizeList } from '../lib/aiNormalize';
import {
  buildInsightReportPrompt,
  buildRecallAdvicePrompt,
  buildReviewRecommendPrompt,
  buildReviewSummaryPrompt,
  buildWeaknessDiagnosePrompt,
  type InsightReportOutput,
  type RecallAdviceOutput,
  type ReviewRecommendOutput,
  type ReviewSummaryOutput,
  type WeaknessDiagnoseOutput,
} from '../lib/prompts';
import type {
  AiResult,
  DaysDTO,
  InsightReportVO,
  RecallAdviceDTO,
  RecallAdviceVO,
  ReviewRecommendDTO,
  ReviewRecommendVO,
  ReviewSummaryDTO,
  ReviewSummaryVO,
  WeaknessDiagnoseVO,
} from '../types/ai';

// ===================== 只读聚合辅助 =====================

function buildOverview() {
  const count = (tbl: any, extra: any[] = []) => {
    const r = db.select({ c: sql<number>`COUNT(*)` }).from(tbl).where(and(eq(tbl.userId, CURRENT_USER), ...extra)).get() as any;
    return r?.c ?? 0;
  };
  const now = new Date().toISOString();
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
  return {
    captureTotal: count(wbCapture),
    captureInbox: count(wbCapture, [eq(wbCapture.status, 'INBOX')]),
    noteTotal: count(wbNote),
    reviewDue: count(wbReviewCard, [eq(wbReviewCard.suspended, 0), sql`${wbReviewCard.nextReviewTime} <= ${now}`]),
    storyTotal: count(wbStory),
    reviewLast7d: count(wbReviewLog, [gte(wbReviewLog.reviewedAt, since7)]),
  };
}

function buildForgettingCurve(days: number) {
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const startDate = fmt(start);
  const endDate = fmt(end);
  const bucket: Record<string, { reviews: number; lapses: number }> = {};
  for (let i = 0; i < days; i++) {
    bucket[fmt(new Date(start.getTime() + i * 86400000))] = { reviews: 0, lapses: 0 };
  }
  const logs = db
    .select({ reviewedAt: wbReviewLog.reviewedAt, quality: wbReviewLog.quality })
    .from(wbReviewLog)
    .where(and(eq(wbReviewLog.userId, CURRENT_USER), gte(wbReviewLog.reviewedAt, start.toISOString())))
    .all() as { reviewedAt: string; quality: number }[];
  let totalReviews = 0;
  let totalLapses = 0;
  for (const log of logs) {
    const p = bucket[(log.reviewedAt || '').slice(0, 10)];
    if (!p) continue;
    p.reviews += 1;
    if (log.quality === 0) p.lapses += 1;
    totalReviews += 1;
    if (log.quality === 0) totalLapses += 1;
  }
  const points = Object.keys(bucket).map((date) => ({
    date,
    reviews: bucket[date].reviews,
    lapses: bucket[date].lapses,
    lapseRate: bucket[date].reviews === 0 ? 0 : bucket[date].lapses / bucket[date].reviews,
  }));
  return {
    startDate,
    endDate,
    points,
    totalReviews,
    totalLapses,
    overallLapseRate: totalReviews === 0 ? 0 : totalLapses / totalReviews,
  };
}

// ===================== P2-G1：学习周报 / 洞察 =====================

export async function buildInsightReport(b: DaysDTO): Promise<AiResult<InsightReportVO>> {
  const days = Math.max(7, Math.min(90, Number(b.days) || 30));
  const overview = buildOverview();
  const forgettingCurve = buildForgettingCurve(days);
  const { data, raw } = await chatJson<InsightReportOutput>(
    buildInsightReportPrompt({ overview, forgettingCurve, days }),
    { temperature: 0.3 },
  );
  return {
    kind: 'ok',
    data: {
      summary: String(data.summary || '').trim(),
      highlights: normalizeList(data.highlights, 5),
      suggestions: normalizeList(data.suggestions, 5),
      model: raw.model,
      latencyMs: raw.latencyMs,
    },
  };
}

// ===================== P2-C2：薄弱点诊断 =====================

export async function diagnoseWeakness(b: DaysDTO): Promise<AiResult<WeaknessDiagnoseVO>> {
  const days = Math.max(7, Math.min(180, Number(b.days) || 60));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const logs = db
    .select({ front: wbReviewCard.front, reviewedAt: wbReviewLog.reviewedAt })
    .from(wbReviewLog)
    .innerJoin(wbReviewCard, eq(wbReviewCard.id, wbReviewLog.cardId))
    .where(and(eq(wbReviewLog.userId, CURRENT_USER), eq(wbReviewLog.quality, 0), gte(wbReviewLog.reviewedAt, since)))
    .all() as { front: string; reviewedAt: string }[];
  const total =
    (
      db
        .select({ c: sql<number>`COUNT(*)` })
        .from(wbReviewLog)
        .where(and(eq(wbReviewLog.userId, CURRENT_USER), gte(wbReviewLog.reviewedAt, since)))
        .get() as any
    )?.c ?? 0;
  const lapses = logs.map((l) => ({ front: l.front, reviewedAt: (l.reviewedAt || '').slice(0, 10) }));
  const overallLapseRate = total === 0 ? 0 : logs.length / total;
  const { data, raw } = await chatJson<WeaknessDiagnoseOutput>(
    buildWeaknessDiagnosePrompt({ lapses, overallLapseRate, totalReviews: total }),
    { temperature: 0.3 },
  );
  return {
    kind: 'ok',
    data: {
      summary: String(data.summary || '').trim(),
      weakTopics: normalizeList(data.weakTopics, 5),
      suggestions: normalizeList(data.suggestions, 5),
      model: raw.model,
      latencyMs: raw.latencyMs,
    },
  };
}

// ===================== P3-D2：三轮闭卷默写「趋势改进建议」 =====================

export async function adviseRecall(b: RecallAdviceDTO): Promise<AiResult<RecallAdviceVO>> {
  if (!b.sessionId) {
    return { kind: 'fail', status: 400, message: '缺少 sessionId', aiCode: 'AI_BAD_INPUT' };
  }
  const session = db.select().from(wbRecallSession).where(eq(wbRecallSession.id, Number(b.sessionId))).get() as any;
  if (!session) {
    return { kind: 'fail', status: 404, message: '会话不存在', aiCode: 'AI_BAD_INPUT' };
  }
  const rounds = [
    { round: 1, text: session.round1Text || '', score: session.round1Score },
    { round: 2, text: session.round2Text || '', score: session.round2Score },
    { round: 3, text: session.round3Text || '', score: session.round3Score },
  ].filter((r) => (r.text || '').trim().length > 0);
  if (rounds.length === 0) {
    return {
      kind: 'fail',
      status: 400,
      message: '该会话还没有任何默写记录，先完成至少一轮再求建议',
      aiCode: 'AI_BAD_INPUT',
    };
  }
  const { data, raw } = await chatJson<RecallAdviceOutput>(
    buildRecallAdvicePrompt({
      title: session.title || '',
      sourceText: session.sourceText || '',
      rounds,
      improvementPct: session.improvementPct || [null, null, null],
    }),
    { temperature: 0.3 },
  );
  return {
    kind: 'ok',
    data: {
      summary: String(data.summary || '').trim(),
      strengths: normalizeList(data.strengths, 5),
      gaps: normalizeList(data.gaps, 5),
      advice: normalizeList(data.advice, 5),
      nextSteps: normalizeList(data.nextSteps, 3),
      model: raw.model,
      latencyMs: raw.latencyMs,
    },
  };
}

// ===================== P3-G2：智能复习推荐引擎 =====================

export async function recommendReview(b: ReviewRecommendDTO): Promise<AiResult<ReviewRecommendVO>> {
  const limit = Math.max(5, Math.min(50, Number(b.limit) || 20));
  const now = new Date().toISOString();
  const dueCards = db
    .select({
      front: wbReviewCard.front,
      back: wbReviewCard.back,
      intervalDay: wbReviewCard.intervalDay,
      easeFactor: wbReviewCard.easeFactor,
      lapseCount: wbReviewCard.lapseCount,
    })
    .from(wbReviewCard)
    .where(and(eq(wbReviewCard.userId, CURRENT_USER), eq(wbReviewCard.suspended, 0), gte(wbReviewCard.nextReviewTime, now)))
    .orderBy(sql`${wbReviewCard.nextReviewTime} ASC`)
    .limit(limit)
    .all() as any[];
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const lapses = db
    .select({ front: wbReviewCard.front })
    .from(wbReviewLog)
    .innerJoin(wbReviewCard, eq(wbReviewCard.id, wbReviewLog.cardId))
    .where(and(eq(wbReviewLog.userId, CURRENT_USER), eq(wbReviewLog.quality, 0), gte(wbReviewLog.reviewedAt, since)))
    .all() as { front: string }[];
  const forgettingCurve = buildForgettingCurve(30);
  const { data, raw } = await chatJson<ReviewRecommendOutput>(
    buildReviewRecommendPrompt({
      dueCards: dueCards.map((c) => ({
        front: c.front,
        back: c.back,
        intervalDay: c.intervalDay,
        easeFactorDecimal: c.easeFactor / 100,
        lapseCount: c.lapseCount,
      })),
      lapses: lapses.map((l) => l.front),
      forgettingSummary: {
        overallLapseRate: forgettingCurve.overallLapseRate,
        totalReviews: forgettingCurve.totalReviews,
      },
    }),
    { temperature: 0.3 },
  );
  return {
    kind: 'ok',
    data: {
      summary: String(data.summary || '').trim(),
      priorities: Array.isArray(data.priorities)
        ? data.priorities
            .filter((p: any) => p && String(p.front || '').trim())
            .map((p: any) => ({
              front: String(p.front).trim(),
              reason: String(p.reason || '').trim(),
              method: String(p.method || '主动回忆').trim(),
            }))
            .slice(0, 6)
        : [],
      suggestions: normalizeList(data.suggestions, 5),
      model: raw.model,
      latencyMs: raw.latencyMs,
    },
  };
}

// ===================== 本轮复习简报 =====================

/** 入参不合法 —— 与 aiContentService.badInput 同形，两层各自持有避免跨服务耦合 */
function badInput(message: string): AiResult<never> {
  return { kind: 'fail', status: 400, message, aiCode: 'AI_BAD_INPUT' };
}

/**
 * 刷完一轮后的 AI 复盘简报（纯计算，不落库）。
 *
 * ⚠️ 数据来源是**前端回传的本轮记录**，不是查库。
 * 原因：一轮复习是个会话级概念，库里只有「最近一次复习时间」，
 * 没有「这一轮包含哪些卡」的概念；要支持就得再建一张会话表，
 * 而简报是一次性读物，为它加表不划算。
 *
 * 全部通过（0 张 hard）也应该出稿——一份「今天很稳」的正向简报同样有价值，
 * 这时 weakTopics 为空，模型只写 headline + encouragement。
 */
export async function summarizeReviewSession(
  b: ReviewSummaryDTO,
): Promise<AiResult<ReviewSummaryVO>> {
  const rawCards = Array.isArray(b.cards) ? b.cards : [];
  const cards = rawCards
    .filter((c) => c && String(c.front || '').trim())
    .map((c) => ({
      front: String(c.front || '').trim(),
      back: String(c.back || '').trim(),
      rating: String(c.rating || 'hard').trim(),
    }))
    .slice(0, 20);

  const hardCount = cards.filter((c) => c.rating === 'hard').length;
  // total 以前端回传为准；缺省时退化成卡片数，保证提示词里的分母不为 0
  const total = Math.max(Number(b.total) || 0, cards.length);
  const minutes = Number(b.minutes) > 0 ? Math.round(Number(b.minutes)) : null;

  if (total === 0) return badInput('本轮还没有复习记录，无法生成简报');

  const { data, raw } = await chatJson<ReviewSummaryOutput>(
    buildReviewSummaryPrompt({ total, hardCount, cards, minutes }),
    { temperature: 0.4 },
  );

  return {
    kind: 'ok',
    data: {
      headline: String(data.headline || '').trim() || '本轮复习已完成',
      weakTopics: Array.isArray(data.weakTopics)
        ? data.weakTopics
            .filter((t: any) => t && String(t.topic || '').trim())
            .map((t: any) => ({
              topic: String(t.topic).trim(),
              reason: String(t.reason || '').trim(),
            }))
            .slice(0, 4)
        : [],
      suggestions: normalizeList(data.suggestions, 4),
      encouragement: String(data.encouragement || '').trim(),
      total,
      hardCount,
      model: raw.model,
      latencyMs: raw.latencyMs,
    },
  };
}
