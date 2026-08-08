import { CURRENT_USER, db } from '../db';
import { wbCapture, wbNote, wbReviewCard, wbPalace, wbPalaceLoci, wbStory, wbReviewLog } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { OverviewStats } from '../types/overview';

export function getOverview(): OverviewStats {
  const now = new Date();
  const iso = now.toISOString();
  const since7 = new Date(now.getTime() - 7 * 86400000).toISOString();

  // 注意：count 为跨多表的泛型计数 helper，tbl/extra 为 any 属原有写法（忠实搬运，未改逻辑）
  const count = (tbl: any, extra: any[] = []) => {
    const conds = [eq(tbl.userId, CURRENT_USER), ...extra];
    const r = db.select({ c: sql<number>`COUNT(*)` }).from(tbl).where(and(...conds)).get() as any;
    return r?.c ?? 0;
  };
  const countWhere = (tbl: any, where: any) => {
    const r = db.select({ c: sql<number>`COUNT(*)` }).from(tbl).where(where).get() as any;
    return r?.c ?? 0;
  };

  const captureTotal = count(wbCapture);
  const captureInbox = count(wbCapture, [eq(wbCapture.status, 'INBOX')]);
  const captureStarred = count(wbCapture, [eq(wbCapture.starred, 1)]);
  const noteTotal = count(wbNote);
  const reviewDue = countWhere(
    wbReviewCard,
    and(eq(wbReviewCard.userId, CURRENT_USER), eq(wbReviewCard.suspended, 0), sql`${wbReviewCard.nextReviewTime} <= ${iso}`),
  );
  const reviewCountRow = db
    .select({ s: sql<number>`COALESCE(SUM(${wbReviewCard.reviewCount}), 0)` })
    .from(wbReviewCard)
    .where(eq(wbReviewCard.userId, CURRENT_USER))
    .get() as any;
  const reviewCount = reviewCountRow?.s ?? 0;
  const palaceTotal = count(wbPalace);
  const lociTotal = count(wbPalaceLoci);
  const storyTotal = count(wbStory);
  const storyDraft = countWhere(
    wbStory,
    and(eq(wbStory.userId, CURRENT_USER), sql`${wbStory.status} IN ('DRAFT','DONE')`),
  );
  const reviewLast7d = countWhere(
    wbReviewLog,
    and(eq(wbReviewLog.userId, CURRENT_USER), sql`${wbReviewLog.reviewedAt} >= ${since7}`),
  );

  return {
    captureTotal,
    captureInbox,
    captureStarred,
    noteTotal,
    reviewDue,
    reviewCount,
    palaceTotal,
    lociTotal,
    storyTotal,
    storyDraft,
    reviewLast7d,
  };
}
