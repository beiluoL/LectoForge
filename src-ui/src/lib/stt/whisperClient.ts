/**
 * 离线语音转文字客户端（Whisper WASM）。
 *
 * 完全本地运行：录音 Blob → 解码为 16kHz 单声道 Float32 PCM → 交给 whisper.worker
 * 里的 whisper.cpp wasm 转写。零云 API、零外网，满足「离线」诉求。
 *
 * 模型位置：/models/whisper/ggml-base-q5_0.bin（由 scripts/fetch-models.sh 拉取，
 * 随 Tauri 打包进 .app）。改模型只需换文件名（如 ggml-small-q5_0.bin 中文更准）。
 */
import { transcribeAudioBlob } from './whisperRuntime';

/** 默认模型路径（与 fetch-models.sh 下载的文件名保持一致） */
export const WHISPER_MODEL_PATH = '/models/whisper/ggml-base-q5_0.bin';

/** 转写一段录音为文字；失败抛错（调用方应 catch 并提示） */
export function transcribeAudio(blob: Blob, modelPath: string = WHISPER_MODEL_PATH): Promise<string> {
  return transcribeAudioBlob(blob, modelPath);
}
