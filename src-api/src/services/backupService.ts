// 数据备份服务层：封装「拉起 backup.js 打包」与「每日备份计划持久化」两类逻辑。
//
// - runBackup：在 Node 侧车内用 child_process.spawn 启动仓库根的 backup.js（纯 JS，依赖 archiver），
//   把 SQLite 主库（含 WAL 兄弟文件）、上传目录、配置文件、思维导图目录打成一个带时间戳的 zip。
// - 计划持久化：enabled / time(HH:MM) / outDir 落 <dataDir>/backup-config.json，供 Rust 调度器读取。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { sqlite } from '../db';
import {
  getDbPath,
  getUploadsDir,
  resolveDataDir,
  getAppConfigPath,
  getAiConfigPath,
  getMindmapsDir,
} from '../lib/paths';

/** 备份结果（POST /api/backup 的返回体） */
export interface BackupResult {
  zipPath: string;
  size: number;
  createdAt: string;
}

/** 每日自动备份计划 */
export interface BackupSchedule {
  enabled: boolean;
  /** 每日触发时刻，HH:MM（24 小时制） */
  time: string;
  /** 备份产物输出目录（绝对路径） */
  outDir: string;
}

const DEFAULT_SCHEDULE: BackupSchedule = { enabled: false, time: '03:00', outDir: '' };

/** 解析 backup.js 绝对路径（dev/build 两种 cwd 都能命中） */
function resolveBackupScript(): string {
  // __dirname 在生产是 <resources>/api/services，在开发是 src-api/src/services，
  // 因此向上找 1~2 级 + cwd 兜底，三种运行姿势（tsx watch / node dist / .app 侧车）都能命中。
  const candidates = [
    path.join(__dirname, '..', 'backup.js'), // 生产：api/services -> api/backup.js
    path.join(__dirname, '..', '..', 'backup.js'), // 开发：src-api/src/services -> src-api/backup.js
    path.join(__dirname, 'backup.js'),
    path.join(process.cwd(), 'backup.js'), // 兜底：进程 cwd
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('找不到 backup.js 脚本（请确认 src-api/backup.js 存在）');
}

/**
 * 执行一次备份：spawn 一个 node 子进程跑 backup.js，收集其 stdout（zip 绝对路径）。
 * 子进程阻塞直到 zip 写出完成，因此本调用是「同步语义」的 Promise。
 */
export function runBackup(outDir: string): Promise<BackupResult> {
  if (!outDir || !outDir.trim()) {
    return Promise.reject(new Error('备份输出目录不能为空'));
  }
  // 先把 WAL 里的未落盘事务刷进主库，保证 zip 里的 .db 单文件就是完整快照
  // （失败也不阻断——backup.js 仍会连 -wal/-shm 兄弟文件一起打包）
  try {
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* ignore */
  }

  const script = resolveBackupScript();
  const db = getDbPath();
  const uploads = getUploadsDir();
  const mindmaps = getMindmapsDir();
  const extras = [getAppConfigPath(), getAiConfigPath()].filter((p) => fs.existsSync(p));
  const args = [
    '--db',
    db,
    '--uploads',
    uploads,
    '--out',
    outDir.trim(),
    '--mindmaps',
    mindmaps,
    '--extra',
    extras.join(','),
  ];

  return new Promise<BackupResult>((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.stderr?.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => reject(new Error(`启动备份进程失败：${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`备份失败（退出码 ${code}）：${err.trim() || '未知错误'}`));
        return;
      }
      const zipPath = out.trim().split('\n').pop()?.trim();
      if (!zipPath || !fs.existsSync(zipPath)) {
        reject(new Error('备份进程结束但未产出 zip 文件'));
        return;
      }
      const stat = fs.statSync(zipPath);
      resolve({ zipPath, size: stat.size, createdAt: new Date().toISOString() });
    });
  });
}

/** 读取备份计划（文件缺失/损坏则回落默认） */
export function getSchedule(): BackupSchedule {
  const file = path.join(resolveDataDir(), 'backup-config.json');
  if (!fs.existsSync(file)) return { ...DEFAULT_SCHEDULE };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<BackupSchedule>;
    return {
      enabled: raw.enabled === true,
      time: typeof raw.time === 'string' ? raw.time : DEFAULT_SCHEDULE.time,
      outDir: typeof raw.outDir === 'string' ? raw.outDir : '',
    };
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
}

/** 写入备份计划（校验 time 格式，确保父目录存在） */
export function setSchedule(input: Partial<BackupSchedule>): BackupSchedule {
  const next: BackupSchedule = {
    enabled: input.enabled === true,
    time:
      typeof input.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)
        ? input.time
        : DEFAULT_SCHEDULE.time,
    outDir: typeof input.outDir === 'string' ? input.outDir.trim() : '',
  };
  const file = path.join(resolveDataDir(), 'backup-config.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
