// SSE 消费助手（桌面端面试/语音通话专用）。
//
// 为什么不用 EventSource：面试流每一轮都是独立的 POST（携带 sessionId / 录音文本），
// 而浏览器原生 EventSource 只支持 GET，无法携带请求体。这里改用
// fetch + ReadableStream reader + TextDecoder 手动解析 `text/event-stream`。
//
// 约定（与后端 src-api/src/routes/interview.ts 手写 reply.raw 对齐）：
//   单个事件块以空行（\n\n）分隔，块内逐行 `event: <name>` / `data: <json>`。
//   data 行为 JSON 字符串；解析失败则原样透传字符串，不阻塞后续事件。
//
// 取消：调用方传入 { signal }（AbortController.signal），reader 抛 AbortError 时
// 生成器自然结束；连接类错误（非 2xx / 无 body）直接 throw，交由业务层捕获提示。
import type { ApiResult } from './types'

/** 单个解析出的 SSE 事件 */
export interface SseEvent {
  /** 事件名，缺省为 'message'（与 SSE 规范一致） */
  event: string
  /** data 行 JSON.parse 后的对象；解析失败则为原始字符串 */
  data: unknown
}

export interface SseOptions extends Omit<RequestInit, 'method' | 'body'> {
  /** 附加到请求头的字段（baseURL 由本助手统一拼接，不在此传递） */
  headers?: Record<string, string>
}

/**
 * 以 POST 消费 SSE 流，逐事件 yield。
 * @param url   相对路径（如 '/interview/start'），自动按 /api 前缀拼接；
 *              已带 http(s) 或 /api 前缀时原样使用。
 * @param body  请求体；FormData 原样发送（multipart），其它对象 JSON 序列化，undefined 不发送。
 * @param options 透传 fetch 选项（signal / 额外 headers 等），method/body 由本函数接管。
 */
export async function* postSSE(
  url: string,
  body?: unknown,
  options: SseOptions = {},
): AsyncGenerator<SseEvent> {
  const fullUrl = url.startsWith('http')
    ? url
    : url.startsWith('/api')
      ? url
      : `/api${url}`

  let bodyInit: BodyInit | undefined
  const headers: Record<string, string> = { ...(options.headers || {}) }
  if (body instanceof FormData) {
    bodyInit = body
    // 让浏览器/fetch 自行设置 multipart boundary
  } else if (body !== undefined) {
    bodyInit = JSON.stringify(body)
    headers['Content-Type'] = 'application/json'
  }

  let resp: Response
  try {
    resp = await fetch(fullUrl, {
      method: 'POST',
      body: bodyInit,
      headers,
      signal: options.signal,
    })
  } catch (e) {
    // AbortController 主动取消：当作正常结束，不抛错
    if (e instanceof DOMException && e.name === 'AbortError') return
    throw e
  }

  if (!resp.ok || !resp.body) {
    // 尽量读取后端返回的明文错误信息
    let message = `SSE 连接失败（${resp.status}）`
    try {
      const text = await resp.text()
      const parsed = safeJson<ApiResult<unknown>>(text)
      if (parsed?.message) message = parsed.message
      else if (text) message = text
    } catch {
      /* 忽略读取错误 */
    }
    throw new Error(message)
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // 按事件块边界（连续两个换行）切分，可能一次读出多个块
      let sep: number
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawBlock = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const ev = parseBlock(rawBlock)
        if (ev) yield ev
      }
    }
    // 流式结束，冲刷残留（无尾随空行的兜底）
    if (buffer.trim()) {
      const ev = parseBlock(buffer)
      if (ev) yield ev
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return
    throw e
  } finally {
    try {
      reader.cancel()
    } catch {
      /* 已结束，忽略 */
    }
  }
}

/** 解析单个 SSE 块（可能含 id:/event:/data: 多行）；无 data 则返回 null */
function parseBlock(raw: string): SseEvent | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      // data: 后允许一个前导空格（SSE 规范）
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
    // retry: / id: / 注释行（: 开头）均忽略
  }
  if (dataLines.length === 0) return null
  const dataStr = dataLines.join('\n')
  let data: unknown = dataStr
  try {
    data = JSON.parse(dataStr)
  } catch {
    /* 保持原始字符串 */
  }
  return { event, data }
}

function safeJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}
