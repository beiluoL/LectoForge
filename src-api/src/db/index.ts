import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import {
  categories,
  wbCapture,
  wbPalace,
  wbPalaceLoci,
  wbHabit,
  wbHabitLog,
  wbQuadrantTask,
  wbTaskList,
} from './schema';
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
/* 收集箱主查询 = WHERE user_id = ? AND status = ? ORDER BY starred DESC, created_at DESC
 * （captureService.listCaptures）。把 status 放在 user_id 之后吃等值前缀，
 * created_at 收尾让排序直接走索引顺序，省掉 SQLite 的临时 B-tree 排序。
 * starred 刻意不入索引：它只有 0/1 两个值，选择性极低，加进去只会撑大索引页。 */
CREATE INDEX IF NOT EXISTS idx_wb_capture_status ON wb_capture (user_id, status, created_at);
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
/* 到期卡扫描 = WHERE user_id = ? AND due_date <= ?（reviewService.noteDueWhere）。
 * due_date 存 UTC ISO 串，字典序 === 时间序，所以范围比较能直接吃索引；
 * 一旦有人把条件写成 datetime(due_date) <= ? 索引立刻失效退化全表扫。 */
CREATE INDEX IF NOT EXISTS idx_wb_note_due ON wb_note (user_id, due_date);
/* 笔记列表默认按 updated_at 倒序（noteService.listNotes / searchNotes / backlinks）；
 * 没有这条索引时每次列表都要全表取出再排序，笔记上千条后翻页明显掉帧。 */
CREATE INDEX IF NOT EXISTS idx_wb_note_updated ON wb_note (user_id, updated_at);
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
/* 复习流水是**只增不减**的表：每答一张卡写一行，重度用户一年就是几万行。
 * 三个高频读全都以 reviewed_at 做范围过滤，缺索引时一律全表扫描：
 *   - getHeatmap        WHERE user_id = ? AND reviewed_at >= ?（近 N 天热力图）
 *   - getForgettingCurve 同上（遗忘曲线）
 *   - getReviewDay      WHERE user_id = ? AND reviewed_at BETWEEN ? AND ?（单日下钻）
 * reviewed_at 存 UTC ISO 串（字典序 === 时间序），范围比较可直接命中索引。 */
CREATE INDEX IF NOT EXISTS idx_wb_review_log_time ON wb_review_log (user_id, reviewed_at);
/* 单日下钻拿到流水后要按 card_id 回查源表标题；同时「某张卡的历史表现」也走这条。 */
CREATE INDEX IF NOT EXISTS idx_wb_review_log_card ON wb_review_log (card_id, reviewed_at);
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
/* 打开一座宫殿 = WHERE palace_id = ? ORDER BY sort_order, id
 * （palaceService.getPalaceWithLoci / listLoci / listDueLoci）。
 * sort_order 进索引后，位点顺序直接由索引给出，不再临时排序。 */
CREATE INDEX IF NOT EXISTS idx_wb_palace_loci_palace ON wb_palace_loci (palace_id, sort_order);
/* 与 idx_wb_note_due 对称：位点也是复习卡源，到期扫描走 user_id + due_date。 */
CREATE INDEX IF NOT EXISTS idx_wb_palace_loci_due ON wb_palace_loci (user_id, due_date);
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
CREATE TABLE IF NOT EXISTS wb_calendar_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  description TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  is_all_day INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#3B6FE0',
  location TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
/* 日历只有一种查询：某用户在某个时间窗内的事件。
 * (user_id, start_time) 让「翻到上个月」这类操作走索引区间扫描；
 * 前提是 start_time 永远是同格式的 UTC ISO 串（见 schema.ts 的时间存储口径），
 * 否则字符串比较的顺序就不等于时间顺序，索引会给出错误结果。 */
CREATE INDEX IF NOT EXISTS idx_wb_calendar_event_range ON wb_calendar_event (user_id, start_time);
/* ===== 任务清单（Things 3 模型）：wb_task_list + wb_task ===== */
CREATE TABLE IF NOT EXISTS wb_task_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'list',
  parent_id INTEGER,
  icon_name TEXT NOT NULL DEFAULT 'list',
  color TEXT NOT NULL DEFAULT '#3B6FE0',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wb_task_list_owner ON wb_task_list (user_id, parent_id, sort_order);
CREATE TABLE IF NOT EXISTS wb_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'inbox',
  completed INTEGER NOT NULL DEFAULT 0,
  list_id INTEGER,
  parent_task_id INTEGER,
  target_date TEXT,
  due_date TEXT,
  completed_at TEXT,
  tags TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
/* 侧边栏五个智能列表 = WHERE user_id = ? AND status = ?，全部吃这条索引；
 * 把 sort_order 也带进复合索引，让「按手工序输出」不再需要额外的 filesort。 */
CREATE INDEX IF NOT EXISTS idx_wb_task_status ON wb_task (user_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_wb_task_list_ref ON wb_task (user_id, list_id);
CREATE INDEX IF NOT EXISTS idx_wb_task_target_date ON wb_task (user_id, target_date);
/* ===== 模拟面试题库 ===== */
CREATE TABLE IF NOT EXISTS wb_qa_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  reference_answer TEXT NOT NULL DEFAULT '',
  scoring_points TEXT,
  source_type TEXT NOT NULL DEFAULT 'import',
  source_id INTEGER,
  tags TEXT,
  difficulty INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  idx INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wb_qa_bank_source ON wb_qa_bank (source_type);
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

/* ===================================================================
 * 一次性数据迁移：wb_daily_task → wb_task
 *
 * 幂等策略用 SQLite 内置的 `PRAGMA user_version`（整型，随库文件走），
 * 而**不是**「wb_task 表为空就搬」——后者有个致命缺陷：
 * 用户把搬过来的任务全删光之后，下次启动会被原样塞回来，删不掉。
 * user_version 是「这个库已经跑到第几号迁移」的单调计数器，只增不减。
 *
 * 版本号约定（新增迁移时往下追加，永远不要复用旧号）：
 *   0 → 1  wb_daily_task 搬入 wb_task
 *
 * 映射规则（与产品口径一致）：
 *   completed = 1                 → status 'logbook'，completed_at 回填 updated_at
 *   target_date == 今天(本机时区)  → status 'today'
 *   target_date >  今天            → status 'upcoming'
 *   target_date <  今天且未完成     → status 'today'
 *       ↑ 这条是刻意的：Things 3 里过期未做的事会浮到「今天」催你处理，
 *         若原样丢进 upcoming 会永远沉底，等于静默丢任务。
 *
 * 旧表**不删除、不清空**：日历联查与历史统计仍在读它，
 * 删表等于炸掉现有功能；两张表在过渡期并存由各自的 Service 负责去重。
 * =================================================================== */
{
  const SCHEMA_VERSION = 1;
  const row = sqlite.pragma('user_version', { simple: true }) as number;
  const current = typeof row === 'number' ? row : 0;

  if (current < 1) {
    try {
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const ts = d.toISOString();

      const legacy = sqlite
        .prepare(
          `SELECT id, user_id, target_date, content, completed, updated_at, created_at
             FROM wb_daily_task ORDER BY target_date ASC, id ASC`,
        )
        .all() as Array<{
        id: number;
        user_id: number;
        target_date: string;
        content: string;
        completed: number;
        updated_at: string | null;
        created_at: string | null;
      }>;

      if (legacy.length > 0) {
        const insert = sqlite.prepare(
          `INSERT INTO wb_task
             (user_id, title, notes, status, completed, list_id, parent_task_id,
              target_date, due_date, completed_at, tags, sort_order, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, NULL, NULL, ?, NULL, ?, '日程迁移', ?, ?, ?)`,
        );

        // better-sqlite3 的事务回调**必须是同步函数**：写成 async 会在第一个
        // await 处提前提交，后半段插入就落在事务之外，失败时无法整体回滚。
        const run = sqlite.transaction((rows: typeof legacy) => {
          rows.forEach((r, i) => {
            const done = Number(r.completed) === 1;
            const date = r.target_date;
            let status: string;
            if (done) status = 'logbook';
            else if (date > today) status = 'upcoming';
            else status = 'today'; // 今天 + 已过期未完成，都浮到「今天」
            insert.run(
              r.user_id ?? 1,
              r.content,
              status,
              done ? 1 : 0,
              date,
              done ? (r.updated_at ?? ts) : null,
              i,
              r.created_at ?? ts,
              r.updated_at ?? ts,
            );
          });
          return rows.length;
        });

        const n = run(legacy);
        console.log(`[lectoforge-desktop] 数据迁移完成：wb_daily_task → wb_task（${n} 条）`);
      }

      sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);
    } catch (e) {
      // 迁移失败不阻断启动：新表照样可用，用户手动补录即可；
      // 不推进 user_version，下次启动会重试。
      console.error('[lectoforge-desktop] wb_daily_task → wb_task 迁移失败', e);
    }
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

/* ---- 任务清单：预置三个清单骨架（不预置任务本身）。
 * 只播清单不播任务，是刻意的：任务是极私人的东西，塞几条假待办进「今天」
 * 会让用户第一眼就想删；而空空如也的侧边栏又让人不知道「清单」这个概念存在。
 * 给三个空容器，既示范了 area / project / list 三种类型的差别，又不脏数据。 ---- */
seedIfEmpty(wbTaskList, '默认任务清单', () => {
  const now = nowIso();
  const rows = [
    { name: '个人', type: 'area', iconName: 'user', color: '#3B6FE0' },
    { name: '工作', type: 'area', iconName: 'briefcase', color: '#8E7CFF' },
    { name: '学习计划', type: 'project', iconName: 'graduation-cap', color: '#F0A020' },
  ];
  db.insert(wbTaskList)
    .values(
      rows.map((r, i) => ({
        userId: CURRENT_USER,
        name: r.name,
        type: r.type,
        parentId: null,
        iconName: r.iconName,
        color: r.color,
        sortOrder: i,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run();
  return rows.length;
});

/* ---- 日历：不再预置示例事件。
 * 日历事件一律来自真实业务数据（用户自建事件 + 来自「日程计划」wb_daily_task 的每日任务），
 * 不再注入 demo 数据，避免「假数据」混在真实日程里。空日历由前端的空态 UI 兜底。 ---- */
