/* =============================================================================
 * whisper.cpp emscripten WASM 转写 Worker（classic worker，配合 importScripts）。
 *
 * 模型与 wasm 由侧车同源托管在 /models/whisper/（见 src-api/src/index.ts 双根托管）。
 * 主线程把 16kHz 单声道 Float32 PCM 传进来，本 worker 加载 wasm 后转写。
 *
 * whisper.cpp emscripten 胶水（whisper.js）真实 API：
 *   const Module = await whisper({ print, printErr, model });        // 工厂（可能叫 whisper / Module）
 *   Module.FS_createDataFile('/', 'model.bin', bytes, true, false);  // 模型写入 wasm FS
 *   const idx = Module.init('model.bin');                            // 载入模型
 *   Module.FS_createDataFile('/', 'audio.wav', wavBytes, ...);       // 音频（WAV）
 *   const text = Module.full_default(idx, pcm, lang, threads, translate); // 转写
 *   Module.free(idx);
 * 不同构建产物函数名略有差异（文本可能经 print 回调而非返回值），这里做了兜底兼容。
 * 具体以你构建的 whisper.wasm 为准。
 * ===========================================================================*/
/* eslint-disable no-restricted-globals */
let whisperModule = null;
let modelIndex = null;
let currentModelPath = null;

async function loadWhisperModule() {
  if (whisperModule) return whisperModule;
  importScripts('/models/whisper/whisper.js');
  const factory = self.whisper || self.Module;
  if (!factory || typeof factory !== 'function') {
    throw new Error('whisper.js 未加载，请确认 /models/whisper/whisper.js 与 whisper.wasm 已就位');
  }
  // whisper.cpp emscripten 通过 print 回调吐出逐段文本，集中收集作兜底
  const captured = [];
  whisperModule = await factory({
    print: (t) => { if (typeof t === 'string' && t.trim()) captured.push(t); },
    printErr: (t) => console.error('[whisper]', t),
  });
  whisperModule.__captured = captured;
  return whisperModule;
}

async function ensureModel(modelPath) {
  if (modelIndex !== null && currentModelPath === modelPath) return modelIndex;
  const Module = await loadWhisperModule();
  // 切换模型：先释放旧模型、清理旧 FS 文件，避免同名冲突
  if (modelIndex !== null) {
    try { Module.free(modelIndex); } catch (_) { /* noop */ }
    try { Module.FS_unlink('/model.bin'); } catch (_) { /* noop */ }
  }
  const res = await fetch(modelPath);
  if (!res.ok) throw new Error('模型下载失败: ' + modelPath + ' (HTTP ' + res.status + ')');
  const bytes = new Uint8Array(await res.arrayBuffer());
  Module.FS_createDataFile('/', 'model.bin', bytes, true, false, false);
  modelIndex = Module.init('model.bin');
  currentModelPath = modelPath;
  return modelIndex;
}

/** Float32 PCM (16kHz mono) → 16-bit PCM WAV 的 ArrayBuffer */
function pcmToWav(pcm) {
  const numSamples = pcm.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, 1, true);            // mono
  view.setUint32(24, 16000, true);        // sample rate
  view.setUint32(28, 16000 * 2, true);    // byte rate
  view.setUint16(32, 2, true);            // block align
  view.setUint16(34, 16, true);           // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buffer;
}

self.onmessage = async (e) => {
  const { id, pcm, modelPath } = e.data || {};
  try {
    const Module = await loadWhisperModule();
    const captured = Module.__captured;
    captured.length = 0;
    const idx = await ensureModel(modelPath);
    const wav = pcmToWav(pcm);
    Module.FS_createDataFile('/', 'audio.wav', new Uint8Array(wav), true, false, false);
    const threads = Math.min(4, (navigator.hardwareConcurrency || 4) | 0) || 1;
    let text = '';
    try {
      const ret = Module.full_default(idx, pcm, 'zh', threads, false);
      if (typeof ret === 'string') text = ret;
    } finally {
      try { Module.FS_unlink('/audio.wav'); } catch (_) { /* noop */ }
    }
    // 兜底：部分构建经 print 回调吐字
    if (!text && captured.length) text = captured.join('').trim();
    self.postMessage({ id, ok: true, text: String(text || '').trim() });
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) });
  }
};
