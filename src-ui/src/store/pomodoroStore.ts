/**
 * usePomodoroStore —— 番茄钟全局状态（计时引擎 + 配置 + 音频 + 原生菜单栏联动）。
 *
 * 为什么计时器住在 store 而不是页面组件里：
 * 番茄钟必须跨页面存活——用户开了专注就会去 /review 刷卡、去 /workbench/notes 写笔记，
 * 一旦计时逻辑挂在 Pomodoro 页面的 onMounted 上，路由一切走就归零了。
 * Pinia store 是应用级单例，setInterval 挂在这里才能真正「常驻」。
 *
 * 计时精度（重点）：
 * setInterval 在后台标签页/系统休眠时会被节流甚至跳帧，靠「每次 -1」累加必然走偏。
 * 这里改成**时间戳差值**：记录本段开始的 runStartedAt + 暂停前累计的 accumulatedMs，
 * 每次 tick 都用 Date.now() 重新算 elapsed，掉多少帧都不影响结果。
 * tick 间隔取 250ms 只是为了进度环顺滑，不参与任何计数。
 *
 * 用法：
 * ```ts
 * const store = usePomodoroStore()
 * const { timeLeft, phase, status } = storeToRefs(store)
 * store.init(); store.startTimer(); store.pauseTimer(); store.resetTimer()
 * ```
 */
import { defineStore } from 'pinia';
import { computed, ref, reactive } from 'vue';
import {
  getPomodoroConfig,
  recordPomodoro,
  savePomodoroConfig,
  type NoiseTrack,
  type PomodoroPhase,
  type PomodoroSettings,
  type SoundType,
} from '@/api/pomodoro';
import { playCue, whiteNoise } from '@/utils/pomodoroAudio';
import { notify } from '@/utils/toast';
// 顶层静态导入 invoke/emit：避免 build 模式下从静态 dist 动态加载 @tauri-apps/api/core 的
// chunk 时（由 server 侧车托管）因路径/MIME 问题静默失败，导致菜单栏标题推送不出去。
// dev 模式由 Vite dev server 加载不受影响，build 模式必须用静态导入才稳。
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

// 对外 re-export 番茄钟类型，让消费方（App.vue / PopupTimer.vue 等）统一从 store 入口引，
// 避免散落两处 import 路径（store 与 api）一旦调整类型位置出现编译错位。
export type { PomodoroPhase } from '@/api/pomodoro';

export type PomodoroStatus = 'idle' | 'running' | 'paused' | 'completed';

/** 各阶段的展示名（菜单栏与状态条共用，改文案只改这里） */
export const PHASE_LABEL: Record<PomodoroPhase, string> = {
  work: '专注中',
  short_break: '小憩中',
  long_break: '长休息',
};

/** 各阶段的 emoji 前缀（原生菜单栏靠它一眼分辨状态） */
export const PHASE_EMOJI: Record<PomodoroPhase, string> = {
  work: '🍅',
  short_break: '☕',
  long_break: '🌴',
};

/** 计时器 tick 间隔：只影响进度环刷新率，不参与计数 */
const TICK_MS = 250;
/** 配置写盘防抖：拖滑块时别把磁盘写爆 */
const SAVE_DEBOUNCE_MS = 500;

export const usePomodoroStore = defineStore('pomodoro', () => {
  /* ==================== 一、State ==================== */

  const settings = reactive<PomodoroSettings>({
    workMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    cyclesPerSet: 4,
  });

  const status = ref<PomodoroStatus>('idle');
  const phase = ref<PomodoroPhase>('work');
  /** 当前是本组的第几个番茄（1 起算，达到 cyclesPerSet 后进长休息并归 1） */
  const currentCycle = ref(1);
  /** 倒计时剩余秒数（整数，向上取整，避免最后一秒闪现 0 又跳回 1） */
  const timeLeft = ref(settings.workMinutes * 60);

  const soundSettings = reactive<{ enabled: boolean; soundType: SoundType }>({
    enabled: true,
    soundType: 'ding',
  });

  const whiteNoiseState = reactive<{ enabled: boolean; volume: number; track: NoiseTrack }>({
    enabled: false,
    volume: 45,
    track: 'rain',
  });

  /** 自动开始下一段（专注结束自动进休息，休息结束自动进专注）—— 后端 config schema 已有这个字段 */
  const autoStartNext = ref(false);

  /** 本次启动应用以来完成的番茄数（图表统计走后端，这里只做即时反馈） */
  const completedToday = ref(0);
  /** 配置是否已从后端水合，防止未加载完就把默认值写回去覆盖用户设置 */
  const configLoaded = ref(false);

  /* ==================== 二、计时内部量（非响应式，不进 state） ==================== */

  /** 本段（从上次 start/resume 起）的起始时间戳 */
  let runStartedAt = 0;
  /** 暂停前累计已过去的毫秒 */
  let accumulatedMs = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** 上次向原生菜单栏发射的秒数，用于把每秒一次的发射节流出来 */
  let lastEmittedSec = -1;

  /* ==================== 三、Getters ==================== */

  /** 当前阶段的总时长（秒） */
  const phaseTotalSec = computed(() => {
    if (phase.value === 'work') return Math.max(1, settings.workMinutes) * 60;
    if (phase.value === 'short_break') return Math.max(1, settings.shortBreakMinutes) * 60;
    return Math.max(1, settings.longBreakMinutes) * 60;
  });

  /** 已过去的秒数 */
  const elapsedSec = computed(() => Math.max(0, phaseTotalSec.value - timeLeft.value));

  /** 进度 0-100（进度环的 stroke-dashoffset 与 conic-gradient 都用它） */
  const progress = computed(() => {
    const total = phaseTotalSec.value;
    if (total <= 0) return 0;
    return Math.min(100, Math.max(0, (elapsedSec.value / total) * 100));
  });

  /** MM:SS 文本 */
  const timeText = computed(() => formatMMSS(timeLeft.value));

  const phaseLabel = computed(() => PHASE_LABEL[phase.value]);
  const phaseEmoji = computed(() => PHASE_EMOJI[phase.value]);
  const isRunning = computed(() => status.value === 'running');
  /** 菜单栏 / 状态条统一文案，例如「🍅 专注中 12:34」 */
  const menuTitle = computed(() => `${phaseEmoji.value} ${phaseLabel.value} ${timeText.value}`);
  /** 菜单栏状态栏文本标题：阶段 emoji + MM:SS（如「🍅 24:59」），供 tray:update 推送给 Rust 侧 set_title */
  const trayTitle = computed(() => `${phaseEmoji.value} ${timeText.value}`);

  function formatMMSS(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  /* ==================== 四、原生菜单栏联动 ==================== */

  /**
   * 向 Rust 侧推送菜单栏标题（阶段 emoji + MM:SS，如「🍅 24:59」）。
   * 浏览器预览态（非 Tauri 宿主）下 @tauri-apps/api 会抛错，整体 try/catch 静默——
   * 番茄钟在浏览器里也要能正常跑。
   *
   * 双通道推送，任一生效即可刷新状态栏，规避 Tauri 2 不同版本下 webview 的 emit
   * 是否触达 Rust 全局 app.listen 的实现差异：
   *  ① 命令通道 `update_tray_title`：由 invoke 直接调用 Rust 函数，无歧义、必然触达（主）；
   *  ② 事件通道 `tray:update`：tray.rs 的全局监听兜底（次）。
   * 命令失败会 console.error，便于在 tauri:dev 下的 DevTools 真机排查。
   */
  async function emitToNative(force = false): Promise<void> {
    const sec = timeLeft.value;
    if (!force && sec === lastEmittedSec) return;
    lastEmittedSec = sec;
    const title = trayTitle.value;
    // ① 命令通道（主）：invoke 为顶层静态导入，build 模式下也能稳定触达 Rust
    try {
      await invoke('update_tray_title', { title });
      // 成功日志：DevTools Console 每跳一秒会看到一行，用于确认前端已把标题推给 Rust
      console.log('[pomodoro] tray updated ->', title);
    } catch (e) {
      console.error('[pomodoro] update_tray_title 命令失败（事件通道兜底）:', e);
    }
    // ② 事件通道（兜底）
    try {
      await emit('tray:update', { title });
    } catch {
      /* 非桌面宿主环境，忽略 */
    }
  }

  /**
   * 阶段自然结束 → 调用 Rust 侧 `trigger_notification` 命令弹 macOS 原生通知
   * （菜单栏应用后台运行时也能提醒，不依赖任何可见窗口）。
   * 整体 try/catch 静默（浏览器态 @tauri-apps/api 不存在）。
   */
  async function emitFinished(
    finished: PomodoroPhase,
    isSetEnd: boolean,
    count: number,
  ): Promise<void> {
    const title = finished === 'work' ? '🍅 专注结束' : '☕ 休息结束';
    const body =
      finished === 'work'
        ? isSetEnd
          ? `完成第 ${count} 个番茄，一组结束，去长休息吧 🌴`
          : `完成第 ${count} 个番茄，休息一下 ☕`
        : '休息结束，开始下一段专注 💪';
    try {
      await invoke('trigger_notification', { title, body });
    } catch {
      /* 非桌面宿主环境，忽略 */
    }
  }

  /* ==================== 五、配置读写 ==================== */

  /** 从后端 pomodoro-config.json 水合配置（页面初始化调用；失败静默用默认值） */
  async function loadSettings(): Promise<void> {
    try {
      const cfg = await getPomodoroConfig();
      Object.assign(settings, cfg.settings);
      Object.assign(soundSettings, cfg.soundSettings);
      Object.assign(whiteNoiseState, cfg.whiteNoise);
      autoStartNext.value = cfg.autoStartNext;
      whiteNoise.setVolume(whiteNoiseState.volume);
      // 空闲态才同步倒计时显示，正在跑的时候改配置不能把当前这一段掐掉
      if (status.value === 'idle') timeLeft.value = phaseTotalSec.value;
    } catch {
      /* 后端不可用时保持默认值，不打断计时功能 */
    } finally {
      configLoaded.value = true;
    }
  }

  /** 保存配置到后端（防抖 500ms，最后一次为准） */
  function saveSettings(): void {
    if (!configLoaded.value) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void savePomodoroConfig({
        settings: { ...settings },
        soundSettings: { ...soundSettings },
        whiteNoise: { ...whiteNoiseState },
        autoStartNext: autoStartNext.value,
      }).catch(() => {
        /* 保存失败不弹错：用户可能正在拖滑块，弹窗会打断操作 */
      });
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * 更新时长类设置。空闲态下同步刷新倒计时显示，
   * 运行中只改配置、不动当前这一段（否则用户调个数字就把专注打断了）。
   */
  function updateSettings(patch: Partial<PomodoroSettings>): void {
    Object.assign(settings, patch);
    if (status.value === 'idle') {
      timeLeft.value = phaseTotalSec.value;
      accumulatedMs = 0;
    }
    if (currentCycle.value > settings.cyclesPerSet) currentCycle.value = 1;
    saveSettings();
    void emitToNative(true);
  }

  /* ==================== 六、计时引擎 ==================== */

  function clearTimer(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  /** 每 tick 依据时间戳重算剩余秒数；归零则结算本段 */
  function tick(): void {
    const totalMs = phaseTotalSec.value * 1000;
    const passed = accumulatedMs + (Date.now() - runStartedAt);
    const left = Math.ceil((totalMs - passed) / 1000);
    timeLeft.value = Math.max(0, left);
    void emitToNative();
    if (passed >= totalMs) void finishPhase();
  }

  /** 开始 / 继续 */
  function startTimer(): void {
    if (status.value === 'running') return;
    // completed 态再点开始 = 从当前阶段重新计时
    if (status.value === 'completed') accumulatedMs = 0;
    runStartedAt = Date.now();
    status.value = 'running';
    clearTimer();
    timer = setInterval(tick, TICK_MS);
    // 白噪音跟随计时启停（用户开了才播）
    if (whiteNoiseState.enabled) whiteNoise.play(whiteNoiseState.track);
    void emitToNative(true);
  }

  /** 暂停：把本段已过去的时间沉淀进 accumulatedMs，恢复时接着算 */
  function pauseTimer(): void {
    if (status.value !== 'running') return;
    accumulatedMs += Date.now() - runStartedAt;
    clearTimer();
    status.value = 'paused';
    whiteNoise.stop();
    void emitToNative(true);
  }

  /** 重置：回到当前阶段的起点（不改变 phase 与 currentCycle） */
  function resetTimer(): void {
    clearTimer();
    accumulatedMs = 0;
    runStartedAt = 0;
    status.value = 'idle';
    timeLeft.value = phaseTotalSec.value;
    whiteNoise.stop();
    void emitToNative(true);
  }

  /** 彻底退出番茄钟：回到 work 第 1 个，并让菜单栏复位 */
  function stopSession(): void {
    clearTimer();
    accumulatedMs = 0;
    runStartedAt = 0;
    phase.value = 'work';
    currentCycle.value = 1;
    status.value = 'idle';
    timeLeft.value = phaseTotalSec.value;
    whiteNoise.stop();
    void emitToNative(true);
  }

  /** 直接切到指定阶段（跳过当前段，不记录数据） */
  function switchPhase(next: PomodoroPhase): void {
    clearTimer();
    accumulatedMs = 0;
    runStartedAt = 0;
    phase.value = next;
    status.value = 'idle';
    timeLeft.value = phaseTotalSec.value;
    void emitToNative(true);
  }

  /**
   * 跳过当前阶段（用户主动点「跳过」）：不记数据、不弹通知，仅按阶段机推进到下一阶段。
   * 与 finishPhase 的区别在于跳过不视为「完成」，不 +1 completedToday、不上报后端。
   */
  function skipPhase(): void {
    const finished = phase.value;
    clearTimer();
    accumulatedMs = 0;
    runStartedAt = 0;
    let next: PomodoroPhase;
    if (finished === 'work') {
      next =
        currentCycle.value >= Math.max(1, settings.cyclesPerSet) ? 'long_break' : 'short_break';
    } else {
      next = 'work';
      // 小憩结束 → 进入下一个番茄；长休息结束 → 新的一组从 1 开始
      currentCycle.value =
        finished === 'long_break' ? 1 : Math.min(settings.cyclesPerSet, currentCycle.value + 1);
    }
    phase.value = next;
    status.value = 'idle';
    timeLeft.value = phaseTotalSec.value;
    whiteNoise.stop();
    void emitToNative(true);
  }

  /**
   * 本段自然结束：上报后端 → 提示音 → 推进阶段机。
   * 上报时长用 phaseTotalSec（本段设定时长）而非墙上时间——
   * 暂停期间不该算进专注时长，而 accumulatedMs 恰好已排除暂停区间，二者在自然结束时等价。
   */
  async function finishPhase(): Promise<void> {
    clearTimer();
    const finished = phase.value;
    const duration = phaseTotalSec.value;
    status.value = 'completed';
    timeLeft.value = 0;
    accumulatedMs = 0;

    if (soundSettings.enabled) playCue(soundSettings.soundType, 0.6);
    whiteNoise.stop();

    if (finished === 'work') completedToday.value += 1;

    // 落库失败不阻断阶段推进：专注体验优先，统计次之
    try {
      await recordPomodoro(finished, duration);
    } catch {
      /* 静默 */
    }

    // 阶段机推进
    let next: PomodoroPhase;
    let isSetEnd = false;
    if (finished === 'work') {
      isSetEnd = currentCycle.value >= Math.max(1, settings.cyclesPerSet);
      next = isSetEnd ? 'long_break' : 'short_break';
      notify(
        isSetEnd
          ? `🍅 完成第 ${currentCycle.value} 个番茄，一组结束，去长休息吧`
          : `🍅 完成第 ${currentCycle.value} 个番茄，休息一下`,
        'success',
      );
    } else {
      next = 'work';
      // 小憩结束 → 进入下一个番茄；长休息结束 → 新的一组从 1 开始
      currentCycle.value =
        finished === 'long_break' ? 1 : Math.min(settings.cyclesPerSet, currentCycle.value + 1);
      notify('休息结束，开始下一段专注 💪', 'info');
    }

    void emitFinished(finished, isSetEnd, completedToday.value);
    phase.value = next;
    timeLeft.value = phaseTotalSec.value;
    status.value = 'idle';
    // 自动开始下一段：专注/休息结束无缝衔接下一段，用户不再需要点开始。
    // 注意要在 emitToNative 之前 startTimer，否则菜单栏标题会先闪一帧 idle 状态。
    if (autoStartNext.value) startTimer();
    else void emitToNative(true);
  }

  /* ==================== 七、音频 actions ==================== */

  /** 试听 / 播放提示音（设置面板的「试听」与阶段切换共用） */
  function playSound(type: SoundType = soundSettings.soundType): void {
    playCue(type, 0.6);
  }

  function setSoundEnabled(v: boolean): void {
    soundSettings.enabled = v;
    saveSettings();
  }

  function setSoundType(t: SoundType): void {
    soundSettings.soundType = t;
    playCue(t, 0.6); // 选中即试听，省一次点击
    saveSettings();
  }

  /** 白噪音开关（与计时状态解耦：用户可以只放环境音不计时） */
  function toggleWhiteNoise(): void {
    whiteNoiseState.enabled = !whiteNoiseState.enabled;
    if (whiteNoiseState.enabled) whiteNoise.play(whiteNoiseState.track);
    else whiteNoise.stop();
    saveSettings();
  }

  function setWhiteNoiseVolume(v: number): void {
    whiteNoiseState.volume = Math.min(100, Math.max(0, Math.round(v)));
    whiteNoise.setVolume(whiteNoiseState.volume);
    saveSettings();
  }

  function setWhiteNoiseTrack(t: NoiseTrack): void {
    whiteNoiseState.track = t;
    whiteNoise.setTrack(t);
    if (whiteNoiseState.enabled) whiteNoise.play(t);
    saveSettings();
  }

  /** 自动开始下一段开关 */
  function setAutoStartNext(v: boolean): void {
    autoStartNext.value = v;
    saveSettings();
  }

  /* ==================== 八、初始化 ==================== */

  let inited = false;
  /** 页面进入时调用；重复调用只生效一次（配置水合 + 菜单栏复位） */
  async function init(): Promise<void> {
    if (inited) return;
    inited = true;
    await loadSettings();
    void emitToNative(true);
  }

  return {
    // state
    settings,
    status,
    phase,
    currentCycle,
    timeLeft,
    soundSettings,
    whiteNoise: whiteNoiseState,
    autoStartNext,
    completedToday,
    configLoaded,
    // getters
    phaseTotalSec,
    elapsedSec,
    progress,
    timeText,
    phaseLabel,
    phaseEmoji,
    isRunning,
    menuTitle,
    trayTitle,
    // actions
    init,
    loadSettings,
    saveSettings,
    updateSettings,
    startTimer,
    pauseTimer,
    resetTimer,
    stopSession,
    switchPhase,
    skipPhase,
    playSound,
    setSoundEnabled,
    setSoundType,
    toggleWhiteNoise,
    setWhiteNoiseVolume,
    setWhiteNoiseTrack,
    setAutoStartNext,
  };
});
