import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';

// ===== 本地分类（替代线上 doc_category）=====
export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  parentId: integer('parent_id').notNull().default(0),
  sort: integer('sort').notNull().default(0),
});

// ===== 模块一：收集箱（字段与 Web 端 WbCapture 对齐）=====
export const wbCapture = sqliteTable('wb_capture', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(1),
  title: text('title').notNull(),
  content: text('content'),
  // Web: sourceType(MANUAL/DOC/WEB/AI/IMPORT) / sourceUrl / docId / tags
  sourceType: text('source_type'),
  sourceUrl: text('source_url'),
  docId: integer('doc_id'),
  categoryId: integer('category_id'),
  tags: text('tags'),
  // 状态大写对齐 Web：INBOX / PROCESSED / ARCHIVED / TRASHED
  // 收集箱（/api/inbox）对外暴露小写三态：unprocessed / archived / trashed，
  // 映射关系集中在 routes/inbox.ts 的 toStatusVO / toStatusDb，勿在别处硬编码。
  status: text('status').notNull().default('INBOX'),
  starred: integer('starred').notNull().default(0),
  // 网页剪藏封面图（og:image / favicon），仅收集箱卡片展示用
  coverImage: text('cover_image'),
  // 流转时间：条目被「沉淀为笔记 / 文档」的时刻，未流转为 null
  processedAt: text('processed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ===== 模块二：康奈尔笔记（字段与 Web 端 WbNote 对齐）=====
export const wbNote = sqliteTable('wb_note', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(1),
  captureId: integer('capture_id'),
  categoryId: integer('category_id'),
  title: text('title').notNull(),
  // Web: cueColumn / noteColumn / summaryColumn / tags / mastery
  cueColumn: text('cue_column').notNull().default(''),
  noteColumn: text('note_column').notNull().default(''),
  summaryColumn: text('summary_column').notNull().default(''),
  tags: text('tags'),
  mastery: integer('mastery').notNull().default(0),
  // 助记口诀 / 联想图像：与 wb_palace_loci.imageHint 同语义，供「AI 生成助记口诀 → 采纳」落库
  imageHint: text('image_hint'),
  // SRS 间隔重复（本表直接作为复习卡源，字段与 wb_review_card 的 SM-2 对齐）
  dueDate: text('due_date').notNull().default('1970-01-01T00:00:00.000Z'),
  easeFactor: integer('ease_factor').notNull().default(250),
  repetitions: integer('repetitions').notNull().default(0),
  intervalDay: integer('interval_day').notNull().default(0),
  lapseCount: integer('lapse_count').notNull().default(0),
  reviewCount: integer('review_count').notNull().default(0),
  lastReviewedAt: text('last_reviewed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ===== 模块三：间隔重复（SM-2）=====
export const wbReviewCard = sqliteTable('wb_review_card', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(1),
  captureId: integer('capture_id'),
  noteId: integer('note_id'),
  categoryId: integer('category_id'),
  front: text('front').notNull(),
  back: text('back').notNull().default(''),
  cardType: text('card_type').notNull().default('basic'),
  easeFactor: integer('ease_factor').notNull().default(250),
  repetitions: integer('repetitions').notNull().default(0),
  intervalDay: integer('interval_day').notNull().default(0),
  reviewCount: integer('review_count').notNull().default(0),
  lapseCount: integer('lapse_count').notNull().default(0),
  nextReviewTime: text('next_review_time').notNull(),
  lastReviewTime: text('last_review_time'),
  suspended: integer('suspended').notNull().default(0),
});

export const wbReviewLog = sqliteTable('wb_review_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(1),
  cardId: integer('card_id').notNull(),
  quality: integer('quality').notNull(),
  intervalDay: integer('interval_day').notNull(),
  easeFactor: integer('ease_factor').notNull(),
  costMs: integer('cost_ms'),
  reviewedAt: text('reviewed_at').notNull(),
  /** 卡源：'note' | 'loci' 由新 SRS 写入；NULL 表示旧卡组（card_id 指向 wb_review_card）。
   *  可空是刻意的——两套系统共用本表，历史行不回填，读侧按 NULL 回溯解析。 */
  sourceType: text('source_type'),
});

// ===== 模块三扩展：记忆宫殿（字段与 Web 端 WbPalace / WbPalaceLoci 对齐）=====
export const wbPalace = sqliteTable('wb_palace', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(1),
  name: text('name').notNull(),
  description: text('description'),
  // Web: theme(ROOM/STREET/CAMPUS/CUSTOM) / coverColor / categoryId
  theme: text('theme'),
  coverColor: text('cover_color'),
  categoryId: integer('category_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const wbPalaceLoci = sqliteTable('wb_palace_loci', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  palaceId: integer('palace_id').notNull(),
  userId: integer('user_id').notNull().default(1),
  // Web: name / knowledgePoint / imageHint / icon / posX / posY / sortOrder
  name: text('name').notNull(),
  knowledgePoint: text('knowledge_point'),
  imageHint: text('image_hint'),
  icon: text('icon'),
  posX: real('pos_x'),
  posY: real('pos_y'),
  sortOrder: integer('sort_order').notNull().default(0),
  captureId: integer('capture_id'),
  noteId: integer('note_id'),
  categoryId: integer('category_id'),
  // SRS 复习：熟练度 0-5（越高越熟），lastReviewedAt 记录最近一次打分时间
  masteredLevel: integer('mastered_level').notNull().default(0),
  lastReviewedAt: text('last_reviewed_at'),
  // SRS 间隔重复（字段与 wb_review_card 的 SM-2 对齐）
  dueDate: text('due_date').notNull().default('1970-01-01T00:00:00.000Z'),
  easeFactor: integer('ease_factor').notNull().default(250),
  repetitions: integer('repetitions').notNull().default(0),
  intervalDay: integer('interval_day').notNull().default(0),
  lapseCount: integer('lapse_count').notNull().default(0),
  reviewCount: integer('review_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ===== 模块三扩展：主动回忆（三轮闭卷默写，字段与 Web 端 WbRecallSession 对齐）=====
export const wbRecallSession = sqliteTable('wb_recall_session', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(1),
  noteId: integer('note_id'),
  cardId: integer('card_id'),
  title: text('title').notNull(),
  sourceText: text('source_text').notNull().default(''),
  // 三轮默写展开列（对齐 Web round1/2/3Text + Score）
  round1Text: text('round1_text'),
  round1Score: integer('round1_score'),
  round2Text: text('round2_text'),
  round2Score: integer('round2_score'),
  round3Text: text('round3_text'),
  round3Score: integer('round3_score'),
  currentRound: integer('current_round').notNull().default(1),
  // 状态大写：IN_PROGRESS / COMPLETED
  status: text('status').notNull().default('IN_PROGRESS'),
  round3DueTime: text('round3_due_time'),
  completedTime: text('completed_time'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ===== 模块四：费曼故事（字段与 Web 端 WbStory 对齐）=====
export const wbStory = sqliteTable('wb_story', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(1),
  captureId: integer('capture_id'),
  noteId: integer('note_id'),
  categoryId: integer('category_id'),
  title: text('title').notNull(),
  // Web: audience / metaphor / gapNote / clarityScore / wordCount
  audience: text('audience'),
  metaphor: text('metaphor'),
  content: text('content').notNull().default(''),
  gapNote: text('gap_note'),
  status: text('status').notNull().default('DRAFT'),
  clarityScore: integer('clarity_score'),
  wordCount: integer('word_count'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// ===== 模块五：番茄钟专注日志（每完成一段专注/休息落一行，统计图表的唯一数据源）=====
// 设计取舍：只记「已完成的时段」，不记进行中的状态——进行中的倒计时是前端内存态，
// 崩溃/退出后没有保留价值，落库只会产生一堆需要清理的僵尸行。
export const wbPomodoroLog = sqliteTable('wb_pomodoro_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(1),
  /** 时段开始时刻（ISO UTC，由 endTime - duration 反推，保证与 endTime 严格自洽） */
  startTime: text('start_time').notNull(),
  /** 时段结束时刻（ISO UTC，即客户端上报的那一刻） */
  endTime: text('end_time').notNull(),
  /** 时段类型：work / short_break / long_break（与前端 phase 同名，避免两侧再做映射） */
  type: text('type').notNull(),
  /** 实际时长（秒）：以「真实经过时间」为准，中途暂停不计入 */
  durationSeconds: integer('duration_seconds').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

// ===== P3-G3：内容向量索引（本地 embedding 存储，相似度在应用层计算）=====
export const wbEmbedding = sqliteTable('wb_embedding', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // 实体类型：capture / note / story
  entityType: text('entity_type').notNull(),
  entityId: integer('entity_id').notNull(),
  // 生成向量所用的模型（与配置中的 embeddingsModel 对齐）
  model: text('model').notNull(),
  // 向量维度
  dim: integer('dim').notNull(),
  // 向量本体，以 JSON 数组存储（better-sqlite3 无原生 vector 类型，应用层计算余弦相似度）
  vector: text('vector').notNull(),
  // 内容指纹（对正文做轻量 hash），用于判断是否需要重算
  contentHash: text('content_hash'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
