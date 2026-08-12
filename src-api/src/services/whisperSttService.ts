/**
 * Whisper 本地语音转写代理（STT）。
 *
 * 连接本机运行的 whisper.cpp `whisper-server`（OpenAI 兼容 /v1/audio/transcriptions 端点），
 * 语音不出本机，满足「离线模拟面试」诉求。地址读 WHISPER_URL（默认 http://127.0.0.1:8080），
 * 模型名读 WHISPER_MODEL（默认 whisper-1，whisper.cpp 实际按启动时 -m 指定的模型忽略此字段，
 * 但 OpenAI 协议要求请求体带 model）。
 */
import { LlmError } from '../lib/llm';

const WHISPER_URL = process.env.WHISPER_URL || 'http://127.0.0.1:8080';
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'whisper-1';

/** 把 MIME 兜底成扩展名（MediaRecorder 产出的 Blob 常无文件名）。 */
function mimeToExt(mime: string): string {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'video/webm': 'webm',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/ogg; codecs=opus': 'ogg',
  };
  return map[m] || 'webm';
}

/**
 * 转写音频缓冲。
 * @param audioBuffer 录音二进制（前端 MediaRecorder 产出）
 * @param mime 录音的 MIME 类型（如 audio/webm），用于命名上传文件
 * @returns { text } 转写文本
 */
export async function transcribe(audioBuffer: Buffer, mime: string): Promise<{ text: string }> {
  const form = new FormData();
  const filename = `interview.${mimeToExt(mime)}`;
  // 复制为独立 Uint8Array 视图，规避 Node Buffer 与 BlobPart 的 ArrayBufferLike 类型差异
  const view = new Uint8Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength);
  const blob = new Blob([view as unknown as BlobPart], { type: mime || 'audio/webm' });
  form.append('file', blob, filename);
  form.append('model', WHISPER_MODEL);

  let resp: Response;
  try {
    resp = await fetch(`${WHISPER_URL}/v1/audio/transcriptions`, {
      method: 'POST',
      body: form,
    });
  } catch (e) {
    throw new LlmError(
      'AI_UPSTREAM_ERROR',
      `无法连接本地 Whisper 服务（${WHISPER_URL}），请确认 whisper-server 已启动：${(e as Error)?.message || e}`,
      502,
    );
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new LlmError('AI_UPSTREAM_ERROR', `Whisper 转写失败 ${resp.status}${text ? `：${text.slice(0, 300)}` : ''}`, 502);
  }
  const data = (await resp.json()) as { text?: string };
  return { text: data.text || '' };
}
