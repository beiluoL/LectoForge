// TTS 音色 / 配置的前端 API 封装。
// JSON 类请求走 apiGet/apiPost/apiDelete（自动解包 .data）；
// SSE 下载走原生 fetch（不进 axios 拦截器），手动按 "\n\n" 切分 data: 行。
import { apiGet, apiPost, apiDelete } from './request'

export type VoiceStatus = 'available' | 'downloading' | 'downloaded'

export interface VoiceEntry {
  id: string
  file: string
  label: string
  sizeMB: number
  lang: string
  gender: string
  note: string
  default: boolean
  status: VoiceStatus
  downloadedPath: string | null
}

export type TtsEngine = 'browser' | 'piper'

export interface TtsConfig {
  engine: TtsEngine
  selectedVoiceId: string
  updatedAt: string
}

export interface DownloadEvent {
  type: 'progress' | 'done' | 'error'
  received?: number
  total?: number
  pct?: number
  path?: string
  message?: string
}

export function getTtsVoices(): Promise<VoiceEntry[]> {
  return apiGet('/tts-voices')
}
export function getTtsConfig(): Promise<TtsConfig> {
  return apiGet('/tts-voices/config')
}
export function saveTtsConfig(cfg: Partial<TtsConfig>): Promise<TtsConfig> {
  return apiPost('/tts-voices/config', cfg)
}
export function deleteTtsVoice(id: string): Promise<{ removed: boolean }> {
  return apiDelete(`/tts-voices/${id}`)
}

/** SSE 下载：原生 fetch + 读 res.body.getReader()，按 "\n\n" 切分 data: 行 */
export async function downloadTtsVoice(id: string, onProgress: (e: DownloadEvent) => void): Promise<string> {
  const res = await fetch(`/api/tts-voices/${encodeURIComponent(id)}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    let msg = `下载失败 (${res.status})`
    try {
      const j = await res.json()
      if (j?.message) msg = j.message
    } catch {
      /* noop */
    }
    throw new Error(msg)
  }
  if (!res.body) throw new Error('服务端未返回进度流')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let finalPath = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() || ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) continue
      const json = line.slice(5).trim()
      if (!json) continue
      const evt = JSON.parse(json) as DownloadEvent
      onProgress(evt)
      if (evt.type === 'done' && evt.path) finalPath = evt.path
      if (evt.type === 'error') throw new Error(evt.message || '下载失败')
    }
  }
  return finalPath
}
