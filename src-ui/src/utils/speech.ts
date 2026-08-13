/**
 * 浏览器原生 TTS 封装（window.speechSynthesis）。
 *
 * 设计要点（踩坑沉淀）：
 * 1. macOS 限制：speechSynthesis 首次发声前，最好有一次用户手势触发或先 cancel() 唤醒底层语音服务，
 *    否则部分系统首句静默。故导出 warmUpSpeech() 在视图 onMounted 里调用一次。
 * 2. 打断机制：开始新朗读前必须 cancel() 上一句，避免多条 AI 回答的朗读重叠。
 * 3. 中文嗓音：macOS 可能未预装中文语音包，getVoices() 首调常为空，需等 voiceschanged 事件；
 *    选不到中文嗓音时退回默认嗓音，并在 UI 提示用户去系统设置安装（见下方 SPEECH_HINT）。
 */
import { ref } from 'vue';

/** macOS 未装中文语音包时的引导文案 */
export const SPEECH_HINT =
  '若听不到声音，请在 macOS「系统设置 → 辅助功能 → 语音」中添加中文（普通话）语音包。';

export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

/** 当前是否正在朗读（供 UI 切换 🔊 / ⏹ 图标） */
export const speaking = ref(false);

let cachedVoices: SpeechSynthesisVoice[] = [];

function cacheVoices() {
  if (!speechSupported) return;
  cachedVoices = window.speechSynthesis.getVoices() || [];
}
if (speechSupported) {
  cacheVoices();
  window.speechSynthesis.onvoiceschanged = cacheVoices;
}

/** 优先选中文嗓音（zh / Chinese），其次任意可用嗓音 */
function pickVoice(): SpeechSynthesisVoice | null {
  if (!cachedVoices.length) cacheVoices();
  const zh = cachedVoices.find((v) => /zh|cmn|Chinese/i.test(v.lang) || /中文|普通话/.test(v.name));
  return zh || cachedVoices[0] || null;
}

let currentUtterance: SpeechSynthesisUtterance | null = null;

/** 是否存在中文嗓音（用于 UI 提示用户去系统设置安装语音包） */
export function hasChineseVoice(): boolean {
  if (!speechSupported) return false;
  if (!cachedVoices.length) cacheVoices();
  return cachedVoices.some(
    (v) => /zh|cmn|Chinese/i.test(v.lang) || /中文|普通话/.test(v.name),
  );
}

/** 视图挂载时调用一次，唤醒底层语音服务（macOS 首句静默规避） */
export function warmUpSpeech(): void {
  if (!speechSupported) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* 忽略 */
  }
}

/** 打断当前朗读 */
export function cancelSpeak(): void {
  if (!speechSupported) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* 忽略 */
  }
  currentUtterance = null;
  speaking.value = false;
}

/**
 * 朗读文本。会先 cancel() 打断上一段，避免重叠。
 * @param text 要朗读的中文文本
 * @param onEnd 朗读自然结束后的回调（用于 UI 复位）
 */
export function speakText(text: string, onEnd?: () => void): void {
  if (!speechSupported || !text) return;
  // 打断上一句
  window.speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  const voice = pickVoice();
  if (voice) u.voice = voice;
  // 轻微降速，比原生匀速更自然、更清晰
  u.rate = 0.98;
  u.pitch = 1;

  u.onstart = () => {
    currentUtterance = u;
    speaking.value = true;
  };
  u.onend = () => {
    if (currentUtterance === u) {
      currentUtterance = null;
      speaking.value = false;
      onEnd?.();
    }
  };
  u.onerror = () => {
    if (currentUtterance === u) {
      currentUtterance = null;
      speaking.value = false;
    }
  };

  window.speechSynthesis.speak(u);
}
