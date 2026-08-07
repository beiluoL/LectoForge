// 收集箱（Inbox）API 客户端：对接后端 /api/inbox/*。
// 知识闭环第一步——「极速输入，先积累再沉淀」。
//
// 状态契约：对外统一小写三态 unprocessed / archived / trashed，
// 后端负责与 DB 大写状态（INBOX / ARCHIVED / TRASHED）互转，前端不感知大小写。
import { apiGet, apiPost, apiPut, apiDelete } from './request';

/** 收集项类型：速记 / 链接剪藏 / 图片 */
export type InboxType = 'text' | 'link' | 'image';

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

/** 拉取全部未处理条目；sort='asc' 时按创建时间升序（收件箱积压视图用） */
export function fetchInboxList(sort?: 'asc' | 'desc') {
  return apiGet<InboxItem[]>('/inbox/list', sort ? { sort } : undefined);
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
