// 主动智能：每日学习日报 前端类型契约（与后端 insightService / routes/insight 对齐）

/** GET /insight/daily-report 返回的纯聚合统计 */
export interface DailyReportStats {
  /** 本地昨日日期键 YYYY-MM-DD */
  date: string;
  /** 昨日收集箱新增条数 */
  capturesYesterday: number;
  /** 昨日完成复习次数 */
  reviewsYesterday: number;
  /** 昨日薄弱知识点题面（quality<2 的卡片 front，Top 3） */
  weakPoints: string[];
  /** 近 7 天 收集→笔记 转化率（百分比 0~100） */
  conversion7d: number;
  /** 转化率明细 */
  conversionDetail: { captured: number; converted: number };
}

/** POST /insight/daily-report/generate 返回的 AI 文案 */
export interface DailyReportContent {
  title: string;
  summary: string;
  weakPoints: string;
  encouragement: string;
  suggestions: string;
  model?: string;
  latencyMs?: number;
}

/** POST /insight/daily-report/generate-cards 返回的结果 */
export interface GenerateCardsResult {
  created: number;
  weakPoints: string[];
  message: string;
}
