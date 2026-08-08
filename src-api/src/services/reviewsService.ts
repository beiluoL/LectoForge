/**
 * 复习卡牌业务层（workbench 旧系统，表 wb_review_card）。
 *
 * ⚠️ 与 services/reviewService.ts 区分：本文件服务 /api/workbench/reviews/*，
 * 另一个服务 /api/reviews/*（跨 note + loci 的新 SRS）。两套并存，勿合并。
 *
 * SM-2 计算统一委托 services/sm2.ts（该文件为算法唯一实现源，重构轮内只读不改）。
 */
import { and, eq, gte, lte, type SQL } from 'drizzle-orm';

import { CURRENT_USER, db, nowIso } from '../db';
import { categories, wbReviewCard, wbReviewLog } from '../db/schema';
import { gradeCard } from './sm2';
import type {
  CreateReviewCardDTO,
  DueCountVO,
  ForgettingCurveVO,
  GradeReviewCardVO,
  ListReviewCardQuery,
  ReviewCardRow,
  ReviewCardVO,
  UpdateReviewCardDTO,
} from '../types/reviews';

const DEFAULT_EF = 250;

/** 构建人类可读的「下次复习」提示（对齐 Web buildNextHint，按日期粒度计算）。 */
function buildNextHint(nextStr: string | null): string {
  if (!nextStr) return '待安排';
  const next = new Date(nextStr);
  if (Number.isNaN(next.getTime())) return '待安排';
  const today = new Date();
  const nextDay = Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
  const todayDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((nextDay - todayDay) / 86400000);
  if (days < 0) return `已逾期 ${-days} 天`;
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  return `${days} 天后`;
}

/** 数据库行 → 视图对象：补 EF 小数形态、下次复习提示与分类名 */
function toVO(card: ReviewCardRow): ReviewCardVO {
  const cat = card.categoryId
    ? db.select().from(categories).where(eq(categories.id, card.categoryId)).get()
    : null;
  return {
    ...card,
    easeFactorDecimal: (card.easeFactor ?? DEFAULT_EF) / 100,
    nextReviewHint: buildNextHint(card.nextReviewTime),
    categoryName: cat ? cat.name : null,
  };
}

/** 卡片列表（按下次复习时间升序） */
export function listCards(query: ListReviewCardQuery): ReviewCardVO[] {
  const conds: SQL[] = [eq(wbReviewCard.userId, CURRENT_USER)];
  if (query.categoryId !== undefined) conds.push(eq(wbReviewCard.categoryId, query.categoryId));
  if (query.noteId !== undefined) conds.push(eq(wbReviewCard.noteId, query.noteId));
  const rows = db
    .select()
    .from(wbReviewCard)
    .where(and(...conds))
    .orderBy(wbReviewCard.nextReviewTime)
    .all();
  return rows.map(toVO);
}

/** 抽取待复习卡片：优先到期卡片（含明日到期窗口），不足则补未学过的新卡 */
export function drawCards(rawLimit: unknown): ReviewCardVO[] {
  const limit = Math.max(1, Math.min(100, Number(rawLimit) || 20));
  const windowEnd = new Date(Date.now() + 86400000).toISOString();
  const due = db
    .select()
    .from(wbReviewCard)
    .where(
      and(
        eq(wbReviewCard.userId, CURRENT_USER),
        eq(wbReviewCard.suspended, 0),
        lte(wbReviewCard.nextReviewTime, windowEnd),
      ),
    )
    .orderBy(wbReviewCard.nextReviewTime, wbReviewCard.id)
    .all();
  let pool: ReviewCardRow[] = due;
  if (pool.length < limit) {
    const dueIds = new Set(pool.map((c) => c.id));
    const fresh = db
      .select()
      .from(wbReviewCard)
      .where(
        and(
          eq(wbReviewCard.userId, CURRENT_USER),
          eq(wbReviewCard.suspended, 0),
          eq(wbReviewCard.repetitions, 0),
        ),
      )
      .orderBy(wbReviewCard.nextReviewTime, wbReviewCard.id)
      .all()
      .filter((c) => !dueIds.has(c.id));
    pool = pool.concat(fresh).slice(0, limit);
  }
  return pool.map(toVO);
}

/** 待复习计数（供桌面端原生通知调度轮询） */
export function getDueCount(): DueCountVO {
  const now = nowIso();
  const due = db
    .select({ id: wbReviewCard.id, front: wbReviewCard.front })
    .from(wbReviewCard)
    .where(
      and(
        eq(wbReviewCard.userId, CURRENT_USER),
        eq(wbReviewCard.suspended, 0),
        lte(wbReviewCard.nextReviewTime, now),
      ),
    )
    .all();
  const sample = due.slice(0, 3).map((c) => c.front);
  return { count: due.length, sample };
}

/** 新建卡片，返回自增主键 */
export function createCard(dto: CreateReviewCardDTO): number {
  const now = nowIso();
  const row = db
    .insert(wbReviewCard)
    .values({
      userId: CURRENT_USER,
      captureId: dto.captureId ?? null,
      noteId: dto.noteId ?? null,
      categoryId: dto.categoryId ?? null,
      front: dto.front as string,
      back: dto.back ?? '',
      cardType: dto.cardType ?? 'basic',
      easeFactor: DEFAULT_EF,
      repetitions: 0,
      intervalDay: 0,
      reviewCount: 0,
      lapseCount: 0,
      nextReviewTime: now,
      lastReviewTime: null,
      suspended: 0,
    })
    .returning()
    .get();
  return row.id;
}

/** 编辑卡片；卡片不存在时返回 null（由 controller 转 404） */
export function updateCard(id: number, dto: UpdateReviewCardDTO): ReviewCardVO | null {
  const ex = db.select().from(wbReviewCard).where(eq(wbReviewCard.id, id)).get();
  if (!ex) return null;
  db.update(wbReviewCard)
    .set({
      front: dto.front ?? ex.front,
      back: dto.back ?? ex.back,
      cardType: dto.cardType ?? ex.cardType,
      captureId: dto.captureId !== undefined ? dto.captureId : ex.captureId,
      noteId: dto.noteId !== undefined ? dto.noteId : ex.noteId,
      categoryId: dto.categoryId !== undefined ? dto.categoryId : ex.categoryId,
    })
    .where(eq(wbReviewCard.id, id))
    .run();
  return toVO(db.select().from(wbReviewCard).where(eq(wbReviewCard.id, id)).get() as ReviewCardRow);
}

/** 删除卡片（幂等：不存在也不报错，与重构前一致） */
export function deleteCard(id: number): void {
  db.delete(wbReviewCard).where(eq(wbReviewCard.id, id)).run();
}

/**
 * SM-2 评分（对齐 Web gradeReview）。卡片不存在时返回 null。
 *
 * ⚠️ quality 由 controller 传入 Number() 结果，可能是 NaN：
 * 原实现的范围校验写作 `quality < 0 || quality > 3`，与 NaN 比较恒为 false，
 * 因此 NaN 会一路落到这里并触发数据库 NOT NULL 约束错误（500）。
 * 这是既有行为，本轮结构重构刻意不修正——修它属于行为变更，应另开 PR。
 */
export function gradeReviewCard(
  id: number,
  quality: number,
  costMs: number | null,
): GradeReviewCardVO | null {
  const card = db.select().from(wbReviewCard).where(eq(wbReviewCard.id, id)).get();
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

  const now = new Date();
  const next = new Date(now.getTime() + res.nextReviewDays * 86400000);
  db.update(wbReviewCard)
    .set({
      easeFactor: res.easeFactor,
      repetitions: res.repetitions,
      intervalDay: res.intervalDay,
      reviewCount: res.reviewCount,
      lapseCount: res.lapseCount,
      nextReviewTime: next.toISOString(),
      lastReviewTime: now.toISOString(),
    })
    .where(eq(wbReviewCard.id, id))
    .run();

  db.insert(wbReviewLog)
    .values({
      userId: CURRENT_USER,
      cardId: id,
      quality: res.quality,
      intervalDay: res.intervalDay,
      easeFactor: res.easeFactor,
      costMs: costMs ?? null,
      reviewedAt: now.toISOString(),
    })
    .run();

  // nextReviewAt 与 Web 端语义一致（同一瞬时，前端按本地时区展示墙钟时间）
  return {
    cardId: id,
    quality: res.quality,
    repetitions: res.repetitions,
    intervalDay: res.intervalDay,
    easeFactor: res.easeFactor / 100,
    nextReviewAt: next.getTime(),
    lapsed: res.lapsed,
  };
}

/** 挂起 / 取消挂起（切换语义）；卡片不存在时返回 false */
export function toggleSuspend(id: number): boolean {
  const row = db.select().from(wbReviewCard).where(eq(wbReviewCard.id, id)).get();
  if (!row) return false;
  const suspended = row.suspended ? 0 : 1;
  db.update(wbReviewCard).set({ suspended }).where(eq(wbReviewCard.id, id)).run();
  return true;
}

/** 遗忘曲线：按日聚合复习量、遗忘量、遗忘率与新卡数（对齐 Web forgettingCurve） */
export function getForgettingCurve(rawDays: unknown): ForgettingCurveVO {
  const days = Math.max(1, Math.min(365, Number(rawDays) || 30));
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400000);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const startDate = fmt(start);
  const endDate = fmt(end);

  const bucket: Record<string, { reviews: number; lapses: number; newCards: number }> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const key = fmt(d);
    bucket[key] = { reviews: 0, lapses: 0, newCards: 0 };
  }

  const logs = db
    .select()
    .from(wbReviewLog)
    .where(and(eq(wbReviewLog.userId, CURRENT_USER), gte(wbReviewLog.reviewedAt, start.toISOString())))
    .all();

  const seenCards = new Set<number>();
  let totalReviews = 0;
  let totalLapses = 0;
  for (const log of logs) {
    const key = (log.reviewedAt || '').slice(0, 10);
    const p = bucket[key];
    if (!p) continue;
    p.reviews += 1;
    if (log.quality === 0) p.lapses += 1;
    if (log.cardId != null && !seenCards.has(log.cardId)) {
      seenCards.add(log.cardId);
      p.newCards += 1;
    }
    totalReviews += 1;
    if (log.quality === 0) totalLapses += 1;
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

  return {
    startDate,
    endDate,
    points,
    totalReviews,
    totalLapses,
    overallLapseRate,
  };
}
