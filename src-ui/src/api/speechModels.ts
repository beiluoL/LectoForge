// 离线语音模型接口封装（对应 src-api 的 /api/models 路由）。
// - getSpeechModels / getSpeechConfig / saveSpeechConfig 走常规 JSON 请求；
// - downloadSpeechModel 走 SSE（POST /api/models/:id/download），边下边回传进度。
import { apiGet, apiPost, apiDelete } from './request'

export type ModelStatus = 'available' | 'downloading' | 'downloaded'

export interface SpeechModelEntry {
  id: string
  tier: string
  file: string
  label: string
  sizeMB: number
  lang: string
  note: string
  default: boolean
  status: ModelStatus
  downloadedPath: string | null
}

export type SpeechRuntime = 'native' | 'wasm'

export interface SpeechConfig {
  runtime: SpeechRuntime
  selectedModelId: string
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

export function getSpeechModels(): Promise<SpeechModelEntry[]> {
  return apiGet('/models')
}
export function getSpeechConfig(): Promise<SpeechConfig> {
  return apiGet('/models/config')
}
export function saveSpeechConfig(cfg: Partial<SpeechConfig>): Promise<SpeechConfig> {
  return apiPost('/models/config', cfg)
}
export function deleteSpeechModel(id: string): Promise<{ removed: boolean }> {
  return apiDelete(`/models/${id}`)
}

/**
 * 下载模型（SSE 进度流）。onProgress 逐事件回调；done 事件携带落盘 path。
 * 用原生 fetch 消费 SSE（request 封装未覆盖流式场景）。
 */
export async function downloadSpeechModel(
  id: string,
  onProgress: (e: DownloadEvent) => void,
): Promise<string> {
  const res = await fetch(`/api/models/${encodeURIComponent(id)}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    let msg = `下载请求失败 (${res.status})`
    try {
      const j = (await res.json()) as { message?: string }
      if (j.message) msg = j.message
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
      try {
        const evt = JSON.parse(json) as DownloadEvent
        onProgress(evt)
        if (evt.type === 'done' && evt.path) finalPath = evt.path
        if (evt.type === 'error') throw new Error(evt.message || '下载失败')
      } catch (e) {
        if (e instanceof Error && e.message) throw e
      }
    }
  }
  return finalPath
}
