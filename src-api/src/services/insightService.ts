/**
 * 主动智能：每日学习日报聚合与闪卡联动服务。
 *
 * 职责边界（与项目三层架构一致）：
 * - Route 不碰 db；本文件是 Service 层，直接读 better-sqlite3（同步 API），写盘只走 wb_review_card。
 * - LLM 编排是 async（chatJson），但所有 SQL 都是同步的（better-sqlite3 同步特性，不可改）。
 * - 所有对外的失败都通过 AiResult 契约上报，由 route 翻译成 { code, message, aiCode }。
 *
 * 时区红线：本地昨天的判定一律用 SQLite 的 date(col, 'localtime') = date('now','-1 day','localtime')，
 * 不可只用 date('now','-1 day')（那会得到 UTC 昨天，与中国本地时区差 8 小时）。
 */
import { and, eq, gte, sql } from 'drizzle-orm';

import { CURRENT_USER, db } from '../db';
import { wbCapture, wbHabitLog, wbNote, wbReviewCard, wbReviewLog } from '../db/schema';
import { chatJson, isReady } from '../lib/llm';
import { generateFlashcards } from './aiContentService';
import { buildDailyReportPrompt, type DailyReportOutput } from '../lib/prompts';
import type { AiResult } from '../types/ai';

// ===================== 类型 =====================

export interface DailyReportStats {
  /** 本地昨天的日期键 YYYY-MM-DD */
  date: string;
  /** 昨日收集箱新增条数 */
  capturesYesterday: number;
  /** 昨日完成复习次数 */
  reviewsYesterday: number;
  /** 昨日薄弱知识点题面（quality<2 的卡片 front，Top 3） */
  weakPoints: string[];
  /** 近 7 天 收集→笔记 转化率（百分比 0~100） */
  conversion7d: number;
  /** 转化率明细，供前端展示「已转化/总收集」 */
  conversionDetail: { captured: number; converted: number };
}

export interface DailyReportContent {
  title: string;
  summary: string;
  weakPoints: string;
  encouragement: string;
  suggestions: string;
  model: string;
  latencyMs: number;
}

export interface DailyReportGenerateCardsResult {
  created: number;
  weakPoints: string[];
  message: string;
}

export interface DailyReportBundle {
  date: string;
  stats: DailyReportStats;
  /** AI 文案；未配置 AI 时为 null（不调用 LLM） */
  content: DailyReportContent | null;
}

export interface TrendPoint {
  date: string;
  captures: number;
  reviews: number;
  habits: number;
}
export interface TrendVO {
  days: number;
  series: TrendPoint[];
}

/** 本地日期键 YYYY-MM-DD（时区红线：一律本地时区） */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 近 N 天学习趋势：每日 收集 / 复习 / 习惯打卡 三序列（本地日分组） */
export function getTrend(rawDays?: unknown): TrendVO {
  const days = Math.max(7, Math.min(365, Number(rawDays) || 30));
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  const startIso = start.toISOString();

  const map: Record<string, TrendPoint> = {};
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = localDateKey(d);
    map[key] = { date: key, captures: 0, reviews: 0, habits: 0 };
  }

  const caps = db.select({ createdAt: wbCapture.createdAt }).from(wbCapture).where(gte(wbCapture.createdAt, startIso)).all();
  for (const c of caps) {
    const k = localDateKey(new Date(c.createdAt));
    if (map[k]) map[k].captures += 1;
  }
  const revs = db.select({ reviewedAt: wbReviewLog.reviewedAt }).from(wbReviewLog).where(gte(wbReviewLog.reviewedAt, startIso)).all();
  for (const r of revs) {
    const k = localDateKey(new Date(r.reviewedAt));
    if (map[k]) map[k].reviews += 1;
  }
  // wb_habit_log.log_date 本身就是本地日期键（YYYY-MM-DD）
  const hlogs = db.select({ logDate: wbHabitLog.logDate }).from(wbHabitLog).all();
  for (const h of hlogs) {
    if (map[h.logDate]) map[h.logDate].habits += 1;
  }

  return { days, series: Object.values(map).sort((a, b) => a.date.localeCompare(b.date)) };
}

// ===================== 本地时区辅助 =====================

/** 取本地今天/昨天的日期键（YYYY-MM-DD，按本地时区，非 UTC） */
function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 本地昨天日期键（与 SQLite date('now','-1 day','localtime') 对齐） */
function yesterdayKey(): string {
  return localDayKey(new Date(Date.now() - 86400000));
}

// ===================== 只读聚合 =====================

/** 通用计数：where 直接吃 SQL 片段（同步查询） */
function countWhere(tbl: any, cond: any): number {
  const r = db
    .select({ c: sql<number>`COUNT(*)` })
    .from(tbl)
    .where(cond)
    .get() as { c: number } | undefined;
  return r?.c ?? 0;
}

/** 昨天的本地日期过滤条件（所有「昨日」查询共用，强制 localtime） */
function yesterdayCond(col: any): any {
  return sql`date(${col}, 'localtime') = date('now', '-1 day', 'localtime')`;
}

/** 聚合昨日学习数据（纯只读，无 AI 依赖） */
export function getDailyReport(): DailyReportStats {
  const date = yesterdayKey();

  const capturesYesterday = countWhere(
    wbCapture,
    sql`${wbCapture.userId} = ${CURRENT_USER} AND ${yesterdayCond(wbCapture.createdAt)}`,
  );

  const reviewsYesterday = countWhere(
    wbReviewLog,
    sql`${wbReviewLog.userId} = ${CURRENT_USER} AND ${yesterdayCond(wbReviewLog.reviewedAt)}`,
  );

  // 薄弱点 Top3：join review_log ↔ review_card 取 front，过滤 quality<2 且本地昨天
  const weakRows = db
    .select({ front: wbReviewCard.front, cnt: sql<number>`COUNT(*)` })
    .from(wbReviewLog)
    .innerJoin(wbReviewCard, eq(wbReviewCard.id, wbReviewLog.cardId))
    .where(
      sql`${wbReviewLog.userId} = ${CURRENT_USER}
          AND ${wbReviewLog.quality} < 2
          AND ${yesterdayCond(wbReviewLog.reviewedAt)}`,
    )
    .groupBy(wbReviewCard.front)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(3)
    .all() as { front: string; cnt: number }[];
  const weakPoints = weakRows.map((r) => r.front).filter(Boolean);

  // 近 7 天 收集→笔记 转化率：captured = 近7天收集箱新增；converted = 其中已沉淀成笔记的（按 capture_id 去重）
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const captured = countWhere(
    wbCapture,
    sql`${wbCapture.userId} = ${CURRENT_USER} AND ${wbCapture.createdAt} >= ${since7}`,
  );
  const convertedRow = db
    .select({ c: sql<number>`COUNT(DISTINCT ${wbNote.captureId})` })
    .from(wbNote)
    .innerJoin(wbCapture, eq(wbCapture.id, wbNote.captureId))
    .where(
      sql`${wbNote.userId} = ${CURRENT_USER}
          AND ${wbCapture.userId} = ${CURRENT_USER}
          AND ${wbCapture.createdAt} >= ${since7}`,
    )
    .get() as { c: number } | undefined;
  const converted = convertedRow?.c ?? 0;
  const conversion7d = captured > 0 ? Math.round((converted / captured) * 100) : 0;

  return {
    date,
    capturesYesterday,
    reviewsYesterday,
    weakPoints,
    conversion7d,
    conversionDetail: { captured, converted },
  };
}

// ===================== AI 日报文案（带 1h 缓存） =====================

/** 按日期缓存生成结果，避免用户在 1 小时内反复点「重新生成」刷爆 LLM */
const reportCache = new Map<string, { at: number; data: DailyReportContent }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function generateDailyReport(): Promise<AiResult<DailyReportContent>> {
  if (!isReady()) {
    return {
      kind: 'fail',
      status: 409,
      message: '尚未配置 AI 服务，请先前往「AI 设置」填写地址与模型',
      aiCode: 'AI_NOT_CONFIGURED',
    };
  }

  const stats = getDailyReport();
  const cached = reportCache.get(stats.date);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { kind: 'ok', data: cached.data };
  }

  const { data, raw } = await chatJson<DailyReportOutput>(
    buildDailyReportPrompt({ date: stats.date, stats }),
    { temperature: 0.4 },
  );

  const content: DailyReportContent = {
    title: String(data.title || `${stats.date} 学习日报`).trim(),
    summary: String(data.summary || '').trim(),
    weakPoints: String(data.weakPoints || '').trim(),
    encouragement: String(data.encouragement || '').trim(),
    suggestions: String(data.suggestions || '').trim(),
    model: raw.model,
    latencyMs: raw.latencyMs,
  };
  reportCache.set(stats.date, { at: Date.now(), data: content });
  return { kind: 'ok', data: content };
}

// ===================== 薄弱点 → 强化复习卡 =====================

/**
 * 基于昨日薄弱点生成 3 张强化复习卡，写入旧复习系统 wb_review_card（next_review_time=now 立即到期）。
 * 复用 aiContentService.generateFlashcards 的 autoSave 路径，不重复实现插入逻辑。
 * 红线：昨日若无任何 quality<2 的卡，直接返回 0 且不调用 LLM（避免空数组喂模型）。
 */
export async function generateCards(): Promise<AiResult<DailyReportGenerateCardsResult>> {
  const stats = getDailyReport();

  if (!stats.weakPoints.length) {
    return {
      kind: 'ok',
      data: { created: 0, weakPoints: [], message: '昨日表现完美，没有错误卡片需要生成' },
    };
  }

  if (!isReady()) {
    return {
      kind: 'fail',
      status: 409,
      message: '尚未配置 AI 服务，请先前往「AI 设置」填写地址与模型',
      aiCode: 'AI_NOT_CONFIGURED',
    };
  }

  const weakPointsJoined = stats.weakPoints
    .map((w, i) => `${i + 1}. ${w}`)
    .join('\n');

  const r = await generateFlashcards({
    title: `${stats.date} 薄弱点强化`,
    // 直接把薄弱点题面作为出题素材，让模型围绕这些易错点出 3 道混合题（单选+填空）
    noteColumn: `以下是用户昨日复习中反复出错的薄弱知识点，请基于这些要点出 3 道强化复习题帮助其巩固：\n${weakPointsJoined}`,
    count: 3,
    autoSave: true,
    type: 'mixed',
  });
  if (r.kind !== 'ok') return r;

  return {
    kind: 'ok',
    data: {
      created: r.data.created,
      weakPoints: stats.weakPoints,
      message: `已生成 ${r.data.created} 张基于薄弱点的复习卡，快去 /review/flashcard 刷题吧！`,
    },
  };
}

// ===================== 清晨推送（供 index.ts 定时任务调用） =====================

/**
 * 定时任务入口：聚合昨日数据 + 在 AI 就绪时生成文案。
 * 故意不抛错——定时任务里任何异常都要被吞掉，避免打挂进程。
 */
export async function runMorningPush(): Promise<DailyReportBundle> {
  const stats = getDailyReport();
  let content: DailyReportContent | null = null;
  if (isReady()) {
    try {
      const r = await generateDailyReport();
      if (r.kind === 'ok') content = r.data;
    } catch {
      content = null;
    }
  }
  return { date: stats.date, stats, content };
}
