/**
 * STT 运行时分发器（离线语音转文字通用；模拟面试 / 笔记速记共用）。
 *
 * 依据「设置 → 本地模型」持久化的 speech-config.json.runtime 选择语音转写路径：
 *   - native：交给后端 whisper-server 侧车（src-api whisperSttService），
 *             前端以 multipart POST /interview/transcribe，语音不出本机。
 *   - wasm  ：前端 worker 内跑 whisper.cpp wasm（whisperClient），零后端依赖。
 *
 * 两条路径统一收敛为 transcribe(blob, fileName) -> { text }，调用方无感。
 * 配置每次实时读取（localhost 极快），确保用户在设置页切换后能立即生效；
 * 模型列表（含 file 字段，用于拼 WASM 模型 URL）做一次性缓存（注册表静态、file 不变）。
 */
import { transcribeAudio as transcribeNative } from '@/api/interview';
import { transcribeAudio as transcribeWasm } from '@/lib/stt/whisperClient';
import { getSpeechConfig, getSpeechModels } from '@/api/speechModels';
import type { SpeechConfig, SpeechModelEntry } from '@/api/speechModels';
import { blobToWav } from '@/lib/stt/audio';

export interface TranscribeOutcome {
  text: string;
}

let modelIndexCache: Map<string, SpeechModelEntry> | null = null;

/** 拉取模型列表并建 id→entry 索引（缓存，file 字段静态不变） */
async function modelIndex(): Promise<Map<string, SpeechModelEntry>> {
  if (modelIndexCache) return modelIndexCache;
  const list = await getSpeechModels();
  const map = new Map<string, SpeechModelEntry>();
  for (const m of list) map.set(m.id, m);
  modelIndexCache = map;
  return map;
}

/** WASM 模型在双根托管下的 URL：/models/whisper/{file} */
function wasmModelUrl(file: string): string {
  return `/models/whisper/${file}`;
}

/** 把录音转写为文本；失败抛错（上报给调用方统一提示） */
export async function transcribe(blob: Blob, fileName = 'audio.webm'): Promise<TranscribeOutcome> {
  // 配置实时读取，使设置页的运行时切换立即生效
  let cfg: SpeechConfig;
  try {
    cfg = await getSpeechConfig();
  } catch {
    // 读不到配置（极端情况）回落 native，不阻断面试
    cfg = { runtime: 'native', selectedModelId: 'base-q5_1', updatedAt: '' };
  }

  if (cfg.runtime === 'wasm') {
    const index = await modelIndex();
    const meta = index.get(cfg.selectedModelId);
    if (!meta) {
      throw new Error(`未找到语音模型「${cfg.selectedModelId}」，请到「设置 → 本地模型」检查。`);
    }
    if (meta.status !== 'downloaded') {
      throw new Error(`所选语音模型「${meta.label}」尚未下载，请到「设置 → 本地模型」下载后重试。`);
    }
    const text = await transcribeWasm(blob, wasmModelUrl(meta.file));
    return { text: (text || '').trim() };
  }

  // native：后端 whisper-server 代理
  // 转码为 WAV（whisper.cpp legacy 服务器解不了浏览器录音的 webm/opus，会 400）
  let payload: Blob = blob;
  try {
    payload = await blobToWav(blob);
  } catch {
    // 转码失败（极少数不支持的格式）退回原 blob，由后端报错给出真实原因
  }
  const r = await transcribeNative(payload, payload === blob ? fileName : 'audio.wav');
  return { text: (r.text || '').trim() };
}
