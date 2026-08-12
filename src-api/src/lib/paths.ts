import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/* =============================================================================
 * 运行期路径解析（打包后可写目录 / 开发期项目目录 的唯一收敛点）
 *
 * 打包成 macOS .app 之后，`.app` 包内是**只读**的（且带签名，写入会破坏签名），
 * 任何落盘（SQLite、AI 配置、上传图片、日志）都不能再拼 `src-api/data/`。
 * 真实可写目录由 Tauri 宿主用 `BaseDirectory::AppData` 取到后，
 * 通过环境变量 LECTOFORGE_DATA_DIR 注入本进程：
 *   macOS → ~/Library/Application Support/com.lectoforge.desktop/
 *
 * 解析优先级（逐级探测「能否真正写入」，第一个通过的胜出）：
 *   1. 环境变量 LECTOFORGE_DATA_DIR      —— 生产：Tauri 宿主注入（权威来源）
 *   2. 命令行 --data-dir <path>        —— 兼容旧版宿主 / 手工调试
 *   3. <src-api>/data                  —— 开发：tsx watch / npm run dev:api
 *   4. 系统应用数据目录                —— 兜底：脱离宿主直跑 .app 内 dist 时
 *   5. os.tmpdir()/lectoforge-data       —— 最后兜底，保证进程一定能起来
 * ========================================================================== */

/** 与 src-tauri/tauri.conf.json 的 identifier 保持一致 */
const APP_IDENTIFIER = 'com.lectoforge.desktop';

/** 宿主注入的数据目录环境变量名（Rust 侧 SidecarManager 写入同名变量） */
export const DATA_DIR_ENV = 'LECTOFORGE_DATA_DIR';

/** 数据目录下的固定文件名（历史数据靠它们定位，改名 = 用户数据丢失，勿动） */
const FILE_DB = 'workbench.db';
const FILE_AI_CONFIG = 'ai-config.json';
const FILE_WORKSPACE = 'library-workspace.json';
/** 应用级配置（新手引导状态 + 用户偏好的数据目录），与 ai-config.json 分开存放 */
const FILE_APP_CONFIG = 'config.json';
/** 番茄钟偏好（时长 / 循环数 / 提示音 / 白噪音），与应用外壳配置分开存放 */
const FILE_POMODORO_CONFIG = 'pomodoro-config.json';

/** 数据目录下的固定子目录名 */
const DIR_MINDMAPS = 'mindmaps';
const DIR_UPLOADS = 'uploads';
const DIR_LOGS = 'logs';

/** 离线模型资源目录（tesseract / whisper）的环境变量名，由 Rust 宿主注入 */
export const RESOURCES_DIR_ENV = 'LECTOFORGE_RESOURCES_DIR';

// ===================== 内部工具 =====================

/** 读取 `--flag value` 形式的命令行参数 */
function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  return null;
}

/**
 * 确保目录存在**且真的可写**。
 * 只用 fs.existsSync 判断是不够的：.app 包内目录是存在的，但写入会 EROFS/EPERM，
 * 那样 better-sqlite3 会在 new Database() 那一刻直接抛错、整个后端起不来。
 * 这里用「创建 + W_OK 探测」做实证判断，失败即换下一个候选目录。
 */
function ensureWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** 系统级应用数据目录（与 Tauri BaseDirectory::AppData 的落点一致） */
function systemAppDataDir(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', APP_IDENTIFIER);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), APP_IDENTIFIER);
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), APP_IDENTIFIER);
}

/**
 * 开发期项目目录：<src-api>/data
 * 运行 tsx（src/lib/paths.ts）与运行编译产物（dist/lib/paths.js）时，
 * __dirname 分别是 <src-api>/src/lib 与 <src-api>/dist/lib，上溯两级都落到 <src-api>。
 */
function projectDataDir(): string {
  return path.resolve(__dirname, '..', '..', 'data');
}

// ===================== 数据目录（解析一次并缓存） =====================

let cachedDataDir: string | null = null;

/**
 * 解析并**确保存在**应用数据根目录，进程内只计算一次。
 * 返回值一定是一个已存在且可写的绝对路径。
 */
export function resolveDataDir(): string {
  if (cachedDataDir) return cachedDataDir;

  const candidates: Array<{ dir: string; from: string }> = [];
  const fromEnv = process.env[DATA_DIR_ENV];
  if (fromEnv && fromEnv.trim()) {
    candidates.push({ dir: path.resolve(fromEnv.trim()), from: `env ${DATA_DIR_ENV}` });
  }
  const fromArg = argValue('--data-dir');
  if (fromArg) candidates.push({ dir: path.resolve(fromArg), from: '--data-dir' });
  candidates.push({ dir: projectDataDir(), from: '开发目录 <src-api>/data' });
  candidates.push({ dir: systemAppDataDir(), from: '系统应用数据目录' });
  candidates.push({ dir: path.join(os.tmpdir(), 'lectoforge-data'), from: '临时目录兜底' });

  for (const c of candidates) {
    if (ensureWritableDir(c.dir)) {
      cachedDataDir = c.dir;
      console.log(`[lectoforge-desktop] 数据目录: ${c.dir}  (来源: ${c.from})`);
      return cachedDataDir;
    }
    console.warn(`[lectoforge-desktop] 数据目录不可写，跳过: ${c.dir}  (来源: ${c.from})`);
  }

  // 理论上不可达：tmpdir 都写不了的话进程本来也活不下去
  throw new Error('无法找到任何可写的数据目录，请检查磁盘权限');
}

/** 拼接数据目录下的文件路径，并确保其父目录存在 */
export function dataFile(...segments: string[]): string {
  const file = path.join(resolveDataDir(), ...segments);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

/** 拼接数据目录下的子目录路径，并确保该目录存在 */
export function dataSubDir(...segments: string[]): string {
  const dir = path.join(resolveDataDir(), ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ===================== 具名路径访问器（全项目统一从这里取） =====================

/**
 * SQLite 主库：<dataDir>/workbench.db
 * 支持 LECTOFORGE_DB 显式覆盖（指向任意绝对路径，便于跑测试库）。
 */
export function getDbPath(): string {
  const override = process.env.LECTOFORGE_DB;
  if (override && override.trim()) {
    const file = path.resolve(override.trim());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return file;
  }
  return dataFile(FILE_DB);
}

/** AI 配置（含 API Key，写盘后 chmod 600）：<dataDir>/ai-config.json */
export function getAiConfigPath(): string {
  return dataFile(FILE_AI_CONFIG);
}

/**
 * 应用级配置：<dataDir>/config.json
 * 记录首次引导是否完成（hasOnboarded）与用户在引导页选择的数据目录偏好（dataDir）。
 * 生产环境下该文件落在 ~/Library/Application Support/com.lectoforge.desktop/config.json。
 */
export function getAppConfigPath(): string {
  return dataFile(FILE_APP_CONFIG);
}

/**
 * 番茄钟配置：<dataDir>/pomodoro-config.json
 * 存工作/休息时长、循环数、提示音与白噪音偏好。刻意与 config.json 分开：
 * 番茄钟设置改动频繁（用户随手拖时长就写一次），混进应用外壳配置会互相污染。
 */
export function getPomodoroConfigPath(): string {
  return dataFile(FILE_POMODORO_CONFIG);
}

/** 文档库工作区配置：<dataDir>/library-workspace.json */
export function getWorkspaceConfigPath(): string {
  return dataFile(FILE_WORKSPACE);
}

/** 思维导图文档目录：<dataDir>/mindmaps/ */
export function getMindmapsDir(): string {
  return dataSubDir(DIR_MINDMAPS);
}

/** 用户上传图片目录：<dataDir>/uploads/ */
export function getUploadsDir(): string {
  return dataSubDir(DIR_UPLOADS);
}

/** 运行日志目录：<dataDir>/logs/ */
export function getLogsDir(): string {
  return dataSubDir(DIR_LOGS);
}

/**
 * 离线模型资源目录（tesseract 的 wasm/worker/语言包 + whisper 的 wasm/模型）。
 *
 * 打包后由 Rust 宿主通过 `LECTOFORGE_RESOURCES_DIR` 注入 `.app` 内 Resources 目录，
 * 模型文件随之位于 `<RESOURCES_DIR>/models`，本函数返回该绝对路径。
 * 开发期（未注入环境变量）回退到项目根 `resources/models`，与 tauri.conf.json
 * 的 `bundle.resources` 映射同源，便于本地 `npm run dev:all` 直接取到模型。
 */
export function getModelsDir(): string {
  const fromEnv = process.env[RESOURCES_DIR_ENV];
  if (fromEnv && fromEnv.trim()) {
    return path.join(path.resolve(fromEnv.trim()), 'models');
  }
  // 开发期：项目根 resources/models（__dirname 在 tsx 下为 src-api/src/lib，上溯三级到项目根）
  return path.resolve(__dirname, '..', '..', '..', 'resources', 'models');
}

// ===================== 其它启动参数 =====================

/** 前端构建产物目录（由 Node 后端同源托管），生产由 Tauri 通过 --web-dir 传入 */
export function resolveWebDir(): string | null {
  const fromArg = argValue('--web-dir');
  if (fromArg) return fromArg;
  const local = path.resolve(__dirname, '..', '..', '..', 'src-ui', 'dist');
  return fs.existsSync(local) ? local : null;
}

/** 解析监听端口，默认 8787，支持 --port 覆盖 */
export function resolvePort(): number {
  const fromArg = argValue('--port');
  if (fromArg) {
    const p = parseInt(fromArg, 10);
    if (!Number.isNaN(p)) return p;
  }
  return 8787;
}

/** 是否由 Tauri 宿主拉起（据此启用孤儿自检等宿主相关行为） */
export function isLaunchedByHost(): boolean {
  return Boolean(process.env[DATA_DIR_ENV]) || process.argv.includes('--data-dir');
}
