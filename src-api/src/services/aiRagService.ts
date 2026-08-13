/**
 * 知识库问答（RAG）检索增强生成服务。
 *
 * 检索策略（增强版）：
 *   1) 向量语义检索（优先）：把用户 Query 向量化，与 wb_embedding 中全部向量算余弦相似度，
 *      取 Top-3 实体；命中 .md 文档时，再对该文档按段落二次向量化，定位最相似段落的
 *      精确行号（anchor: "L20-L25"），作为「精准溯源」交给前端高亮。
 *   2) 关键词检索（降级）：未配置向量化服务、或库内尚无向量时，退化为 .md 文件 grep +
 *      wb_note 的 LIKE 检索，并同样给出匹配行号锚点。
 *
 * 与既有 AI 服务一致：
 * - 入参/检索失败以 AiFailure 回报，由 Controller 翻译成 { code, message, aiCode }；
 * - LlmError（未配置 Key）向上抛，Controller 的 fail() 转成 { code, message, aiCode }。
 */
import fs from 'node:fs';
import path from 'node:path';

import { eq, like, or } from 'drizzle-orm';

import { db } from '../db';
import { wbNote, wbEmbedding } from '../db/schema';
import { chatJson, truncate, embed, embeddingsReady, readEmbeddingConfig } from '../lib/llm';
import { requireRootDir, safeResolve, toRelId } from '../lib/vault';
import { buildRagPrompt } from '../lib/prompts';
import type { AiResult } from '../types/ai';
import type { RagRequest, RagResponse, RagSource } from '../types/rag';

/** 合并后上下文正文的总字符上限（避免超出 LLM Token 限制） */
const MAX_CONTEXT_CHARS = 6000;
/** 单条检索片段截断长度 */
const SNIPPET_CAP = 1200;
/** 向量检索取前 N 个最相似实体 */
const VECTOR_TOP_K = 3;
/** 关键词检索：单次扫描文件数上限，防止超大库把进程拖死 */
const MAX_DOC_FILES = 4000;
/** 单个 .md 文件超过此体积（1MB）则跳过正文扫描 */
const DOC_READ_CAP = 1024 * 1024;
/** 每个来源（文档/笔记）最多保留的命中块数 */
const TOP_PER_SOURCE = 5;
/** 递归遍历时始终跳过的目录名 */
const SKIP_DIRS = new Set([
  '.git', '.svn', '.hg', 'node_modules', '.obsidian', '.trash',
  '.DS_Store', '__pycache__', '.idea', '.vscode',
]);

/** 文档命中块 */
interface DocHit {
  /** POSIX 相对 id，如 折子/并发编程指南.md */
  path: string;
  /** 文件名（去 .md 后缀） */
  title: string;
  /** 命中片段（含上下文行） */
  content: string;
  /** 命中词数，用于排序 */
  score: number;
  /** 精确行号锚点，形如 "L20-L25"（1-based，闭区间） */
  anchor?: string;
}

/** 笔记命中块 */
interface NoteHit {
  id: number;
  title: string;
  content: string;
  score: number;
}

/** 送入 Prompt 的来源块（已编号，模型据此引用） */
interface RagContextBlock {
  index: number;
  sourceType: 'doc' | 'note';
  title: string;
  link: string;
  content: string;
  /** 文档库命中时的精确行号锚点 */
  anchor?: string;
}

/** 余弦相似度（向量已归一化时即点积；这里显式归一化，避免维度不一致） */
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 把查询拆成检索词：空白与常见标点切分；中文整体作为一词仍可子串命中 */
function tokenize(q: string): string[] {
  const cleaned = q.trim().toLowerCase();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/[\s,，。、；;：:!！?？()（）[\]"'"'”“《》<>]+/)
    .filter(Boolean);
  return parts.length ? parts : [cleaned];
}

/** 统计文本中命中词出现次数，作为相关度分数 */
function snippetScore(text: string, terms: string[]): number {
  if (!text || !terms.length) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (!t) continue;
    let idx = lower.indexOf(t);
    while (idx >= 0) {
      score += 1;
      idx = lower.indexOf(t, idx + t.length);
    }
  }
  return score;
}

// ===================== 关键词检索（降级路径） =====================

/**
 * 在单个 .md 文件中定位命中行（含上下文），返回片段与精确行号区间。
 * 复用 vault 的 requireRootDir / toRelId 保证路径始终落在文档库范围内（防越界）。
 */
function findDocHit(
  abs: string,
  terms: string[],
): { snippet: string; lineStart: number; lineEnd: number } | null {
  let content: string;
  try {
    const stat = fs.statSync(abs);
    if (stat.size > DOC_READ_CAP) return null;
    content = fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
  if (!content) return null;

  const lines = content.split(/\r?\n/);
  const hitLines: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (terms.some((t) => lines[i].toLowerCase().includes(t))) hitLines.push(i + 1); // 1-based
  }
  if (!hitLines.length) return null;

  const first = hitLines[0];
  const last = hitLines[hitLines.length - 1];
  // 命中行上下各取 1 行作为上下文片段
  const start = Math.max(1, first - 1);
  const end = Math.min(lines.length, last + 1);
  let snippet = lines.slice(start - 1, end).join('\n');
  if (snippet.length > SNIPPET_CAP) snippet = `${snippet.slice(0, SNIPPET_CAP)}…`;
  return { snippet, lineStart: first, lineEnd: last };
}

/** 文档库关键词检索：遍历 .md 文件，对命中行抽取片段与精确行号区间 */
function retrieveDocsKeyword(query: string): DocHit[] {
  let root: string;
  try {
    root = requireRootDir();
  } catch {
    return [];
  }
  const terms = tokenize(query);
  if (!terms.length) return [];

  const files: string[] = [];
  const walk = (dir: string) => {
    if (files.length >= MAX_DOC_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= MAX_DOC_FILES) return;
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      try {
        if (e.isDirectory()) walk(abs);
        else if (e.isFile() && /\.(md|markdown|mdx)$/i.test(e.name)) files.push(abs);
      } catch {
        /* 权限不足忽略 */
      }
    }
  };
  walk(root);

  const hits: DocHit[] = [];
  for (const abs of files) {
    const hit = findDocHit(abs, terms);
    if (hit) {
      const relId = toRelId(abs);
      hits.push({
        path: relId,
        title: path.basename(abs, path.extname(abs)),
        content: hit.snippet,
        score: snippetScore(hit.snippet, terms),
        anchor: hit.lineStart === hit.lineEnd ? `L${hit.lineStart}` : `L${hit.lineStart}-L${hit.lineEnd}`,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, TOP_PER_SOURCE);
}

/**
 * 康奈尔笔记检索：在 note_column / cue_column / summary_column 三列做 LIKE 匹配。
 * 单用户场景，沿用本模块其它 AI 服务的写法（不按 userId 过滤）。
 */
function retrieveNotesKeyword(query: string): NoteHit[] {
  const q = query.trim();
  if (!q) return [];
  const likeConds = [
    like(wbNote.noteColumn, `%${q}%`),
    like(wbNote.cueColumn, `%${q}%`),
    like(wbNote.summaryColumn, `%${q}%`),
  ];
  const rows = db
    .select({
      id: wbNote.id,
      title: wbNote.title,
      noteColumn: wbNote.noteColumn,
      cueColumn: wbNote.cueColumn,
      summaryColumn: wbNote.summaryColumn,
    })
    .from(wbNote)
    .where(or(...likeConds))
    .limit(5)
    .all() as Array<{
    id: number;
    title: string;
    noteColumn: string | null;
    cueColumn: string | null;
    summaryColumn: string | null;
  }>;

  return rows
    .map((r) => {
      const text = [r.noteColumn, r.cueColumn, r.summaryColumn]
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .join('\n');
      return {
        id: r.id,
        title: r.title || '未命名笔记',
        content: text,
        score: snippetScore(text, tokenize(q)),
      };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_PER_SOURCE);
}

// ===================== 向量语义检索（主路径） =====================

/**
 * 对单个 .md 文档按段落二次向量化，定位与 Query 最相似段落的精确行号。
 * @returns 命中文段的截断文本与行号锚点（如 "L20-L25"）；文档缺失/空则返回 null。
 */
async function localizeDocLines(
  relId: string,
  queryVec: number[],
): Promise<{ content: string; anchor?: string } | null> {
  let abs: string;
  try {
    abs = safeResolve(relId);
  } catch {
    return null;
  }
  let content: string;
  try {
    const stat = fs.statSync(abs);
    if (stat.size > DOC_READ_CAP) return null;
    content = fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
  if (!content.trim()) return null;

  const lines = content.split(/\r?\n/);
  // 按空行切分成段落，记录每段 1-based 行区间 [start, end]
  const paras: Array<{ start: number; end: number; text: string }> = [];
  let curStart = 1;
  let curBuf: string[] = [];
  const flush = (endLine: number) => {
    if (curBuf.length) {
      const text = curBuf.join('\n').trim();
      if (text) paras.push({ start: curStart, end: endLine, text });
    }
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      flush(i); // 当前段结束于 i-1
      curBuf = [];
      curStart = i + 2; // 下一段从下一行(1-based i+2)开始
    } else {
      curBuf.push(line);
    }
  }
  flush(lines.length);
  if (!paras.length) {
    paras.push({ start: 1, end: lines.length, text: content.trim() });
  }

  // 限制段落数，避免超大文档产生过多 embedding 调用
  const capped = paras.slice(0, 80);
  let scored = capped.map((p) => ({ ...p, score: 0 }));
  try {
    const vectors = await embed(
      capped.map((p) => p.text),
      { config: readEmbeddingConfig() },
    );
    scored = capped.map((p, idx) => ({ ...p, score: cosineSimilarity(queryVec, vectors[idx] ?? []) }));
  } catch {
    // 段落向量化失败：退化为首段，不阻断 RAG
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const text = truncate(best.text, SNIPPET_CAP);
  const anchor = best.start === best.end ? `L${best.start}` : `L${best.start}-L${best.end}`;
  return { content: text, anchor };
}

/**
 * 向量语义检索：向量化 Query，对 wb_embedding 全量算余弦相似度，取 Top-N 实体，
 * 命中文档则定位精确行号。未配置向量化服务或库内无向量时返回 null（交由关键词降级）。
 */
async function vectorRetrieve(query: string): Promise<RagContextBlock[] | null> {
  if (!embeddingsReady()) return null;
  const cfg = readEmbeddingConfig();

  let queryVec: number[];
  try {
    [queryVec] = await embed([query], { config: cfg });
  } catch {
    return null; // 向量化失败（Key 无效/网络）→ 关键词降级
  }

  const rows = db
    .select({
      entityType: wbEmbedding.entityType,
      entityId: wbEmbedding.entityId,
      model: wbEmbedding.model,
      vector: wbEmbedding.vector,
    })
    .from(wbEmbedding)
    .where(eq(wbEmbedding.model, cfg.model))
    .all() as Array<{ entityType: string; entityId: string; model: string; vector: string }>;
  if (!rows.length) return null;

  const scored = rows
    .map((e) => {
      let vec: number[];
      try {
        vec = JSON.parse(e.vector);
      } catch {
        return null;
      }
      return { type: e.entityType, id: e.entityId, score: cosineSimilarity(queryVec, vec) };
    })
    .filter((x): x is { type: string; id: string; score: number } => !!x && x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, VECTOR_TOP_K);

  if (!scored.length) return null;

  const blocks: RagContextBlock[] = [];
  for (const s of scored) {
    if (s.type === 'doc') {
      let abs: string;
      try {
        abs = safeResolve(s.id);
      } catch {
        continue;
      }
      const title = path.basename(abs, path.extname(abs));
      const loc = await localizeDocLines(s.id, queryVec);
      if (!loc) continue;
      blocks.push({
        index: blocks.length + 1,
        sourceType: 'doc',
        title,
        link: `/library?doc=${encodeURIComponent(s.id)}&highlight=${encodeURIComponent(loc.anchor ?? '')}`,
        content: loc.content,
        anchor: loc.anchor,
      });
    } else if (s.type === 'note') {
      const noteId = Number(s.id);
      const row = db
        .select({
          id: wbNote.id,
          title: wbNote.title,
          noteColumn: wbNote.noteColumn,
          cueColumn: wbNote.cueColumn,
          summaryColumn: wbNote.summaryColumn,
        })
        .from(wbNote)
        .where(eq(wbNote.id, noteId))
        .get();
      if (!row) continue;
      const text = [row.noteColumn, row.cueColumn, row.summaryColumn]
        .filter((x): x is string => typeof x === 'string' && x.length > 0)
        .join('\n');
      blocks.push({
        index: blocks.length + 1,
        sourceType: 'note',
        title: row.title || '未命名笔记',
        link: `/workbench/notes/${noteId}`,
        content: truncate(text, SNIPPET_CAP),
      });
    }
    // capture / story 不进入 RAG 上下文（RAG 只答文档库与笔记）
  }
  return blocks.length ? blocks : null;
}

// ===================== 上下文拼装 =====================

/** 合并文档/笔记命中，排序并截断到上下文上限，生成编号来源块 */
function buildContextBlocks(docHits: DocHit[], noteHits: NoteHit[]): RagContextBlock[] {
  const all: Array<{
    sourceType: 'doc' | 'note';
    title: string;
    link: string;
    content: string;
    score: number;
    anchor?: string;
  }> = [
    ...docHits.map((d) => ({
      sourceType: 'doc' as const,
      title: d.title,
      link: `/library?doc=${encodeURIComponent(d.path)}`,
      content: truncate(d.content, SNIPPET_CAP),
      score: d.score,
      anchor: d.anchor,
    })),
    ...noteHits.map((n) => ({
      sourceType: 'note' as const,
      title: n.title,
      link: `/workbench/notes/${n.id}`,
      content: truncate(n.content, SNIPPET_CAP),
      score: n.score,
    })),
  ];
  all.sort((a, b) => b.score - a.score);

  const picked: typeof all = [];
  let total = 0;
  for (const h of all) {
    if (picked.length && total + h.content.length > MAX_CONTEXT_CHARS) break;
    picked.push(h);
    total += h.content.length;
  }

  return picked.map((h, i) => ({
    index: i + 1,
    sourceType: h.sourceType,
    title: h.title,
    link: h.link,
    content: h.content,
    anchor: h.anchor,
  }));
}

/** 把来源块拼成 Prompt 用的上下文字符串（供模型引用与照抄 link/行号） */
function assembleContext(blocks: RagContextBlock[]): string {
  return blocks
    .map((b) => {
      const lines = [
        `[来源 ${b.index}]（${b.sourceType === 'doc' ? '文档库' : '笔记'}）`,
        `标题：${b.title}`,
        `链接：${b.link}`,
      ];
      if (b.anchor) lines.push(`行号：${b.anchor}`);
      lines.push(`正文：\n${b.content}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * 知识库问答主入口。
 * @returns AiResult<RagResponse> —— Controller 据此翻译成 HTTP 响应。
 */
export async function askRag(req: RagRequest): Promise<AiResult<RagResponse>> {
  const query = (req.query || '').trim();
  if (!query) {
    return { kind: 'fail', status: 400, message: '问题不能为空', aiCode: 'AI_BAD_INPUT' };
  }

  // 优先向量语义检索；不可用时降级关键词检索
  const vectorBlocks = await vectorRetrieve(query);
  const blocks =
    vectorBlocks && vectorBlocks.length
      ? vectorBlocks
      : buildContextBlocks(retrieveDocsKeyword(query), retrieveNotesKeyword(query));

  // 没有任何检索命中：直接坦诚回复，省去一次 LLM 调用
  if (blocks.length === 0) {
    return { kind: 'ok', data: { answer: '知识库中未找到相关内容', sources: [] } };
  }

  const messages = buildRagPrompt(query, assembleContext(blocks));
  const { data } = await chatJson<{
    answer?: string;
    sources?: Array<{ sourceType?: string; title?: string; link?: string }>;
  }>(messages, { temperature: 0.2 });

  const answer = (data.answer || '').trim() || '知识库中未找到相关内容';

  // 校验模型回传的来源：只保留 link 真实存在（来自检索块）的来源；
  // 模型未引用或引用了幻觉链接时，回退为全部检索来源，保证链接可跳转。
  const linkMap = new Map(blocks.map((b) => [b.link, b]));
  const fallback: RagSource[] = blocks.map((b) => ({
    sourceType: b.sourceType,
    title: b.title,
    link: b.link,
    anchor: b.anchor,
  }));

  let sources: RagSource[] = fallback;
  if (Array.isArray(data.sources)) {
    const cited = data.sources
      .filter((s) => s && linkMap.has(s.link || ''))
      .map((s) => {
        const block = linkMap.get(s.link || '')!;
        return {
          sourceType: (s.sourceType === 'note' ? 'note' : 'doc') as 'doc' | 'note',
          title: String(s.title || block.title || ''),
          link: String(s.link || ''),
          anchor: block.anchor,
        };
      });
    if (cited.length) sources = cited;
  }

  return { kind: 'ok', data: { answer, sources } };
}
