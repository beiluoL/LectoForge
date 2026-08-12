// 离线语音模型下载 / 状态服务（侧车 Node 内执行，非 DB 操作，故允许 async）。
//
// 关键工程点：
// - 写入 <dataDir>/models/whisper/（可写目录，双根托管优先于只读 .app Resources）。
// - 先写 <file>.part 临时文件，完成后再 rename，避免半截文件被误判为「已下载」。
// - 用全局 fetch（自动跟随 HF 302 → CDN 重定向）流式拉取，边收边写并汇报进度。
// - 主源失败时自动切国内镜像（modelSources 顺序）。
// - 进行中的下载登记到内存 Map，支持取消（AbortController）与状态查询。
import fs from 'node:fs';
import path from 'node:path';

import { dataSubDir } from '../lib/paths';
import {
  SPEECH_MODELS,
  DEFAULT_SPEECH_MODEL_ID,
  getSpeechModel,
  modelSources,
} from './speechModels';

function modelsDir(): string {
  return dataSubDir('models', 'whisper');
}

export type ModelStatus = 'available' | 'downloading' | 'downloaded';

export interface ModelEntry {
  id: string;
  tier: string;
  file: string;
  label: string;
  sizeMB: number;
  lang: string;
  note: string;
  default: boolean;
  status: ModelStatus;
  downloadedPath: string | null;
}

interface ActiveDownload {
  controller: AbortController;
}
const active = new Map<string, ActiveDownload>();

/** 列出全部可选模型及其本地状态（available / downloading / downloaded） */
export function listModels(): ModelEntry[] {
  const dir = modelsDir();
  return SPEECH_MODELS.map((m) => {
    const p = path.join(dir, m.file);
    const exists = fs.existsSync(p);
    const status: ModelStatus = active.has(m.id) ? 'downloading' : exists ? 'downloaded' : 'available';
    return {
      id: m.id,
      tier: m.tier,
      file: m.file,
      label: m.label,
      sizeMB: m.sizeMB,
      lang: m.lang,
      note: m.note,
      default: m.id === DEFAULT_SPEECH_MODEL_ID,
      status,
      downloadedPath: exists ? p : null,
    };
  });
}

/**
 * 下载指定模型到 <dataDir>/models/whisper/。
 * @param onProgress 进度回调（received / total，单位字节）
 * @returns 落盘后的绝对路径
 */
export async function downloadModel(
  id: string,
  onProgress: (received: number, total: number) => void,
): Promise<string> {
  const meta = getSpeechModel(id);
  if (!meta) throw new Error(`未知语音模型: ${id}`);
  if (active.has(id)) throw new Error('该模型正在下载中');
  const dir = modelsDir();
  const target = path.join(dir, meta.file);
  const part = `${target}.part`;
  const sources = modelSources(meta);

  let lastErr: Error | null = null;
  for (const url of sources) {
    const controller = new AbortController();
    active.set(id, { controller });
    try {
      await streamDownload(url, part, onProgress, controller);
      // 整文件下载完成，原子改名，避免半截文件
      fs.renameSync(part, target);
      active.delete(id);
      return target;
    } catch (e) {
      lastErr = e as Error;
      try {
        fs.unlinkSync(part);
      } catch {
        /* noop */
      }
      active.delete(id);
    }
  }
  throw new Error(`模型下载失败: ${lastErr?.message ?? '未知错误'}`);
}

async function streamDownload(
  url: string,
  dest: string,
  onProgress: (received: number, total: number) => void,
  controller: AbortController,
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

/** 删除已下载模型，或取消进行中的下载；返回是否真正删除了文件 */
export function deleteModel(id: string): { removed: boolean } {
  const a = active.get(id);
  if (a) {
    a.controller.abort();
    active.delete(id);
  }
  const meta = getSpeechModel(id);
  if (!meta) throw new Error(`未知语音模型: ${id}`);
  const p = path.join(modelsDir(), meta.file);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    return { removed: true };
  }
  return { removed: false };
}
