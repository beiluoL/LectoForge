/**
 * 模拟面试题库服务（wb_qa_bank）。
 *
 * 三层职责：
 * - 导入：手动面经（Markdown / PDF）+ 复用 wb_review_card（问答卡）与 wb_note（康奈尔笔记）；
 * - 查询：listBanks / getBank / randomNext（含 excludeIds，供面试编排避免重复抽题）；
 * - 标注：tagBank。
 *
 * ⚠️ better-sqlite3 全同步：本文件所有 DB 操作均为同步，且此处不调用任何 LLM / fetch，
 * 异步只来自 ingestFromPdf 的 PDF 解析（本地 CPU 计算，无网络），与 DB 写入无交错 await。
 */
import { and, asc, eq, like } from 'drizzle-orm';
import pdfParse from 'pdf-parse';

import { CURRENT_USER, db } from '../db';
import { wbNote, wbQaBank, wbReviewCard } from '../db/schema';
import type { QaBankFilter, QaBankRow, QaSourceType } from '../types/qaBank';

type RawInsert = {
  question: string;
  referenceAnswer: string;
  sourceType: QaSourceType;
  sourceId: number | null;
};

/* ===== Markdown / 文本解析：把面经文本拆成 {question, referenceAnswer} 列表 =====
 *
 * 采用「稳健且文档化」的启发式：
 * 1. 行首 `Q:` / `Question:` / `问：`——开启一道新题（该行为题干）；
 * 2. 行首 `A:` / `Answer:` / `答：`——该行为参考答案首行；
 * 3. `## ` 或 `### ` 标题——同样开启一道新题（标题文本作为题干），其下内容直到下个标记均为答案；
 * 4. 其余行：若已处于某题之下则累加为答案；否则视为前言，忽略。
 *
 * 这样既能吃「Q:/A:」成对格式，也能吃「## 题目 \n 答案段落」的章节式面经。 */
function parseMarkdownQa(text: string): Array<{ question: string; referenceAnswer: string }> {
  const lines = (text || '').split(/\r?\n/);
  const items: Array<{ question: string; referenceAnswer: string }> = [];
  let curQ: string | null = null;
  let curA: string[] = [];

  const flush = () => {
    if (curQ !== null && curQ.trim()) {
      items.push({ question: curQ.trim(), referenceAnswer: curA.join('\n').trim() });
    }
    curQ = null;
    curA = [];
  };

  for (const line of lines) {
    const qMatch = line.match(/^\s*(?:q|question|问)[:：]\s*(.+)$/i);
    const aMatch = line.match(/^\s*(?:a|answer|答)[:：]\s*(.+)$/i);
    const hMatch = line.match(/^\s*#{2,3}\s+(.+)$/); // ## / ### 标题作为题干

    if (qMatch) {
      flush();
      curQ = qMatch[1];
    } else if (aMatch) {
      if (curQ === null) curQ = ''; // 答案先于题目出现：给一个空题干占位，避免静默丢内容
      curA.push(aMatch[1]);
    } else if (hMatch) {
      flush();
      curQ = hMatch[1];
    } else {
      if (curQ === null) continue; // 首个标记之前的前言，忽略
      curA.push(line);
    }
  }
  flush();
  return items;
}

/** 批量插入（同步）。返回实际插入条数。 */
function insertItems(items: RawInsert[]): number {
  if (!items.length) return 0;
  const now = Date.now();
  db.insert(wbQaBank)
    .values(
      items.map((it) => ({
        userId: CURRENT_USER,
        question: it.question,
        referenceAnswer: it.referenceAnswer,
        sourceType: it.sourceType,
        sourceId: it.sourceId ?? null,
        tags: null,
        difficulty: 1,
        scoringPoints: null,
        createdAt: now,
        idx: null,
      })),
    )
    .run();
  return items.length;
}

/** 读取某来源类型已导入的 sourceId 集合，避免重复导入同一张卡/笔记。 */
function existingSourceIds(sourceType: QaSourceType): Set<number> {
  const rows = db
    .select({ sourceId: wbQaBank.sourceId })
    .from(wbQaBank)
    .where(eq(wbQaBank.sourceType, sourceType))
    .all() as Array<{ sourceId: number | null }>;
  return new Set(rows.map((r) => r.sourceId).filter((n): n is number => n != null));
}

/* ===================== 导入 ===================== */

/** 从 Markdown / 纯文本面经解析并入库，sourceType='import'。 */
export function ingestFromMarkdown(text: string): number {
  const items = parseMarkdownQa(text).map((it) => ({
    question: it.question,
    referenceAnswer: it.referenceAnswer,
    sourceType: 'import' as const,
    sourceId: null,
  }));
  return insertItems(items);
}

/** 从 PDF 缓冲区解析文本（pdf-parse），复用 Markdown 解析器入库。 */
export async function ingestFromPdf(buffer: Buffer): Promise<number> {
  const data = await pdfParse(buffer);
  const text = data?.text || '';
  return ingestFromMarkdown(text);
}

/** 复用复习卡（wb_review_card.front/back）为题库，sourceType='review_card'。幂等去重。 */
export function importFromReviewCards(): number {
  const seen = existingSourceIds('review_card');
  const cards = db
    .select({ id: wbReviewCard.id, front: wbReviewCard.front, back: wbReviewCard.back })
    .from(wbReviewCard)
    .all() as Array<{ id: number; front: string | null; back: string | null }>;
  const items = cards
    .filter((c) => c.front && c.front.trim() && !seen.has(c.id))
    .map((c) => ({ question: c.front!.trim(), referenceAnswer: c.back || '', sourceType: 'review_card' as const, sourceId: c.id }));
  return insertItems(items);
}

/** 复用康奈尔笔记（wb_note.cueColumn 为题、noteColumn/summaryColumn 为答案），sourceType='note'。幂等去重。 */
export function importFromNotes(): number {
  const seen = existingSourceIds('note');
  const notes = db
    .select({ id: wbNote.id, cue: wbNote.cueColumn, note: wbNote.noteColumn, summary: wbNote.summaryColumn })
    .from(wbNote)
    .all() as Array<{ id: number; cue: string | null; note: string | null; summary: string | null }>;
  const items = notes
    .filter((n) => n.cue && n.cue.trim() && !seen.has(n.id))
    .map((n) => ({
      question: n.cue!.trim(),
      referenceAnswer: (n.note || n.summary || '').trim(),
      sourceType: 'note' as const,
      sourceId: n.id,
    }));
  return insertItems(items);
}

/* ===================== 查询 ===================== */

/** 列出题库（同步）。filter 支持来源/标签/难度，excludeIds 在 JS 侧过滤（数据量小）。 */
export function listBanks(filter: QaBankFilter = {}): QaBankRow[] {
  const conds = [];
  if (filter.sourceType) conds.push(eq(wbQaBank.sourceType, filter.sourceType));
  if (typeof filter.difficulty === 'number') conds.push(eq(wbQaBank.difficulty, filter.difficulty));
  if (filter.tag) conds.push(like(wbQaBank.tags, `%${filter.tag}%`));
  const where = conds.length ? and(...conds) : undefined;

  const rows = db
    .select()
    .from(wbQaBank)
    .where(where)
    .orderBy(asc(wbQaBank.idx), asc(wbQaBank.createdAt))
    .all() as QaBankRow[];

  if (filter.excludeIds?.length) {
    const ex = new Set(filter.excludeIds);
    return rows.filter((r) => !ex.has(r.id));
  }
  return rows;
}

/** 按 id 取单条。 */
export function getBank(id: number): QaBankRow | null {
  const row = db.select().from(wbQaBank).where(eq(wbQaBank.id, id)).get();
  return (row as QaBankRow) ?? null;
}

/** 在过滤结果中随机抽一道（用于面试逐题推进）；无题返回 null。 */
export function randomNext(filter: QaBankFilter = {}): QaBankRow | null {
  const rows = listBanks(filter);
  if (!rows.length) return null;
  return rows[Math.floor(Math.random() * rows.length)];
}

/** 取过滤后第一条（startSession 兜底，确保即使不随机也有题可出）。 */
export function firstQuestion(filter: QaBankFilter = {}): QaBankRow | null {
  const rows = listBanks(filter);
  return rows[0] ?? null;
}

/** 给某题合并打标签（去重后写回 tags 列，逗号分隔）。 */
export function tagBank(id: number, tags: string[]): QaBankRow | null {
  const row = getBank(id);
  if (!row) return null;
  const existing = (row.tags ? row.tags.split(',').map((s) => s.trim()).filter(Boolean) : []) as string[];
  const merged = Array.from(new Set([...existing, ...tags.map((s) => s.trim()).filter(Boolean)])).join(',');
  db.update(wbQaBank).set({ tags: merged }).where(eq(wbQaBank.id, id)).run();
  return getBank(id);
}
