import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import { categories, wbCapture, wbPalace, wbPalaceLoci, wbHabit, wbHabitLog, wbQuadrantTask } from './schema';
import { getDbPath } from '../lib/paths';

/* 库文件位置全权交给 lib/paths：打包后落在宿主注入的 LECTOFORGE_DATA_DIR
 * （macOS: ~/Library/Application Support/com.lectoforge.desktop/workbench.db），
 * 开发期落在 <src-api>/data/workbench.db；目录创建与可写校验由 paths 负责。 */
const dbPath = getDbPath();
console.log(`[lectoforge-desktop] SQLite: ${dbPath}`);

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
CREATE TABLE IF NOT EXISTS wb_task_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  tasks TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wb_daily_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  target_date TEXT NOT NULL,
  content TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  parent_template_id INTEGER,
  repeat_rule TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wb_daily_task_date ON wb_daily_task (target_date);
CREATE INDEX IF NOT EXISTS idx_wb_daily_task_tpl ON wb_daily_task (parent_template_id);
CREATE TABLE IF NOT EXISTS wb_habit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  description TEXT,
  icon_name TEXT NOT NULL DEFAULT 'check-circle',
  color TEXT NOT NULL DEFAULT '#3B6FE0',
  frequency TEXT NOT NULL DEFAULT 'DAILY',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wb_habit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL DEFAULT 1,
  log_date TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wb_habit_log_uniq ON wb_habit_log (habit_id, log_date);
CREATE INDEX IF NOT EXISTS idx_wb_habit_log_date ON wb_habit_log (log_date);
CREATE TABLE IF NOT EXISTS wb_quadrant_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  description TEXT,
  quadrant TEXT NOT NULL DEFAULT 'urgent-important',
  completed INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT,
  tags TEXT,
  source TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
/* 四象限列表页只有一种查询形态：「某用户的全部任务，按象限分桶」。
 * 复合索引 (user_id, quadrant) 让这条查询走索引扫描而非全表，
 * 顺带覆盖未来「只刷新某一个象限」的增量拉取。 */
CREATE INDEX IF NOT EXISTS idx_wb_quadrant_task_user_q ON wb_quadrant_task (user_id, quadrant);
CREATE INDEX IF NOT EXISTS idx_wb_quadrant_task_done ON wb_quadrant_task (completed);
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
/* 复习流水补列：source_type 标记这条流水属于哪套卡源。
 * ⚠️ wb_review_log 是**两套复习系统共用**的表：
 *   - 新 SRS（/api/reviews/*）写 'note' / 'loci'，card_id 指向 wb_note / wb_palace_loci；
 *   - 旧卡组（/api/workbench/reviews/*）历史上不写该列，card_id 指向 wb_review_card。
 * 因此列可空：NULL 一律按「旧卡组」回溯解析，历史数据无需回填。
 * 没有这一列时，card_id=5 到底是笔记 5 还是位点 5 无法区分，日复盘会张冠李戴。 */
addColumn('wb_review_log', 'source_type', 'TEXT');
/* 康奈尔笔记补 image_hint：让「AI 助记口诀」可以像记忆宫殿位点一样落库。
 * wb_palace_loci 早就有该列，wb_note 此前没有，采纳口诀时无处可写。 */
addColumn('wb_note', 'image_hint', 'TEXT');

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

export const db = drizzle(sqlite, { schema });

// 单本地用户
export const CURRENT_USER = 1;

export function nowIso(): string {
  return new Date().toISOString();
}

/* ===================================================================
 * 种子数据（Seed Data）
 *
 * 这不是「模拟数据」——它们是**真正写进 SQLite 的真实行**，用户可以编辑、
 * 删除、复习，与自己创建的数据没有任何区别。前端不得再持有任何硬编码副本。
 *
 * 三条铁律：
 * 1) 幂等：只在目标表**整表为空**时写入。用户删光了示例也不会被反复塞回来。
 * 2) 可辨识：文案带「示例 / 演示」前缀或标签，用户一眼知道这是可删的引导内容。
 * 3) 同步：better-sqlite3 是同步 API，播种全程不得引入 async/await。
 * =================================================================== */

/** 表是否为空（SELECT COUNT(*) === 0），幂等播种的唯一判据 */
function isTableEmpty(table: SQLiteTable): boolean {
  const row = db.select({ count: sql<number>`count(*)` }).from(table).get();
  return (row?.count ?? 0) === 0;
}

/**
 * 幂等播种器：表为空才执行 insert，并打印注入条数。
 * insert 回调必须是同步函数并返回写入行数（better-sqlite3 同步 API 红线）。
 */
function seedIfEmpty(table: SQLiteTable, label: string, insert: () => number): void {
  if (!isTableEmpty(table)) return;
  try {
    const n = insert();
    console.log(`[lectoforge-desktop] 种子数据已注入：${label}（${n} 条）`);
  } catch (e) {
    // 播种失败不能阻断应用启动：大不了首屏是空态，用户照样能自己创建
    console.error(`[lectoforge-desktop] 种子数据注入失败：${label}`, e);
  }
}

// ---- 分类：四个基础分类，用户可在设置里改名/新增 ----
seedIfEmpty(categories, '默认分类', () => {
  const rows = ['未分类', '工作', '学习', '生活'].map((name, sort) => ({ name, parentId: 0, sort }));
  db.insert(categories).values(rows).run();
  return rows.length;
});

/* ---- 收集箱：让新用户首次打开 /inbox 就能看到「速记 / 网页剪藏 / 待读链接」
 * 三种形态，而不是一个空列表。createdAt 刻意错开，同时验证时间线倒序。
 * 每条都带「示例」标签，方便用户识别并批量清理。 ---- */
seedIfEmpty(wbCapture, '收集箱示例条目', () => {
  const now = Date.now();
  const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
  const rows = [
    {
      title: '今晚思考一下微服务的熔断机制如何抽象',
      content:
        '今晚思考一下微服务的熔断机制如何抽象。\n\n关键问题：熔断器的状态机（Closed / Open / Half-Open）能否抽出一层与具体传输协议无关的通用接口？如果能，Sentinel 和 Resilience4j 的差异就只剩配置层了。',
      sourceType: 'text',
      sourceUrl: null as string | null,
      tags: ['示例', '灵感', '架构'],
      at: minutesAgo(6),
    },
    {
      title: 'Vue.js - 渐进式 JavaScript 框架',
      content:
        'Vue 是一款用于构建用户界面的 JavaScript 框架。它基于标准 HTML、CSS 和 JavaScript 构建，并提供了一套声明式的、组件化的编程模型。',
      sourceType: 'link',
      sourceUrl: 'https://cn.vuejs.org/',
      tags: ['示例', '网页剪藏', '前端'],
      at: minutesAgo(95),
    },
    {
      title: 'SQLite 的 WAL 模式到底快在哪',
      content:
        '写前日志（Write-Ahead Logging）让读写不再互斥，读事务可以和写事务并发执行。回头补一篇对比测试。',
      sourceType: 'link',
      sourceUrl: 'https://www.sqlite.org/wal.html',
      tags: ['示例', '待读'],
      at: minutesAgo(60 * 26),
    },
    {
      title: '费曼学习法的第四步最容易被跳过',
      content:
        '大多数人做到「用简单语言复述」就停了，但真正拉开差距的是第四步——回到原始材料，补上复述时卡壳的地方。',
      sourceType: 'text',
      sourceUrl: null as string | null,
      tags: ['示例', '灵感', '学习方法'],
      at: minutesAgo(60 * 50),
    },
  ];
  db.insert(wbCapture)
    .values(
      rows.map((r) => ({
        userId: CURRENT_USER,
        title: r.title,
        content: r.content,
        sourceType: r.sourceType,
        sourceUrl: r.sourceUrl,
        coverImage: null,
        tags: JSON.stringify(r.tags),
        // ⚠️ 大写状态机：wb_capture 存 INBOX/PROCESSED/ARCHIVED/TRASHED。
        // /api/inbox 对外的小写三态由 inboxService 的 toStatusVO/toStatusDb 映射，勿在此统一。
        status: 'INBOX',
        starred: 0,
        createdAt: r.at,
        updatedAt: r.at,
      })),
    )
    .run();
  return rows.length;
});

/* ---- 记忆宫殿：「并发编程公寓」演示宫殿 + 8 个位点。
 * 这份数据原先硬编码在前端 store（MOCK_LOCI，纯本地不落库，拖拽/复习进度刷新即丢），
 * 现下沉为真实数据库行：可拖拽落库、可 AI 扩写、可参与 SM-2 复习统计。 ---- */
seedIfEmpty(wbPalace, '演示记忆宫殿', () => {
  const now = nowIso();
  const palace = db
    .insert(wbPalace)
    .values({
      userId: CURRENT_USER,
      name: '✨ 演示宫殿 - 并发编程公寓',
      description: '示例宫殿，点击编辑替换为你自己的空间；不需要可直接删除',
      theme: 'ROOM',
      coverColor: '#3B6FE0',
      categoryId: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  const loci = [
    {
      name: '玄关鞋柜',
      knowledgePoint:
        '进程 vs 线程：进程是资源分配的基本单位，线程是 CPU 调度的基本单位，一个进程可含多个线程并共享内存',
      imageHint: '一只巨大的货架（进程）上挂着好几只敏捷的小猴子（线程）一起搬同一批货',
      icon: 'server',
      posX: 15,
      posY: 20,
    },
    {
      name: '客厅沙发',
      knowledgePoint: '并发 vs 并行：并发是同一时段交替处理多任务，并行是同一时刻同时执行多任务',
      imageHint: '一个人左右手同时耍两球（并发）vs 两人在两台机器上各耍一球（并行）',
      icon: 'git-compare',
      posX: 40,
      posY: 15,
    },
    {
      name: '厨房灶台',
      knowledgePoint: '锁与互斥：用锁保证同一时间只有一个线程进入临界区，避免竞态条件',
      imageHint: '一扇只挂一把钥匙的卫生间门，谁拿钥匙谁进，其他人门外排队',
      icon: 'lock',
      posX: 68,
      posY: 22,
    },
    {
      name: '卧室床头',
      knowledgePoint: '死锁：互斥、占有且等待、不可剥夺、循环等待四个条件同时成立时发生',
      imageHint: '两只人偶各拿一根筷子互相等对方先放下，僵在原地谁也走不了',
      icon: 'link-2',
      posX: 88,
      posY: 35,
    },
    {
      name: '书房书桌',
      knowledgePoint: 'volatile：保证变量在多线程间的可见性，但不保证复合操作的原子性',
      imageHint: '一块大黑板，谁写一笔所有人立刻看到，但两人同时擦写会糊成一团',
      icon: 'eye',
      posX: 20,
      posY: 50,
    },
    {
      name: '阳台花架',
      knowledgePoint: 'CAS（Compare And Swap）：无锁原子操作，比较旧值相等才更新，失败则重试',
      imageHint: '自动售货机核对你投的币和标价一致才吐货，不一致就退币让你重投',
      icon: 'repeat',
      posX: 50,
      posY: 55,
    },
    {
      name: '卫生间',
      knowledgePoint: '线程池：预先创建一组可复用线程，避免频繁创建/销毁开销，有核心与最大线程数',
      imageHint: '一排随时待命的出租车，客人（任务）来了直接上车走，不用现造一辆车',
      icon: 'users',
      posX: 78,
      posY: 60,
    },
    {
      name: '走廊尽头',
      knowledgePoint: 'ThreadLocal：线程私有变量，每个线程持有独立副本，互不干扰',
      imageHint: '每个人手腕上专属的手环，存自己的东西，别人看不见也拿不到',
      icon: 'user-round',
      posX: 45,
      posY: 85,
    },
  ];

  db.insert(wbPalaceLoci)
    .values(
      loci.map((l, i) => ({
        palaceId: palace.id,
        userId: CURRENT_USER,
        name: l.name,
        knowledgePoint: l.knowledgePoint,
        imageHint: l.imageHint,
        icon: l.icon,
        posX: l.posX,
        posY: l.posY,
        sortOrder: i + 1,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run();
  return loci.length;
});

/* ---- 习惯打卡：两个示例习惯，让新用户首次打开 /habits 就能看到可打卡的卡片 ---- */
seedIfEmpty(wbHabit, '示例习惯', () => {
  const now = nowIso();
  const rows = [
    { name: '每日阅读', description: '示例习惯，可删除或编辑', iconName: 'book-open', color: '#3B6FE0', frequency: 'DAILY' },
    { name: '早起打卡', description: '示例习惯，可删除或编辑', iconName: 'sunrise', color: '#F59E0B', frequency: 'DAILY' },
  ];
  db.insert(wbHabit)
    .values(
      rows.map((r) => ({
        userId: CURRENT_USER,
        name: r.name,
        description: r.description,
        iconName: r.iconName,
        color: r.color,
        frequency: r.frequency,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run();
  return rows.length;
});

/* ---- 四象限：每格各放 1~2 条示例，让新用户首次打开 /quadrant 就能看懂
 * 「紧急 × 重要」这两个轴到底怎么分，而不是面对四个空盒子发呆。
 * 刻意留一条已完成项（completed: 1），顺带演示「已完成」折叠区的存在。 ---- */
seedIfEmpty(wbQuadrantTask, '四象限示例任务', () => {
  const now = nowIso();
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const rows: Array<{
    title: string;
    description: string | null;
    quadrant: string;
    completed: number;
    scheduledAt: string | null;
    tags: string;
  }> = [
    {
      title: '🔥 修复线上登录失败的告警',
      description: '示例任务：这类「不做会立刻出事」的活儿放第一象限，今天就得清掉。',
      quadrant: 'urgent-important',
      completed: 0,
      scheduledAt: inHours(3),
      tags: '示例,工作',
    },
    {
      title: '📮 回复客户的合同确认邮件',
      description: null,
      quadrant: 'urgent-important',
      completed: 1,
      scheduledAt: null,
      tags: '示例',
    },
    {
      title: '📚 每天读 30 分钟专业书',
      description: '示例任务：第二象限是「长期最值钱、却最容易被挤掉」的事，要主动排进日程。',
      quadrant: 'not-urgent-important',
      completed: 0,
      scheduledAt: inHours(26),
      tags: '示例,成长',
    },
    {
      title: '🏋️ 每周三次力量训练',
      description: null,
      quadrant: 'not-urgent-important',
      completed: 0,
      scheduledAt: null,
      tags: '示例,健康',
    },
    {
      title: '📞 临时插进来的会议邀约',
      description: '示例任务：第三象限看着急，其实对你的目标没什么贡献——能授权就授权。',
      quadrant: 'urgent-not-important',
      completed: 0,
      scheduledAt: inHours(5),
      tags: '示例',
    },
    {
      title: '📺 刷短视频 / 无目的闲逛',
      description: '示例任务：第四象限是纯消耗，看到它出现在列表里，本身就是一种提醒。',
      quadrant: 'not-urgent-not-important',
      completed: 0,
      scheduledAt: null,
      tags: '示例',
    },
  ];
  db.insert(wbQuadrantTask)
    .values(
      rows.map((r, i) => ({
        userId: CURRENT_USER,
        title: r.title,
        description: r.description,
        quadrant: r.quadrant,
        completed: r.completed,
        scheduledAt: r.scheduledAt,
        tags: r.tags,
        source: 'seed',
        sortOrder: i,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run();
  return rows.length;
});
