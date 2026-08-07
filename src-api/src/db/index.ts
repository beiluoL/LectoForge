import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { getDbPath } from '../lib/paths';

/* 库文件位置全权交给 lib/paths：打包后落在宿主注入的 KNOWFLOW_DATA_DIR
 * （macOS: ~/Library/Application Support/com.knowflow.desktop/workbench.db），
 * 开发期落在 <src-api>/data/workbench.db；目录创建与可写校验由 paths 负责。 */
const dbPath = getDbPath();
console.log(`[knowflow-desktop] SQLite: ${dbPath}`);

export const sqlite = new Database(dbPath);
// 单用户桌面应用：开 WAL 提升并发与崩溃安全
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = OFF'); // 逻辑外键，由应用层保证

// ===== DDL（幂等，首次运行建表；字段与 Web 端 Wb* 实体对齐）=====
sqlite.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS wb_capture (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  content TEXT,
  source_type TEXT,
  source_url TEXT,
  doc_id INTEGER,
  category_id INTEGER,
  tags TEXT,
  status TEXT NOT NULL DEFAULT 'INBOX',
  starred INTEGER NOT NULL DEFAULT 0,
  cover_image TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wb_note (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  capture_id INTEGER,
  category_id INTEGER,
  title TEXT NOT NULL,
  cue_column TEXT NOT NULL DEFAULT '',
  note_column TEXT NOT NULL DEFAULT '',
  summary_column TEXT NOT NULL DEFAULT '',
  tags TEXT,
  mastery INTEGER NOT NULL DEFAULT 0,
  due_date TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  ease_factor INTEGER NOT NULL DEFAULT 250,
  repetitions INTEGER NOT NULL DEFAULT 0,
  interval_day INTEGER NOT NULL DEFAULT 0,
  lapse_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wb_review_card (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  capture_id INTEGER,
  note_id INTEGER,
  category_id INTEGER,
  front TEXT NOT NULL,
  back TEXT NOT NULL DEFAULT '',
  card_type TEXT NOT NULL DEFAULT 'basic',
  ease_factor INTEGER NOT NULL DEFAULT 250,
  repetitions INTEGER NOT NULL DEFAULT 0,
  interval_day INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  lapse_count INTEGER NOT NULL DEFAULT 0,
  next_review_time TEXT NOT NULL,
  last_review_time TEXT,
  suspended INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS wb_review_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  card_id INTEGER NOT NULL,
  quality INTEGER NOT NULL,
  interval_day INTEGER NOT NULL,
  ease_factor INTEGER NOT NULL,
  cost_ms INTEGER,
  reviewed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wb_palace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  description TEXT,
  theme TEXT,
  cover_color TEXT,
  category_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wb_palace_loci (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  palace_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  knowledge_point TEXT,
  image_hint TEXT,
  icon TEXT,
  pos_x REAL,
  pos_y REAL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  capture_id INTEGER,
  note_id INTEGER,
  category_id INTEGER,
  due_date TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  ease_factor INTEGER NOT NULL DEFAULT 250,
  repetitions INTEGER NOT NULL DEFAULT 0,
  interval_day INTEGER NOT NULL DEFAULT 0,
  lapse_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wb_recall_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  note_id INTEGER,
  card_id INTEGER,
  title TEXT NOT NULL,
  source_text TEXT NOT NULL DEFAULT '',
  round1_text TEXT,
  round1_score INTEGER,
  round2_text TEXT,
  round2_score INTEGER,
  round3_text TEXT,
  round3_score INTEGER,
  current_round INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  round3_due_time TEXT,
  completed_time TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wb_story (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  capture_id INTEGER,
  note_id INTEGER,
  category_id INTEGER,
  title TEXT NOT NULL,
  audience TEXT,
  metaphor TEXT,
  content TEXT NOT NULL DEFAULT '',
  gap_note TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  clarity_score INTEGER,
  word_count INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wb_pomodoro_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  type TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wb_pomodoro_end ON wb_pomodoro_log (end_time);
CREATE TABLE IF NOT EXISTS wb_embedding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector TEXT NOT NULL,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wb_embedding_entity ON wb_embedding (entity_type, entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wb_embedding_uniq ON wb_embedding (entity_type, entity_id, model);
`);

// ===== 向后兼容：旧库增量补齐新列（PRAGMA 探测存在性，幂等安全）=====
function addColumn(table: string, col: string, def: string) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === col)) return;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

addColumn('wb_capture', 'source_type', 'TEXT');
addColumn('wb_capture', 'source_url', 'TEXT');
addColumn('wb_capture', 'doc_id', 'INTEGER');
addColumn('wb_capture', 'tags', 'TEXT');
// 收集箱增强：网页剪藏封面图 + 流转时间（旧库幂等补列）
addColumn('wb_capture', 'cover_image', 'TEXT');
addColumn('wb_capture', 'processed_at', 'TEXT');
addColumn('wb_note', 'cue_column', "TEXT NOT NULL DEFAULT ''");
addColumn('wb_note', 'note_column', "TEXT NOT NULL DEFAULT ''");
addColumn('wb_note', 'summary_column', "TEXT NOT NULL DEFAULT ''");
addColumn('wb_note', 'tags', 'TEXT');
addColumn('wb_note', 'mastery', 'INTEGER NOT NULL DEFAULT 0');
addColumn('wb_palace', 'theme', 'TEXT');
addColumn('wb_palace', 'cover_color', 'TEXT');
addColumn('wb_palace', 'category_id', 'INTEGER');
addColumn('wb_palace', 'created_at', 'TEXT');
addColumn('wb_palace', 'updated_at', 'TEXT');
addColumn('wb_palace_loci', 'name', 'TEXT');
addColumn('wb_palace_loci', 'knowledge_point', 'TEXT');
addColumn('wb_palace_loci', 'image_hint', 'TEXT');
addColumn('wb_palace_loci', 'icon', 'TEXT');
addColumn('wb_palace_loci', 'pos_x', 'REAL');
addColumn('wb_palace_loci', 'pos_y', 'REAL');
addColumn('wb_palace_loci', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');
addColumn('wb_palace_loci', 'capture_id', 'INTEGER');
addColumn('wb_palace_loci', 'note_id', 'INTEGER');
addColumn('wb_palace_loci', 'category_id', 'INTEGER');
addColumn('wb_palace_loci', 'mastered_level', 'INTEGER NOT NULL DEFAULT 0');
addColumn('wb_palace_loci', 'last_reviewed_at', 'TEXT');
addColumn('wb_palace_loci', 'due_date', "TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'");
addColumn('wb_palace_loci', 'ease_factor', 'INTEGER NOT NULL DEFAULT 250');
addColumn('wb_palace_loci', 'repetitions', 'INTEGER NOT NULL DEFAULT 0');
addColumn('wb_palace_loci', 'interval_day', 'INTEGER NOT NULL DEFAULT 0');
addColumn('wb_palace_loci', 'lapse_count', 'INTEGER NOT NULL DEFAULT 0');
addColumn('wb_palace_loci', 'review_count', 'INTEGER NOT NULL DEFAULT 0');
addColumn('wb_note', 'due_date', "TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'");
addColumn('wb_note', 'ease_factor', 'INTEGER NOT NULL DEFAULT 250');
addColumn('wb_note', 'repetitions', 'INTEGER NOT NULL DEFAULT 0');
addColumn('wb_note', 'interval_day', 'INTEGER NOT NULL DEFAULT 0');
addColumn('wb_note', 'lapse_count', 'INTEGER NOT NULL DEFAULT 0');
addColumn('wb_note', 'review_count', 'INTEGER NOT NULL DEFAULT 0');
addColumn('wb_note', 'last_reviewed_at', 'TEXT');
addColumn('wb_palace_loci', 'created_at', 'TEXT');
addColumn('wb_palace_loci', 'updated_at', 'TEXT');
addColumn('wb_recall_session', 'note_id', 'INTEGER');
addColumn('wb_recall_session', 'card_id', 'INTEGER');
addColumn('wb_recall_session', 'round1_text', 'TEXT');
addColumn('wb_recall_session', 'round1_score', 'INTEGER');
addColumn('wb_recall_session', 'round2_text', 'TEXT');
addColumn('wb_recall_session', 'round2_score', 'INTEGER');
addColumn('wb_recall_session', 'round3_text', 'TEXT');
addColumn('wb_recall_session', 'round3_score', 'INTEGER');
addColumn('wb_recall_session', 'current_round', 'INTEGER NOT NULL DEFAULT 1');
addColumn('wb_recall_session', 'status', "TEXT NOT NULL DEFAULT 'IN_PROGRESS'");
addColumn('wb_recall_session', 'round3_due_time', 'TEXT');
addColumn('wb_recall_session', 'completed_time', 'TEXT');
addColumn('wb_story', 'capture_id', 'INTEGER');
addColumn('wb_story', 'note_id', 'INTEGER');
addColumn('wb_story', 'audience', 'TEXT');
addColumn('wb_story', 'metaphor', 'TEXT');
addColumn('wb_story', 'gap_note', 'TEXT');
addColumn('wb_story', 'clarity_score', 'INTEGER');
addColumn('wb_story', 'word_count', 'INTEGER');

// 迁移：旧版本 wb_palace_loci 曾使用 label 列（TEXT NOT NULL），现统一为 name。
// 若旧库表仍残留 label 列，将其数据并入 name 后删除该列；否则新建点位时 INSERT 只填 name、
// label 留空会触发 "NOT NULL constraint failed: wb_palace_loci.label"。
{
  const locCols = sqlite.prepare(`PRAGMA table_info(wb_palace_loci)`).all() as Array<{ name: string }>;
  if (locCols.some((c) => c.name === 'label')) {
    sqlite.exec(`UPDATE wb_palace_loci SET name = COALESCE(NULLIF(name, ''), label) WHERE name IS NULL OR name = ''`);
    sqlite.exec(`ALTER TABLE wb_palace_loci DROP COLUMN label`); // 需 SQLite >= 3.35
  }
}

// 初始化默认分类（首次运行时）
const catCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM categories').get() as { c: number }).c;
if (catCount === 0) {
  const insert = sqlite.prepare('INSERT INTO categories (name, parent_id, sort) VALUES (?, 0, ?)');
  ['未分类', '工作', '学习', '生活'].forEach((name, i) => insert.run(name, i));
}

/* 收集箱示例数据：**仅在 wb_capture 整表为空时**注入，绝不覆盖用户已有数据。
 * 目的是让新用户首次打开 /inbox 就能看到「速记 / 网页剪藏 / 待读链接」三种形态，
 * 而不是一个空列表。created_at 刻意错开，用于验证时间线倒序。 */
{
  const capCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM wb_capture').get() as { c: number }).c;
  if (capCount === 0) {
    const now = Date.now();
    const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
    const seed = sqlite.prepare(
      `INSERT INTO wb_capture
         (user_id, title, content, source_type, source_url, cover_image, tags, status, starred, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, NULL, ?, 'INBOX', 0, ?, ?)`,
    );
    const rows: Array<[string, string, string, string | null, string, string]> = [
      [
        '今晚思考一下微服务的熔断机制如何抽象',
        '今晚思考一下微服务的熔断机制如何抽象。\n\n关键问题：熔断器的状态机（Closed / Open / Half-Open）能否抽出一层与具体传输协议无关的通用接口？如果能，Sentinel 和 Resilience4j 的差异就只剩配置层了。',
        'text',
        null,
        JSON.stringify(['灵感', '架构']),
        minutesAgo(6),
      ],
      [
        'Vue.js - 渐进式 JavaScript 框架',
        'Vue 是一款用于构建用户界面的 JavaScript 框架。它基于标准 HTML、CSS 和 JavaScript 构建，并提供了一套声明式的、组件化的编程模型。',
        'link',
        'https://cn.vuejs.org/',
        JSON.stringify(['网页剪藏', '前端']),
        minutesAgo(95),
      ],
      [
        'SQLite 的 WAL 模式到底快在哪',
        '写前日志（Write-Ahead Logging）让读写不再互斥，读事务可以和写事务并发执行。回头补一篇对比测试。',
        'link',
        'https://www.sqlite.org/wal.html',
        JSON.stringify(['待读']),
        minutesAgo(60 * 26),
      ],
      [
        '费曼学习法的第四步最容易被跳过',
        '大多数人做到「用简单语言复述」就停了，但真正拉开差距的是第四步——回到原始材料，补上复述时卡壳的地方。',
        'text',
        null,
        JSON.stringify(['灵感', '学习方法']),
        minutesAgo(60 * 50),
      ],
    ];
    for (const [title, content, type, url, tags, ts] of rows) {
      seed.run(title, content, type, url, tags, ts, ts);
    }
    console.log(`[knowflow-desktop] 收集箱示例数据已注入 (${rows.length} 条)`);
  }
}

export const db = drizzle(sqlite, { schema });

// 单本地用户
export const CURRENT_USER = 1;

export function nowIso(): string {
  return new Date().toISOString();
}
