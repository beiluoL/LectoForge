import { desc, eq } from 'drizzle-orm';
import { CURRENT_USER, db, nowIso } from '../db';
import { wbRecallSession } from '../db/schema';
import type { CreateRecallDTO, RecallSessionVO, SubmitRecallDTO } from '../types/recall';

type RecallRow = typeof wbRecallSession.$inferSelect;

/** 简易分词：英文按词（长度≥2）、中文按字，用于三轮闭卷默写自动比对计分。 */
function tokenize(text: string): Set<string> {
  const lower = (text || '').toLowerCase();
  const tokens = new Set<string>();
  const matches = lower.match(/[a-z]+|[一-龥]/g) || [];
  for (const t of matches) {
    if (/[a-z]/.test(t)) {
      if (t.length >= 2) tokens.add(t);
    } else {
      tokens.add(t);
    }
  }
  return tokens;
}

/** 比对原文与默写，命中原文关键词比例 × 100（0~100）。 */
function scoreRecall(source: string, recall: string): number {
  if (!source || !source.trim()) return 0;
  const sourceWords = tokenize(source);
  if (sourceWords.size === 0) return 0;
  const recallWords = tokenize(recall);
  if (recallWords.size === 0) return 0;
  let hit = 0;
  recallWords.forEach((w) => {
    if (sourceWords.has(w)) hit += 1;
  });
  return Math.round((hit / sourceWords.size) * 100);
}

/** 计算本轮相对上一轮的进步百分比，任一为空返回 null。 */
function calcImprovement(prev: number | null, curr: number | null): number | null {
  if (prev == null || curr == null) return null;
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

function toVO(e: RecallRow): RecallSessionVO {
  return {
    id: e.id,
    userId: e.userId,
    noteId: e.noteId,
    cardId: e.cardId,
    title: e.title,
    sourceText: e.sourceText,
    round1Text: e.round1Text,
    round1Score: e.round1Score,
    round2Text: e.round2Text,
    round2Score: e.round2Score,
    round3Text: e.round3Text,
    round3Score: e.round3Score,
    currentRound: e.currentRound,
    status: e.status,
    round3DueTime: e.round3DueTime,
    completedTime: e.completedTime,
    createTime: e.createdAt,
    updateTime: e.updatedAt,
    scoreTrend: [e.round1Score, e.round2Score, e.round3Score],
    improvementPct: [
      null,
      calcImprovement(e.round1Score, e.round2Score),
      calcImprovement(e.round2Score, e.round3Score),
    ],
  };
}

export function listRecallSessions(): RecallSessionVO[] {
  return db
    .select()
    .from(wbRecallSession)
    .where(eq(wbRecallSession.userId, CURRENT_USER))
    .orderBy(desc(wbRecallSession.createdAt))
    .all()
    .map(toVO);
}

export function findRecallSession(id: number): RecallSessionVO | null {
  const row = db.select().from(wbRecallSession).where(eq(wbRecallSession.id, id)).get();
  return row ? toVO(row) : null;
}

export function createRecallSession(b: CreateRecallDTO): number {
  const now = nowIso();
  const row = db
    .insert(wbRecallSession)
    .values({
      userId: CURRENT_USER,
      noteId: b.noteId ?? null,
      cardId: b.cardId ?? null,
      title: (b.title && String(b.title).trim()) || '主动回忆会话',
      sourceText: b.sourceText,
      round1Text: null,
      round1Score: null,
      round2Text: null,
      round2Score: null,
      round3Text: null,
      round3Score: null,
      currentRound: 1,
      status: 'IN_PROGRESS',
      round3DueTime: null,
      completedTime: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return row.id;
}

export function submitRecallRound(id: number, round: number, text: string): RecallSessionVO | null {
  const row = db.select().from(wbRecallSession).where(eq(wbRecallSession.id, id)).get();
  if (!row) return null;
  const score = scoreRecall(row.sourceText ?? '', String(text));
  const now = nowIso();
  const set: Partial<RecallRow> = { updatedAt: now };
  if (round === 1) {
    set.round1Text = text;
    set.round1Score = score;
    set.currentRound = 2;
  } else if (round === 2) {
    set.round2Text = text;
    set.round2Score = score;
    set.currentRound = 3;
    set.round3DueTime = new Date(Date.now() + 3600000).toISOString();
  } else {
    set.round3Text = text;
    set.round3Score = score;
    set.currentRound = 3;
    set.status = 'COMPLETED';
    set.completedTime = now;
  }
  db.update(wbRecallSession).set(set).where(eq(wbRecallSession.id, id)).run();
  const updated = db.select().from(wbRecallSession).where(eq(wbRecallSession.id, id)).get();
  return updated ? toVO(updated) : null;
}

export function deleteRecallSession(id: number): void {
  db.delete(wbRecallSession).where(eq(wbRecallSession.id, id)).run();
}
