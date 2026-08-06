import fs from 'node:fs';
import path from 'node:path';

import { getAiConfigPath } from './paths';

/**
 * LLM 配置中心（P0）
 *
 * 设计要点：
 * 1. 配置落盘在数据目录（与 workbench.db 同级），文件权限 600，且 src-api/data/ 已被 .gitignore 忽略，
 *    避免 API Key 进入版本库。
 * 2. 只依赖 Node 22 原生 fetch，不引入任何 SDK，保持桌面端体积与离线可用性。
 * 3. 协议统一走 OpenAI 兼容的 /chat/completions，DeepSeek / OpenAI / 任意兼容网关均可直接切换。
 * 4. 未配置 Key、网络不可达、超时等场景统一抛 LlmError，由路由层降级为业务可读的错误码，
 *    保证「没有 AI 也能照常用」的离线优先原则。
 */

/** 支持的服务商预设 */
export type LlmProvider = 'deepseek' | 'openai' | 'custom';

export interface LlmConfig {
  /** 总开关，关闭后所有 AI 端点直接返回未启用 */
  enabled: boolean;
  provider: LlmProvider;
  /** OpenAI 兼容的 API 根地址，不含 /chat/completions */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 采样温度，0~2，越低越稳定 */
  temperature: number;
  /** 单次请求超时（毫秒） */
  timeoutMs: number;
  /**
   * 向量化（embedding）配置 —— 可选。
   * 聊天模型（如 DeepSeek）多数不提供 embeddings 端点，因此向量检索（G3 内容关联）可单独配置一个
   * OpenAI 兼容的 /embeddings 服务（如 SiliconFlow 的 BAAI/bge-m3）。向量只在本机 SQLite 计算与存储，
   * 相似度也在本地 JS 中完成，符合「本地 embedding + 向量相似度」的离线优先原则。
   * 未配置时 G3 功能优雅降级为提示引导，不影响任何主流程。
   */
  embeddingsBaseUrl: string;
  embeddingsApiKey: string;
  embeddingsModel: string;
}

/** 服务商预设，供前端下拉选择时一键填充 */
export const PROVIDER_PRESETS: Record<LlmProvider, { label: string; baseUrl: string; model: string }> = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  custom: { label: '自定义（OpenAI 兼容）', baseUrl: '', model: '' },
};

/** 向量化服务商预设（与聊天服务解耦，可独立配置） */
export const EMBEDDING_PRESETS: Record<string, { label: string; baseUrl: string; model: string }> = {
  siliconflow: { label: 'SiliconFlow (BAAI/bge-m3)', baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3' },
  openai: { label: 'OpenAI (text-embedding-3-small)', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small' },
  custom: { label: '自定义（OpenAI 兼容）', baseUrl: '', model: '' },
};

/** 文件名常量已收敛到 lib/paths.getAiConfigPath()，此处仅保留注释便于检索：ai-config.json */

const DEFAULT_CONFIG: LlmConfig = {
  enabled: true,
  provider: 'deepseek',
  baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
  apiKey: '',
  model: PROVIDER_PRESETS.deepseek.model,
  temperature: 0.3,
  timeoutMs: 45000,
  // 向量化默认不配置（与聊天服务解耦），由用户在设置页按需开启
  embeddingsBaseUrl: '',
  embeddingsApiKey: '',
  embeddingsModel: '',
};

/** AI 相关错误码，前端据此做差异化提示与降级 */
export type LlmErrorCode =
  | 'AI_DISABLED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_TIMEOUT'
  | 'AI_UPSTREAM_ERROR'
  | 'AI_BAD_RESPONSE';

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly status: number;

  constructor(code: LlmErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
  }
}

/** <dataDir>/ai-config.json —— 目录不存在时由 paths 自动创建 */
function configPath(): string {
  return getAiConfigPath();
}

/** 写盘并收紧权限；权限设置失败（如 Windows）不阻断主流程。 */
function writeConfigFile(cfg: LlmConfig): void {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* 非 POSIX 平台忽略 */
  }
}

/** 数值兜底：非法值回落默认值，并限制在合理区间。 */
function clampNumber(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 读取配置。文件不存在时用默认值初始化并落盘；
 * 环境变量 KNOWFLOW_AI_KEY / KNOWFLOW_AI_MODEL / KNOWFLOW_AI_BASE_URL 优先级最高（便于 CI 与临时覆盖）。
 */
export function readConfig(): LlmConfig {
  const file = configPath();
  let cfg: LlmConfig = { ...DEFAULT_CONFIG };
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LlmConfig>;
      cfg = {
        enabled: raw.enabled !== false,
        provider: (raw.provider as LlmProvider) || DEFAULT_CONFIG.provider,
        baseUrl: (raw.baseUrl || DEFAULT_CONFIG.baseUrl).trim(),
        apiKey: (raw.apiKey || '').trim(),
        model: (raw.model || DEFAULT_CONFIG.model).trim(),
        temperature: clampNumber(raw.temperature, DEFAULT_CONFIG.temperature, 0, 2),
        timeoutMs: clampNumber(raw.timeoutMs, DEFAULT_CONFIG.timeoutMs, 5000, 180000),
        embeddingsBaseUrl: (raw.embeddingsBaseUrl || DEFAULT_CONFIG.embeddingsBaseUrl).trim(),
        embeddingsApiKey: (raw.embeddingsApiKey || DEFAULT_CONFIG.embeddingsApiKey).trim(),
        embeddingsModel: (raw.embeddingsModel || DEFAULT_CONFIG.embeddingsModel).trim(),
      };
    } catch {
      cfg = { ...DEFAULT_CONFIG };
    }
  } else {
    writeConfigFile(cfg);
  }

  if (process.env.KNOWFLOW_AI_KEY) cfg.apiKey = process.env.KNOWFLOW_AI_KEY;
  if (process.env.KNOWFLOW_AI_MODEL) cfg.model = process.env.KNOWFLOW_AI_MODEL;
  if (process.env.KNOWFLOW_AI_BASE_URL) cfg.baseUrl = process.env.KNOWFLOW_AI_BASE_URL;
  return cfg;
}

/** 保存配置（增量合并）。apiKey 传空字符串表示「保持原值」，传 null 表示「清空」。 */
export function saveConfig(patch: Partial<LlmConfig> & { apiKey?: string | null }): LlmConfig {
  const cur = readConfig();
  const next: LlmConfig = {
    enabled: patch.enabled !== undefined ? !!patch.enabled : cur.enabled,
    provider: (patch.provider as LlmProvider) || cur.provider,
    baseUrl: patch.baseUrl !== undefined ? String(patch.baseUrl).trim() : cur.baseUrl,
    apiKey: cur.apiKey,
    model: patch.model !== undefined ? String(patch.model).trim() : cur.model,
    temperature: patch.temperature !== undefined
      ? clampNumber(patch.temperature, cur.temperature, 0, 2)
      : cur.temperature,
    timeoutMs: patch.timeoutMs !== undefined
      ? clampNumber(patch.timeoutMs, cur.timeoutMs, 5000, 180000)
      : cur.timeoutMs,
    embeddingsBaseUrl: patch.embeddingsBaseUrl !== undefined ? String(patch.embeddingsBaseUrl).trim() : cur.embeddingsBaseUrl,
    embeddingsApiKey: cur.embeddingsApiKey,
    embeddingsModel: patch.embeddingsModel !== undefined ? String(patch.embeddingsModel).trim() : cur.embeddingsModel,
  };
  if (patch.apiKey === null) next.apiKey = '';
  else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) next.apiKey = patch.apiKey.trim();
  if (patch.embeddingsApiKey === null) next.embeddingsApiKey = '';
  else if (typeof patch.embeddingsApiKey === 'string' && patch.embeddingsApiKey.trim()) {
    next.embeddingsApiKey = patch.embeddingsApiKey.trim();
  }
  if (!next.embeddingsBaseUrl && next.embeddingsModel) {
    // 仅填了模型未填地址时，尝试按 embeddings 预设兜底
    const preset = Object.values(EMBEDDING_PRESETS).find((p) => p.model === next.embeddingsModel);
    if (preset?.baseUrl) next.embeddingsBaseUrl = preset.baseUrl;
  }

  // 未填 baseUrl / model 时按服务商预设兜底，避免保存出不可用配置
  const preset = PROVIDER_PRESETS[next.provider];
  if (!next.baseUrl && preset?.baseUrl) next.baseUrl = preset.baseUrl;
  if (!next.model && preset?.model) next.model = preset.model;

  writeConfigFile(next);
  return next;
}

/** Key 脱敏：sk-abcd…wxyz，前端只展示掩码，不回传明文。 */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 10) return `${key.slice(0, 2)}****`;
  return `${key.slice(0, 6)}****${key.slice(-4)}`;
}

/** 对外暴露的安全配置视图（不含明文 Key） */
export function publicConfig(cfg = readConfig()) {
  return {
    enabled: cfg.enabled,
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    temperature: cfg.temperature,
    timeoutMs: cfg.timeoutMs,
    apiKeyMask: maskKey(cfg.apiKey),
    configured: !!cfg.apiKey && !!cfg.baseUrl && !!cfg.model,
    embeddingsModel: cfg.embeddingsModel,
    embeddingsConfigured: !!cfg.embeddingsBaseUrl && !!cfg.embeddingsApiKey && !!cfg.embeddingsModel,
  };
}

/** AI 是否可用（开关打开 + Key/地址/模型齐备） */
export function isReady(cfg = readConfig()): boolean {
  return cfg.enabled && !!cfg.apiKey && !!cfg.baseUrl && !!cfg.model;
}

/** 向量化是否可用（与聊天服务独立判断） */
export function embeddingsReady(cfg = readConfig()): boolean {
  return !!cfg.embeddingsBaseUrl && !!cfg.embeddingsApiKey && !!cfg.embeddingsModel;
}

export interface EmbeddingConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/** 取向量化配置（与聊天配置解耦） */
export function readEmbeddingConfig(cfg = readConfig()): EmbeddingConfig {
  return { baseUrl: cfg.embeddingsBaseUrl, apiKey: cfg.embeddingsApiKey, model: cfg.embeddingsModel };
}

/** 校验可用性，不可用直接抛 LlmError（供路由层统一 catch） */
export function assertReady(cfg = readConfig()): LlmConfig {
  if (!cfg.enabled) throw new LlmError('AI_DISABLED', 'AI 功能已关闭，可在「AI 设置」中开启', 409);
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
    throw new LlmError('AI_NOT_CONFIGURED', '尚未配置 AI 服务，请先前往「AI 设置」填写 API Key', 409);
  }
  return cfg;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** 要求服务端返回严格 JSON（DeepSeek / OpenAI 均支持 response_format） */
  json?: boolean;
  timeoutMs?: number;
  config?: LlmConfig;
}

export interface ChatResult {
  content: string;
  model: string;
  /** 端到端耗时（毫秒） */
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
}

function joinUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${suffix}`;
}

/** 调用 OpenAI 兼容的 chat/completions。 */
export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
  const cfg = assertReady(options.config ?? readConfig());
  const timeoutMs = options.timeoutMs ?? cfg.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages,
      temperature: options.temperature ?? cfg.temperature,
      stream: false,
    };
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (options.json) body.response_format = { type: 'json_object' };

    const resp = await fetch(joinUrl(cfg.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new LlmError(
        'AI_UPSTREAM_ERROR',
        `AI 服务返回 ${resp.status}${text ? `：${text.slice(0, 300)}` : ''}`,
        502,
      );
    }

    const data = (await resp.json()) as any;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new LlmError('AI_BAD_RESPONSE', 'AI 返回内容为空', 502);
    }
    return {
      content: content.trim(),
      model: data?.model || cfg.model,
      latencyMs: Date.now() - started,
      promptTokens: data?.usage?.prompt_tokens,
      completionTokens: data?.usage?.completion_tokens,
    };
  } catch (e: any) {
    if (e instanceof LlmError) throw e;
    if (e?.name === 'AbortError') {
      throw new LlmError('AI_TIMEOUT', `AI 请求超时（${timeoutMs}ms），请检查网络或调大超时时间`, 504);
    }
    throw new LlmError('AI_UPSTREAM_ERROR', `AI 请求失败：${e?.message || e}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

/** 从模型输出中抠出 JSON：兼容 ```json 围栏与前后闲聊文字。 */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) return body.trim();
  const openChar = body[start];
  const closeChar = openChar === '{' ? '}' : ']';
  const end = body.lastIndexOf(closeChar);
  if (end <= start) return body.slice(start).trim();
  return body.slice(start, end + 1).trim();
}

/** 调用模型并解析为 JSON 对象，解析失败抛 AI_BAD_RESPONSE。 */
export async function chatJson<T>(messages: ChatMessage[], options: ChatOptions = {}): Promise<{ data: T; raw: ChatResult }> {
  const raw = await chat(messages, { ...options, json: true });
  try {
    return { data: JSON.parse(extractJson(raw.content)) as T, raw };
  } catch {
    throw new LlmError('AI_BAD_RESPONSE', 'AI 返回内容不是合法 JSON，请重试或更换模型', 502);
  }
}

/** 向量化：调用 OpenAI 兼容的 /embeddings，返回与输入等长的向量数组。 */
export async function embed(
  texts: string[],
  options: { config?: EmbeddingConfig; timeoutMs?: number } = {},
): Promise<number[][]> {
  const cfg = options.config ?? readEmbeddingConfig()
  if (!embeddingsReady({ ...readConfig(), embeddingsBaseUrl: cfg.baseUrl, embeddingsApiKey: cfg.apiKey, embeddingsModel: cfg.model })) {
    throw new LlmError('AI_NOT_CONFIGURED', '尚未配置向量化服务，请在「AI 设置」中填写 Embeddings 地址、Key 与模型', 409);
  }
  if (!texts.length) return []
  const timeoutMs = options.timeoutMs ?? 60000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    const resp = await fetch(joinUrl(cfg.baseUrl, '/embeddings'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ input: texts, model: cfg.model }),
      signal: controller.signal,
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new LlmError('AI_UPSTREAM_ERROR', `向量化服务返回 ${resp.status}${text ? `：${text.slice(0, 300)}` : ''}`, 502)
    }
    const data = (await resp.json()) as any
    const arr = Array.isArray(data?.data) ? data.data : []
    // OpenAI 返回按 index 排序的向量，稳妥起见按 index 还原顺序
    const byIndex = new Map<number, number[]>()
    for (const item of arr) {
      if (item && Array.isArray(item.embedding)) byIndex.set(item.index ?? byIndex.size, item.embedding as number[])
    }
    const vectors = texts.map((_, i) => byIndex.get(i) || [])
    if (vectors.some((v) => !v.length)) {
      throw new LlmError('AI_BAD_RESPONSE', '向量化返回结果缺失或格式异常', 502)
    }
    return vectors
  } catch (e: any) {
    if (e instanceof LlmError) throw e
    if (e?.name === 'AbortError') {
      throw new LlmError('AI_TIMEOUT', `向量化请求超时（${timeoutMs}ms）`, 504)
    }
    throw new LlmError('AI_UPSTREAM_ERROR', `向量化请求失败：${e?.message || e}`, 502)
  } finally {
    clearTimeout(timer)
  }
}

/** 连通性自检：发一条极短请求，返回耗时与模型回显。 */
export async function ping(config?: LlmConfig): Promise<{ ok: true; model: string; latencyMs: number; reply: string }> {
  const res = await chat(
    [
      { role: 'system', content: '你是一个连通性测试探针，只回复用户要求的内容，不要有多余文字。' },
      { role: 'user', content: '回复两个字：可用' },
    ],
    { config, temperature: 0, maxTokens: 16 },
  );
  return { ok: true, model: res.model, latencyMs: res.latencyMs, reply: res.content.slice(0, 50) };
}

/** 截断超长文本，避免无谓的 token 消耗（保留头部，尾部补省略号）。 */
export function truncate(text: string | null | undefined, max = 4000): string {
  const s = (text || '').trim();
  return s.length <= max ? s : `${s.slice(0, max)}…（内容过长已截断）`;
}

/** 去除 HTML 标签，把富文本笔记转成纯文本喂给模型。 */
export function stripHtml(html: string | null | undefined): string {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
