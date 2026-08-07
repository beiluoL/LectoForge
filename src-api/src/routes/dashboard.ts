import { FastifyInstance } from 'fastify';
import { db, CURRENT_USER } from '../db';
import { wbCapture, wbNote, wbPalaceLoci, wbStory } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';

/**
 * 工作台首页聚合统计（顶部「学习闭环四步」数字气泡 + 「今日聚焦」四卡的唯一数据源）。
 *
 * 与原始需求 spec 的字段对齐，但表名/枚举按本项目真实 schema 校正：
 * - captures  → wbCapture（状态枚举 INBOX/PROCESSED/ARCHIVED，spec 的 'unprocessed' = INBOX）
 * - notes     → wbNote
 * - stories   → wbStory（状态枚举 DRAFT/DONE，spec 的 'draft' = DRAFT）
 * - loci      → wbPalaceLoci
 * 「待复习」按 SM-2 到期语义：跨 wbNote + wbPalaceLoci 统计 dueDate <= now（与 /review 新复习系统同源）。
 */
export interface DashboardStats {
  /** 今日新增灵感数（收集箱，createdAt >= 本地当日 0 点） */
  todayCaptures: number;
  /** 待整理碎片（收集箱 status = INBOX） */
  pendingCaptures: number;
  /** 待复习卡片数（notes + loci 中 dueDate <= now） */
  dueReviews: number;
  /** 记忆宫殿总位点数 */
  palaceLoci: number;
  /** 故事草稿数（status = DRAFT） */
  storyDrafts: number;
  /** 收件箱积压数：INBOX 且创建已超过 72 小时（3 天）未整理的条目（收件箱归零提醒 D） */
  inboxOverdueCount: number;
  /** 最近 7 天从收集箱流转到笔记的数量（由 capture 生成、近 7 天创建的笔记） */
  weeklyFlow: number;
  /** 顶部闭环四步的总量统计 */
  loopSteps: {
    /** 收集箱总容量 */
    step1Count: number;
    /** 笔记总容量 */
    step2Count: number;
    /** 复习待办总数（= dueReviews，保证数字↔入口一致） */
    step3Count: number;
    /** 故事总数 */
    step4Count: number;
  };
}

export default async function (app: FastifyInstance) {
  /** GET /api/dashboard/stats —— 首页聚合统计，全部实时反映 SQLite 状态 */
  app.get('/dashboard/stats', async (): Promise<DashboardStats> => {
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

    // 统一 count helper：始终按当前用户过滤，再追加各自的业务条件。
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
    // 最近 7 天从收集箱流转到笔记：captureId 非空且近 7 天创建的笔记（流转率统计）
    const weeklyFlow = count(wbNote, [
      sql`${wbNote.captureId} IS NOT NULL`,
      sql`${wbNote.createdAt} >= ${since7}`,
    ]);

    // 顶部闭环四步总量
    const step1Count = count(wbCapture); // 收集箱总容量
    const step2Count = count(wbNote); // 笔记总容量
    const step3Count = dueReviews; // 复习待办总数（与 dueReviews 同源）
    const step4Count = count(wbStory); // 故事总数

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
  });
}
