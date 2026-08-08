import { and, desc, eq, like, type SQL } from 'drizzle-orm';
import { CURRENT_USER, db, nowIso } from '../db';
import { wbStory } from '../db/schema';
import type { CreateStoryDTO, ListStoryQuery, StoryVO, UpdateStoryDTO } from '../types/story';

type StoryRow = typeof wbStory.$inferSelect;

/** 粗略统计中文字符 + 英文单词数（对齐 Web calcWords）。 */
function calcWords(content: string | null): number {
  if (!content) return 0;
  const text = content.replace(/[#>*`\-|\[\]()!]/g, ' ').replace(/\s+/g, ' ');
  let cjk = 0;
  let en = 0;
  for (const token of text.split(' ')) {
    if (!token) continue;
    if (/[一-龥]/.test(token)) cjk += token.length;
    else en += 1;
  }
  return cjk + en;
}

function toVO(r: StoryRow): StoryVO {
  return {
    id: r.id,
    userId: r.userId,
    captureId: r.captureId,
    noteId: r.noteId,
    categoryId: r.categoryId,
    title: r.title,
    audience: r.audience,
    metaphor: r.metaphor,
    content: r.content,
    gapNote: r.gapNote,
    status: r.status,
    clarityScore: r.clarityScore,
    wordCount: r.wordCount,
    createTime: r.createdAt,
    updateTime: r.updatedAt,
  };
}

export function listStories(q: ListStoryQuery): StoryVO[] {
  const conds: SQL[] = [eq(wbStory.userId, CURRENT_USER)];
  if (q.status) conds.push(eq(wbStory.status, String(q.status)));
  if (q.categoryId) conds.push(eq(wbStory.categoryId, Number(q.categoryId)));
  if (q.keyword) conds.push(like(wbStory.title, `%${q.keyword}%`));
  return db
    .select()
    .from(wbStory)
    .where(and(...conds))
    .orderBy(desc(wbStory.updatedAt))
    .all()
    .map(toVO);
}

export function findStory(id: number): StoryVO | null {
  const row = db.select().from(wbStory).where(eq(wbStory.id, id)).get();
  return row ? toVO(row) : null;
}

export function createStory(b: CreateStoryDTO): number {
  const now = nowIso();
  const row = db
    .insert(wbStory)
    .values({
      userId: CURRENT_USER,
      captureId: b.captureId ?? null,
      noteId: b.noteId ?? null,
      categoryId: b.categoryId ?? null,
      title: b.title,
      audience: b.audience ?? 'CHILD',
      metaphor: b.metaphor ?? null,
      content: b.content ?? '',
      gapNote: b.gapNote ?? null,
      status: b.status ?? 'DRAFT',
      clarityScore: b.clarityScore ?? null,
      wordCount: calcWords(b.content ?? ''),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return row.id;
}

export function updateStory(id: number, b: UpdateStoryDTO): StoryVO | null {
  const ex = db.select().from(wbStory).where(eq(wbStory.id, id)).get();
  if (!ex) return null;
  const content = b.content ?? ex.content;
  db.update(wbStory)
    .set({
      captureId: b.captureId !== undefined ? b.captureId : ex.captureId,
      noteId: b.noteId !== undefined ? b.noteId : ex.noteId,
      categoryId: b.categoryId !== undefined ? b.categoryId : ex.categoryId,
      title: b.title ?? ex.title,
      audience: b.audience ?? ex.audience,
      metaphor: b.metaphor ?? ex.metaphor,
      content,
      gapNote: b.gapNote ?? ex.gapNote,
      status: b.status ?? ex.status,
      clarityScore: b.clarityScore !== undefined ? b.clarityScore : ex.clarityScore,
      wordCount: calcWords(content),
      updatedAt: nowIso(),
    })
    .where(eq(wbStory.id, id))
    .run();
  const updated = db.select().from(wbStory).where(eq(wbStory.id, id)).get();
  return updated ? toVO(updated) : null;
}

export function deleteStory(id: number): void {
  db.delete(wbStory).where(eq(wbStory.id, id)).run();
}
