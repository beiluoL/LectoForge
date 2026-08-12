/* =============================================================================
 * whisper.cpp emscripten WASM 的转写 Worker（classic worker，配合 importScripts）。
 *
 * 模型与 wasm 由侧车同源托管在 /models/whisper/（见 src-api/src/index.ts）。
 * 主线程把 16kHz 单声道 Float32 PCM 传进来，本 worker 加载 wasm 后调用转写 API。
 *
 * 注意：whisper.cpp 不同构建产物的 JS 胶水 API 略有差异，这里用最常见的
 *   const m = await whisper.createWhisper({ model }); await m.transcribe(samples, params)
 * 若你构建的 whisper.wasm 暴露的函数名不同（如 transcribeBuffer / generate），
 * 只需改下方这一处即可，调用方无需变动。
 * ===========================================================================*/
/* eslint-disable no-restricted-globals */
let whisperModule = null;
let model = null;

function loadWhisper() {
  if (whisperModule) return whisperModule;
  importScripts('/models/whisper/whisper.js');
  // emscripten 胶水通常把工厂挂到全局 whisper；兜底再找 Module
  whisperModule = self.whisper || self.Module || null;
  return whisperModule;
}

async function ensureModel(modelPath) {
  if (model) return model;
  const w = loadWhisper();
  if (!w || typeof w.createWhisper !== 'function') {
    throw new Error('whisper.js 未加载，请确认 /models/whisper/whisper.js 与 whisper.wasm 已就位');
  }
  model = await w.createWhisper({ model: modelPath });
  return model;
}

self.onmessage = async (e) => {
  const { id, pcm, modelPath } = e.data || {};
  try {
    const m = await ensureModel(modelPath);
    const res = await m.transcribe(pcm, { language: 'zh', translate: false });
    const text = (res && (res.text || res.result || '')) || '';
    self.postMessage({ id, ok: true, text: String(text) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) });
  }
};
