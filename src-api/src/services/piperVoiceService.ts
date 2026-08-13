// Piper TTS 音色下载 / 状态服务（侧车 Node 内执行，非 DB 操作，故允许 async）。
//
// 工程要点（与 whisperModelService 一致）：
// - 下载落盘 <dataDir>/models/piper/（双根托管优先于只读 .app Resources）。
// - 先写 <file>.part 临时文件，完成再 rename，避免半截文件被误判为「已下载」。
// - 流式拉取、边收边写并汇报进度；主源失败时自动切镜像。
// - 每个音色含两个文件：<file>.onnx（权重）+ <file>.onnx.json（元数据），需一并下载。
// - 进行中下载登记到内存 Map，支持取消（AbortController）。
import fs from 'node:fs';
import path from 'node:path';

import { dataSubDir } from '../lib/paths';
import {
  TTS_VOICES,
  DEFAULT_TTS_VOICE_ID,
  getTtsVoice,
  voiceSources,
  voiceConfigSources,
} from './ttsVoices';

function modelsDir(): string {
  return dataSubDir('models', 'piper');
}

export type VoiceStatus = 'available' | 'downloading' | 'downloaded';

export interface VoiceEntry {
  id: string;
  file: string;
  label: string;
  sizeMB: number;
  lang: string;
  gender: string;
  note: string;
  default: boolean;
  status: VoiceStatus;
  downloadedPath: string | null;
}

interface ActiveDownload {
  controller: AbortController;
}
const active = new Map<string, ActiveDownload>();

function jsonFor(file: string): string {
  return `${file}.json`;
}

/** 列出全部可选音色及其本地状态 */
export function listVoices(): VoiceEntry[] {
  const dir = modelsDir();
  return TTS_VOICES.map((v) => {
    const p = path.join(dir, v.file);
    const exists = fs.existsSync(p) && fs.existsSync(path.join(dir, jsonFor(v.file)));
    const status: VoiceStatus = active.has(v.id) ? 'downloading' : exists ? 'downloaded' : 'available';
    return {
      id: v.id,
      file: v.file,
      label: v.label,
      sizeMB: v.sizeMB,
      lang: v.lang,
      gender: v.gender,
      note: v.note,
      default: v.id === DEFAULT_TTS_VOICE_ID,
      status,
      downloadedPath: exists ? p : null,
    };
  });
}

/**
 * 下载指定音色（.onnx + .onnx.json）到 <dataDir>/models/piper/。
 * onProgress 回调累计字节数（received / total，单位字节，含两个文件）。
 */
export async function downloadVoice(
  id: string,
  onProgress: (received: number, total: number) => void,
): Promise<string> {
  const meta = getTtsVoice(id);
  if (!meta) throw new Error(`未知 TTS 音色: ${id}`);
  if (active.has(id)) throw new Error('该音色正在下载中');
  const dir = modelsDir();
  const target = path.join(dir, meta.file);
  const targetJson = path.join(dir, jsonFor(meta.file));
  const part = `${target}.part`;
  const partJson = `${targetJson}.part`;
  const onnxSources = voiceSources(meta);
  const jsonSources = voiceConfigSources(meta);

  let lastErr: Error | null = null;
  let total = 0;
  let received = 0;
  const controller = new AbortController();
  active.set(id, { controller });

  const cleanup = () => {
    for (const f of [part, partJson]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* noop */
      }
    }
    active.delete(id);
  };

  try {
    // 1) 权重 .onnx
    for (const url of onnxSources) {
      try {
        await streamDownload(url, part, controller, (r, t) => {
          total = t;
          received = r;
          onProgress(received, total);
        });
        fs.renameSync(part, target);
        break;
      } catch (e) {
        lastErr = e as Error;
        try {
          fs.unlinkSync(part);
        } catch {
          /* noop */
        }
      }
    }
    if (!fs.existsSync(target)) throw new Error(`音色权重下载失败: ${lastErr?.message ?? '未知错误'}`);

    // 2) 元数据 .onnx.json
    for (const url of jsonSources) {
      try {
        await streamDownload(url, partJson, controller, (r, t) => {
          onProgress(received + r, total + t);
        });
        fs.renameSync(partJson, targetJson);
        break;
      } catch (e) {
        lastErr = e as Error;
        try {
          fs.unlinkSync(partJson);
        } catch {
          /* noop */
        }
      }
    }
    if (!fs.existsSync(targetJson)) {
      // 元数据缺失也算失败，删除已下权重避免误导
      try {
        fs.unlinkSync(target);
      } catch {
        /* noop */
      }
      throw new Error(`音色配置下载失败: ${lastErr?.message ?? '未知错误'}`);
    }
    active.delete(id);
    return target;
  } catch (e) {
    cleanup();
    throw e;
  }
}

async function streamDownload(
  url: string,
  dest: string,
  controller: AbortController,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  const res = await fetch(url, { signal: controller.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') || 0);
  const reader = res.body!.getReader();
  const ws = fs.createWriteStream(dest);
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.length;
        onProgress(received, total);
        await new Promise<void>((resolve, reject) => {
          ws.write(value, (err) => (err ? reject(err) : resolve()));
        });
      }
    }
  } finally {
    await new Promise<void>((r) => ws.end(r));
  }
}

/** 删除已下载音色，或取消进行中的下载 */
export function deleteVoice(id: string): { removed: boolean } {
  const a = active.get(id);
  if (a) {
    a.controller.abort();
    active.delete(id);
  }
  const meta = getTtsVoice(id);
  if (!meta) throw new Error(`未知 TTS 音色: ${id}`);
  const dir = modelsDir();
  let removed = false;
  for (const f of [meta.file, jsonFor(meta.file)]) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      removed = true;
    }
  }
  return { removed };
}
