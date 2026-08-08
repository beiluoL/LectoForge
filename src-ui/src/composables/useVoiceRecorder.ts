/**
 * 语音录制组合式函数（收集箱「语音灵感」用）。
 *
 * 为什么不用 @vueuse/core 的 useMediaRecorder：本项目锁定的 @vueuse 版本里没有这个
 * composable（它属于 @vueuse/electron / 实验性范畴），与其为一个 60 行的能力引依赖，
 * 不如直接封一层，顺便把桌面端的两个坑处理掉：
 *
 * 坑 1 —— **麦克风轨道必须显式停掉**。MediaRecorder.stop() 只结束录制，
 *   getUserMedia 拿到的 MediaStreamTrack 仍是 live 状态，macOS 菜单栏那颗橙色
 *   「正在使用麦克风」指示灯会一直亮着，用户会以为应用在偷听。必须逐条 track.stop()。
 *
 * 坑 2 —— **mimeType 不能写死 audio/webm**。WKWebView（Tauri 在 macOS 用的内核）
 *   对 webm 的支持随系统版本变化，写死会在部分机器上直接抛 NotSupportedError。
 *   这里按候选列表用 isTypeSupported 逐个探测，探不到就传 undefined 让浏览器自己挑，
 *   并根据最终 mimeType 推断文件扩展名（后端按扩展名归档）。
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { formatFileStamp, formatMMSS } from '@/lib/date';

/** 候选容器格式，按「体积小 + 兼容好」排序 */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

/** mimeType → 文件扩展名 */
function extOf(mime: string): string {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

export interface VoiceRecording {
  blob: Blob;
  /** 建议文件名，形如 voice-20260808-143012.webm */
  fileName: string;
  mimeType: string;
  /** 时长（秒，取整） */
  seconds: number;
}

export function useVoiceRecorder() {
  const recording = ref(false);
  /** 已录制秒数，用于按钮上的 MM:SS */
  const seconds = ref(0);
  const error = ref('');
  /** 浏览器是否具备录音能力（非 https/localhost 环境下 mediaDevices 为 undefined） */
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  const elapsedText = computed(() => formatMMSS(seconds.value));

  /** 释放麦克风：stop() 之后必须做，否则系统录音指示灯不灭 */
  function releaseStream() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function pickMimeType(): string | undefined {
    if (typeof MediaRecorder === 'undefined') return undefined;
    return MIME_CANDIDATES.find((m) => {
      try {
        return MediaRecorder.isTypeSupported(m);
      } catch {
        return false;
      }
    });
  }

  /** 开始录音；失败时把人话错误写进 error 并返回 false */
  async function start(): Promise<boolean> {
    if (recording.value) return true;
    error.value = '';
    if (!supported) {
      error.value = '当前环境不支持录音（需要麦克风权限）';
      return false;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e: any) {
      // NotAllowedError = 用户拒绝或系统未授权；桌面端首启常见，给可执行的指引
      error.value =
        e?.name === 'NotAllowedError'
          ? '麦克风被拒绝：请在「系统设置 → 隐私与安全性 → 麦克风」中允许本应用'
          : '无法访问麦克风，请检查设备是否可用';
      return false;
    }

    try {
      const mimeType = pickMimeType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      releaseStream();
      error.value = '当前系统不支持该录音格式';
      return false;
    }

    chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.start();
    recording.value = true;
    seconds.value = 0;
    timer = setInterval(() => {
      seconds.value += 1;
    }, 1000);
    return true;
  }

  /**
   * 结束录音并返回音频数据。
   * 用 Promise 包住 onstop —— stop() 是异步的，最后一片 dataavailable 会在 stop() 之后才到，
   * 同步读 chunks 会丢掉尾巴（表现为录音被截断几百毫秒）。
   */
  function stop(): Promise<VoiceRecording | null> {
    return new Promise((resolve) => {
      if (!recorder || !recording.value) {
        resolve(null);
        return;
      }
      const mimeType = recorder.mimeType || 'audio/webm';
      const took = seconds.value;
      recorder.onstop = () => {
        stopTimer();
        recording.value = false;
        releaseStream();
        const blob = new Blob(chunks, { type: mimeType });
        chunks = [];
        recorder = null;
        if (!blob.size) {
          resolve(null);
          return;
        }
        const stamp = formatFileStamp();
        resolve({
          blob,
          fileName: `voice-${stamp}.${extOf(mimeType)}`,
          mimeType,
          seconds: took,
        });
      };
      recorder.stop();
    });
  }

  /** 放弃本次录音：丢弃数据、释放设备 */
  function cancel() {
    if (!recorder) {
      releaseStream();
      return;
    }
    recorder.onstop = () => {
      chunks = [];
      recorder = null;
      releaseStream();
    };
    try {
      recorder.stop();
    } catch {
      releaseStream();
    }
    stopTimer();
    recording.value = false;
    seconds.value = 0;
  }

  // 组件卸载时兜底释放，避免"关掉弹窗麦克风还亮着"
  onBeforeUnmount(() => {
    stopTimer();
    if (recording.value) cancel();
    else releaseStream();
  });

  return { recording, seconds, elapsedText, error, supported, start, stop, cancel };
}
