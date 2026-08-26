import { sqliteTable, integer, text, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

// ===== 模块六：日程计划 / 每日任务 =====
// wb_task_template：用户保存的「每日任务模板」（如「晨间 Routine」「备考日」），
// 任务清单以 JSON 存于 tasks 列，结构见 types/schedule.ts 的 TemplateTask。
// wb_daily_task：某一天实际要做的任务；手动/批量添加的 parentTemplateId 为 NULL，
// 由模板生成（含重复规则推导）的带 parentTemplateId 与 repeatRule。
export const wbTaskTemplate = sqliteTable('wb_task_template', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(1),
  name: text('name').notNull(),
  // 任务清单 JSON：[{ content: string, time?: string, repeatRule?: RepeatRule | null }]
  tasks: text('tasks').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const wbDailyTask = sqliteTable('wb_daily_task', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(1),
  // 目标日期 YYYY-MM-DD（本机时区自然日，与 wb_pomodoro_log 聚合口径一致，绝不用 UTC 日）
  targetDate: text('target_date').notNull(),
  content: text('content').notNull(),
  // 完成态 0/1：按日期独立存储，单日勾选不影响其它日期的同一重复任务
  completed: integer('completed').notNull().default(0),
  // 来源模板 id（手动添加 / 批量添加为 NULL）
  parentTemplateId: integer('parent_template_id'),
  // 重复规则 JSON：{ type:'daily', interval } | { type:'weekly', days:[0-6] } | { type:'monthly', day }
  // 非重复任务为 NULL（空串也视为 NULL，避免 '' 被 JSON.parse 炸库）
  repeatRule: text('repeat_rule'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/* ===== 模块六·二代：任务清单（对标 Things 3）=====
 * 取代 wb_daily_task「一天一张平铺清单」的旧模型，改为 Things 3 的
 * 「状态 + 清单 + 层级」三维模型。旧表**保留不删**（日历/统计仍在读），
 * 数据由 db/index.ts 的 migrateDailyTasksIntoTasks() 一次性搬迁。
 *
 * 为什么 status 用单列字符串枚举，而不是 isInbox / isToday 一堆布尔：
 * - Things 3 的五个「智能列表」（收件箱/今天/计划/随时/某天）在语义上**互斥**，
 *   一个任务同一时刻只可能待在一个筐里，天然是枚举而非位标记；
 * - 侧边栏每个入口 = 一次 `WHERE status = ?`，能直接吃 (user_id, status) 索引；
 *   布尔矩阵则要写成一串 AND/OR 组合，且无法用同一个索引。
 *
 * 🔴 status 与 completed 的分工（极易写错，务必分清）：
 * - completed 是**事实**：这件事做完了没有（0/1）；
 * - status 是**归属**：它现在应该出现在哪个视图里。
 *   勾选完成 → completed=1 且 status 落到 'logbook'（日志本），
 *   取消勾选 → completed=0 且 status 依据 targetDate 回推
 *   （有今天的日期回 'today'，有未来日期回 'upcoming'，都没有回 'inbox'）。
 *   这条回推规则唯一收口在 services/taskService.ts 的 deriveStatus()。
 *
 * 层级：parentTaskId 自引用（逻辑外键，库级 foreign_keys = OFF），
 * 只做**一层**子任务（Things 3 的 Checklist 语义），不做无限递归树；
 * 树的拼装在 JS 层完成（better-sqlite3 是同步 API，递归 CTE 反而更慢更难读）。
 */
export const wbTaskList = sqliteTable(
  'wb_task_list',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().default(1),
    name: text('name').notNull(),
    /** 'list' 普通清单 | 'project' 项目（带进度条）| 'area' 领域（可容纳子清单） */
    type: text('type').notNull().default('list'),
    /** 父清单 id：area 下可挂 list/project；顶层为 NULL */
    parentId: integer('parent_id'),
    iconName: text('icon_name').notNull().default('list'),
    color: text('color').notNull().default('#3B6FE0'),
    /** 侧边栏手工排序位，越小越靠前 */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    ownerIdx: index('idx_wb_task_list_owner').on(t.userId, t.parentId, t.sortOrder),
  }),
);

export const wbTask = sqliteTable(
  'wb_task',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().default(1),
    title: text('title').notNull(),
    /** 备注（Things 3 的 Notes），纯文本 */
    notes: text('notes'),
    /** 'inbox' | 'today' | 'upcoming' | 'someday' | 'logbook' | 'completed' */
    status: text('status').notNull().default('inbox'),
    /** 0 未完成 / 1 已完成 */
    completed: integer('completed').notNull().default(0),
    /** 所属清单 id；NULL = 未归档（收件箱） */
    listId: integer('list_id'),
    /** 父任务 id；非 NULL 即为子任务（仅一层） */
    parentTaskId: integer('parent_task_id'),
    /** 「什么时候做」YYYY-MM-DD 本机自然日；Things 3 的 When */
    targetDate: text('target_date'),
    /** 「什么时候到期」YYYY-MM-DD；Things 3 的 Deadline，红色角标 */
    dueDate: text('due_date'),
    /** 完成时刻 UTC ISO 串，用于日志本按时间倒序 */
    completedAt: text('completed_at'),
    /** 逗号分隔标签串，与 wb_capture / wb_quadrant_task 口径一致 */
    tags: text('tags'),
    /** 列表内手工排序位，越小越靠前 */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    /* 侧边栏五个智能列表全是 WHERE user_id = ? AND status = ?，走这条索引 */
    statusIdx: index('idx_wb_task_status').on(t.userId, t.status, t.sortOrder),
    /* 清单详情页 WHERE user_id = ? AND list_id = ? */
    listIdx: index('idx_wb_task_list_ref').on(t.userId, t.listId),
    /* 日历联查按 target_date 区间扫描 */
    dateIdx: index('idx_wb_task_target_date').on(t.userId, t.targetDate),
  }),
);

// ===== P3-G3：内容向量索引（本地 embedding 存储，相似度在应用层计算）=====
// ⚠️ entityId 用 TEXT 而非 INTEGER：文档库(.md)的实体标识是 POSIX 相对路径字符串
// （如 "折子/并发编程指南.md"），capture/note/story 则是数字 id；统一以字符串存储，
// 读取时按 entityType 决定是否需要 Number() 还原。该表是纯本地缓存，重建索引即可重算。
export const wbEmbedding = sqliteTable('wb_embedding', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // 实体类型：doc / capture / note / story
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
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

// ===== 模块七：习惯打卡（每日微习惯 + 连续打卡热力图）=====
// wb_habit：用户定义的日常习惯（如「每日阅读」「早起」）。
// wb_habit_log：某天对某习惯的打卡记录；同一 (habit_id, log_date) 唯一，toggle 走 upsert。
// 逻辑外键（habit_id → wb_habit.id）由应用层维护，库级 foreign_keys = OFF。
export const wbHabit = sqliteTable('wb_habit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(1),
  name: text('name').notNull(),
  description: text('description'),
  iconName: text('icon_name').notNull().default('check-circle'),
  color: text('color').notNull().default('#3B6FE0'),
  frequency: text('frequency').notNull().default('DAILY'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const wbHabitLog = sqliteTable(
  'wb_habit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    habitId: integer('habit_id').notNull(),
    userId: integer('user_id').notNull().default(1),
    logDate: text('log_date').notNull(),
    status: integer('status').notNull().default(0),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    uniqHabitDate: uniqueIndex('idx_wb_habit_log_uniq').on(t.habitId, t.logDate),
  }),
);

/* ===== 模块八：四象限（艾森豪威尔矩阵 / Eisenhower Matrix）=====
 * 把「紧迫性 × 重要性」两个维度数据化，用一张扁平表承载 2×2 网格。
 *
 * 为什么 quadrant 用字符串枚举而不是两个布尔列（urgent / important）：
 * - 前端渲染、后端分组、拖拽换象限全都以「一个象限」为原子单位，
 *   单列枚举可以一次 WHERE / GROUP BY 搞定，两个布尔列则要处处写组合条件；
 * - 未来若要加「未分类 / 待定」第五态，加一个枚举值即可，布尔组合则表达不了。
 *
 * 枚举值刻意使用连字符（urgent-important），与 API 响应里的分组键
 * （urgent_important，下划线）**不是同一套写法**：库里存的是业务枚举，
 * 响应键是 JSON 字段名。两者的映射唯一收口在 services/quadrantService.ts
 * 的 QUADRANT_KEYS，任何地方都不得再手写这层转换。
 */
export const wbQuadrantTask = sqliteTable('wb_quadrant_task', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(1),
  title: text('title').notNull(),
  description: text('description'),
  /** 'urgent-important' | 'not-urgent-important' | 'urgent-not-important' | 'not-urgent-not-important' */
  quadrant: text('quadrant').notNull().default('urgent-important'),
  /** 0 未完成 / 1 已完成（SQLite 无 boolean，沿用全项目 INTEGER 0/1 口径） */
  completed: integer('completed').notNull().default(0),
  /** 计划时间 ISO 字符串；null 表示未排期 */
  scheduledAt: text('scheduled_at'),
  /** 逗号分隔的标签串，与 wb_capture / wb_note 的 tags 口径一致 */
  tags: text('tags'),
  /** 来源标记（inbox / note / manual…），供后续「收集箱 → 四象限」流转追溯 */
  source: text('source'),
  /** 象限内手工排序位（拖拽预留，越小越靠前） */
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/* ===== 模块九：日历视图（月 / 周 / 日 三视图共用的时间轴事件）=====
 * 与既有的 wb_daily_task（日程计划）刻意分表，别合并：
 * - wb_daily_task 回答「今天这几件事做没做」，是**带完成状态的清单**，按 target_date 归属某一天；
 * - wb_calendar_event 回答「几点到几点被占用了」，是**带时间区间的日程**，可跨天、可全天、
 *   没有完成态。二者的查询形态（一天一列表 vs 一段时间范围内的重叠事件）与
 *   渲染形态（勾选框 vs 时间轴色块）都不一样，硬塞进一张表会让两边都别扭。
 *
 * 🔴 时间存储口径（全表铁律）：start_time / end_time 一律是
 *    `new Date(x).toISOString()` 产出的 **UTC ISO 串**（形如 2026-08-09T06:00:00.000Z）。
 *    统一格式带来一个关键性质——**字符串字典序 === 时间先后序**，
 *    因此范围查询可以直接用 SQLite 的字符串比较走索引，无需 datetime() 函数包裹
 *    （一旦包裹，idx_wb_calendar_event_range 就失效，退化成全表扫描）。
 *    写入前的归一化唯一收口在 services/calendarService.ts 的 normalizeIso()。
 *
 * end_time 允许为 NULL，表示「单点事件」（如 09:00 的提醒），
 * 查询重叠时用 coalesce(end_time, start_time) 兜底，见 listEventsInRange()。
 */
export const wbCalendarEvent = sqliteTable(
  'wb_calendar_event',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().default(1),
    title: text('title').notNull(),
    description: text('description'),
    /** 开始时刻，UTC ISO 串，必填 */
    startTime: text('start_time').notNull(),
    /** 结束时刻，UTC ISO 串；NULL = 单点事件 */
    endTime: text('end_time'),
    /** 0 定时事件 / 1 全天事件（SQLite 无 boolean，沿用全项目 INTEGER 0/1 口径） */
    isAllDay: integer('is_all_day').notNull().default(0),
    /** 事件色，十六进制串（如 #3B6FE0）。库里只存这一个值，
     *  柔和背景由前端用 color-mix 派生，避免再存一列冗余的浅色。 */
    color: text('color').notNull().default('#3B6FE0'),
    location: text('location'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    /* 日历唯一的查询形态就是「某用户 + 某时间窗内的事件」，
     * (user_id, start_time) 复合索引让翻月/翻周走索引区间扫描而非全表。 */
    rangeIdx: index('idx_wb_calendar_event_range').on(t.userId, t.startTime),
  }),
);

/* ===== 纪念日 / 生日（每年或每月重复的日期，与日历事件独立）=====
 * 关键设计：**绝不写入 wb_calendar_event**——那是一条一条的具体事件，需要每年复制；
 * 纪念日是「每年重复」的模板，date 存 MM-DD（如 03-15），渲染时由前端把当前年
 * 拼上 MM-DD 与日历格比对，天然每年自动出现，无需任何复制。
 *
 * repeat_rule 支持两种：
 * - 'yearly'  每年重复（生日、结婚纪念日等），date 为 MM-DD；
 * - 'monthly' 每月重复（还贷日、发薪日等），date 为 DD（仅日，忽略月）。
 *
 * year 为可选「起始年份」：null 表示不限；设置了则只有 >= year 的年份才显示
 * （如只纪念「出生后的年份」，避免 2000 年以前的空转）。
 */
export const wbAnniversary = sqliteTable(
  'wb_anniversary',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().default(1),
    /** 纪念日名称（如 小明的生日 / 结婚纪念日） */
    name: text('name').notNull(),
    /** lucide 图标名（如 heart / cake / gift），默认 heart */
    iconName: text('icon_name').notNull().default('heart'),
    /** 日期：yearly 存 MM-DD（如 03-15）；monthly 存 DD（如 15） */
    date: text('date').notNull(),
    /** 起始年份（可选）：null = 不限；设置后仅 >= 该年的年份显示 */
    year: integer('year'),
    /** 重复规则：yearly（每年）/ monthly（每月） */
    repeatRule: text('repeat_rule').notNull().default('yearly'),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    /* 唯一查询形态：某用户的全部纪念日（数据量小，全量拉取无压力），
     * 按名称排序保证列表稳定；user_id 索引是隔离单用户数据的基线。 */
    ownerIdx: index('idx_wb_anniversary_owner').on(t.userId),
  }),
);

/* ===== 模块十：模拟面试题库（离线语音面试/通话的素材层）=====
 * 统一题库：手动导入面经（Markdown/PDF）+ 复用 wb_review_card（问答卡）与 wb_note（康奈尔笔记）。
 * 答案评分复用 recallService 的关键词命中率逻辑（scoreRecall）。
 *
 * createdAt 用 INTEGER（epoch 毫秒）而非 ISO 串：题库条目按 idx 顺序 + 时间排序即可，
 * 不需要跨时区对齐，整数比较比字符串更快也更直观；idx 为手动/导入序位（NULL 表示未排序）。
 */
export const wbQaBank = sqliteTable('wb_qa_bank', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  question: text('question').notNull(),
  referenceAnswer: text('reference_answer').notNull().default(''),
  /** 评分要点（可选，供面试官/用户复盘），存 JSON 数组或纯文本，NULL 表示无 */
  scoringPoints: text('scoring_points'),
  /** 来源类型：import（手动/面经导入）| review_card（复习卡）| note（康奈尔笔记） */
  sourceType: text('source_type').notNull().default('import'),
  /** 来源行 id：review_card → wb_review_card.id，note → wb_note.id；手动导入为 NULL */
  sourceId: integer('source_id'),
  /** 逗号分隔标签串，与 wb_capture / wb_note 口径一致 */
  tags: text('tags'),
  /** 难度 1~5，默认 1 */
  difficulty: integer('difficulty').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  /** 排序位，越小越靠前；NULL 表示按入库时间 */
  idx: integer('idx'),
});

// ===== AI 助手 / 多轮对话（对标 DeepSeek 网页端体验）=====
// 会话表 + 消息表，全部走 better-sqlite3 同步 API，删除会话时事务级联删消息。
// createdAt / updatedAt 用 TEXT(ISO) 与项目其它表保持一致，便于排序与展示。
export const wbAiConversation = sqliteTable('wb_ai_conversation', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(1),
  title: text('title').notNull().default('新对话'),
  /** 置顶标记：0 未置顶，1 置顶；列表按 pinned 降序、updated_at 降序排列 */
  pinned: integer('pinned').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const wbAiMessage = sqliteTable(
  'wb_ai_message',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 所属会话 id（逻辑外键，关联 wb_ai_conversation.id，级联删除由 Service 事务维护） */
    conversationId: integer('conversation_id').notNull(),
    /** 'user' 用户提问 / 'assistant' AI 回答 */
    role: text('role').notNull(),
    /** 消息正文（Markdown，AI 回答含代码块等富文本） */
    content: text('content').notNull(),
    /** 知识库检索来源（RagSource[] 的 JSON 字符串），可空；无引用时存 NULL */
    sourceRefs: text('source_refs'),
    /** 消息评分：'like' 赞 / 'dislike' 踩 / 'none' 无（默认） */
    rating: text('rating').notNull().default('none'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    // 按会话拉取消息走「会话 + 时间」复合索引，避免全表扫描
    convIdx: index('idx_wb_ai_message_conv').on(t.conversationId, t.createdAt),
  }),
);

// ===== 模块：绘图工具 / 流程图（类 ProcessOn / Draw.io 白板）=====
// 一份「图文件」= 一个画布快照。nodes / edges / viewport 整体序列化进 data 列的 JSON，
// 不拆子表：流程图节点没有独立查询需求（永远整图加载），拆表只会增加 join 与事务复杂度。
// user_id 仍保留逻辑外键口径（单用户桌面应用，默认 1）。
// createdAt / updatedAt 用 TEXT(ISO)，与项目其它表一致，便于排序与展示。
export const wbDiagram = sqliteTable('wb_diagram', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(1),
  name: text('name').notNull().default('未命名文件'),
  /** 画布完整状态 JSON：{ nodes: Node[], edges: Edge[], viewport: { x, y, zoom } }
   * 存纯净业务字段（id/type/position/data.label + 边 source/target 等），
   * 不含 vue-flow 运行时字段（computedPosition 等），序列化由前端 toPlain 负责。 */
  data: text('data').notNull().default('{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
