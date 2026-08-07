// 工作台首页聚合统计 API 客户端：对接后端 GET /api/dashboard/stats。
// 首页「学习闭环四步」数字气泡 + 「今日聚焦」四卡的唯一数据源。
import { apiGet } from './request';

/** 首页聚合统计（全部实时反映 SQLite 状态） */
export interface DashboardStats {
  /** 今日新增灵感数（收集箱，本地当日 0 点起） */
  todayCaptures: number;
  /** 待整理碎片（收集箱 status = INBOX） */
  pendingCaptures: number;
  /** 待复习卡片数（notes + loci 中 dueDate <= now） */
  dueReviews: number;
  /** 记忆宫殿总位点数 */
  palaceLoci: number;
  /** 故事草稿数（status = DRAFT） */
  storyDrafts: number;
  /** 最近 7 天从收集箱流转到笔记的数量 */
  weeklyFlow: number;
  /** 顶部闭环四步的总量统计 */
  loopSteps: {
    /** 收集箱总容量 */
    step1Count: number;
    /** 笔记总容量 */
    step2Count: number;
    /** 复习待办总数（= dueReviews） */
    step3Count: number;
    /** 故事总数 */
    step4Count: number;
  };
}

/** 拉取首页聚合统计 */
export function getDashboardStats() {
  return apiGet<DashboardStats>('/dashboard/stats');
}
