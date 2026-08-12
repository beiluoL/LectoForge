// 离线语音模型注册表（只描述「有哪些可选模型」，不含任何下载 / IO 逻辑）。
//
// 设计要点（见《离线语音模型加载与运行时方案.md》）：
// - 模型权重【不随包内置】，运行时按需下载到 <dataDir>/models/whisper/。
// - 文件名（ggml-<tier>-q5_1.bin）必须与 src-tauri/src/lib.rs 侧车默认、
//   src-ui/src/lib/stt/whisperClient.ts 的 WHISPER_MODEL_PATH 保持一致。
// - 来源：ggerganov/whisper.cpp 在 HuggingFace 的 ggml 量化权重（q5_1 量化，中文可用）。
//   注意：whisper.cpp 官方【没有】q5_0 的 base/small 档（只有 tiny-q5_0），统一用 q5_1。

export type SpeechModelTier = 'tiny' | 'base' | 'small';

export interface SpeechModelMeta {
  /** 稳定标识，如 'base-q5_1'（设置页与配置持久化都用它） */
  id: string;
  tier: SpeechModelTier;
  /** 文件名（与侧车 / 前端一致） */
  file: string;
  /** 展示名 */
  label: string;
  /** 体积（MB，约值，用于 UI 提示与进度校验） */
  sizeMB: number;
  /** 推荐语言 */
  lang: string;
  /** 说明 */
  note: string;
  /** 是否默认档位 */
  default?: boolean;
}

export const SPEECH_MODELS: SpeechModelMeta[] = [
  {
    id: 'tiny-q5_1',
    tier: 'tiny',
    file: 'ggml-tiny-q5_1.bin',
    label: 'Tiny (q5_1)',
    sizeMB: 31,
    lang: 'zh',
    note: '最小最快，精度较低，适合弱网或先跑通链路',
  },
  {
    id: 'base-q5_1',
    tier: 'base',
    file: 'ggml-base-q5_1.bin',
    label: 'Base (q5_1)',
    sizeMB: 57,
    lang: 'zh',
    note: '精度与体积平衡最佳，默认档位',
    default: true,
  },
  {
    id: 'small-q5_1',
    tier: 'small',
    file: 'ggml-small-q5_1.bin',
    label: 'Small (q5_1)',
    sizeMB: 181,
    lang: 'zh',
    note: '精度最高，体积大，首次下载慢',
  },
];

export const DEFAULT_SPEECH_MODEL_ID = 'base-q5_1';

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
// 国内镜像兜底（HF 直连在国内常不稳定）
const HF_MIRROR = 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/';

/** 返回某模型的候选下载源（主源 + 镜像），用于网络不稳时重试 */
export function modelSources(meta: SpeechModelMeta): string[] {
  return [`${HF_BASE}${meta.file}`, `${HF_MIRROR}${meta.file}`];
}

export function getSpeechModel(id: string): SpeechModelMeta | undefined {
  return SPEECH_MODELS.find((m) => m.id === id);
}
