// 语音运行时配置持久化（与 config.json / pomodoro-config.json 同构，独立文件落盘）。
// 记录：用户偏好的运行方式（native 原生 whisper-server / wasm 前端 worker）与默认模型档位。
// 落盘在 <dataDir>/speech-config.json。不含任何密钥。
import fs from 'node:fs';
import path from 'node:path';

import { dataFile } from '../lib/paths';
import { DEFAULT_SPEECH_MODEL_ID, getSpeechModel } from './speechModels';

export type SpeechRuntime = 'native' | 'wasm';

export interface SpeechConfig {
  /** 运行方式：native = 原生 whisper-server 侧车；wasm = 前端 worker */
  runtime: SpeechRuntime;
  /** 默认模型档位 id（须存在于注册表） */
  selectedModelId: string;
  updatedAt: string;
}

const DEFAULT_CONFIG: SpeechConfig = {
  runtime: 'native',
  selectedModelId: DEFAULT_SPEECH_MODEL_ID,
  updatedAt: '',
};

function configPath(): string {
  return dataFile('speech-config.json');
}

/** 读取语音配置；文件缺失 / 损坏时回落默认（不抛错） */
export function getSpeechConfig(): SpeechConfig {
  const file = configPath();
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SpeechConfig>;
    const runtime: SpeechRuntime = raw.runtime === 'wasm' ? 'wasm' : 'native';
    const selectedModelId = getSpeechModel(raw.selectedModelId ?? '')
      ? (raw.selectedModelId as string)
      : DEFAULT_SPEECH_MODEL_ID;
    return {
      runtime,
      selectedModelId,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** 保存语音配置（仅采纳注册表内合法的字段，非法值回落默认） */
export function saveSpeechConfig(input: Partial<SpeechConfig>): SpeechConfig {
  const cur = getSpeechConfig();
  const next: SpeechConfig = {
    runtime: input.runtime === 'wasm' ? 'wasm' : 'native',
    selectedModelId: getSpeechModel(input.selectedModelId ?? '')
      ? (input.selectedModelId as string)
      : cur.selectedModelId,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
