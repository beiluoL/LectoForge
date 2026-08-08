import { db, CURRENT_USER } from '../db';
import { wbCapture, wbNote, wbPalaceLoci, wbStory } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { DashboardStats } from '../types/dashboard';

export function getDashboardStats(): DashboardStats {
  const now = new Date();
  const nowIsoStr = now.toISOString();
  // 桌面端单机场景：以本机时区当日 0 点为「今日」边界，转成 UTC ISO 与 createdAt（UTC ISO）比较。
  const startOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  ).toISOString();
  const since7 = new Date(now.getTime() - 7 * 86400000).toISOString();

  // count 为跨多表泛型计数 helper，tbl/extra 为 any 属原有写法（忠实搬运，未改逻辑）
  const count = (tbl: any, extra: any[] = []): number => {
    const r = db
      .select({ c: sql<number>`COUNT(*)` })
      .from(tbl)
      .where(and(eq(tbl.userId, CURRENT_USER), ...extra))
      .get() as any;
    return r?.c ?? 0;
  };

  // 今日新增灵感（收集箱）
  const todayCaptures = count(wbCapture, [sql`${wbCapture.createdAt} >= ${startOfDay}`]);
  // 待整理碎片（收集箱 INBOX）
  const pendingCaptures = count(wbCapture, [eq(wbCapture.status, 'INBOX')]);
  // 待复习卡片：notes + loci 中 dueDate <= now（SM-2 到期，与 /review 同源）
  const dueNotes = count(wbNote, [sql`${wbNote.dueDate} <= ${nowIsoStr}`]);
  const dueLoci = count(wbPalaceLoci, [sql`${wbPalaceLoci.dueDate} <= ${nowIsoStr}`]);
  const dueReviews = dueNotes + dueLoci;
  // 记忆宫殿总位点数
  const palaceLoci = count(wbPalaceLoci);
  // 故事草稿
  const storyDrafts = count(wbStory, [eq(wbStory.status, 'DRAFT')]);
  // 收件箱积压：INBOX 且创建时间早于 now - 72h（3 天）
  const overdueThreshold = new Date(now.getTime() - 72 * 3600 * 1000).toISOString();
  const inboxOverdueCount = count(wbCapture, [
    eq(wbCapture.status, 'INBOX'),
    sql`${wbCapture.createdAt} < ${overdueThreshold}`,
  ]);
  // 最近 7 天从收集箱流转到笔记：captureId 非空且近 7 天创建的笔记
  const weeklyFlow = count(wbNote, [
    sql`${wbNote.captureId} IS NOT NULL`,
    sql`${wbNote.createdAt} >= ${since7}`,
  ]);

  // 顶部闭环四步总量
  const step1Count = count(wbCapture);
  const step2Count = count(wbNote);
  const step3Count = dueReviews;
  const step4Count = count(wbStory);

  return {
    todayCaptures,
    pendingCaptures,
    dueReviews,
    palaceLoci,
    storyDrafts,
    inboxOverdueCount,
    weeklyFlow,
    loopSteps: { step1Count, step2Count, step3Count, step4Count },
  };
}
