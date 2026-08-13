// TTS 引擎配置服务（落盘 <dataDir>/tts-config.json）。
//
// 与 speech-config.json（STT/Whisper）分开，因为二者生命周期与默认值不同：
// - engine: 'browser' 走系统 Web Speech（零依赖，默认，立即可用）
//           'piper'   走本地 Piper 神经网络 TTS 侧车（更自然、全离线，需先下载音色）
// - selectedVoiceId: 选中的 Piper 音色（必须在 TTS_VOICES 注册表内）
import fs from 'node:fs';
import path from 'node:path';

import { dataFile } from '../lib/paths';
import { DEFAULT_TTS_VOICE_ID, getTtsVoice } from './ttsVoices';

export type TtsEngine = 'browser' | 'piper';

export interface TtsConfig {
  engine: TtsEngine;
  selectedVoiceId: string;
  updatedAt: string;
}

const DEFAULT_CONFIG: TtsConfig = {
  engine: 'browser',
  selectedVoiceId: DEFAULT_TTS_VOICE_ID,
  updatedAt: '',
};

function configPath(): string {
  return dataFile('tts-config.json');
}

export function getTtsConfig(): TtsConfig {
  const file = configPath();
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<TtsConfig>;
    const engine: TtsEngine = raw.engine === 'piper' ? 'piper' : 'browser';
    const selectedVoiceId = getTtsVoice(raw.selectedVoiceId ?? '')
      ? (raw.selectedVoiceId as string)
      : DEFAULT_TTS_VOICE_ID;
    return { engine, selectedVoiceId, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '' };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveTtsConfig(input: Partial<TtsConfig>): TtsConfig {
  const cur = getTtsConfig();
  const next: TtsConfig = {
    engine: input.engine === 'piper' ? 'piper' : 'browser',
    selectedVoiceId: getTtsVoice(input.selectedVoiceId ?? '')
      ? (input.selectedVoiceId as string)
      : cur.selectedVoiceId,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
