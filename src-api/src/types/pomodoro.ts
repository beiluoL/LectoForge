/* 番茄钟领域类型（DTO / VO / 配置结构）
 *
 * 从 routes/pomodoro.ts 原样下沉，字段名与取值范围一字未改——
 * 前端 pomodoroStore 直接按这些字段渲染，改名即等于改契约。
 */

/** 时段类型：与前端 pomodoroStore 的 phase 同名，两侧不做任何映射 */
export type PomodoroPhase = 'work' | 'short_break' | 'long_break';

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

/** 提交上来的补丁：三个子对象都允许只带部分字段（前端调音量时只发 whiteNoise.volume） */
export type PomodoroConfigPatch = {
  settings?: Partial<PomodoroConfig['settings']>;
  soundSettings?: Partial<PomodoroConfig['soundSettings']>;
  whiteNoise?: Partial<PomodoroConfig['whiteNoise']>;
  autoStartNext?: boolean;
};

/** POST /pomodoro/record 的原始入参（未经校验，字段可能缺失或类型错误） */
export interface RecordSessionDTO {
  type?: string;
  duration?: number;
}

/** 记录成功的返回体 */
export interface RecordSessionVO {
  ok: true;
  id: number;
  type: PomodoroPhase;
  durationSeconds: number;
  startTime: string;
  endTime: string;
}

/** 记录失败原因：由 controller 翻成对应的 400 文案，service 不关心措辞 */
export type RecordSessionError = { ok: false; reason: 'INVALID_TYPE' | 'INVALID_DURATION' };

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

/** GET /pomodoro/today 的返回体 */
export interface PomodoroTodayVO {
  workSeconds: number;
  pomodoros: number;
}
