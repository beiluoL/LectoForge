/**
 * 模拟面试编排服务（有状态、内存会话）。
 *
 * 设计要点（务必遵守本项目红线）：
 * 1. 会话状态放内存 Map——单用户桌面应用，进程内即可，无需落库。
 * 2. LLM 调用是 async（fetch 网络），但本服务**不写任何数据库**（仅读题库），
 *    因此不存在「await 写在 db.transaction 回调里提前提交」的问题；读题库全是同步调用，
 *    与 async 的 LLM 流式生成严格分离。
 * 3. startSession / answerSession 返回 async generator，逐事件吐出 SSE 事件对象，
 *    由路由层手写 text/event-stream 推回前端（绕过 onSend 信封，属合理例外）。
 *
 * SSE 事件顺序契约：
 *   start  → {event:'question',  data:{sessionId, text, questionId, question}}
 *   answer → {event:'evaluation',data:{score, comment}}
 *            {event:'question',  data:{sessionId, text, questionId, question}}  // 还有题
 *            或 {event:'end',    data:{summary}}                                // 题库抽完
 *   异常    → {event:'error',    data:{message}}
 */
import crypto from 'node:crypto';

import { LlmError, chatStream, type ChatMessage } from '../lib/llm';
import * as qaBankService from '../services/qaBankService';
import * as recallService from '../services/recallService';
import type { QaBankFilter, QaBankRow } from '../types/qaBank';

/** 一个 SSE 事件：event 为事件名，data 为任意可 JSON 序列化对象。 */
export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

interface InterviewSession {
  history: Array<{ questionId: number; transcript: string }>;
  lastQuestionId: number | null;
  bankFilter?: QaBankFilter;
  usedIds: number[];
}

/** 会话表（进程内）。键=sessionId。 */
const sessions = new Map<string, InterviewSession>();

function newSessionId(): string {
  return crypto.randomBytes(8).toString('hex');
}

function errorEvent(e: unknown): SseEvent {
  const msg = e instanceof LlmError ? e.message : e instanceof Error ? e.message : String(e);
  return { event: 'error', data: { message: msg } };
}

/** 把 chatStream 的增量拼成完整文本。 */
async function streamToText(messages: ChatMessage[]): Promise<string> {
  let out = '';
  for await (const piece of chatStream(messages)) out += piece;
  return out.trim();
}

/** 面试官系统人设：口语化、适合语音朗读。 */
const INTERVIEWER_SYSTEM =
  '你是一场模拟面试的面试官，正在和学员进行语音通话。请用自然、口语化、适合语音朗读的中文沟通，' +
  '不要使用 Markdown、列表或括号备注，也不要暴露「我是 AI」。保持简短、像真人在对话。';

/** 把题干转成一句自然的口头提问。 */
async function generateSpokenQuestion(question: string): Promise<string> {
  return streamToText([
    { role: 'system', content: `${INTERVIEWER_SYSTEM} 现在请直接、自然地念出下面这道面试题（只念题目本身，不要加寒暄或解释）。` },
    { role: 'user', content: question },
  ]);
}

/** 根据学员回答 + 关键词命中分，生成友好的口语化点评。 */
async function generateEvaluation(
  score: number,
  transcript: string,
  referenceAnswer: string,
  question: string,
): Promise<string> {
  return streamToText([
    {
      role: 'system',
      content:
        `${INTERVIEWER_SYSTEM} 学员刚回答完一题，请用中文给出简短（2~4 句）的口语化点评：先肯定亮点，再给一条具体改进建议。` +
        '语气鼓励、像真人面试官。不要复读参考答案全文。',
    },
    {
      role: 'user',
      content:
        `面试题：${question}\n` +
        `参考答案要点：${referenceAnswer || '（无标准答案）'}\n` +
        `学员回答：${transcript || '（未作答）'}\n` +
        `关键词命中评分（0~100）：${score}\n` +
        `请基于以上给出点评。`,
    },
  ]);
}

/**
 * 开始一场面试：抽首题 → 生成口语化题干 → 推 question 事件。
 * 题库为空时直接推 end 事件。
 */
export async function* startSession(filter?: QaBankFilter): AsyncGenerator<SseEvent> {
  const q: QaBankRow | null = qaBankService.randomNext(filter) ?? qaBankService.firstQuestion(filter);
  if (!q) {
    yield { event: 'end', data: { summary: '题库为空，请先在「题库管理」中导入面试题，或关联复习卡 / 笔记。' } };
    return;
  }

  let spoken: string;
  try {
    spoken = await generateSpokenQuestion(q.question);
  } catch (e) {
    yield errorEvent(e);
    return;
  }

  const sessionId = newSessionId();
  sessions.set(sessionId, {
    history: [],
    lastQuestionId: q.id,
    bankFilter: filter,
    usedIds: [q.id],
  });

  yield {
    event: 'question',
    data: { sessionId, text: spoken || q.question, questionId: q.id, question: q.question },
  };
}

/**
 * 提交一轮回答：①关键词命中评分 → ②口语化点评(evaluation 事件) →
 * ③抽下一题并生成口语化题干(question 事件)，或题库抽完推 end 事件。
 */
export async function* answerSession(sessionId: string, transcript: string): AsyncGenerator<SseEvent> {
  const sess = sessions.get(sessionId);
  if (!sess) {
    yield errorEvent(new LlmError('AI_NOT_CONFIGURED', '会话不存在或已结束，请重新开始面试', 409));
    return;
  }

  const lastQ: QaBankRow | null = sess.lastQuestionId != null ? qaBankService.getBank(sess.lastQuestionId) : null;
  const referenceAnswer = lastQ?.referenceAnswer || '';
  const score = recallService.scoreRecall(referenceAnswer, transcript ?? '');

  let comment: string;
  try {
    comment = await generateEvaluation(score, transcript ?? '', referenceAnswer, lastQ?.question || '');
  } catch (e) {
    yield errorEvent(e);
    return;
  }

  yield { event: 'evaluation', data: { score, comment } };

  const next: QaBankRow | null = qaBankService.randomNext({
    ...(sess.bankFilter || {}),
    excludeIds: sess.usedIds,
  });

  if (!next) {
    sessions.delete(sessionId);
    yield {
      event: 'end',
      data: { summary: '面试结束！你已完成当前题库的全部题目，继续保持练习，会越来越稳。' },
    };
    return;
  }

  sess.lastQuestionId = next.id;
  sess.usedIds = [...sess.usedIds, next.id];
  sess.history.push({ questionId: next.id, transcript: transcript ?? '' });

  let spoken: string;
  try {
    spoken = await generateSpokenQuestion(next.question);
  } catch (e) {
    yield errorEvent(e);
    return;
  }

  yield {
    event: 'question',
    data: { sessionId, text: spoken || next.question, questionId: next.id, question: next.question },
  };
}

/*
 * Phase 2 预留：语义选题。当前 v1 用 randomNext（随机/顺序）即可；
 * Phase 2 在这里接入本地 Ollama nomic-embed-text 向量化 + 余弦相似度，
 * 根据学员上一轮薄弱点动态推选最相关的下一道题，替代随机抽题。
 *
 * async function retrieveByEmbedding(transcript: string, filter?: QaBankFilter): Promise<QaBankRow | null> {
 *   // 1. embed(transcript) via EMBEDDING_PRESETS.local
 *   // 2. 对题库逐条 embed 并 cosineSimilarity，取最相关且未用过的
 *   return ...;
 * }
 */
