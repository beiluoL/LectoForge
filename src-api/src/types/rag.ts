/**
 * 知识库问答（RAG）类型契约 —— 纯类型文件，不得出现任何运行时值。
 *
 * 与 types/ai.ts 同源约束：Service 层只回报 AiResult<RagResponse>，
 * 由 Controller 翻译成 { code: 200, data } 或 { code, message, aiCode }。
 */

import type { AiResult } from './ai';

/** POST /api/ai/rag/ask 入参 */
export interface RagRequest {
  /** 用户提问 */
  query: string;
}

/** 检索来源（文档库 .md 或康奈尔笔记） */
export interface RagSource {
  /** 来源类型：文档库 或 笔记 */
  sourceType: 'doc' | 'note';
  /** 匹配标题：文档为文件名（去 .md 后缀），笔记为 wb_note.title */
  title: string;
  /** 跳转链接：文档为 /library?doc=<相对id>，笔记为 /workbench/notes/<id> */
  link: string;
  /**
   * 文档库命中时的精确行号锚点，形如 "L20-L25"（1-based，闭区间）。
   * 笔记来源因 content 多为 HTML/富文本，暂不提供精确行号，故为可选。
   */
  anchor?: string;
}

/** POST /api/ai/rag/ask 返回 */
export interface RagResponse {
  /** 基于检索上下文生成的回答；无相关信息时固定为「知识库中未找到相关内容」 */
  answer: string;
  /** 实际引用的来源清单（由 Service 校验后给出，链接均为真实可跳转地址） */
  sources: RagSource[];
}

/** Service 层回报给 Controller 的结果类型 */
export type RagResult = AiResult<RagResponse>;
