// 应用级配置服务层：承接「新手引导」与「全局设置中心」的读写逻辑。
//
// 职责边界（与 lib/llm 的 ai-config 刻意分开）：
// - 本服务只管「应用外壳」层面的配置：是否完成首次引导（hasOnboarded）+ 用户偏好的数据目录（dataDir），
//   落盘在 <dataDir>/config.json。
// - AI 服务参数（baseUrl / apiKey / model）交给 lib/llm 的 saveConfig 持久化到 ai-config.json（权限 600），
//   这样引导页填的 AI 配置能真正驱动全局 AI 能力，而不是变成一份与实际调用脱节的死数据。
//
// 说明：桌面端真实数据目录由 Tauri 宿主用 BaseDirectory::AppData 解析后注入（LECTOFORGE_DATA_DIR），
// SQLite 在启动那一刻即在该目录打开。因此引导页选择的 dataDir 作为「偏好」记录，
// 迁移既有数据 / 让新目录立即生效属于后续增强，本轮先如实存储并回显。
import fs from 'node:fs';
import path from 'node:path';

import { getAppConfigPath, resolveDataDir } from '../lib/paths';
import { publicConfig, saveConfig, type LlmProvider } from '../lib/llm';

/** config.json 的结构（仅应用外壳配置，不含任何密钥） */
interface AppConfig {
  hasOnboarded: boolean;
  /** 用户在引导页选择的知识库数据目录偏好；为空表示沿用系统默认解析结果 */
  dataDir: string;
  updatedAt: string;
}

/** 引导页 / 设置中心提交的 AI 参数（与前端 store.settings.ai 对齐） */
export interface AiSettingsInput {
  apiUrl?: string;
  /** 留空表示保持已保存的 Key 不变；本服务绝不回显明文 Key */
  apiKey?: string;
  model?: string;
}

/** POST /api/config/init 的请求体 */
export interface InitConfigInput {
  dataDir?: string;
  aiSettings?: AiSettingsInput;
  hasOnboarded?: boolean;
}

/** GET /api/config 的返回视图 */
export interface ConfigView {
  hasOnboarded: boolean;
  /** 用户在引导页选择的知识库数据目录偏好；为空表示沿用系统默认解析结果 */
  dataDir: string;
  ai: ReturnType<typeof publicConfig>;
}

const DEFAULT_APP_CONFIG: AppConfig = {
  hasOnboarded: false,
  dataDir: '',
  updatedAt: '',
};

/** 读取应用配置；文件缺失或损坏时回落默认值（不抛错，保证引导流程可用） */
function readAppConfig(): AppConfig {
  const file = getAppConfigPath();
  if (!fs.existsSync(file)) return { ...DEFAULT_APP_CONFIG };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AppConfig>;
    return {
      hasOnboarded: raw.hasOnboarded === true,
      dataDir: typeof raw.dataDir === 'string' ? raw.dataDir.trim() : '',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    };
  } catch {
    return { ...DEFAULT_APP_CONFIG };
  }
}

/** 写入应用配置（父目录由 paths 保证存在） */
function writeAppConfig(cfg: AppConfig): void {
  const file = getAppConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
}

/** 由 API 地址推断服务商预设（仅用于让 ai-config.json 记录更贴切的 provider） */
function guessProvider(baseUrl?: string): LlmProvider {
  const u = (baseUrl || '').toLowerCase();
  if (u.includes('deepseek')) return 'deepseek';
  if (u.includes('openai')) return 'openai';
  return 'custom';
}

/** GET /api/config —— 读取引导状态、当前数据目录（偏好优先，否则系统解析值）与 AI 公共视图（Key 仅掩码） */
export function getConfigView(): ConfigView {
  const cfg = readAppConfig();
  return {
    hasOnboarded: cfg.hasOnboarded,
    dataDir: cfg.dataDir || resolveDataDir(),
    ai: publicConfig(),
  };
}

/**
 * POST /api/config/init —— 引导完成 / 设置中心保存。
 * - AI 参数经 llm.saveConfig 落 ai-config.json（apiKey 留空则保持原值）；
 * - hasOnboarded 与 dataDir 落 config.json。
 * 返回与 getConfigView 同构的视图（onSend 钩子统一包信封）。
 */
export function initConfig(input: InitConfigInput): ConfigView {
  if (input.aiSettings) {
    const ai = input.aiSettings;
    saveConfig({
      enabled: true,
      provider: guessProvider(ai.apiUrl),
      baseUrl: (ai.apiUrl || '').trim(),
      // 空字符串在 saveConfig 内被视为「保持原值」，非空才覆盖
      apiKey: (ai.apiKey || '').trim(),
      model: (ai.model || '').trim(),
    });
  }

  const next: AppConfig = {
    hasOnboarded: input.hasOnboarded !== false,
    dataDir: (input.dataDir || '').trim() || resolveDataDir(),
    updatedAt: new Date().toISOString(),
  };
  writeAppConfig(next);

  return getConfigView();
}
