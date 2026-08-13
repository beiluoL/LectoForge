// TTS 统一分发器：按 tts-config.json 的 engine 字段选择朗读引擎。
//
// - engine = 'piper'  → 调后端 /api/tts/synthesize（本地神经网络 VITS，全离线、最自然）；
//                       拿到 WAV 二进制后用 <audio> 播放。
// - engine = 'browser'→ 走系统 Web Speech（@/lib/tts/tts 的 speakText，零依赖、立即可用）。
//
// 每次 synthesize() 实时读取配置（不缓存），使设置页切换引擎立即生效，
// 与 sttDispatch 的「切换即生效」策略一致。piper 调用失败会自动回退 browser，保证朗读不中断。
import { getTtsConfig, type TtsConfig } from '@/api/ttsVoices'
import { speakText, cancelSpeech } from '@/lib/tts/tts'

const PIPER_SYNTH = '/api/tts/synthesize'

// 跟踪当前正在播放的 <audio>，便于 stopSynthesis 中断
let currentAudio: HTMLAudioElement | null = null

async function playPiperWav(text: string, voiceId: string): Promise<void> {
  const res = await fetch(PIPER_SYNTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voiceId }),
  })
  if (!res.ok) {
    let msg = ''
    try {
      const j = await res.json()
      msg = j?.message || ''
    } catch {
      /* noop */
    }
    throw new Error(msg || `Piper 合成失败 (${res.status})`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  try {
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio()
      currentAudio = audio
      audio.src = url
      audio.onended = () => resolve()
      audio.onerror = () => reject(new Error('音频播放失败'))
      audio.play().catch(reject)
    })
  } finally {
    URL.revokeObjectURL(url)
    if (currentAudio && (currentAudio as HTMLAudioElement).src === url) currentAudio = null
  }
}

/** 中断当前朗读（同时作用于 Piper 音频与浏览器语音） */
export function stopSynthesis() {
  if (currentAudio) {
    try {
      currentAudio.pause()
    } catch {
      /* noop */
    }
    currentAudio = null
  }
  // 浏览器引擎走 window.speechSynthesis，需单独 cancel
  cancelSpeech()
}

/**
 * 统一合成入口（供面试朗读 / 笔记朗读复用）。
 * @param text 待朗读文本
 */
export async function synthesize(text: string): Promise<void> {
  let cfg: TtsConfig
  try {
    cfg = await getTtsConfig()
  } catch {
    cfg = { engine: 'browser', selectedVoiceId: 'zh_CN-huayan-medium', updatedAt: '' }
  }

  if (cfg.engine === 'piper') {
    try {
      await playPiperWav(text, cfg.selectedVoiceId)
      return
    } catch (e) {
      console.warn('[tts] Piper 合成失败，回退系统语音:', e)
    }
  }
  // 兜底：系统 Web Speech
  await speakText(text)
}
