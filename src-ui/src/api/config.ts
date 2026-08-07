// 应用级配置 API 客户端：对接后端 /api/config 与 /api/config/init。
// 与 ai.ts 的差异：ai.ts 管的是 AI 服务参数视图；这里管的是「应用外壳」配置
// （是否完成引导 + 数据目录），并在 init 时把 AI 参数一并透传给后端统一保存。
import { apiGet, apiPost } from './request'

/** 后端返回的 AI 公共视图（apiKey 仅掩码，与 /api/ai/config 的子集一致） */
export interface AppAiView {
  enabled: boolean
  provider: string
  baseUrl: string
  model: string
  apiKeyMask: string
  configured: boolean
}

/** GET /api/config 的返回体 */
export interface AppConfigVO {
  hasOnboarded: boolean
  dataDir: string
  ai: AppAiView
}

/** POST /api/config/init 的请求体 */
export interface InitConfigPayload {
  dataDir: string
  aiSettings: {
    apiUrl: string
    /** 留空表示保持后端已保存的 Key 不变 */
    apiKey: string
    model: string
  }
  hasOnboarded: boolean
}

/** 读取应用配置（应用启动时调用，用于初始化 appStore） */
export function getAppConfig() {
  return apiGet<AppConfigVO>('/config')
}

/** 提交引导 / 设置结果：持久化数据目录、AI 参数与引导完成标记 */
export function initAppConfig(payload: InitConfigPayload) {
  return apiPost<AppConfigVO>('/config/init', payload)
}
