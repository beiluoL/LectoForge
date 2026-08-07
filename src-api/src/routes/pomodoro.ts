/* 番茄钟路由（前缀 /api/pomodoro）
 *
 * 职责边界：
 * - 「已完成时段」落 SQLite（wb_pomodoro_log），供历史统计图表按天聚合；
 * - 「用户偏好」落 JSON（<dataDir>/pomodoro-config.json），与 config.json / ai-config.json 三份分开，
 *   理由见 lib/paths.ts 的 getPomodoroConfigPath 注释。
 *
 * 时区口径（唯一需要小心的地方）：
 * 库里存的是 UTC ISO 串，但用户看的图表是「本机自然日」。SQLite 的 date(x,'localtime')
 * 依赖进程 TZ，侧车由宿主拉起时 TZ 未必与用户一致，因此**聚合一律在 Node 层用本地时间做**，
 * 不写进 SQL。番茄钟数据量极小（一天几十行），全量取出再分桶完全不构成性能问题。
 */
import { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, gte, sql } from 'drizzle-orm';

import { db, CURRENT_USER, nowIso } from '../db';
import { wbPomodoroLog } from '../db/schema';
import { getPomodoroConfigPath } from '../lib/paths';

/** 时段类型：与前端 pomodoroStore 的 phase 同名，两侧不做任何映射 */
export type PomodoroPhase = 'work' | 'short_break' | 'long_break';
const PHASES: PomodoroPhase[] = ['work', 'short_break', 'long_break'];

/** pomodoro-config.json 的结构（纯用户偏好，无任何敏感信息） */
export interface PomodoroConfig {
  settings: {
    workMinutes: number;
    shortBreakMinutes: number;
    longBreakMinutes: number;
    cyclesPerSet: number;
  };
  soundSettings: {
    enabled: boolean;
    /** 提示音类型：发条声 / 叮 / 滴答声 */
    soundType: 'tick' | 'ding' | 'alarm';
  };
  whiteNoise: {
    enabled: boolean;
    /** 0-100 */
    volume: number;
    track: 'rain' | 'stream' | 'coffee';
  };
  /** 自动开始下一段（专注结束自动进休息，休息结束自动进专注） */
  autoStartNext: boolean;
  updatedAt: string;
}

const DEFAULT_CONFIG: PomodoroConfig = {
  settings: { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, cyclesPerSet: 4 },
  soundSettings: { enabled: true, soundType: 'ding' },
  whiteNoise: { enabled: false, volume: 45, track: 'rain' },
  autoStartNext: false,
  updatedAt: '',
};

/** 把任意输入夹到 [min,max] 的整数；非法值回落 fallback（前端手抖输入 0 / 负数 / NaN 都不该炸后端） */
function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 读取番茄钟配置；文件缺失/损坏时回落默认值并按字段逐项校正，保证前端拿到的一定是合法配置 */
export function readPomodoroConfig(): PomodoroConfig {
  const file = getPomodoroConfigPath();
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as PomodoroConfigPatch;
    return mergeConfig(DEFAULT_CONFIG, raw);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** 提交上来的补丁：三个子对象都允许只带部分字段（前端调音量时只发 whiteNoise.volume） */
export type PomodoroConfigPatch = {
  settings?: Partial<PomodoroConfig['settings']>;
  soundSettings?: Partial<PomodoroConfig['soundSettings']>;
  whiteNoise?: Partial<PomodoroConfig['whiteNoise']>;
  autoStartNext?: boolean;
};

/** 以 base 为底，把 patch 中的合法字段覆盖上去（局部更新语义：前端只传改动项也能正确落盘） */
function mergeConfig(base: PomodoroConfig, patch: PomodoroConfigPatch): PomodoroConfig {
  const s: Partial<PomodoroConfig['settings']> = patch.settings ?? {};
  const snd: Partial<PomodoroConfig['soundSettings']> = patch.soundSettings ?? {};
  const wn: Partial<PomodoroConfig['whiteNoise']> = patch.whiteNoise ?? {};
  const soundType = ['tick', 'ding', 'alarm'].includes(String(snd.soundType))
    ? (snd.soundType as PomodoroConfig['soundSettings']['soundType'])
    : base.soundSettings.soundType;
  const track = ['rain', 'stream', 'coffee'].includes(String(wn.track))
    ? (wn.track as PomodoroConfig['whiteNoise']['track'])
    : base.whiteNoise.track;
  return {
    settings: {
      // 上限刻意给得宽松（工作 180 分钟 / 休息 60 分钟），够用又挡得住 99999 这类离谱值
      workMinutes: clampInt(s.workMinutes, 1, 180, base.settings.workMinutes),
      shortBreakMinutes: clampInt(s.shortBreakMinutes, 1, 60, base.settings.shortBreakMinutes),
      longBreakMinutes: clampInt(s.longBreakMinutes, 1, 60, base.settings.longBreakMinutes),
      cyclesPerSet: clampInt(s.cyclesPerSet, 1, 12, base.settings.cyclesPerSet),
    },
    soundSettings: {
      enabled: typeof snd.enabled === 'boolean' ? snd.enabled : base.soundSettings.enabled,
      soundType,
    },
    whiteNoise: {
      enabled: typeof wn.enabled === 'boolean' ? wn.enabled : base.whiteNoise.enabled,
      volume: clampInt(wn.volume, 0, 100, base.whiteNoise.volume),
      track,
    },
    autoStartNext:
      typeof patch.autoStartNext === 'boolean' ? patch.autoStartNext : base.autoStartNext,
    updatedAt: base.updatedAt,
  };
}

/** 写入番茄钟配置（父目录由 paths 保证存在） */
function writePomodoroConfig(cfg: PomodoroConfig): void {
  const file = getPomodoroConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
}

/** 本机时区下的 YYYY-MM-DD（图表 X 轴的分桶键；绝不用 toISOString，那是 UTC 日） */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 单日聚合结果 */
export interface PomodoroStatPoint {
  /** YYYY-MM-DD（本机时区自然日） */
  date: string;
  /** 专注总秒数 */
  work: number;
  /** 小憩总秒数 */
  shortBreak: number;
  /** 长休息总秒数 */
  longBreak: number;
  /** 休息合计秒数（shortBreak + longBreak），图表橙色柱直接用它 */
  breakTotal: number;
  /** 当日完成的番茄个数（work 段计数） */
  workCount: number;
}

export interface PomodoroStatsResult {
  days: number;
  startDate: string;
  endDate: string;
  points: PomodoroStatPoint[];
  summary: {
    /** 区间内专注总秒数 */
    totalWorkSeconds: number;
    /** 区间内休息总秒数 */
    totalBreakSeconds: number;
    /** 平均每日专注秒数（分母固定为 days，而非「有记录的天数」——摸鱼的日子也要算进平均） */
    avgWorkSecondsPerDay: number;
    /** 完成的番茄个数 */
    completedPomodoros: number;
  };
}

export default async function (app: FastifyInstance) {
  /**
   * POST /api/pomodoro/record —— 记录一次已完成的番茄钟 / 休息。
   * body: { type: 'work'|'short_break'|'long_break', duration: number(秒) }
   * startTime 由服务端用 now - duration 反推，避免客户端时钟漂移导致 start > end。
   */
  app.post('/pomodoro/record', async (req, reply) => {
    const b = (req.body || {}) as { type?: string; duration?: number };
    const type = PHASES.includes(b.type as PomodoroPhase) ? (b.type as PomodoroPhase) : null;
    if (!type) {
      return reply.code(400).send({ code: 400, message: 'type 必须是 work / short_break / long_break' });
    }
    // 上限 6 小时：挡住「页面挂后台一整天后一次性上报」这种脏数据污染统计
    const duration = clampInt(b.duration, 1, 6 * 3600, 0);
    if (duration <= 0) {
      return reply.code(400).send({ code: 400, message: 'duration 必须为正整数秒' });
    }

    const end = new Date();
    const start = new Date(end.getTime() - duration * 1000);
    const row = {
      userId: CURRENT_USER,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      type,
      durationSeconds: duration,
      createdAt: nowIso(),
    };
    const res = db.insert(wbPomodoroLog).values(row).run();
    return {
      ok: true,
      id: Number(res.lastInsertRowid),
      type,
      durationSeconds: duration,
      startTime: row.startTime,
      endTime: row.endTime,
    };
  });

  /**
   * GET /api/pomodoro/stats?days=7 —— 近 N 天按天聚合。
   * 缺记录的日子补 0 行，保证图表 X 轴天数恒等于 days（否则柱子会挤在一起，视觉上骗人）。
   */
  app.get('/pomodoro/stats', async (req): Promise<PomodoroStatsResult> => {
    const q = (req.query || {}) as { days?: string };
    const days = clampInt(q.days, 1, 365, 7);

    // 起点 = 本机时区「今天往前 days-1 天」的 0 点
    const now = new Date();
    const startLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    startLocal.setDate(startLocal.getDate() - (days - 1));

    const rows = db
      .select({
        endTime: wbPomodoroLog.endTime,
        type: wbPomodoroLog.type,
        durationSeconds: wbPomodoroLog.durationSeconds,
      })
      .from(wbPomodoroLog)
      .where(
        and(
          eq(wbPomodoroLog.userId, CURRENT_USER),
          gte(wbPomodoroLog.endTime, startLocal.toISOString()),
        ),
      )
      .all();

    // 先铺满 days 个空桶，再往里灌数据
    const buckets = new Map<string, PomodoroStatPoint>();
    for (let i = 0; i < days; i++) {
      const d = new Date(startLocal);
      d.setDate(startLocal.getDate() + i);
      const key = localDateKey(d);
      buckets.set(key, { date: key, work: 0, shortBreak: 0, longBreak: 0, breakTotal: 0, workCount: 0 });
    }

    for (const r of rows) {
      const key = localDateKey(new Date(r.endTime));
      const b = buckets.get(key);
      if (!b) continue; // 边界：跨时区/夏令时导致落在窗口外，直接丢弃
      const sec = r.durationSeconds || 0;
      if (r.type === 'work') {
        b.work += sec;
        b.workCount += 1;
      } else if (r.type === 'long_break') {
        b.longBreak += sec;
      } else {
        b.shortBreak += sec;
      }
      b.breakTotal = b.shortBreak + b.longBreak;
    }

    const points = Array.from(buckets.values());
    const totalWorkSeconds = points.reduce((s, p) => s + p.work, 0);
    const totalBreakSeconds = points.reduce((s, p) => s + p.breakTotal, 0);
    const completedPomodoros = points.reduce((s, p) => s + p.workCount, 0);

    return {
      days,
      startDate: points[0]?.date ?? localDateKey(startLocal),
      endDate: points[points.length - 1]?.date ?? localDateKey(now),
      points,
      summary: {
        totalWorkSeconds,
        totalBreakSeconds,
        avgWorkSecondsPerDay: Math.round(totalWorkSeconds / days),
        completedPomodoros,
      },
    };
  });

  /** GET /api/pomodoro/config —— 读取用户偏好（页面初始化调用一次） */
  app.get('/pomodoro/config', async (): Promise<PomodoroConfig> => readPomodoroConfig());

  /**
   * PUT /api/pomodoro/config —— 保存用户偏好（局部更新：只传改动的字段即可）。
   * 前端拖时长/调音量是高频操作，务必在客户端做防抖后再调，别每一帧都写盘。
   */
  app.put('/pomodoro/config', async (req, reply) => {
    try {
      const patch = (req.body || {}) as PomodoroConfigPatch;
      const next = mergeConfig(readPomodoroConfig(), patch);
      next.updatedAt = nowIso();
      writePomodoroConfig(next);
      return next;
    } catch (e) {
      const message = e instanceof Error ? e.message : '番茄钟配置保存失败';
      return reply.code(500).send({ code: 500, message });
    }
  });

  /**
   * GET /api/pomodoro/today —— 今日速览（专注秒数 + 番茄个数）。
   * 复习页状态条与首页气泡都可能要它，单独给一个轻量端点，免得为两个数字拉整月数据。
   */
  app.get('/pomodoro/today', async () => {
    const now = new Date();
    const startLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const r = db
      .select({
        seconds: sql<number>`COALESCE(SUM(${wbPomodoroLog.durationSeconds}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(wbPomodoroLog)
      .where(
        and(
          eq(wbPomodoroLog.userId, CURRENT_USER),
          eq(wbPomodoroLog.type, 'work'),
          gte(wbPomodoroLog.endTime, startLocal),
        ),
      )
      .get() as { seconds: number; count: number } | undefined;
    return { workSeconds: r?.seconds ?? 0, pomodoros: r?.count ?? 0 };
  });
}
