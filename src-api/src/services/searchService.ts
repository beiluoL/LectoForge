import { db } from '../db';
import { wbCapture, wbNote, wbStory } from '../db/schema';
import { CURRENT_USER } from '../db';
import { eq, and, or, like } from 'drizzle-orm';
import type { SearchResult } from '../types/search';

type CaptureRow = typeof wbCapture.$inferSelect;
type NoteRow = typeof wbNote.$inferSelect;
type StoryRow = typeof wbStory.$inferSelect;

const MAX_RESULTS = 15;
const SUMMARY_LEN = 30;

/** 取字符串前 SUMMARY_LEN 字，超出补省略号 */
function summarize(s: string | null | undefined): string {
  const t = (s ?? '').toString().replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > SUMMARY_LEN ? `${t.slice(0, SUMMARY_LEN)}…` : t;
}

/** 康奈尔笔记没有单一 content 列，正文散落在 cueColumn / noteColumn / summaryColumn */
function noteText(row: NoteRow): string {
  return [row.cueColumn, row.noteColumn, row.summaryColumn]
    .filter((s) => s && String(s).trim())
    .join(' ');
}

function mapCapture(row: CaptureRow): SearchResult {
  return {
    type: 'capture',
    id: row.id,
    title: (row.title || '').trim() || '未命名收集项',
    content: summarize(row.content),
    path: `/inbox?highlightId=${row.id}`,
  };
}

function mapNote(row: NoteRow): SearchResult {
  return {
    type: 'note',
    id: row.id,
    title: (row.title || '').trim() || '未命名笔记',
    content: summarize(noteText(row)),
    path: `/workbench/notes/${row.id}`,
  };
}

function mapStory(row: StoryRow): SearchResult {
  return {
    type: 'story',
    id: row.id,
    title: (row.title || '').trim() || '未命名故事',
    content: summarize(row.content),
    path: `/workbench/story/${row.id}`,
  };
}

/** 跨三表实时模糊搜索，合并后按创建时间倒序，取前 15 条 */
export function search(q: string): SearchResult[] {
  const query = q.trim();
  if (!query) return [];

  const pattern = `%${query}%`;
  const base = eq(wbCapture.userId, CURRENT_USER);

  const captureRows = db
    .select()
    .from(wbCapture)
    .where(and(base, or(like(wbCapture.title, pattern), like(wbCapture.content, pattern))))
    .all() as CaptureRow[];

  const noteRows = db
    .select()
    .from(wbNote)
    .where(
      and(
        eq(wbNote.userId, CURRENT_USER),
        or(
          like(wbNote.title, pattern),
          like(wbNote.cueColumn, pattern),
          like(wbNote.noteColumn, pattern),
          like(wbNote.summaryColumn, pattern),
        ),
      ),
    )
    .all() as NoteRow[];

  const storyRows = db
    .select()
    .from(wbStory)
    .where(and(eq(wbStory.userId, CURRENT_USER), or(like(wbStory.title, pattern), like(wbStory.content, pattern))))
    .all() as StoryRow[];

  // 合并且保留创建时间用于全局排序（createdAt 为 ISO 字符串，字典序即时间序）
  const merged = [
    ...captureRows.map((r) => ({ r, type: 'capture' as const })),
    ...noteRows.map((r) => ({ r, type: 'note' as const })),
    ...storyRows.map((r) => ({ r, type: 'story' as const })),
  ];
  merged.sort((a, b) => {
    const at = a.r.createdAt || '';
    const bt = b.r.createdAt || '';
    return bt < at ? -1 : bt > at ? 1 : 0;
  });

  return merged.slice(0, MAX_RESULTS).map(({ r, type }) => {
    if (type === 'capture') return mapCapture(r);
    if (type === 'note') return mapNote(r);
    return mapStory(r);
  });
}
