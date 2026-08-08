/**
 * 间隔复习业务层（新 SRS 系统，跨 wb_note + wb_palace_loci 聚合）。
 *
 * ⚠️ 与 services/reviewsService.ts 区分：本文件服务 /api/reviews/*，
 * 另一个服务 /api/workbench/reviews/*（wb_review_card 旧体系）。两套并存，勿合并。
 *
 * SM-2 计算统一委托 services/sm2.ts —— 该文件是算法唯一实现源，本轮重构只读不改，
 * 这里仅搬运调用点，入参与出参的用法与重构前逐字一致。
 */
import { and, eq, gte, inArray, lte } from 'drizzle-orm';

import { CURRENT_USER, db, nowIso } from '../db';
import { wbNote, wbPalaceLoci, wbReviewCard, wbReviewLog } from '../db/schema';
import { gradeCard } from './sm2';
import type {
  AdoptMnemonicOutcome,
  HeatmapVO,
  ReviewCardVO,
  ReviewDayItem,
  ReviewDayVO,
  ReviewDueStatsVO,
  ReviewForgettingCurveVO,
  ReviewSourceType,
  SnoozeOutcome,
  SubmitOutcome,
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

/** 单次拉取默认张数：手册约定的 UI 上限，保持不变 */
const DEFAULT_DUE_LIMIT = 20;
/** 「待复习清单」需要全量视图，放宽到 200；再多也不该一次塞进弹窗 */
const MAX_DUE_LIMIT = 200;
const EPOCH = '1970-01-01T00:00:00.000Z';

/** 评分档位 → SM-2 quality；未知档位返回 undefined（由 controller 转 400） */
export function ratingToQuality(rating: string): number | undefined {
  return RATING_TO_QUALITY[rating];
}

/** limit 归一化：1 ~ 200，非法/缺省回落 20（清单页显式传 100） */
function normalizeLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DUE_LIMIT;
  return Math.max(1, Math.min(MAX_DUE_LIMIT, Math.floor(n)));
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
    imageHint: row.imageHint ?? null,
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
    imageHint: row.imageHint ?? null,
  };
}

/**
 * 到期判据（全系统唯一真相）：due_date <= now。
 *
 * ⚠️ 重构前这里是 `due_date <= now OR mastery < 3`，比 dashboardService.dueReviews
 * （只看 due_date）宽松，直接引发三个连锁问题：
 *   ① 驾驶舱显示 31，队列却能拉出更多 → 进度条分母无解；
 *   ② 刚评过分的卡（due_date 已排到未来，但 mastery=1 < 3）立刻重新满足条件，
 *      刷完一轮再拉还是它，用户观感就是「永远刷不完 / 卡在同一张」；
 *   ③ 本次新增的「刷完 20 张自动续取下一批」会因此陷入死循环，永远到不了完成页。
 * 统一收敛到 due_date <= now 后，due / due-stats / 驾驶舱三处数字恒等。
 * 新卡不会漏：due_date 列 NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'，天然处于到期态。
 */
function noteDueWhere(now: string) {
  return and(eq(wbNote.userId, CURRENT_USER), lte(wbNote.dueDate, now));
}
function lociDueWhere(now: string) {
  return and(eq(wbPalaceLoci.userId, CURRENT_USER), lte(wbPalaceLoci.dueDate, now));
}

/** 按到期时间升序合并两类源卡；ISO 字符串字典序即时间序 */
function mergeByDue(cards: ReviewCardVO[]): ReviewCardVO[] {
  return cards.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

/**
 * 拉取待复习卡片（跨 notes + loci 聚合）。
 * @param rawLimit 缺省 20（刷题页），「待复习清单」抽屉传 100，硬上限 200。
 */
export function listDueCards(rawLimit?: unknown): ReviewCardVO[] {
  const limit = normalizeLimit(rawLimit);
  const now = nowIso();
  const noteRows = db.select().from(wbNote).where(noteDueWhere(now)).all();
  const lociRows = db.select().from(wbPalaceLoci).where(lociDueWhere(now)).all();
  const merged = mergeByDue([...noteRows.map(mapNote), ...lociRows.map(mapLoci)]);
  return merged.slice(0, limit);
}

/**
 * 进度条分母的唯一数据源：到期总量 + 按卡型细分。
 * 判据与 listDueCards / dashboardService.dueReviews 完全一致，三处数字保证对得上。
 * 到期卡量级只有几十~几百，直接取列在 JS 里分桶，比拆 6 条 COUNT 更省事也更好读。
 */
export function getDueStats(): ReviewDueStatsVO {
  const now = nowIso();
  const notes = db
    .select({ repetitions: wbNote.repetitions, lapseCount: wbNote.lapseCount })
    .from(wbNote)
    .where(noteDueWhere(now))
    .all();
  const locis = db
    .select({ repetitions: wbPalaceLoci.repetitions, lapseCount: wbPalaceLoci.lapseCount })
    .from(wbPalaceLoci)
    .where(lociDueWhere(now))
    .all();

  let newCount = 0;
  let reviewCount = 0;
  let riskCount = 0;
  for (const c of [...notes, ...locis]) {
    if ((c.repetitions ?? 0) === 0) newCount += 1;
    else reviewCount += 1;
    if ((c.lapseCount ?? 0) > 2) riskCount += 1;
  }
  return {
    total: notes.length + locis.length,
    newCount,
    reviewCount,
    riskCount,
    noteCount: notes.length,
    lociCount: locis.length,
  };
}

/** 写复习流水，供热力图 / 遗忘曲线 / 单日复盘聚合（新系统统一从这里取数）。
 *  sourceType 必填：同一张表里 card_id=5 既可能是 note 也可能是 loci，
 *  不写来源就没法在「单日复盘」里反查卡面文案。旧系统写入时该列为 NULL。 */
function writeReviewLog(
  cardId: number,
  sourceType: ReviewSourceType,
  quality: number,
  intervalDay: number,
  easeFactor: number,
  at: string,
) {
  db.insert(wbReviewLog)
    .values({
      userId: CURRENT_USER,
      cardId,
      quality,
      intervalDay,
      easeFactor,
      reviewedAt: at,
      sourceType,
    })
    .run();
}

/**
 * 提交评分，落 SM-2 数据到对应源表。
 *
 * ⚠️ 本函数**永不抛异常**，这是队列卡死修复的服务端一半。
 * 客户端队列是一份快照，卡片随时可能在别处被删掉；若这里回 404/500，
 * 前端 catch 之后极易把用户锁死在同一张卡上。所以：
 *   - 卡片查不到      → skipped  （controller 翻成 200 + { ok:false }）
 *   - 落库中途炸了    → degraded （同样 200，文案换成「未保存」）
 * 两种情况前端都照常出队，最坏结果只是这张卡下次还会到期，不会锁死。
 *
 * 两个分支的差异仅在「目标表」与「熟练度列名」（note 用 mastery，loci 用 masteredLevel），
 * 其余字段集合与写入顺序（先更新源表、再写流水）与重构前一致。
 */
export function submitReview(
  cardId: number,
  sourceType: ReviewSourceType,
  quality: number,
): SubmitOutcome {
  const now = new Date();
  const nowIsoStr = now.toISOString();

  let card: NoteRow | LociRow | undefined;
  try {
    card =
      sourceType === 'note'
        ? db.select().from(wbNote).where(eq(wbNote.id, cardId)).get()
        : db.select().from(wbPalaceLoci).where(eq(wbPalaceLoci.id, cardId)).get();
  } catch {
    return { kind: 'degraded', message: '评分未能保存，已跳过该卡' };
  }
  if (!card) return { kind: 'skipped', message: '卡片已不存在，跳过' };

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

  try {
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

    writeReviewLog(cardId, sourceType, quality, res.intervalDay, res.easeFactor, nowIsoStr);
  } catch (err) {
    // 源表已更新但流水失败之类的半成功也归到这里：排程是准的，统计少一条，可接受
    console.error('[reviewService.submitReview] 落库失败', { cardId, sourceType }, err);
    return { kind: 'degraded', message: '评分未能保存，已跳过该卡' };
  }

  return {
    kind: 'ok',
    data: {
      ok: true,
      sourceType,
      nextDue,
      masteredLevel,
      easeFactor: res.easeFactor / 100,
      lapsed: res.lapsed,
    },
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

// ===================== 单日复盘（热力图 / 遗忘曲线点击下钻）=====================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 校验并归一化 YYYY-MM-DD；非法回落今天（UTC，与热力图分桶口径一致） */
function normalizeDate(raw: unknown): string {
  const s = String(raw ?? '').trim();
  return DATE_RE.test(s) ? s : new Date().toISOString().slice(0, 10);
}

/**
 * 某一天到底复习了什么、哪些没记住。
 *
 * 数据源是 wb_review_log —— 两套系统共用的表，靠 source_type 区分：
 *   'note' / 'loci' → 新 SRS，回源表取卡面；
 *   NULL            → 旧卡组历史流水，回 wb_review_card 取 front。
 * 卡面查不到（源卡已删）не 丢弃该条，front 留空由前端渲染成「已删除的卡片」，
 * 否则统计数会和热力图对不上。
 */
export function getReviewDay(rawDate: unknown): ReviewDayVO {
  const date = normalizeDate(rawDate);
  // reviewedAt 是 UTC ISO 字符串，用前缀区间过滤即可命中当日全部记录
  const logs = db
    .select({
      cardId: wbReviewLog.cardId,
      quality: wbReviewLog.quality,
      reviewedAt: wbReviewLog.reviewedAt,
      sourceType: wbReviewLog.sourceType,
    })
    .from(wbReviewLog)
    .where(
      and(
        eq(wbReviewLog.userId, CURRENT_USER),
        gte(wbReviewLog.reviewedAt, `${date}T00:00:00.000Z`),
        lte(wbReviewLog.reviewedAt, `${date}T23:59:59.999Z`),
      ),
    )
    .all();

  // 分组批量回表，避免 N+1
  const noteIds = [...new Set(logs.filter((l) => l.sourceType === 'note').map((l) => l.cardId))];
  const lociIds = [...new Set(logs.filter((l) => l.sourceType === 'loci').map((l) => l.cardId))];
  const legacyIds = [...new Set(logs.filter((l) => l.sourceType == null).map((l) => l.cardId))];

  const noteFront = new Map<number, string>();
  const lociFront = new Map<number, string>();
  const legacyFront = new Map<number, string>();

  if (noteIds.length) {
    for (const r of db
      .select({ id: wbNote.id, cue: wbNote.cueColumn, title: wbNote.title })
      .from(wbNote)
      .where(inArray(wbNote.id, noteIds))
      .all()) {
      noteFront.set(r.id, (r.cue || r.title || '').trim() || '未命名笔记');
    }
  }
  if (lociIds.length) {
    for (const r of db
      .select({ id: wbPalaceLoci.id, name: wbPalaceLoci.name })
      .from(wbPalaceLoci)
      .where(inArray(wbPalaceLoci.id, lociIds))
      .all()) {
      lociFront.set(r.id, (r.name || '').trim() || '未命名位点');
    }
  }
  if (legacyIds.length) {
    for (const r of db
      .select({ id: wbReviewCard.id, front: wbReviewCard.front })
      .from(wbReviewCard)
      .where(inArray(wbReviewCard.id, legacyIds))
      .all()) {
      legacyFront.set(r.id, (r.front || '').trim());
    }
  }

  const items: ReviewDayItem[] = logs
    .map((l) => {
      const st: ReviewDayItem['sourceType'] =
        l.sourceType === 'note' ? 'note' : l.sourceType === 'loci' ? 'loci' : 'card';
      const front =
        st === 'note'
          ? noteFront.get(l.cardId) || ''
          : st === 'loci'
            ? lociFront.get(l.cardId) || ''
            : legacyFront.get(l.cardId) || '';
      return {
        cardId: l.cardId,
        sourceType: st,
        front,
        quality: l.quality,
        lapsed: l.quality < 2, // 与遗忘曲线口径一致
        reviewedAt: l.reviewedAt,
      };
    })
    // 遗忘的排前面（用户下钻多半想看"我错在哪"），其次按时间倒序
    .sort((a, b) => {
      if (a.lapsed !== b.lapsed) return a.lapsed ? -1 : 1;
      return a.reviewedAt < b.reviewedAt ? 1 : -1;
    });

  const lapses = items.filter((i) => i.lapsed).length;
  return {
    date,
    total: items.length,
    lapses,
    lapseRate: items.length === 0 ? 0 : lapses / items.length,
    items,
  };
}

// ===================== 助记口诀采纳 =====================

/** 口诀落库长度上限：image_hint 是给人扫一眼的提示，不是正文 */
const MNEMONIC_MAX_LEN = 300;

/**
 * 把助记口诀写进源表的 image_hint。
 * loci 本来就有这一列；note 的 image_hint 是本轮新增（db/index.ts 幂等补列）。
 * 传空字符串 = 清除已采纳的口诀，属于合法操作，不当成 badInput。
 */
export function adoptMnemonic(
  cardId: number,
  sourceType: ReviewSourceType,
  rawMnemonic: unknown,
): AdoptMnemonicOutcome {
  const mnemonic = String(rawMnemonic ?? '').trim().slice(0, MNEMONIC_MAX_LEN);
  if (!Number.isInteger(cardId) || cardId <= 0) {
    return { kind: 'badInput', message: 'cardId 非法' };
  }

  const at = new Date().toISOString();
  if (sourceType === 'note') {
    const row = db.select({ id: wbNote.id }).from(wbNote).where(eq(wbNote.id, cardId)).get();
    if (!row) return { kind: 'notFound' };
    db.update(wbNote)
      .set({ imageHint: mnemonic || null, updatedAt: at })
      .where(eq(wbNote.id, cardId))
      .run();
  } else {
    const row = db
      .select({ id: wbPalaceLoci.id })
      .from(wbPalaceLoci)
      .where(eq(wbPalaceLoci.id, cardId))
      .get();
    if (!row) return { kind: 'notFound' };
    db.update(wbPalaceLoci)
      .set({ imageHint: mnemonic || null, updatedAt: at })
      .where(eq(wbPalaceLoci.id, cardId))
      .run();
  }

  return { kind: 'ok', data: { ok: true, cardId, sourceType, mnemonic } };
}
