// Piper TTS 中文语音注册表（纯静态描述，无 IO）。
//
// 模型托管在 HuggingFace `rhasspy/piper-voices`，每个语音由两个文件组成：
//   - <file>.onnx      模型权重
//   - <file>.onnx.json 音素表 / 采样率 / 说话人配置等元数据（缺一个都跑不起来）
// 下载源以国内镜像 hf-mirror.com 为主、HuggingFace 主站兜底（与 whisper 同策略，仅顺序反转——
// 本机直连 huggingface.co 不稳，镜像更可靠）。

export interface TtsVoiceMeta {
  id: string;
  /** onnx 文件名（与 bundled / 下载目录中的实际文件名一致） */
  file: string;
  /** 仓库内目录（相对 resolve/main/），如 zh/zh_CN/huayan/medium。不含末尾斜杠。 */
  path: string;
  label: string;
  sizeMB: number;
  lang: string;
  gender: string;
  note: string;
  default?: boolean;
}

// ⚠️ 以下语音路径均已在 2026-08-13 通过 HF 镜像 API 树 + 范围请求核实存在：
//    zh/zh_CN/{huayan,chaowen,xiao_ya}，各档位 onnx/onnx.json 齐全（206/200）。
//    （rhasspy/piper-voices 仓库根即语言目录，**没有** voices/ 前缀；
//      也 **没有** zh_CN-chen，旧记忆有误，勿补。）
export const TTS_VOICES: TtsVoiceMeta[] = [
  {
    id: 'zh_CN-huayan-medium',
    file: 'zh_CN-huayan-medium.onnx',
    path: 'zh/zh_CN/huayan/medium',
    label: '华岩 · 标准（推荐）',
    sizeMB: 63,
    lang: 'zh-CN',
    gender: '女',
    note: '自然度最佳，约 63MB，离线首选',
    default: true,
  },
  {
    id: 'zh_CN-huayan-x_low',
    file: 'zh_CN-huayan-x_low.onnx',
    path: 'zh/zh_CN/huayan/x_low',
    label: '华岩 · 极速',
    sizeMB: 11,
    lang: 'zh-CN',
    gender: '女',
    note: '体积小、合成快，自然度略低',
  },
  {
    id: 'zh_CN-chaowen-medium',
    file: 'zh_CN-chaowen-medium.onnx',
    path: 'zh/zh_CN/chaowen/medium',
    label: '朝闻 · 标准',
    sizeMB: 70,
    lang: 'zh-CN',
    gender: '男',
    note: '男声选项，约 70MB',
  },
  {
    id: 'zh_CN-xiao_ya-medium',
    file: 'zh_CN-xiao_ya-medium.onnx',
    path: 'zh/zh_CN/xiao_ya/medium',
    label: '小雅 · 标准',
    sizeMB: 70,
    lang: 'zh-CN',
    gender: '女',
    note: '另一女声选项，约 70MB',
  },
];

export const DEFAULT_TTS_VOICE_ID = 'zh_CN-huayan-medium';

const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';
const HF_MIRROR = 'https://hf-mirror.com/rhasspy/piper-voices/resolve/main/';

/** 主源（镜像）在前，兜底（主站）在后，下载失败时按序重试 */
export function voiceSources(meta: TtsVoiceMeta): string[] {
  return [`${HF_MIRROR}${meta.path}/${meta.file}`, `${HF_BASE}${meta.path}/${meta.file}`];
}

/** 同 voiceSources，但指向 .onnx.json 元数据文件 */
export function voiceConfigSources(meta: TtsVoiceMeta): string[] {
  return [`${HF_MIRROR}${meta.path}/${meta.file}.json`, `${HF_BASE}${meta.path}/${meta.file}.json`];
}

export function getTtsVoice(id: string): TtsVoiceMeta | undefined {
  return TTS_VOICES.find((v) => v.id === id);
}
