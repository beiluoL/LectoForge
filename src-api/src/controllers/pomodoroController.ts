import type { FastifyReply, FastifyRequest } from 'fastify';
import * as pomodoroService from '../services/pomodoroService';
import type {
  PomodoroConfig,
  PomodoroConfigPatch,
  PomodoroStatsResult,
  PomodoroTodayVO,
  RecordSessionDTO,
} from '../types/pomodoro';

/** Fastify 未声明 schema 时 req.query/body 为 unknown，这里用显式结构收口，避免 any */
interface RawStatsQuery {
  days?: string;
}

/** service 的失败枚举 → 前端已依赖的 400 文案（措辞属于 HTTP 层，不下沉到 service） */
const RECORD_ERROR_MESSAGE: Record<string, string> = {
  INVALID_TYPE: 'type 必须是 work / short_break / long_break',
  INVALID_DURATION: 'duration 必须为正整数秒',
};

/** POST /pomodoro/record —— 记录一次已完成的番茄钟 / 休息 */
export async function record(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as RecordSessionDTO;
  const result = pomodoroService.recordSession(b);
  if (!result.ok) {
    return reply.code(400).send({ code: 400, message: RECORD_ERROR_MESSAGE[result.reason] });
  }
  return result;
}

/** GET /pomodoro/stats?days=7 —— 近 N 天按天聚合 */
export async function stats(req: FastifyRequest): Promise<PomodoroStatsResult> {
  const q = (req.query || {}) as RawStatsQuery;
  return pomodoroService.getStats(q.days);
}

/** GET /pomodoro/config —— 读取用户偏好（页面初始化调用一次） */
export async function getConfig(): Promise<PomodoroConfig> {
  return pomodoroService.readPomodoroConfig();
}

/**
 * PUT /pomodoro/config —— 保存用户偏好（局部更新：只传改动的字段即可）。
 * 前端拖时长/调音量是高频操作，务必在客户端做防抖后再调，别每一帧都写盘。
 */
export async function putConfig(req: FastifyRequest, reply: FastifyReply) {
  try {
    const patch = (req.body || {}) as PomodoroConfigPatch;
    return pomodoroService.savePomodoroConfig(patch);
  } catch (e) {
    const message = e instanceof Error ? e.message : '番茄钟配置保存失败';
    return reply.code(500).send({ code: 500, message });
  }
}

/** GET /pomodoro/today —— 今日速览（专注秒数 + 番茄个数） */
export async function today(): Promise<PomodoroTodayVO> {
  return pomodoroService.getToday();
}
