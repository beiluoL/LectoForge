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
  /** 收件箱积压数：INBOX 且创建已超过 72 小时（3 天）未整理的条目 */
  inboxOverdueCount: number;
  /** 最近 7 天从收集箱流转到笔记的数量 */
  weeklyFlow: number;
  /** 顶部闭环四步的总量统计 */
  loopSteps: {
    /** 收集箱总容量 */
    step1Count: number;
    /** 笔记总容量 */
    step2Count: number;
    /** 复习待办总数（= and 入口一致） */
    step3Count: number;
    /** 故事总数 */
    step4Count: number;
  };
}
