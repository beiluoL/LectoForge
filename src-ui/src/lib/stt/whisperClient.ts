/**
 * 离线语音转文字客户端（Whisper WASM）。
 *
 * 完全本地运行：录音 Blob → 解码为 16kHz 单声道 Float32 PCM → 交给 whisper.worker
 * 里的 whisper.cpp wasm 转写。零云 API、零外网，满足「离线」诉求。
 *
 * 模型位置：/models/whisper/ggml-base-q5_1.bin（默认档位；可在「设置→本地模型」
 * 中切换/下载其它档位，由下载器写到用户可写目录，经双根托管以同名 URL 提供）。
 */
import { transcribeAudioBlob } from './whisperRuntime';

/** 默认模型路径（与 Phase1 下载器写入的文件名、lib.rs 侧车默认一致） */
export const WHISPER_MODEL_PATH = '/models/whisper/ggml-base-q5_1.bin';

/** 转写一段录音为文字；失败抛错（调用方应 catch 并提示） */
export function transcribeAudio(blob: Blob, modelPath: string = WHISPER_MODEL_PATH): Promise<string> {
  return transcribeAudioBlob(blob, modelPath);
}
