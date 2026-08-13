// Axios 实例与拦截器（桌面版）：与 Web 端 src/api/request.ts 保持同一解包契约，
// 差异仅在于桌面端为本机单用户场景，不附加 JWT、不做 401 跳转。
//
// 额外承担一件桌面端专属的事：**侧车断线的透明恢复**。
// Node 侧车崩溃时，Rust 宿主会在 2 秒后用同一端口把它拉起来；这段空窗期里
// 所有 /api 请求都会变成 ERR_NETWORK。这里不把错误抛给业务层，而是挂起请求、
// 挂出全局遮罩、退避轮询 /api/health，恢复后原样重放，用户只会看到一次短暂的等待。
import axios, { type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios'
import type { ApiResult } from './types'
import {
  ensureBackendAlive,
  isBackendDownError,
  isTimeoutError,
  probeHealth,
} from '@/utils/connection'

/** 单个请求最多因断线重放的次数，防止后端持续半死不活时无限重发 */
const MAX_REPLAY = 3

/** 内部标记：记录某个请求已经被断线重放过几次 */
interface RetryableConfig extends InternalAxiosRequestConfig {
  __replayCount?: number
}

const request = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

// 响应拦截器：解包 Result<T>，统一透传业务错误
request.interceptors.response.use(
  (response) => {
    const res = response.data as { code?: number; message?: string; aiCode?: string }
    if (res && res.code !== undefined && res.code !== 200) {
      // 把后端业务码（如 AI_NOT_CONFIGURED）挂到错误对象上，便于调用方差异化处理
      const err = new Error(res.message || '请求失败')
      ;(err as Error & { aiCode?: string }).aiCode = res.aiCode
      return Promise.reject(err)
    }
    return response.data
  },
  async   (error) => {
    const config = error.config as RetryableConfig | undefined
    /* ===== 断线恢复分支 =====
     * 条件：没有 response（后端根本没应答）+ 请求可重放 + 未超过重放上限。
     * 注意 ensureBackendAlive() 是全局单例任务，并发失败的请求会共享同一轮轮询，
     * 不会出现十几个请求各开一条探活风暴。 */
    if (config && shouldAttemptReconnect(error)) {
      const replayed = config.__replayCount ?? 0
      if (replayed < MAX_REPLAY) {
        const recovered = await handleDisconnected(error)
        if (recovered) {
          config.__replayCount = replayed + 1
          // 后端已恢复：用与首发完全一致的方式重新派发该请求，业务层完全无感。
          // 不直接 request.request(error.config) —— 失败请求的 config 已经被 axios
          // 派发流程改过（baseURL 合并、url 可能被写成绝对地址等），再次原样重放
          // 会触发「绝对地址被当成请求行原样发出 / 前缀翻倍」等坑。
          // 这里只取 method + 原始相对 url，走公共 request.get/post/... 重新发一次，
          // URL 组合与首发的那次请求逐字节相同。
          return replayRequest(config)
        }
      }
      return Promise.reject(new Error('知识引擎未响应，请稍后重试'))
    }

    // 透传后端业务错误信息，避免展示 axios 原始英文报错
    const bizData = error.response?.data as { message?: string; aiCode?: string } | undefined
    if (bizData?.message) {
      // 同上：保留 aiCode，使「未配置 AI」等场景能被前端识别并引导去设置页
      const err = new Error(bizData.message)
      ;(err as Error & { aiCode?: string }).aiCode = bizData.aiCode
      return Promise.reject(err)
    }
    return Promise.reject(error)
  },
)

/** 是否值得进入断线恢复流程 */
function shouldAttemptReconnect(error: unknown): boolean {
  return isBackendDownError(error) || isTimeoutError(error)
}

/**
 * 进入断线恢复：
 * - 纯超时先探一次 health，后端活着就说明是慢请求，交回业务层按超时处理；
 * - 确认后端不在，才挂遮罩并启动指数退避轮询。
 */
async function handleDisconnected(error: unknown): Promise<boolean> {
  if (isTimeoutError(error) && (await probeHealth())) return false
  return ensureBackendAlive()
}

/**
 * 以「首发同款」方式重新派发一个请求。
 * 只使用 error.config 里稳定的 method / url / data / params / headers，
 * 重新走 request.get/post/put/patch/delete，让 axios 像第一次那样
 * 从实例默认 baseURL 继承并组合 URL（桌面端相对 /api，Node 测试绝对地址，皆可），
 * 避免直接重放被派发流程改过的 config 导致的各种 URL 异常。
 */
function replayRequest(config: RetryableConfig): Promise<unknown> {
  const method = (config.method || 'get').toLowerCase()
  const url = config.url || ''
  const headers = config.headers
  switch (method) {
    case 'post':
      return request.post(url, config.data, { headers })
    case 'put':
      return request.put(url, config.data, { headers })
    case 'patch':
      return request.patch(url, config.data, { headers })
    case 'delete':
      return request.delete(url, { params: config.params, data: config.data, headers })
    default:
      return request.get(url, { params: config.params, headers })
  }
}

// 类型安全的请求助手（response 已被拦截器解包为 ApiResult<T>）
export async function apiGet<T>(url: string, params?: object): Promise<T> {
  const res = await request.get(url, { params })
  return (res as unknown as ApiResult<T>).data
}

export async function apiPost<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const res = await request.post(url, data, config)
  return (res as unknown as ApiResult<T>).data
}

export async function apiPut<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const res = await request.put(url, data, config)
  return (res as unknown as ApiResult<T>).data
}

export async function apiDelete<T>(url: string, params?: object, config?: AxiosRequestConfig): Promise<T> {
  const res = await request.delete(url, { params, ...config })
  return (res as unknown as ApiResult<T>).data
}

/** 带 body 的 DELETE 调用（用于批量删除等需要 JSON 负载的场景） */
export async function apiDeleteWithBody<T>(
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await request.request({
    url,
    method: 'DELETE',
    data,
    ...config,
  })
  return (res as unknown as ApiResult<T>).data
}

export default request
