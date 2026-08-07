// 番茄钟 API 客户端：对接后端 /api/pomodoro/*（记录 / 统计 / 配置 / 今日速览）。
import { apiGet, apiPost, apiPut } from './request';

/** 时段类型：与后端 wb_pomodoro_log.type、store 的 phase 三处同名，全链路不做映射 */
export type PomodoroPhase = 'work' | 'short_break' | 'long_break';
export type SoundType = 'tick' | 'ding' | 'alarm';
export type NoiseTrack = 'rain' | 'stream' | 'coffee';

export interface PomodoroSettings {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  cyclesPerSet: number;
}

export interface SoundSettings {
  enabled: boolean;
  soundType: SoundType;
}

export interface WhiteNoiseSettings {
  enabled: boolean;
  /** 0-100 */
  volume: number;
  track: NoiseTrack;
}

export interface PomodoroConfig {
  settings: PomodoroSettings;
  soundSettings: SoundSettings;
  whiteNoise: WhiteNoiseSettings;
  autoStartNext: boolean;
  updatedAt: string;
}

/** 局部更新补丁：三个子对象都可只带部分字段 */
export interface PomodoroConfigPatch {
  settings?: Partial<PomodoroSettings>;
  soundSettings?: Partial<SoundSettings>;
  whiteNoise?: Partial<WhiteNoiseSettings>;
  autoStartNext?: boolean;
}

export interface PomodoroStatPoint {
  /** YYYY-MM-DD（本机时区自然日） */
  date: string;
  work: number;
  shortBreak: number;
  longBreak: number;
  /** shortBreak + longBreak */
  breakTotal: number;
  workCount: number;
}

export interface PomodoroStatsResult {
  days: number;
  startDate: string;
  endDate: string;
  points: PomodoroStatPoint[];
  summary: {
    totalWorkSeconds: number;
    totalBreakSeconds: number;
    avgWorkSecondsPerDay: number;
    completedPomodoros: number;
  };
}

export interface PomodoroRecordResult {
  ok: boolean;
  id: number;
  type: PomodoroPhase;
  durationSeconds: number;
  startTime: string;
  endTime: string;
}

/** 记录一次已完成的专注 / 休息（duration 单位：秒） */
export function recordPomodoro(type: PomodoroPhase, duration: number) {
  return apiPost<PomodoroRecordResult>('/pomodoro/record', { type, duration });
}

/** 近 N 天按天聚合统计（缺记录的日子后端已补 0 行） */
export function getPomodoroStats(days = 7) {
  return apiGet<PomodoroStatsResult>('/pomodoro/stats', { days });
}

/** 读取番茄钟偏好（落盘于 <dataDir>/pomodoro-config.json） */
export function getPomodoroConfig() {
  return apiGet<PomodoroConfig>('/pomodoro/config');
}

/** 保存番茄钟偏好（局部更新，调用方需自行防抖） */
export function savePomodoroConfig(patch: PomodoroConfigPatch) {
  return apiPut<PomodoroConfig>('/pomodoro/config', patch);
}

/** 今日速览：专注秒数 + 完成番茄数 */
export function getPomodoroToday() {
  return apiGet<{ workSeconds: number; pomodoros: number }>('/pomodoro/today');
}
