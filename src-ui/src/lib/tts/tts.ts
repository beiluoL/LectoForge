/**
 * 本地语音合成（TTS）统一封装。
 *
 * 当前引擎是浏览器的 window.speechSynthesis（Web Speech API）。它"人机感"重的根因：
 * 1) 默认会选到系统传统嗓音里质量最差的那一个；
 * 2) 无韵律控制（匀速、无自然停顿）。
 *
 * 本模块做三件事：
 *  - 列出本机「能说中文」的嗓音，按质量（neural / enhanced / standard）排序供设置页选择；
 *  - 持久化用户选中的嗓音（localStorage，按 name 存，换机回落最优）；
 *  - 提供 speakText：逐句串联 + 选中/优选嗓音 + 轻微降速 + 句间停顿，立刻更自然。
 *
 * ⚠️ 这是 B 阶段「快赢」：不引入新引擎。真正的去人机感靠后续本地神经网络 TTS（Piper）侧车。
 */

const STORAGE_KEY = 'lf.tts.voice'

export type TtsQuality = 'neural' | 'enhanced' | 'standard'

export interface TtsVoiceOption {
  name: string
  lang: string
  quality: TtsQuality
}

/** 预取嗓音；首次 getVoices 可能为空，监听 voiceschanged 兜底 */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return resolve([])
    const vs = window.speechSynthesis.getVoices()
    if (vs.length) return resolve(vs)
    const onChanged = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', onChanged)
      resolve(window.speechSynthesis.getVoices())
    }
    window.speechSynthesis.addEventListener('voiceschanged', onChanged)
    window.setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000)
  })
}

function classifyQuality(name: string): TtsQuality {
  const n = name.toLowerCase()
  if (/neural|siri/.test(n)) return 'neural'
  if (/enhanced|premium|plus/.test(n)) return 'enhanced'
  return 'standard'
}

function qualityRank(q: TtsQuality): number {
  return q === 'neural' ? 2 : q === 'enhanced' ? 1 : 0
}

/** 给设置页用的中文（及常用方言）嗓音列表，按质量降序 */
export async function listChineseVoices(): Promise<TtsVoiceOption[]> {
  const vs = await loadVoices()
  return vs
    .filter((v) => /^zh|cmn|yue/i.test(v.lang) || /chinese|mandarin/i.test(v.name))
    .map((v) => ({ name: v.name, lang: v.lang, quality: classifyQuality(v.name) }))
    .sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality))
}

export function getSelectedVoiceName(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function setSelectedVoiceName(name: string): void {
  try {
    if (name) localStorage.setItem(STORAGE_KEY, name)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
}

/**
 * 解析最终使用的嗓音：
 * 优先用户选中项；未选/失效则回落到质量最好的中文嗓音；都没有则首个可用嗓音。
 */
export async function resolveVoice(): Promise<SpeechSynthesisVoice | null> {
  const vs = await loadVoices()
  if (!vs.length) return null
  const sel = getSelectedVoiceName()
  if (sel) {
    const found = vs.find((v) => v.name === sel)
    if (found) return found
  }
  const zh = vs.filter((v) => /^zh|cmn/i.test(v.lang))
  const pool = zh.length ? zh : vs
  const sorted = [...pool].sort(
    (a, b) => qualityRank(classifyQuality(b.name)) - qualityRank(classifyQuality(a.name)),
  )
  return sorted[0] || null
}

/** 按中文标点切句，避免一次性长句不自然 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[，。！？；：、\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export interface SpeakOptions {
  /** 语速，默认 0.98（略慢更从容自然） */
  rate?: number
  /** 音高，默认 1 */
  pitch?: number
  /** 句间停顿毫秒，默认 120（避免黏连） */
  sentenceGapMs?: number
  /** 每句开始（可用于 UI 高亮） */
  onSentenceStart?: (text: string) => void
  /** 全部结束（含被打断） */
  onEnd?: () => void
}

/**
 * 统一朗读：逐句串联 + 选中/优选嗓音 + 韵律微调；开始前 cancel 清空上一段防堆叠。
 * 返回 Promise 在全部朗读完毕（或被打断）后 resolve。
 */
export async function speakText(text: string, opts: SpeakOptions = {}): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    opts.onEnd?.()
    return
  }
  const voice = await resolveVoice()
  const sentences = splitSentences(text)
  if (!sentences.length) {
    opts.onEnd?.()
    return
  }
  const rate = opts.rate ?? 0.98
  const pitch = opts.pitch ?? 1
  const gap = opts.sentenceGapMs ?? 120

  return new Promise<void>((resolve) => {
    window.speechSynthesis.cancel()
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      opts.onEnd?.()
      resolve()
    }
    let i = 0
    const speakNext = () => {
      if (i >= sentences.length) {
        done()
        return
      }
      const u = new SpeechSynthesisUtterance(sentences[i++])
      if (voice) u.voice = voice
      u.lang = voice?.lang || 'zh-CN'
      u.rate = rate
      u.pitch = pitch
      opts.onSentenceStart?.(u.text)
      u.onend = () => window.setTimeout(speakNext, gap)
      u.onerror = () => done()
      u.onboundary = null
      window.speechSynthesis.speak(u)
    }
    speakNext()
  })
}

export function cancelSpeech(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}
