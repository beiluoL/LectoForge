/**
 * 番茄钟音频层：提示音（合成）+ 白噪音（音频文件，带合成兜底）。
 *
 * 两条路刻意用不同技术，理由不同：
 *
 * 1) 提示音用 Web Audio 实时合成，不落任何二进制资源。
 *    「叮 / 滴答 / 发条」都是极短音，打包三个 mp3 既增体积又要处理解码延迟；
 *    振荡器合成是零延迟的，且音量/音色可随时调，不会出现「点了按钮半秒后才响」。
 *
 * 2) 白噪音用 Howler 播放 public/audio/white-noise/*.mp3。
 *    循环环境音必须是真实录音才有质感，合成噪声听久了很刺耳。
 *    但资源可能缺失（用户自行替换 / 打包遗漏），因此加载失败时**自动降级**为
 *    Web Audio 合成噪声（雨=白噪+低通，溪流=带通抖动，咖啡馆=棕噪+缓慢起伏），
 *    保证功能永远可用，而不是静默失败让用户以为按钮坏了。
 */
import { Howl } from 'howler';
import type { NoiseTrack, SoundType } from '@/api/pomodoro';

/* ============================== 公共 AudioContext ============================== */

let ctx: AudioContext | null = null;

/** 懒创建 AudioContext；浏览器自动播放策略要求首次调用发生在用户手势内 */
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // Chrome/WKWebView 会把上下文挂起，恢复一下再用
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/* ============================== 一、提示音（合成） ============================== */

/** 单个正弦音符：freq Hz、dur 秒、delay 秒后起播 */
function beep(
  ac: AudioContext,
  freq: number,
  dur: number,
  delay: number,
  gain: number,
  type: OscillatorType = 'sine',
): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  const t0 = ac.currentTime + delay;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  // 指数衰减包络：起音 5ms 爬升避免爆音，随后自然衰减，听感接近真实敲击
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** 短促噪声脉冲（滴答声的「咔」味来源） */
function click(ac: AudioContext, delay: number, gain: number): void {
  const len = Math.floor(ac.sampleRate * 0.03);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    // 线性衰减的白噪，收尾干净不拖尾
    data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }
  const src = ac.createBufferSource();
  const g = ac.createGain();
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(hp).connect(g).connect(ac.destination);
  src.start(ac.currentTime + delay);
}

/**
 * 播放提示音。
 * - ding  叮：两声清亮铃音（880 → 1320Hz），阶段切换用
 * - tick  滴答：两下机械咔嗒，轻量不打扰
 * - alarm 发条：四声方波急促鸣叫，一整组番茄结束时用
 */
export function playCue(type: SoundType, volume = 0.5): void {
  const ac = getCtx();
  if (!ac) return;
  const v = Math.min(1, Math.max(0, volume));
  if (type === 'ding') {
    beep(ac, 880, 0.5, 0, 0.28 * v);
    beep(ac, 1320, 0.6, 0.14, 0.2 * v);
    return;
  }
  if (type === 'tick') {
    click(ac, 0, 0.35 * v);
    click(ac, 0.16, 0.28 * v);
    return;
  }
  // alarm：四声急促方波，带轻微升调制造「催促感」
  for (let i = 0; i < 4; i++) {
    beep(ac, 660 + i * 40, 0.12, i * 0.17, 0.2 * v, 'square');
  }
}

/* ============================== 二、白噪音 ============================== */

/** 音轨 → 资源路径（放在 public/ 下，构建后原样落到 dist 根） */
const TRACK_SRC: Record<NoiseTrack, string> = {
  rain: '/audio/white-noise/rain.mp3',
  stream: '/audio/white-noise/stream.mp3',
  coffee: '/audio/white-noise/coffee.mp3',
};

export const TRACK_LABEL: Record<NoiseTrack, string> = {
  rain: '🌧️ 雨声',
  stream: '💧 溪流',
  coffee: '☕ 咖啡馆',
};

/** 合成兜底：不同音轨的滤波参数（近似模拟三种环境音的频谱重心） */
const SYNTH_PROFILE: Record<NoiseTrack, { filter: BiquadFilterType; freq: number; q: number }> = {
  rain: { filter: 'lowpass', freq: 2200, q: 0.7 },
  stream: { filter: 'bandpass', freq: 1400, q: 0.5 },
  coffee: { filter: 'lowpass', freq: 700, q: 0.9 },
};

/**
 * 白噪音播放器（模块级单例，全局同一时刻只有一条音轨在响）。
 * 对外只暴露 play / stop / setTrack / setVolume 四个动作，内部自行决定走文件还是合成。
 */
class WhiteNoisePlayer {
  private howl: Howl | null = null;
  private currentTrack: NoiseTrack | null = null;
  /** 0-1 */
  private volume = 0.45;
  private playing = false;

  /* —— 合成兜底链路 —— */
  private synthSrc: AudioBufferSourceNode | null = null;
  private synthGain: GainNode | null = null;
  /** 该音轨的 mp3 已确认加载失败，后续直接走合成，不再重复试探 */
  private failedTracks = new Set<NoiseTrack>();

  get isPlaying(): boolean {
    return this.playing;
  }

  get track(): NoiseTrack | null {
    return this.currentTrack;
  }

  /** 音量 0-100 */
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v / 100));
    this.howl?.volume(this.volume);
    if (this.synthGain) this.synthGain.gain.value = this.volume * 0.35; // 合成噪声偏亮，压低一档
  }

  /** 切换音轨；正在播放时无缝换源 */
  setTrack(track: NoiseTrack): void {
    if (this.currentTrack === track) return;
    const wasPlaying = this.playing;
    this.stop();
    this.currentTrack = track;
    if (wasPlaying) this.play(track);
  }

  play(track: NoiseTrack): void {
    if (this.playing && this.currentTrack === track) return;
    this.stop();
    this.currentTrack = track;
    this.playing = true;

    if (this.failedTracks.has(track)) {
      this.playSynth(track);
      return;
    }

    this.howl = new Howl({
      src: [TRACK_SRC[track]],
      loop: true,
      volume: this.volume,
      html5: false, // 走 Web Audio，循环点无缝，且能与提示音共用输出
      onloaderror: () => {
        // 资源缺失/解码失败 → 记账并降级，不打扰用户
        this.failedTracks.add(track);
        this.howl?.unload();
        this.howl = null;
        if (this.playing && this.currentTrack === track) this.playSynth(track);
      },
      onplayerror: () => {
        // 自动播放被拦截：解锁后重试一次
        this.howl?.once('unlock', () => this.howl?.play());
      },
    });
    this.howl.play();
  }

  stop(): void {
    this.playing = false;
    if (this.howl) {
      this.howl.stop();
      this.howl.unload();
      this.howl = null;
    }
    if (this.synthSrc) {
      try {
        this.synthSrc.stop();
      } catch {
        /* 已停止，忽略 */
      }
      this.synthSrc.disconnect();
      this.synthSrc = null;
    }
    if (this.synthGain) {
      this.synthGain.disconnect();
      this.synthGain = null;
    }
  }

  /** Web Audio 合成兜底：2 秒噪声缓冲循环 + 音轨专属滤波 */
  private playSynth(track: NoiseTrack): void {
    const ac = getCtx();
    if (!ac) return;
    const seconds = 2;
    const len = ac.sampleRate * seconds;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      // 一阶低通积分 → 棕噪，比纯白噪柔和，更接近环境音
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    // 首尾交叉淡化，消除循环接缝处的「啪」声
    const fade = Math.floor(ac.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      data[i] *= k;
      data[len - 1 - i] *= k;
    }

    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const profile = SYNTH_PROFILE[track];
    const filter = ac.createBiquadFilter();
    filter.type = profile.filter;
    filter.frequency.value = profile.freq;
    filter.Q.value = profile.q;
    const gain = ac.createGain();
    gain.gain.value = this.volume * 0.35;
    src.connect(filter).connect(gain).connect(ac.destination);
    src.start();
    this.synthSrc = src;
    this.synthGain = gain;
  }
}

export const whiteNoise = new WhiteNoisePlayer();
