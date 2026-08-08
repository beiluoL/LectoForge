/**
 * 收集箱智能去重服务。
 *
 * 判重口径（命中任一即算重复）：
 *   1) sourceUrl 归一化后完全一致（去协议 / www / 末尾斜杠 / utm 追踪参数）；
 *   2) 正文归一化后与近 7 天未处理条目的相似度 > 0.8（fastest-levenshtein 编辑距离）。
 *
 * 判重是「提醒」而非「拦截」：任何异常都降级为「不重复」，
 * 绝不能因为判重失败挡住用户记录灵感——因此本服务不抛错，永远返回可用结构。
 */
import { and, desc, eq, gte } from 'drizzle-orm';
import { distance as levenshtein } from 'fastest-levenshtein';

import { CURRENT_USER, db } from '../db';
import { wbCapture } from '../db/schema';
import { localDayStartIso } from './inboxService';
import type { DuplicateCheckDTO, DuplicateCheckResult } from '../types/inbox';

/** 相似度判重阈值：> 0.8 视为重复（与前端提示文案一致） */
const DUP_THRESHOLD = 0.8;
/** 去重回溯窗口：只跟最近 7 天的未处理条目比，超出这个窗口的「旧灵感」不打扰用户 */
const DUP_LOOKBACK_DAYS = 7;
/** 短于该长度的内容不参与相似度判重（「好」「TODO」这类极短文本必然互相高相似，纯噪音） */
const DUP_MIN_LEN = 8;

/** 判重前的文本归一化：去 Markdown 空白/标点噪音，统一小写，避免格式差异干扰编辑距离 */
function normalizeForDup(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ') // URL 单独比对，不混进正文相似度
    .replace(/[\s\u3000]+/g, '')
    .replace(/[。，、；：！？,.;:!?"'“”‘’()（）\[\]【】]/g, '');
}

/** 归一化 URL：去掉协议差异、末尾斜杠与常见追踪参数，让同一篇文章的不同分享链接能对上 */
function normalizeUrl(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'from', 'spm'].forEach((k) =>
      u.searchParams.delete(k),
    );
    const qs = u.searchParams.toString();
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${qs ? `?${qs}` : ''}`.toLowerCase();
  } catch {
    return s.toLowerCase().replace(/\/+$/, '');
  }
}

/** 归一化编辑距离相似度：1 - distance / max(len)，取值 [0,1] */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  // 长度差距过大时直接判为不相似，省掉一次 O(n*m) 计算（编辑距离下界即长度差）
  if (Math.abs(a.length - b.length) / max > 1 - DUP_THRESHOLD) return 0;
  return 1 - levenshtein(a, b) / max;
}

const MISS: DuplicateCheckResult = { isDuplicate: false, similarity: 0, reason: 'none' };

export function checkDuplicate(dto: DuplicateCheckDTO): DuplicateCheckResult {
  const content = (dto.content ?? '').trim();
  const sourceUrl = (dto.sourceUrl ?? '').trim();
  const excludeId = dto.excludeId ?? 0;
  if (!content && !sourceUrl) return MISS;

  try {
    const since = localDayStartIso(DUP_LOOKBACK_DAYS - 1);
    const rows = db
      .select({
        id: wbCapture.id,
        title: wbCapture.title,
        content: wbCapture.content,
        sourceUrl: wbCapture.sourceUrl,
        createdAt: wbCapture.createdAt,
      })
      .from(wbCapture)
      .where(
        and(
          eq(wbCapture.userId, CURRENT_USER),
          eq(wbCapture.status, 'INBOX'),
          gte(wbCapture.createdAt, since),
        ),
      )
      .orderBy(desc(wbCapture.createdAt))
      .limit(200) // 近 7 天的收集量级远小于此，加个天花板防极端情况下 O(n·m) 爆炸
      .all();

    // 1) URL 完全一致优先（比正文相似度更硬的证据）
    const urlKey = normalizeUrl(sourceUrl);
    if (urlKey) {
      const hit = rows.find((r) => r.id !== excludeId && normalizeUrl(r.sourceUrl || '') === urlKey);
      if (hit) {
        return {
          isDuplicate: true,
          existingId: hit.id,
          existingTitle: hit.title,
          existingCreatedAt: hit.createdAt,
          similarity: 1,
          reason: 'url',
        };
      }
    }

    // 2) 正文相似度
    const base = normalizeForDup(content);
    if (base.length >= DUP_MIN_LEN) {
      let best: { row: (typeof rows)[number]; score: number } | null = null;
      for (const r of rows) {
        if (r.id === excludeId) continue;
        const other = normalizeForDup(r.content || r.title || '');
        if (other.length < DUP_MIN_LEN) continue;
        const score = similarity(base, other);
        if (!best || score > best.score) best = { row: r, score };
      }
      if (best && best.score > DUP_THRESHOLD) {
        return {
          isDuplicate: true,
          existingId: best.row.id,
          existingTitle: best.row.title,
          existingCreatedAt: best.row.createdAt,
          similarity: Number(best.score.toFixed(3)),
          reason: 'content',
        };
      }
    }
    return MISS;
  } catch {
    // 判重失败一律当作「不重复」，绝不阻断输入
    return MISS;
  }
}
