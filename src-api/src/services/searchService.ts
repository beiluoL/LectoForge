import { db } from '../db';
import { wbCapture, wbNote, wbStory } from '../db/schema';
import { CURRENT_USER } from '../db';
import { eq, and, or, like, desc } from 'drizzle-orm';
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

/**
 * 每张表在 SQL 层最多取回的候选行数。
 *
 * 为什么需要它：最终只输出 MAX_RESULTS(15) 条，但三条子查询原先都是无上限 .all()，
 * 意味着搜 "a" 这种高命中词会把三张表几乎整个读进内存再排序丢弃——⌘K 是**按键即触发**
 * 的高频路径，这个开销会直接卡住 better-sqlite3 所在的同步线程。
 *
 * 取 60（= 4×MAX_RESULTS）的依据：三表各自已按 createdAt 倒序，
 * 全局前 15 名必然落在「各表前 15 名」的并集内，60 提供了 4 倍冗余，
 * 结果集与全量排序**完全等价**，不存在漏召回。
 */
const PER_TABLE_LIMIT = 60;

/**
 * 跨「收集箱 / 笔记 / 故事」三表实时模糊搜索。
 *
 * @param q 用户输入的原始关键词，内部 trim；空串直接短路返回 []
 * @returns 合并后按创建时间倒序的前 MAX_RESULTS 条结果，每条带 type 与可跳转 path
 */
export function search(q: string): SearchResult[] {
  const query = q.trim();
  if (!query) return [];

  const pattern = `%${query}%`;
  const base = eq(wbCapture.userId, CURRENT_USER);

  const captureRows = db
    .select()
    .from(wbCapture)
    .where(and(base, or(like(wbCapture.title, pattern), like(wbCapture.content, pattern))))
    .orderBy(desc(wbCapture.createdAt))
    .limit(PER_TABLE_LIMIT)
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
    .orderBy(desc(wbNote.createdAt))
    .limit(PER_TABLE_LIMIT)
    .all() as NoteRow[];

  const storyRows = db
    .select()
    .from(wbStory)
    .where(and(eq(wbStory.userId, CURRENT_USER), or(like(wbStory.title, pattern), like(wbStory.content, pattern))))
    .orderBy(desc(wbStory.createdAt))
    .limit(PER_TABLE_LIMIT)
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
