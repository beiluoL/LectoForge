/**
 * Whisper 转写运行时：Worker 管理 + 音频解码（任意格式 → 16kHz 单声道 PCM）。
 *
 * 与 whisperClient.ts 分离，便于单测与复用。Worker 为 classic worker（配合
 * whisper.worker.js 里的 importScripts），通过 new URL 让 Vite 正确产出 worker 资源。
 */
import WhisperWorker from './whisper.worker.js?worker&url';

let worker: Worker | null = null;
let reqSeq = 0;

function getWorker(): Worker {
  if (!worker) {
    // ?worker&url → 得到一个可被 new Worker(url) 构造的 URL（classic worker）
    const url = (WhisperWorker as unknown as string) || new URL('./whisper.worker.js', import.meta.url);
    worker = new Worker(url as unknown as string);
  }
  return worker;
}

/** 把录音 Blob 解码并重采样为 whisper 需要的 16kHz 单声道 Float32 */
async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer();
  const AC: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const audio = await ctx.decodeAudioData(buf.slice(0));
    const channels = audio.numberOfChannels;
    const len = audio.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < channels; c++) {
      const data = audio.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += data[i] / channels;
    }
    const targetRate = 16000;
    const ratio = audio.sampleRate / targetRate;
    const outLen = Math.max(1, Math.floor(len / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) out[i] = mono[Math.floor(i * ratio)];
    return out;
  } finally {
    void ctx.close();
  }
}

/** 转写：返回识别文本；底层错误向上抛出 */
export async function transcribeAudioBlob(blob: Blob, modelPath: string): Promise<string> {
  const pcm = await decodeToMono16k(blob);
  const w = getWorker();
  const id = ++reqSeq;
  return new Promise<string>((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const data = e.data || {};
      if (data.id !== id) return;
      w.removeEventListener('message', onMsg);
      if (data.ok) resolve(data.text as string);
      else reject(new Error(data.error || 'whisper 转写失败'));
    };
    w.addEventListener('message', onMsg);
    w.addEventListener(
      'error',
      () => {
        w.removeEventListener('message', onMsg);
        reject(new Error('whisper worker 加载失败，请确认 /models/whisper/whisper.wasm 已就位'));
      },
      { once: true },
    );
    // 传 Float32Array 本体并 transfer 其 buffer，避免大数组拷贝
    w.postMessage({ id, pcm, modelPath }, [pcm.buffer]);
  });
}
