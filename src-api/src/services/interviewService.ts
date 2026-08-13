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
 * SSE 事件顺序契约（增强 A：多角色 + 智能追问）：
 *   start  → {event:'question',  data:{sessionId, text, questionId, question}}
 *   answer → {event:'evaluation',data:{score, comment, weakness?, suggestion?, nextAction?}}
 *            {event:'question',  data:{sessionId, text, questionId, question, followUp?}}  // 还有题（followUp=true 表示 AI 追问）
 *            或 {event:'end',    data:{summary}}                                          // 结束
 *   异常    → {event:'error',    data:{message}}
 */
import crypto from 'node:crypto';

import { LlmError, chatJson, chatStream, type ChatMessage } from '../lib/llm';
import * as qaBankService from '../services/qaBankService';
import * as recallService from '../services/recallService';
import type { QaBankFilter, QaBankRow } from '../types/qaBank';
import { buildInterviewSystemPrompt, buildInterviewDecisionPrompt } from '../lib/prompts';

/** 一个 SSE 事件：event 为事件名，data 为任意可 JSON 序列化对象。 */
export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

/** 一轮对话历史（用于让追问连贯、控制 Prompt 长度）。红线要求引入 ChatHistory 结构体。 */
interface ChatHistory {
  /** 该轮面试官问题（口语化题干或 AI 追问内容） */
  question: string;
  /** 学员回答（转写文本） */
  transcript: string;
  /** 该轮点评/改进建议 */
  evaluation: string;
  /** 该轮检出的薄弱点关键词（无则空串） */
  weakness: string;
}

interface InterviewSession {
  /** 最近若干轮对话（按红线约束只保留最近 3 轮，避免 Token 超限） */
  history: ChatHistory[];
  lastQuestionId: number | null;
  bankFilter?: QaBankFilter;
  usedIds: number[];
  /** 本次面试选择的预设角色（影响 System Prompt 人设） */
  role?: string;
}

/** 会话表（进程内）。键=sessionId。 */
const sessions = new Map<string, InterviewSession>();

/** 历史轮数上限：红线要求仅保留最近 3 轮，防止 Prompt 超长导致 chatJson 失败。 */
const MAX_HISTORY = 3;
const DEFAULT_ROLE = '通用面试官';

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

/** 将历史结构化为一段文本，供 System Prompt 携带上下文。 */
function buildHistoryText(history: ChatHistory[]): string {
  if (!history.length) return '';
  return history
    .map((h, i) => {
      const weak = h.weakness ? `（薄弱点：${h.weakness}）` : '';
      return `${i + 1}. 问：${h.question}\n   答：${h.transcript || '（未作答）'}\n   点评：${h.evaluation}${weak}`;
    })
    .join('\n');
}

/** LLM 决策返回结构 */
interface InterviewDecision {
  nextAction?: 'question' | 'end';
  nextQuestion?: string;
  weakness?: string;
  suggestion?: string;
}

/**
 * 调用 LLM 判断下一步：基于历史 + 上一题 + 学员回答 + 关键词命中分，
 * 输出 {nextAction, nextQuestion, weakness, suggestion}。
 */
async function decideNextStep(
  role: string,
  history: ChatHistory[],
  lastQuestion: string,
  transcript: string,
  score: number,
): Promise<InterviewDecision> {
  const messages: ChatMessage[] = [
    ...buildInterviewSystemPrompt(role, buildHistoryText(history)),
    ...buildInterviewDecisionPrompt({ lastQuestion, transcript, score }),
  ];
  try {
    const { data } = await chatJson<InterviewDecision>(messages, { temperature: 0.3 });
    return {
      nextAction: data.nextAction === 'end' ? 'end' : 'question',
      nextQuestion: (data.nextQuestion || '').trim(),
      weakness: (data.weakness || '').trim(),
      suggestion: (data.suggestion || '').trim(),
    };
  } catch (e) {
    // 决策失败不应阻断流程：降级为继续抽题
    return { nextAction: 'question', nextQuestion: '', weakness: '', suggestion: '' };
  }
}

/**
 * 开始一场面试：抽首题 → 生成口语化题干 → 推 question 事件。
 * 题库为空时直接推 end 事件。
 */
export async function* startSession(filter?: QaBankFilter, role?: string): AsyncGenerator<SseEvent> {
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
    role: role || DEFAULT_ROLE,
  });

  yield {
    event: 'question',
    data: { sessionId, text: spoken || q.question, questionId: q.id, question: q.question },
  };
}

/**
 * 提交一轮回答：①关键词命中评分 → ②LLM 决策（点评/薄弱点/是否追问/是否结束）→
 * ③推 evaluation 事件，再推下一题 question 事件（followUp=true 表示 AI 追问）或 end 事件。
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

  // LLM 决策：是否追问、是否结束、薄弱点、改进建议
  const decision = await decideNextStep(
    sess.role || DEFAULT_ROLE,
    sess.history,
    lastQ?.question || '',
    transcript ?? '',
    score,
  );

  const isFollowUp = decision.nextAction === 'question' && !!decision.weakness;
  const comment = decision.suggestion || '回答已记录，继续下一题。';

  // 先把本轮写入历史（在取下一题之前），并裁剪到最近 3 轮
  sess.history.push({
    question: lastQ?.question || '',
    transcript: transcript ?? '',
    evaluation: comment,
    weakness: decision.weakness || '',
  });
  sess.history = sess.history.slice(-MAX_HISTORY);

  yield {
    event: 'evaluation',
    data: {
      score,
      comment,
      weakness: decision.weakness || '',
      suggestion: decision.suggestion || '',
      nextAction: decision.nextAction || 'question',
    },
  };

  if (decision.nextAction === 'end') {
    sessions.delete(sessionId);
    yield {
      event: 'end',
      data: { summary: decision.suggestion || '面试结束，本次表现不错，继续保持练习。' },
    };
    return;
  }

  // 取下一题：优先用 LLM 生成的追问；为空则回退题库随机抽题
  let nextQuestionText = decision.nextQuestion;
  let nextId: number | string = `followup-${sess.usedIds.length + 1}`;
  let spoken: string;

  if (!nextQuestionText) {
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
    nextQuestionText = next.question;
    nextId = next.id;
    sess.lastQuestionId = next.id;
    sess.usedIds = [...sess.usedIds, next.id];
  } else {
    // AI 追问：没有题库参考答案，沿用上一题的 reference 不影响评分（下一轮仍按上一题评分）
    sess.lastQuestionId = null;
  }

  try {
    spoken = await generateSpokenQuestion(nextQuestionText);
  } catch (e) {
    yield errorEvent(e);
    return;
  }

  yield {
    event: 'question',
    data: {
      sessionId,
      text: spoken || nextQuestionText,
      questionId: nextId,
      question: nextQuestionText,
      followUp: isFollowUp,
    },
  };
}

/*
 * Phase 2 预留：语义选题。当前 v1 用 randomNext（随机/顺序）即可；
 * Phase 2 在这里接入本地 Ollama nomic-embed-text 向量化 + 余弦相似度，
 * 根据学员上一轮薄弱点动态推选最相关的下一道题，替代随机抽题。
 */
