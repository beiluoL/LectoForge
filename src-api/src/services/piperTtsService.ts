// Piper 本地神经网络 TTS 合成服务（侧车 Node 内执行）。
//
// 复用现有 Node 侧车：本函数 spawn 随包构建的 `piper` 二进制（C++，自带 phonemizer，
// 不依赖 Python/Flask），把待合成文本经 stdin 喂入、`--output_raw` 取回 raw PCM16，
// 再包成标准 WAV 返回给前端播放。语音不出本机，全离线。
//
// 二进制布局：<resources>/models/piper/{piper, *.dylib, espeak-ng-data/}（scripts/build-piper.sh 构建并签名）。
// 音色：优先 <dataDir>/models/piper/<file>（运行时下载落盘），兜底 <resources>/models/piper/<file>（随包内置）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { getModelsDir, dataSubDir } from '../lib/paths';
import { getTtsVoice } from './ttsVoices';
import { LlmError } from '../lib/llm';

/** piper 二进制所在目录（随包落在 Resources/models/piper） */
function piperDir(): string {
  return path.join(getModelsDir(), 'piper');
}

function piperBin(): string {
  return path.join(piperDir(), 'piper');
}

/** 解析音色 onnx 路径：优先可写 dataDir，兜底 Resources */
function resolveVoiceFile(voiceId: string): string {
  const meta = getTtsVoice(voiceId);
  if (!meta) throw new LlmError('AI_UPSTREAM_ERROR', `未知 TTS 音色: ${voiceId}`, 400);
  const dataPath = path.join(dataSubDir('models', 'piper'), meta.file);
  if (fs.existsSync(dataPath)) return dataPath;
  const resPath = path.join(piperDir(), meta.file);
  if (fs.existsSync(resPath)) return resPath;
  throw new LlmError('AI_UPSTREAM_ERROR', `TTS 音色「${meta.label}」尚未下载，请到设置页下载后再用`, 400);
}

/** 读音色配置里的采样率（缺省 22050） */
function sampleRateOf(voiceFile: string): number {
  const cfg = `${voiceFile}.json`;
  try {
    const raw = JSON.parse(fs.readFileSync(cfg, 'utf8')) as { audio?: { sample_rate?: number } };
    const sr = raw?.audio?.sample_rate;
    if (typeof sr === 'number' && sr > 0) return sr;
  } catch {
    /* noop */
  }
  return 22050;
}

/** raw PCM16（单声道）→ 标准 WAV 文件头 + 数据 */
function encodeWav(pcm: Buffer, sampleRate: number, numChannels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  pcm.copy(buf, 44);
  return buf;
}

/**
 * 合成文本为 WAV 音频（Buffer）。
 * @param text 待合成文本（支持中文，piper 内部用 espeak-ng 做中文音素化）
 * @param voiceId 音色 id（须存在于 TTS_VOICES 注册表）
 */
export async function synthesize(text: string, voiceId: string): Promise<Buffer> {
  const bin = piperBin();
  if (!fs.existsSync(bin)) {
    throw new LlmError(
      'AI_UPSTREAM_ERROR',
      '本地 Piper 引擎未安装（缺少 piper 二进制），请重新构建应用或改用系统语音',
      500,
    );
  }
  const voiceFile = resolveVoiceFile(voiceId);
  const sampleRate = sampleRateOf(voiceFile);

  return new Promise<Buffer>((resolve, reject) => {
    const espeakData = path.join(piperDir(), 'espeak-ng-data');
    const proc = spawn(bin, ['--model', voiceFile, '--output_raw'], {
      cwd: piperDir(), // 工作目录置为 piper 目录，便于定位同目录资源
      // espeak-ng 的数据目录（phontab 等）必须通过环境变量指明，cwd 无效
      env: { ...process.env, ESPEAK_DATA_PATH: espeakData },
    });
    const chunks: Buffer[] = [];
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => chunks.push(Buffer.from(d)));
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('error', (e) =>
      reject(new LlmError('AI_UPSTREAM_ERROR', `启动 Piper 失败: ${e.message}`, 500)),
    );

    let settled = false;
    const finish = (fn: (b?: Buffer) => void, arg?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg as Buffer);
    };

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      finish(() => reject(new LlmError('AI_UPSTREAM_ERROR', 'Piper 合成超时', 504)));
    }, 60000);

    proc.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        return finish(() =>
          reject(new LlmError('AI_UPSTREAM_ERROR', `Piper 合成失败 (exit ${code}): ${stderr.slice(0, 400)}`, 502)),
        );
      }
      const pcm = Buffer.concat(chunks);
      if (!pcm.length) {
        return finish(() => reject(new LlmError('AI_UPSTREAM_ERROR', 'Piper 未输出音频数据', 502)));
      }
      try {
        finish((b) => resolve(b!), encodeWav(pcm, sampleRate));
      } catch (e) {
        finish(() => reject(e as Error));
      }
    });

    // 文本经 stdin 喂入，写完关闭 stdin 触发合成
    proc.stdin.write(text, (err) => {
      if (err) {
        finish(() => reject(new LlmError('AI_UPSTREAM_ERROR', `写入合成文本失败: ${err.message}`, 500)));
        return;
      }
      proc.stdin.end();
    });
  });
}
