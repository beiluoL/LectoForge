/**
 * AI 助手 / 多轮对话服务（对标 DeepSeek 网页端体验）。
 *
 * 职责边界（严格遵守三层架构）：
 * - 本文件只做「业务计算 + 落库」，不接触 FastifyReply / FastifyRequest；
 *   HTTP 形态由 aiAssistantController 统一处理（run/fail 信封 + SSE hijack）。
 * - 所有 DB 访问走 better-sqlite3 同步 API（drizzle 的 .run()/.all()/.get() 均同步返回），
 *   严禁引入任何异步 DB 调用或 Promise 化的数据库事务。
 * - 检索复用 aiRagService 的向量/关键词检索（retrieveRagContext + assembleContext），
 *   与知识库问答共用同一套 RAG 能力，只把结果作为「参考上下文」注入多轮对话，
 *   不强制模型输出 JSON（区分于 askRag）。
 *
 * SSE 流式端点产出 AsyncGenerator<SseEvent>，由 Controller 的 streamSse 逐事件手写进 reply.raw。
 */
import { eq } from 'drizzle-orm';

import { db, CURRENT_USER, nowIso } from '../db';
import { wbAiConversation, wbAiMessage } from '../db/schema';
import { chatStream, LlmError, type ChatMessage } from '../lib/llm';
import { retrieveRagContext, assembleContext } from './aiRagService';
import type { AiResult } from '../types/ai';
import type {
  AiConversationVO,
  AiMessageVO,
  ChatCompletionsDTO,
  CreateConversationDTO,
  RateMessageDTO,
  UpdateConversationDTO,
} from '../types/ai';
import type { RagSource } from '../types/rag';

/** SSE 事件（与 interviewService.SseEvent 同形，供 Controller 的 streamSse 消费） */
export interface SseEvent {
  event: string;
  data: unknown;
}

type ConvRow = typeof wbAiConversation.$inferSelect;
type MsgRow = typeof wbAiMessage.$inferSelect;

const DEFAULT_TITLE = '新对话';
const TITLE_MAX = 20;
/** 多轮对话注入的历史轮数上限 */
const HISTORY_LIMIT = 10;
/** 单条消息正文读取上限（防极端超长） */
const CONTENT_CAP = 16000;

// ===================== 行 → VO 映射 =====================

function toConvVO(r: ConvRow): AiConversationVO {
  return {
    id: r.id,
    userId: r.userId,
    title: r.title,
    pinned: r.pinned,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toMsgVO(r: MsgRow): AiMessageVO {
  let sourceRefs: RagSource[] | null = null;
  if (r.sourceRefs) {
    try {
      const parsed = JSON.parse(r.sourceRefs);
      if (Array.isArray(parsed)) sourceRefs = parsed as RagSource[];
    } catch {
      sourceRefs = null;
    }
  }
  return {
    id: r.id,
    conversationId: r.conversationId,
    role: r.role === 'assistant' ? 'assistant' : 'user',
    content: r.content,
    rating: (r.rating === 'like' || r.rating === 'dislike' ? r.rating : 'none') as AiMessageVO['rating'],
    sourceRefs,
    createdAt: r.createdAt,
  };
}

// ===================== 会话 CRUD =====================

/** 列出会话：可选按标题模糊搜索；排序为「置顶优先、再按 updated_at 倒序」。 */
export function listConversations(search?: string): AiResult<AiConversationVO[]> {
  let rows = db.select().from(wbAiConversation).all() as ConvRow[];
  const q = (search || '').trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.title.toLowerCase().includes(q));
  rows.sort((a, b) => {
    if (b.pinned !== a.pinned) return b.pinned - a.pinned; // 置顶在前
    return b.updatedAt.localeCompare(a.updatedAt); // 新会话在前
  });
  return { kind: 'ok', data: rows.map(toConvVO) };
}

/** 新建会话（标题可空，缺省「新对话」）。 */
export function createConversation(title?: string): AiResult<AiConversationVO> {
  const now = nowIso();
  const info = db
    .insert(wbAiConversation)
    .values({
      userId: CURRENT_USER,
      title: (title && title.trim()) || DEFAULT_TITLE,
      pinned: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const id = Number(info.lastInsertRowid);
  const row = db.select().from(wbAiConversation).where(eq(wbAiConversation.id, id)).get() as ConvRow;
  return { kind: 'ok', data: toConvVO(row) };
}

/** 改标题 / 切换置顶。 */
export function updateConversation(id: number, payload: UpdateConversationDTO): AiResult<AiConversationVO> {
  const existing = db.select().from(wbAiConversation).where(eq(wbAiConversation.id, id)).get() as
    | ConvRow
    | undefined;
  if (!existing) return { kind: 'fail', status: 404, message: '会话不存在', aiCode: 'AI_CONV_NOT_FOUND' };

  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  if (payload.title !== undefined) patch.title = payload.title;
  if (payload.pinned !== undefined) patch.pinned = payload.pinned ? 1 : 0;
  db.update(wbAiConversation).set(patch).where(eq(wbAiConversation.id, id)).run();

  const row = db.select().from(wbAiConversation).where(eq(wbAiConversation.id, id)).get() as ConvRow;
  return { kind: 'ok', data: toConvVO(row) };
}

/** 删除会话：事务内先删消息再删会话（级联由应用层维护，符合阿里「逻辑外键」约定）。 */
export function deleteConversation(id: number): AiResult<{ ok: true }> {
  const existing = db.select().from(wbAiConversation).where(eq(wbAiConversation.id, id)).get() as
    | ConvRow
    | undefined;
  if (!existing) return { kind: 'fail', status: 404, message: '会话不存在', aiCode: 'AI_CONV_NOT_FOUND' };

  db.transaction((tx) => {
    tx.delete(wbAiMessage).where(eq(wbAiMessage.conversationId, id)).run();
    tx.delete(wbAiConversation).where(eq(wbAiConversation.id, id)).run();
  });
  return { kind: 'ok', data: { ok: true } };
}

/** 拉取单个会话的全部消息（按 id 升序即时间升序）。 */
export function getMessages(conversationId: number): AiResult<AiMessageVO[]> {
  const rows = (db.select().from(wbAiMessage).where(eq(wbAiMessage.conversationId, conversationId)).all() as MsgRow[]).sort(
    (a, b) => a.id - b.id,
  );
  return { kind: 'ok', data: rows.map(toMsgVO) };
}

// ===================== 消息评分 =====================

/** 点赞 / 点踩 / 取消。 */
export function rateMessage(id: number, rating: string): AiResult<AiMessageVO> {
  if (rating !== 'like' && rating !== 'dislike' && rating !== 'none') {
    return { kind: 'fail', status: 400, message: '无效的评分', aiCode: 'AI_BAD_INPUT' };
  }
  const existing = db.select().from(wbAiMessage).where(eq(wbAiMessage.id, id)).get() as MsgRow | undefined;
  if (!existing) return { kind: 'fail', status: 404, message: '消息不存在', aiCode: 'AI_MSG_NOT_FOUND' };
  db.update(wbAiMessage).set({ rating }).where(eq(wbAiMessage.id, id)).run();
  const row = db.select().from(wbAiMessage).where(eq(wbAiMessage.id, id)).get() as MsgRow;
  return { kind: 'ok', data: toMsgVO(row) };
}

// ===================== 提示词组装 =====================

/**
 * 构造 AI 助手的 system 提示。不同于 RAG 问答（强制 JSON + 只引来源），
 * 这里是「自由多轮对话 + 可选知识库参考」：把检索到的知识库材料作为参考上下文注入，
 * 是否引用由模型自行判断；同时强调多轮连贯。
 */
function buildAssistantSystem(context: string): string {
  const base = [
    '你是 LectoForge 的 AI 学习助手，一名耐心、严谨、善于用类比和生活例子讲清楚概念的私人导师。',
    '你会结合用户的知识库（本地文档库与康奈尔笔记）作答，也会基于多轮对话的上下文保持连贯。',
    '要求：',
    '- 用中文清晰、有条理地回答；复杂内容用 Markdown（标题、列表、加粗、代码块）组织，便于阅读；',
    '- 若下方知识库材料与问题相关，优先依据材料作答并自然引用；不编造知识库中没有的事实；',
    '- 保持多轮对话连贯：记住用户前面说过的话，避免重复提问或自相矛盾；',
    '- 不输出多余的客套话与「作为 AI」之类的自述。',
  ].join('\n');
  if (!context) return base;
  return `${base}\n\n【知识库参考材料（可能相关，仅供参考，是否引用由你判断）】\n${context}`;
}

// ===================== 流式对话（SSE）=====================

/**
 * 多轮对话流式端点核心：落库用户消息 → 取历史 + RAG 上下文 → chatStream 增量生成 →
 * 落库助手消息（正文 + 来源）→ 通过 SSE 把增量与来源回传前端。
 *
 * 约定事件流：
 *   meta   → { conversationId, messageId, title }        首事件，告知前端会话/助手消息 id
 *   delta  → { content: string }                         增量文本片段
 *   sources→ { sources: RagSource[] }                    知识库来源（可选）
 *   done   → { conversationId, messageId, sources }      结束
 *   error  → { message: string, aiCode?: string }        异常（含 AI 未配置等）
 */
export async function* chatCompletionsStream(input: ChatCompletionsDTO): AsyncGenerator<SseEvent> {
  const query = (input.query || '').trim();

  // 解析会话：未传 id 则新建；传了但不存在则报错事件
  let conversationId = input.conversationId;
  let conv: ConvRow | undefined =
    conversationId != null
      ? (db.select().from(wbAiConversation).where(eq(wbAiConversation.id, conversationId)).get() as ConvRow | undefined)
      : undefined;

  if (!conv) {
    if (conversationId == null) {
      const created = createConversation();
      if (created.kind !== 'ok') return;
      conv = db.select().from(wbAiConversation).where(eq(wbAiConversation.id, created.data.id)).get() as ConvRow;
      conversationId = created.data.id;
    } else {
      yield { event: 'error', data: { message: '会话不存在', aiCode: 'AI_CONV_NOT_FOUND' } };
      return;
    }
  }
  const cid = conversationId as number;

  // 落库用户消息
  const now = nowIso();
  const userMsgInfo = db
    .insert(wbAiMessage)
    .values({ conversationId: cid, role: 'user', content: query.slice(0, CONTENT_CAP), rating: 'none', createdAt: now })
    .run();
  const userMsgId = Number(userMsgInfo.lastInsertRowid);

  // 首条消息时，用提问前若干字作为会话标题
  if (conv.title === DEFAULT_TITLE) {
    const title = query.slice(0, TITLE_MAX) || DEFAULT_TITLE;
    db.update(wbAiConversation).set({ title, updatedAt: nowIso() }).where(eq(wbAiConversation.id, cid)).run();
  }

  // 落库助手占位消息（流式回填）
  const astInfo = db
    .insert(wbAiMessage)
    .values({ conversationId: cid, role: 'assistant', content: '', rating: 'none', createdAt: nowIso() })
    .run();
  const assistantMsgId = Number(astInfo.lastInsertRowid);

  yield { event: 'meta', data: { conversationId: cid, messageId: assistantMsgId, title: conv.title } };

  // 取历史：当前用户消息之前的消息，取最近 HISTORY_LIMIT 条
  const prior = (db.select().from(wbAiMessage).where(eq(wbAiMessage.conversationId, cid)).all() as MsgRow[])
    .filter((m) => m.id < userMsgId)
    .sort((a, b) => a.id - b.id)
    .slice(-HISTORY_LIMIT);
  const history: ChatMessage[] = prior.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  // RAG 检索作为参考上下文
  const blocks = await retrieveRagContext(query);
  const contextText = blocks.length ? assembleContext(blocks) : '';
  const messages: ChatMessage[] = [
    { role: 'system', content: buildAssistantSystem(contextText) },
    ...history,
    { role: 'user', content: query },
  ];

  let full = '';
  try {
    for await (const delta of chatStream(messages)) {
      full += delta;
      yield { event: 'delta', data: { content: delta } };
    }
  } catch (e) {
    const msg = e instanceof LlmError ? e.message : e instanceof Error ? e.message : String(e);
    const aiCode = e instanceof LlmError ? e.code : 'AI_UPSTREAM_ERROR';
    yield { event: 'error', data: { message: msg, aiCode } };
    db.update(wbAiMessage).set({ content: `⚠️ ${msg}` }).where(eq(wbAiMessage.id, assistantMsgId)).run();
    return;
  }

  const sources: RagSource[] = blocks.map((b) => ({
    sourceType: b.sourceType,
    title: b.title,
    link: b.link,
    anchor: b.anchor,
  }));
  const sourceJson = sources.length ? JSON.stringify(sources) : null;
  db.update(wbAiMessage)
    .set({ content: full, sourceRefs: sourceJson })
    .where(eq(wbAiMessage.id, assistantMsgId))
    .run();
  db.update(wbAiConversation).set({ updatedAt: nowIso() }).where(eq(wbAiConversation.id, cid)).run();

  if (sources.length) yield { event: 'sources', data: { sources } };
  yield { event: 'done', data: { conversationId: cid, messageId: assistantMsgId, sources } };
}

/**
 * 重新生成某条助手消息：找到生成它的那条用户提问 → 删除旧助手消息 → 新建占位 →
 * 复用历史 + RAG 重新流式生成。事件流与 chatCompletions 一致（meta 携带新 messageId）。
 */
export async function* regenerateMessageStream(messageId: number): AsyncGenerator<SseEvent> {
  const oldMsg = db.select().from(wbAiMessage).where(eq(wbAiMessage.id, messageId)).get() as MsgRow | undefined;
  if (!oldMsg || oldMsg.role !== 'assistant') {
    yield { event: 'error', data: { message: '消息不存在或不是助手消息', aiCode: 'AI_MSG_NOT_FOUND' } };
    return;
  }
  const cid = oldMsg.conversationId;

  // 找到紧邻其前的用户提问
  const userMsg = (db.select().from(wbAiMessage).where(eq(wbAiMessage.conversationId, cid)).all() as MsgRow[])
    .filter((m) => m.role === 'user' && m.id < oldMsg.id)
    .sort((a, b) => b.id - a.id)[0];
  if (!userMsg) {
    yield { event: 'error', data: { message: '找不到对应的用户提问', aiCode: 'AI_BAD_INPUT' } };
    return;
  }
  const query = userMsg.content;

  // 删除旧助手消息，新建占位
  db.delete(wbAiMessage).where(eq(wbAiMessage.id, messageId)).run();
  const astInfo = db
    .insert(wbAiMessage)
    .values({ conversationId: cid, role: 'assistant', content: '', rating: 'none', createdAt: nowIso() })
    .run();
  const newId = Number(astInfo.lastInsertRowid);
  yield { event: 'meta', data: { conversationId: cid, messageId: newId } };

  // 历史：用户提问之前的消息，取最近 HISTORY_LIMIT 条
  const prior = (db.select().from(wbAiMessage).where(eq(wbAiMessage.conversationId, cid)).all() as MsgRow[])
    .filter((m) => m.id < userMsg.id)
    .sort((a, b) => a.id - b.id)
    .slice(-HISTORY_LIMIT);
  const history: ChatMessage[] = prior.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  const blocks = await retrieveRagContext(query);
  const contextText = blocks.length ? assembleContext(blocks) : '';
  const messages: ChatMessage[] = [
    { role: 'system', content: buildAssistantSystem(contextText) },
    ...history,
    { role: 'user', content: query },
  ];

  let full = '';
  try {
    for await (const delta of chatStream(messages)) {
      full += delta;
      yield { event: 'delta', data: { content: delta } };
    }
  } catch (e) {
    const msg = e instanceof LlmError ? e.message : e instanceof Error ? e.message : String(e);
    const aiCode = e instanceof LlmError ? e.code : 'AI_UPSTREAM_ERROR';
    yield { event: 'error', data: { message: msg, aiCode } };
    db.update(wbAiMessage).set({ content: `⚠️ ${msg}` }).where(eq(wbAiMessage.id, newId)).run();
    return;
  }

  const sources: RagSource[] = blocks.map((b) => ({
    sourceType: b.sourceType,
    title: b.title,
    link: b.link,
    anchor: b.anchor,
  }));
  const sourceJson = sources.length ? JSON.stringify(sources) : null;
  db.update(wbAiMessage).set({ content: full, sourceRefs: sourceJson }).where(eq(wbAiMessage.id, newId)).run();
  db.update(wbAiConversation).set({ updatedAt: nowIso() }).where(eq(wbAiConversation.id, cid)).run();

  if (sources.length) yield { event: 'sources', data: { sources } };
  yield { event: 'done', data: { conversationId: cid, messageId: newId, sources } };
}
