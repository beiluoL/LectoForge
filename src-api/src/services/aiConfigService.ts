/**
 * AI 配置中心服务：读写 LLM / Embeddings 配置、连通性探测、轻量状态查询。
 * 配置本身由 lib/llm 持久化，本层只做编排，不碰数据库。
 */
import {
  EMBEDDING_PRESETS,
  PROVIDER_PRESETS,
  isReady,
  ping,
  publicConfig,
  readConfig,
  saveConfig,
  type LlmConfig,
} from '../lib/llm';
import type { AiStatusVO } from '../types/ai';

/** 读取当前 AI 配置（Key 脱敏）与服务商预设 */
export function getConfigWithPresets() {
  return {
    ...publicConfig(),
    presets: Object.entries(PROVIDER_PRESETS).map(([value, p]) => ({ value, ...p })),
    embeddingPresets: Object.entries(EMBEDDING_PRESETS).map(([value, p]) => ({ value, ...p })),
  };
}

/** 保存 AI 配置。apiKey 留空表示保持原值，传 null 表示清空。 */
export function updateConfig(patch: Partial<LlmConfig> & { apiKey?: string | null }) {
  const saved = saveConfig(patch);
  return publicConfig(saved);
}

/**
 * 连通性测试。可传临时配置（未保存即测试），传了就用临时的，没传就用已保存的。
 * apiKey 留空时回落到已保存的 Key，避免为了测试必须重填。
 */
export async function testConnection(b: Partial<LlmConfig>) {
  const cur = readConfig();
  const temp: LlmConfig = {
    enabled: true,
    provider: (b.provider as LlmConfig['provider']) || cur.provider,
    baseUrl: (b.baseUrl || cur.baseUrl || '').trim(),
    apiKey: (b.apiKey || '').trim() || cur.apiKey,
    model: (b.model || cur.model || '').trim(),
    temperature: cur.temperature,
    timeoutMs: b.timeoutMs || cur.timeoutMs,
    embeddingsBaseUrl: cur.embeddingsBaseUrl,
    embeddingsApiKey: cur.embeddingsApiKey,
    embeddingsModel: cur.embeddingsModel,
  };
  return ping(temp);
}

/** 轻量状态查询，供各页面决定是否展示 AI 按钮（不发起网络请求） */
export function getStatus(): AiStatusVO {
  const cfg = readConfig();
  return { ready: isReady(cfg), enabled: cfg.enabled, model: cfg.model, provider: cfg.provider };
}
