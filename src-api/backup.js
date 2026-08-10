#!/usr/bin/env node
/**
 * LectoForge 数据备份脚本（纯 JS，由 Node 侧车经 child_process 拉起）
 *
 * 作用：把本地学习数据打包成一个带时间戳的 .zip，便于用户「换机 / 重装 / 误删」后一键恢复。
 *
 * 入参（全部由调用方以绝对路径传入，本脚本不做路径推断）：
 *   --db <path>         SQLite 主库文件（如 workbench.db）。脚本会自动带上同目录的 -wal / -shm 兄弟文件，
 *                       保证 WAL 模式下也能拿到一致的快照。
 *   --uploads <dir>     用户上传目录（录音 / 图片 / 附件），递归打包；目录缺失则跳过。
 *   --out <dir>         输出目录，脚本会确保它存在；最终产物 lectoforge-backup-YYYYMMDD-HHmmss.zip。
 *   --extra <csv>       额外要打包的配置文件（逗号分隔的绝对路径，如 ai-config.json,config.json）；缺失则跳过。
 *   --mindmaps <dir>    思维导图目录（<dataDir>/mindmaps），递归打包；缺失则跳过。
 *
 * 退出码：0 成功（stdout 打印 zip 绝对路径），1 失败（stderr 打印原因）。
 *
 * 为什么用纯 JS 而非 TS：侧车在生产以编译后的 dist/ 运行、开发以 tsx 运行，两者的 cwd 与模块解析
 * 不一致；纯 JS 放在仓库根，dev/build 都能被 node 直接拉起，且只依赖 archiver（已在运行时 node_modules 中）。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const out = { db: '', uploads: '', out: '', extra: [], mindmaps: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') out.db = argv[++i] || '';
    else if (a === '--uploads') out.uploads = argv[++i] || '';
    else if (a === '--out') out.out = argv[++i] || '';
    else if (a === '--mindmaps') out.mindmaps = argv[++i] || '';
    else if (a === '--extra') {
      const v = argv[++i] || '';
      out.extra = v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return out;
}

function exists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

function fail(msg) {
  process.stderr.write(`[backup] ${msg}\n`);
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.out) fail('缺少 --out 输出目录参数');
  if (!args.db) fail('缺少 --db 数据库路径参数');

  // 依赖 archiver（已在运行时 node_modules 中，由 prepare-bin.sh 打包进侧车）
  let archiver;
  try {
    archiver = require('archiver');
  } catch (e) {
    fail(`无法加载 archiver：${e && e.message ? e.message : e}`);
  }

  fs.mkdirSync(args.out, { recursive: true });

  // 用本地时间做文件名时间戳（toISOString 是 UTC，会让 UTC+8 用户看到「早了 8 小时」的文件名）
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}` +
    `-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
  const zipPath = path.join(args.out, `lectoforge-backup-${stamp}.zip`);

  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  let settled = false;
  const finish = (code, msg) => {
    if (settled) return;
    settled = true;
    if (code !== 0) {
      process.stderr.write(`[backup] ${msg}\n`);
      try {
        fs.unlinkSync(zipPath);
      } catch {
        /* ignore */
      }
      process.exit(code);
    }
    // stdout 指向管道时是异步写入，必须等 flush 回调再 exit，否则路径会被截断
    process.stdout.write(`${zipPath}\n`, () => process.exit(0));
  };

  output.on('close', () => finish(0, ''));
  archive.on('warning', (err) => {
    if (err.code !== 'ENOENT') finish(1, `archive warning: ${err.message}`);
  });
  archive.on('error', (err) => finish(1, `archive error: ${err.message}`));

  archive.pipe(output);

  // 1) SQLite 主库 + WAL 兄弟文件（保证 WAL 模式一致性快照）
  if (exists(args.db)) {
    archive.file(args.db, { name: `db/${path.basename(args.db)}` });
    const dir = path.dirname(args.db);
    const base = path.basename(args.db, path.extname(args.db));
    for (const ext of ['.db-wal', '.db-shm', '-wal', '-shm']) {
      const sibling = path.join(dir, `${base}${ext}`);
      if (exists(sibling)) {
        archive.file(sibling, { name: `db/${path.basename(sibling)}` });
      }
    }
  } else {
    finish(1, `数据库文件不存在：${args.db}`);
    return;
  }

  // 2) 上传目录（录音 / 图片 / 附件）
  if (exists(args.uploads)) {
    archive.directory(args.uploads, 'uploads');
  }

  // 3) 配置文件（ai-config.json / config.json 等）
  for (const f of args.extra) {
    if (exists(f)) {
      archive.file(f, { name: `config/${path.basename(f)}` });
    }
  }

  // 4) 思维导图目录
  if (exists(args.mindmaps)) {
    archive.directory(args.mindmaps, 'mindmaps');
  }

  // 5) 清单文件：记录来源路径与时间，恢复时可对照放回原位
  archive.append(
    `${JSON.stringify(
      {
        app: 'LectoForge',
        createdAt: new Date().toISOString(),
        source: {
          db: args.db,
          uploads: args.uploads || null,
          mindmaps: args.mindmaps || null,
          config: args.extra,
        },
        layout: 'db/ = SQLite 主库及 WAL；uploads/ = 上传文件；config/ = 配置；mindmaps/ = 思维导图',
      },
      null,
      2,
    )}\n`,
    { name: 'backup-meta.json' },
  );

  archive.finalize();
}

main();
