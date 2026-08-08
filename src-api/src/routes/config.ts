// 应用级配置路由：承接「新手引导」与「全局设置中心」的读写。
//
// 职责边界（与既有 ai.ts 的 /api/ai/config 刻意分开）：
// - 本路由只管「应用外壳」层面的配置：是否完成首次引导（hasOnboarded）+ 用户偏好的数据目录（dataDir），
//   落盘在 <dataDir>/config.json。
// - AI 服务参数（baseUrl / apiKey / model）仍统一交给 lib/llm.ts 的 saveConfig 持久化到 ai-config.json（权限 600），
//   这样引导页填的 AI 配置能真正驱动全局 AI 能力，而不是变成一份与实际调用脱节的死数据。
//
// 说明：桌面端真实数据目录由 Tauri 宿主用 BaseDirectory::AppData 解析后注入（LECTOFORGE_DATA_DIR），
// SQLite 在启动那一刻即在该目录打开。因此引导页选择的 dataDir 作为「偏好」记录，
// 迁移既有数据 / 让新目录立即生效属于后续增强，本轮先如实存储并回显。
import { FastifyInstance } from 'fastify';
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
interface AiSettingsInput {
  apiUrl?: string;
  /** 留空表示保持已保存的 Key 不变；本文件绝不回显明文 Key */
  apiKey?: string;
  model?: string;
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

export default async function (app: FastifyInstance) {
  /**
   * GET /api/config —— 应用初始化时读取。
   * 返回引导状态、当前数据目录（偏好优先，否则系统解析值）与 AI 公共视图（Key 仅掩码）。
   */
  app.get('/config', async () => {
    const cfg = readAppConfig();
    return {
      hasOnboarded: cfg.hasOnboarded,
      dataDir: cfg.dataDir || resolveDataDir(),
      ai: publicConfig(),
    };
  });

  /**
   * POST /api/config/init —— 引导完成 / 设置中心保存。
   * body: { dataDir?: string, aiSettings?: { apiUrl, apiKey, model }, hasOnboarded?: boolean }
   * - AI 参数经 llm.saveConfig 落 ai-config.json（apiKey 留空则保持原值）；
   * - hasOnboarded 与 dataDir 落 config.json。
   */
  app.post('/config/init', async (req, reply) => {
    const b = (req.body || {}) as {
      dataDir?: string;
      aiSettings?: AiSettingsInput;
      hasOnboarded?: boolean;
    };

    try {
      // 1) AI 参数交给统一的 llm 配置中心（真正驱动 AI 能力，与 /settings/ai 完全一致）
      if (b.aiSettings) {
        const ai = b.aiSettings;
        saveConfig({
          enabled: true,
          provider: guessProvider(ai.apiUrl),
          baseUrl: (ai.apiUrl || '').trim(),
          // 空字符串在 saveConfig 内被视为「保持原值」，非空才覆盖
          apiKey: (ai.apiKey || '').trim(),
          model: (ai.model || '').trim(),
        });
      }

      // 2) 应用外壳配置落盘
      const next: AppConfig = {
        hasOnboarded: b.hasOnboarded !== false,
        dataDir: (b.dataDir || '').trim() || resolveDataDir(),
        updatedAt: new Date().toISOString(),
      };
      writeAppConfig(next);

      return {
        hasOnboarded: next.hasOnboarded,
        dataDir: next.dataDir,
        ai: publicConfig(),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : '配置保存失败';
      return reply.code(500).send({ code: 500, message });
    }
  });
}
