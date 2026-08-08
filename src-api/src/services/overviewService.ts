import { CURRENT_USER, db } from '../db';
import { wbCapture, wbNote, wbReviewCard, wbPalace, wbPalaceLoci, wbStory, wbReviewLog } from '../db/schema';
import { eq, and, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { OverviewStats } from '../types/overview';

/**
 * 参与首页统计的表统一约束：必须带 userId 列。
 * 本应用所有业务表都满足该形状，用它替代原先的 `tbl: any`——
 * 既保住了「一个 helper 数多张表」的泛用性，又能在传错表时由编译器拦下。
 */
type UserScopedTable = SQLiteTable & { userId: AnyColumn };

export function getOverview(): OverviewStats {
  const now = new Date();
  const iso = now.toISOString();
  const since7 = new Date(now.getTime() - 7 * 86400000).toISOString();

  /**
   * 按 userId 作用域计数。
   * @param tbl   目标业务表（须含 userId 列）
   * @param extra 追加的过滤条件，会与 userId 条件做 AND
   * @returns 命中行数；查询无结果时返回 0
   */
  const count = (tbl: UserScopedTable, extra: SQL[] = []): number => {
    const conds = [eq(tbl.userId, CURRENT_USER), ...extra];
    const r = db.select({ c: sql<number>`COUNT(*)` }).from(tbl).where(and(...conds)).get();
    return r?.c ?? 0;
  };

  /**
   * 按完全自定义条件计数（调用方自行拼好 where，包括 userId 约束）。
   * @param tbl   目标业务表
   * @param where 完整的 where 条件
   * @returns 命中行数；查询无结果时返回 0
   */
  const countWhere = (tbl: SQLiteTable, where: SQL | undefined): number => {
    const r = db.select({ c: sql<number>`COUNT(*)` }).from(tbl).where(where).get();
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
