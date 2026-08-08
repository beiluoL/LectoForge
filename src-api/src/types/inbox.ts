/**
 * 收集箱（Inbox）模块类型契约 —— 纯类型文件，**不得出现任何运行时值**
 * （`INBOX_TYPES` / `ALLOWED_EXT` / `DUP_THRESHOLD` 等常量一律归属 service 层）。
 *
 * ⚠️ 状态双契约红线：本模块对外是小写三态（unprocessed / archived / trashed），
 * 与 /api/workbench/captures 的大写状态（INBOX / PROCESSED / ARCHIVED / TRASHED）
 * 是**两套独立契约**，严禁在类型层面合并复用，否则历史数据会大面积状态丢失。
 */

import type { PageQuery } from './pagination';

/** 收集项类型。audio / file 为「富媒体扩展」新增，历史数据仍是 text|link|image */
export type InboxType = 'text' | 'link' | 'image' | 'audio' | 'file';

/** 对外小写三态（DB 侧为大写，映射集中在 inboxService） */
export type InboxStatusVo = 'unprocessed' | 'archived' | 'trashed';

/** 列表智能过滤维度 */
export type InboxFilter = 'all' | 'today' | 'week' | 'untagged';

/** 行 → 前端 InboxItem VO（字段与前端 api/inbox.ts InboxItem 一一对应） */
export interface InboxItemVO {
  id: number;
  type: InboxType;
  title: string;
  content: string;
  sourceUrl: string;
  coverImage: string;
  tags: string[];
  status: InboxStatusVo;
  starred: number;
  createdAt: string;
  processedAt: string | null;
}

/** GET /inbox/list 的查询参数（已由 controller 归一化）。继承 PageQuery 支持分页。 */
export interface ListInboxQuery extends PageQuery {
  /** true 表示按创建时间升序（收件箱积压视图） */
  ascSort: boolean;
  filter: InboxFilter;
}

export interface CreateInboxDTO {
  type?: string;
  title?: string;
  content?: string;
  sourceUrl?: string;
  coverImage?: string;
  tags?: unknown;
  starred?: unknown;
}

export interface UpdateInboxDTO {
  type?: string;
  title?: string;
  content?: string;
  sourceUrl?: string;
  coverImage?: string;
  tags?: unknown;
  starred?: unknown;
  status?: string;
}

// ===================== 网页剪藏 =====================

export interface ClipResult {
  title: string;
  description: string;
  image: string | null;
  url: string;
  snippet: string;
  /** true 表示真实抓取成功；false 表示走了兜底（网络失败 / 非法 URL） */
  ok: boolean;
}

// ===================== 流转（沉淀） =====================

/** 单条流转目标 */
export type ProcessTarget = 'note' | 'cornell' | 'palace' | 'story';

export interface ProcessInput {
  target: string;
  palaceId?: number;
  lociId?: number;
}

export interface ProcessResultVO {
  target: string;
  noteId?: number;
  path?: string;
  palaceId?: number;
  lociId?: number;
  storyId?: number;
  title: string;
  item: InboxItemVO;
}

/**
 * 流转结果的可辨识联合。Service 只回报「发生了什么」，
 * 由 Controller 翻译成 404 / 400 / 409 —— Service 不得接触 FastifyReply。
 */
export type ProcessOutcome =
  | { kind: 'ok'; data: ProcessResultVO }
  | { kind: 'notFound' }
  | { kind: 'vaultNotReady' }
  | { kind: 'palaceIdRequired' }
  | { kind: 'palaceNotFound' }
  | { kind: 'invalidTarget' };

// ===================== 批量处理 =====================

export type BatchTarget = 'archive' | 'delete' | 'cornell';

export interface BatchResultVO {
  target: string;
  processed: number;
  ids: number[];
  /** 越权 / 不存在的 id，静默跳过后在此回报 */
  skipped: number[];
  noteIds: number[];
}

// ===================== 附件上传 =====================

/** 上传子目录：语音走 audio/，其余通用附件走 assets/ */
export type UploadKind = 'audio' | 'assets';

/**
 * 上传源的中立抽象 —— 刻意**不引用** Fastify 的 MultipartFile，
 * 让 service 层与 HTTP 框架彻底解耦（原则 5）。
 * Controller 负责从 req.file() 取出 part 并适配成本结构。
 */
export interface UploadSource {
  filename?: string;
  mimetype?: string;
  stream: NodeJS.ReadableStream;
  /** 流写完后回读：@fastify/multipart 超限时不抛错，只把 truncated 置 true */
  isTruncated: () => boolean;
}

/** 上传结果 VO（前端据 url 拼 Markdown / 存 sourceUrl） */
export interface UploadResult {
  url: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  kind: UploadKind;
}

// ===================== 智能去重 =====================

export interface DuplicateCheckDTO {
  content?: string;
  sourceUrl?: string;
  excludeId?: number;
}

export type DuplicateReason = 'none' | 'url' | 'content';

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingId?: number;
  existingTitle?: string;
  existingCreatedAt?: string;
  similarity: number;
  reason: DuplicateReason;
}
