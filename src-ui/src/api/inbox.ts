// 收集箱（Inbox）API 客户端：对接后端 /api/inbox/*。
// 知识闭环第一步——「极速输入，先积累再沉淀」。
//
// 状态契约：对外统一小写三态 unprocessed / archived / trashed，
// 后端负责与 DB 大写状态（INBOX / ARCHIVED / TRASHED）互转，前端不感知大小写。
import { apiGet, apiPost, apiPut, apiDelete } from './request';

/** 收集项类型：速记 / 链接剪藏 / 图片 / 语音灵感 / 通用附件 */
export type InboxType = 'text' | 'link' | 'image' | 'audio' | 'file';

/** 收集项状态：未处理 / 已归档（含已沉淀）/ 回收站 */
export type InboxStatus = 'unprocessed' | 'archived' | 'trashed';

/** 沉淀目标：文档库文档 / 康奈尔笔记 / 记忆宫殿位点 / 费曼故事草稿 */
export type ProcessTarget = 'note' | 'cornell' | 'palace' | 'story';

/** 流转附加参数（palace 目标需要 palaceId，可选 lociId） */
export interface ProcessOptions {
  palaceId?: number;
  lociId?: number;
}

/** 智能分类建议结果（POST /api/ai/tags） */
export interface TagSuggestResult {
  tags: string[];
  suggestedCategoryId: number | null;
  suggestedCategoryName: string;
}

/** 单条收集项 */
export interface InboxItem {
  id: number;
  type: InboxType;
  /** 标题：速记取内容首行，链接取抓取到的网页标题 */
  title: string;
  /** 正文（Markdown 文本） */
  content: string;
  /** 来源网址，仅 link 类型有值 */
  sourceUrl: string;
  /** 封面图（og:image），仅剪藏时可能有值 */
  coverImage: string;
  tags: string[];
  status: InboxStatus;
  /** 星标置顶（0/1） */
  starred: number;
  createdAt: string;
  /** 沉淀时间，未沉淀为 null */
  processedAt: string | null;
}

/** 网页剪藏抓取结果 */
export interface ClipResult {
  title: string;
  description: string;
  /** og:image 或 favicon 的绝对地址，抓不到为 null */
  image: string | null;
  url: string;
  /** 正文纯文本前 120 字 */
  snippet: string;
  /** true=真实抓取成功；false=走了兜底（网络失败/非法 URL），UI 应弱化提示 */
  ok: boolean;
}

/** 沉淀结果 */
export interface ProcessResult {
  target: ProcessTarget;
  /** target=cornell 时返回新建的康奈尔笔记 id */
  noteId?: number;
  /** target=note 时返回文档库中的文件相对路径 */
  path?: string;
  /** target=palace 时返回宫殿 id / 位点 id */
  palaceId?: number;
  lociId?: number;
  /** target=story 时返回新建的费曼故事 id */
  storyId?: number;
  title: string;
  /** 流转后的收集项（status 已变为 archived） */
  item: InboxItem;
}

/** 新建收集项的入参 */
export interface CreateInboxPayload {
  content: string;
  title?: string;
  type?: InboxType;
  sourceUrl?: string;
  coverImage?: string;
  tags?: string[];
}

/** 更新收集项的入参（字段均可选，未传则保持原值） */
export interface UpdateInboxPayload {
  title?: string;
  content?: string;
  type?: InboxType;
  sourceUrl?: string;
  coverImage?: string;
  tags?: string[];
  starred?: boolean;
  status?: InboxStatus;
}

/* =============================================================================
 * 进阶能力（批量 / 上传 / 去重）的类型契约
 * ========================================================================== */

/** 智能过滤维度：全部 / 今天 / 本周 / 未打标签 */
export type InboxFilter = 'all' | 'today' | 'week' | 'untagged';

/** 批量操作目标：归档 / 删除（进回收站）/ 一键沉淀为康奈尔笔记 */
export type BatchTarget = 'archive' | 'delete' | 'cornell';

/** 批量操作结果 */
export interface BatchProcessResult {
  target: BatchTarget;
  /** 实际生效的条目数 */
  processed: number;
  /** 实际生效的 id 列表 */
  ids: number[];
  /** 被跳过的 id（不存在 / 已是目标状态 / 内容为空无法沉淀） */
  skipped: number[];
  /** target=cornell 时返回新建的笔记 id 列表，顺序与 ids 对应 */
  noteIds: number[];
}

/** 上传归属：audio=语音灵感，assets=图片/通用附件 */
export type UploadKind = 'audio' | 'assets';

/** 上传结果：url 是同源相对地址，可直接塞进 <audio src> 或 Markdown */
export interface UploadResult {
  /** 形如 /uploads/audio/20260808-9f3a1c.webm */
  url: string;
  /** 落盘后的文件名（时间戳 + 随机 hex，避免同名覆盖） */
  fileName: string;
  /** 用户上传时的原始文件名，用于展示 */
  originalName: string;
  mimeType: string;
  /** 字节数 */
  size: number;
  kind: UploadKind;
}

/** 去重检测入参：内容与来源网址至少给一个 */
export interface DuplicateCheckPayload {
  content?: string;
  sourceUrl?: string;
  /** 编辑既有条目时排除自身，避免"和自己重复" */
  excludeId?: number;
}

/** 去重检测结果：后端恒返回 200，isDuplicate=false 即视为无冲突 */
export interface DuplicateCheckResult {
  isDuplicate: boolean;
  /** 命中的既有条目 id，未命中为 null */
  existingId: number | null;
  existingTitle: string;
  existingCreatedAt: string | null;
  /** 0~1 相似度；URL 完全一致时为 1 */
  similarity: number;
  /** 命中原因：'url'=来源网址一致，'content'=正文相似，''=未命中 */
  reason: 'url' | 'content' | '';
}

/**
 * 拉取未处理条目。
 * @param sort  'asc' 时按创建时间升序（收件箱积压视图用）
 * @param filter 智能过滤维度，'all' 或省略表示不过滤
 */
export function fetchInboxList(sort?: 'asc' | 'desc', filter?: InboxFilter) {
  const params: Record<string, string> = {};
  if (sort) params.sort = sort;
  if (filter && filter !== 'all') params.filter = filter;
  return apiGet<InboxItem[]>('/inbox/list', Object.keys(params).length ? params : undefined);
}

/** 按状态拉取（归档箱 / 回收站视图用） */
export function fetchInboxByStatus(status: InboxStatus) {
  return apiGet<InboxItem[]>('/inbox', { status });
}

/** 新建一条收集项 */
export function createInbox(payload: CreateInboxPayload) {
  return apiPost<InboxItem>('/inbox', payload);
}

/**
 * 网页剪藏：抓取目标网址的标题 / 描述 / 封面图 / 正文摘要。
 * 后端做了优雅降级，抓取失败也返回 200（ok=false），调用方无需 try 兜底 UI。
 */
export function clipUrl(url: string) {
  return apiGet<ClipResult>('/inbox/clip', { url });
}

/**
 * 网页元数据抓取（剪藏增强）：与 /clip 同源，但摘要取前 200 字，便于「将摘要作为初稿」。
 * 同样保证 200 成功、ok=false 时仅提示，绝不阻断手动录入。
 */
export function fetchMetadata(url: string) {
  return apiGet<ClipResult>('/inbox/metadata', { url });
}

/** AI 智能分类建议：根据标题 + 正文推荐标签（并建议归类），前端决定是否采纳 */
export function suggestTags(title: string, content: string) {
  return apiPost<TagSuggestResult>('/ai/tags', { title, content });
}

/** 更新收集项（改内容 / 打标签 / 改状态） */
export function updateInbox(id: number, payload: UpdateInboxPayload) {
  return apiPut<InboxItem>(`/inbox/${id}`, payload);
}

/** 归档：不沉淀，直接收进归档箱 */
export function archiveInbox(id: number) {
  return updateInbox(id, { status: 'archived' });
}

/** 沉淀：流转为康奈尔笔记 / 文档库文档 / 记忆宫殿位点 / 费曼故事草稿，成功后该条自动归档 */
export function processInbox(id: number, target: ProcessTarget, options?: ProcessOptions) {
  return apiPut<ProcessResult>(`/inbox/${id}/process`, { target, ...(options || {}) });
}

/** 删除：软删除，移入回收站 */
export function deleteInbox(id: number) {
  return apiDelete<void>(`/inbox/${id}`);
}

/* =============================================================================
 * 进阶能力实现
 * ========================================================================== */

/**
 * 批量处理：一次性归档 / 删除 / 沉淀为康奈尔笔记。
 * 后端用 inArray 做单条 SQL 批量 UPDATE（cornell 需逐条建笔记），
 * 不存在的 id 会进 skipped 而不是整体报错。
 */
export function batchProcessInbox(ids: number[], target: BatchTarget) {
  return apiPost<BatchProcessResult>('/inbox/batch/process', { ids, target });
}

/**
 * 上传文件到 <dataDir>/uploads/<kind>/。
 *
 * 注意这里**不设 Content-Type**：交给浏览器根据 FormData 自动补 multipart/form-data
 * 并附上 boundary，手动写死会导致后端解析不到分片（经典坑）。
 * 超时也放宽到 60s —— 一段两分钟的录音在慢盘上可能超过默认 15s。
 */
function uploadTo(kind: UploadKind, file: Blob, fileName: string) {
  const form = new FormData();
  form.append('file', file, fileName);
  const endpoint = kind === 'audio' ? '/inbox/upload/audio' : '/inbox/upload/asset';
  return apiPost<UploadResult>(endpoint, form, { timeout: 60000 });
}

/** 上传录音（MediaRecorder 产出的 webm/wav Blob） */
export function uploadInboxAudio(blob: Blob, fileName = 'voice-memo.webm') {
  return uploadTo('audio', blob, fileName);
}

/** 上传图片 / 通用附件（文件选择器或粘贴板图片） */
export function uploadInboxAsset(file: File | Blob, fileName?: string) {
  const name = fileName || (file instanceof File ? file.name : 'pasted-image.png');
  return uploadTo('assets', file, name);
}

/**
 * 智能去重检测：在近 7 天的未处理条目里找「来源网址完全一致」或「正文相似度 >80%」的旧条目。
 * 后端恒 200（检测失败也返回 isDuplicate=false），调用方无需 try 兜底 UI。
 */
export function checkDuplicate(payload: DuplicateCheckPayload) {
  return apiPost<DuplicateCheckResult>('/inbox/duplicate-check', payload);
}
