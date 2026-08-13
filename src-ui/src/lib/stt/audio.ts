/**
 * 录音转码：把浏览器 MediaRecorder 产出的音频（webm/opus、mp4、ogg 等）
 * 转码为 whisper.cpp 可原生解码的 WAV（PCM16, 16kHz 单声道）。
 *
 * 背景：随包构建的 whisper-server 是 whisper.cpp 的 legacy 服务器，其
 * read_audio_data 只能解 WAV / MP3 / FLAC，解不了 webm/opus 容器，
 * 直接 POST 浏览器录音会得到 400（服务器 error_handler 覆盖文案为 "Invalid request"）。
 * 在客户端用 Web Audio API 解码 + 重采样为 16kHz 单声道 PCM16 WAV 即可规避，
 * 且 whisper.cpp 对 WAV 原生支持（已验证 12MB WAV 也能正常转写）。
 */

const TARGET_RATE = 16000;

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

/** Float32 单声道 PCM → 16-bit PCM WAV Blob */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

/** 录音 Blob → 16kHz 单声道 PCM16 WAV Blob（已是 WAV 则原样返回） */
export async function blobToWav(blob: Blob): Promise<Blob> {
  if (/^audio\/(x-)?wav$/i.test(blob.type || '')) return blob;

  const AC: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) throw new Error('当前环境不支持 Web Audio，无法转码音频');

  const ctx = new AC();
  try {
    const audioBuf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(audioBuf.duration * TARGET_RATE)),
      TARGET_RATE,
    );
    const src = offline.createBufferSource();
    src.buffer = audioBuf;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0), TARGET_RATE);
  } finally {
    void ctx.close();
  }
}
