// 后端连接状态机：侧车崩溃 / 重启期间的探活、退避轮询与恢复通知。
//
// 桌面版的页面本身由 Node 侧车同源托管（origin = http://127.0.0.1:<port>），
// 侧车挂掉时页面还活着，只是所有 /api 请求瞬间变成 ERR_NETWORK。
// 宿主（Rust SidecarManager）会在 2 秒后自动把它拉起来并复用同一个端口，
// 所以前端要做的不是报错崩掉，而是「挂遮罩 → 退避轮询 → 恢复后静默重放请求」。
import { reactive } from 'vue'
import axios from 'axios'

export type ConnectionStatus = 'online' | 'reconnecting'

export const connectionState = reactive({
  /** 当前连接状态，遮罩组件据此显隐 */
  status: 'online' as ConnectionStatus,
  /** 本轮重连已尝试次数（恢复后归零） */
  attempt: 0,
  /** 下一次探活的等待毫秒数，供 UI 展示 */
  nextDelayMs: 0,
  /** 断线起始时间戳，用于展示已断线时长 */
  offlineSince: 0,
  /** 后端是否换了实例（bootId 变化 = 侧车被重启过） */
  backendRestarted: false,
})

/** 健康检查端点：Fastify 提供，返回 { code:200, data:{ status:'ok', service, bootId } } */
const HEALTH_URL = '/api/health'
/** 指数退避阶梯：0.5s → 1s → 2s → 4s → 8s，之后固定 8s 持续重试 */
const BACKOFF_STEPS = [500, 1000, 2000, 4000, 8000]
/** 单次探活超时：后端刚起来时可能慢，但 3 秒足够回一个 health */
const PROBE_TIMEOUT = 3000

/* 探活必须用**裸 axios 实例**：它不能挂全局拦截器。
 * 否则探活自己失败时又会触发一轮重连逻辑，形成自我递归。 */
const probeClient = axios.create({ timeout: PROBE_TIMEOUT })

let lastBootId: string | null = null
/** 全局唯一的重连任务：并发失败的多个请求共享同一次轮询，不会打出 N 条探活风暴 */
let reconnectTask: Promise<boolean> | null = null
/** 可提前唤醒的 sleep 句柄，供「立即重试」按钮打断退避等待 */
let wake: (() => void) | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      wake = null
      resolve()
    }, ms)
    wake = () => {
      window.clearTimeout(timer)
      wake = null
      resolve()
    }
  })
}

/**
 * 单次健康探测。返回 true 表示后端确实是我们要找的那个服务。
 * 只看 HTTP 200 不够——端口上可能坐着别的程序，必须校验 service 标识。
 */
export async function probeHealth(): Promise<boolean> {
  try {
    const res = await probeClient.get(HEALTH_URL, { params: { _t: Date.now() } })
    // 后端统一信封 { code, data }，兼容裸响应
    const payload = (res.data?.data ?? res.data) as
      | { service?: string; bootId?: string }
      | undefined
    if (res.status !== 200 || payload?.service !== 'knowflow-desktop-api') return false

    const bootId = payload.bootId ? String(payload.bootId) : ''
    if (bootId) {
      if (lastBootId && bootId !== lastBootId) connectionState.backendRestarted = true
      lastBootId = bootId
    }
    return true
  } catch {
    return false
  }
}

/**
 * 应用启动时调用一次：建立「后端实例基线」（记录当前 bootId）。
 * 这样后续若宿主把侧车重启、bootId 变化，probeHealth 才能准确识别
 * 「后端换了实例」并置 backendRestarted=true；否则首次重启会因没有基线
 * 而漏判。非桌面环境（无后端）下 probeHealth 自然返回 false，无副作用。
 */
export async function initBackendHealth(): Promise<void> {
  await probeHealth()
}

/**
 * 确保后端可用：
 * - 已在线 → 立即返回 true
 * - 已有重连任务在跑 → 复用同一个 Promise（并发请求共享）
 * - 否则开启一轮指数退避轮询，直到后端恢复
 *
 * 不设失败上限：宿主侧 SidecarManager 也是无限重启策略，
 * 前端先放弃只会让用户看到一个死界面。用户想干预可以点遮罩上的按钮。
 */
export function ensureBackendAlive(): Promise<boolean> {
  if (reconnectTask) return reconnectTask
  reconnectTask = runReconnectLoop().finally(() => {
    reconnectTask = null
  })
  return reconnectTask
}

async function runReconnectLoop(): Promise<boolean> {
  connectionState.status = 'reconnecting'
  connectionState.attempt = 0
  connectionState.offlineSince = Date.now()
  connectionState.backendRestarted = false

  for (;;) {
    const delay = BACKOFF_STEPS[Math.min(connectionState.attempt, BACKOFF_STEPS.length - 1)]
    connectionState.nextDelayMs = delay
    connectionState.attempt += 1
    await sleep(delay)

    if (await probeHealth()) {
      connectionState.status = 'online'
      connectionState.attempt = 0
      connectionState.nextDelayMs = 0
      return true
    }
  }
}

/** 遮罩上的「立即重试」：打断当前退避等待，马上探一次 */
export function retryNow(): void {
  wake?.()
}

/**
 * 遮罩上的「重启知识引擎」：请宿主杀掉当前侧车，
 * 监控线程 wait() 返回后会按既有策略自动拉起新实例。
 * 浏览器预览模式下没有 Tauri IPC，静默降级为一次立即重试。
 */
export async function restartEngine(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('restart_sidecar')
  } catch {
    /* 非桌面环境或命令不可用，退化为立即重试 */
  }
  retryNow()
}

/** 判断一个 axios 错误是不是「后端不在了」而非业务错误 */
export function isBackendDownError(error: unknown): boolean {
  const err = error as {
    response?: unknown
    code?: string
    message?: string
    config?: { method?: string }
  }
  // 有响应就说明后端还活着，那是业务错误，不归重连管
  if (err?.response) return false
  const code = err?.code ?? ''
  if (code === 'ERR_CANCELED') return false
  if (
    code === 'ERR_NETWORK' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'ERR_CONNECTION_REFUSED'
  ) {
    return true
  }
  // 超时（ECONNABORTED）单独走一次探活判定，避免把「慢请求」误判成断线
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return false
  return /network error/i.test(err?.message ?? '')
}

/** 超时错误：需要额外探一次 health 才能判断到底是后端死了还是请求本身慢 */
export function isTimeoutError(error: unknown): boolean {
  const code = (error as { code?: string })?.code ?? ''
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT'
}
