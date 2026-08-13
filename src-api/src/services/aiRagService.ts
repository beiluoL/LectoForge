/**
 * 知识库问答（RAG）检索增强生成服务。
 *
 * 流程：检索文档库(.md) + 康奈尔笔记(wb_note) → 合并并按相关度排序、截断上下文
 *       → 调 LLM 仅基于上下文作答，并回传真实可跳转的来源。
 *
 * 与既有 AI 服务一致：
 * - 入参/检索失败以 AiFailure 回报，由 Controller 翻译成 { code, message, aiCode }；
 * - LlmError（未配置 Key）向上抛，Controller 的 fail() 转成 { code, message, aiCode }。
 * - 全异步：文件读取与 LLM 调用本就是异步的，与 workbench 侧的同步 Drizzle 服务不冲突。
 */
import fs from 'node:fs';
import path from 'node:path';

import { like, or } from 'drizzle-orm';

import { db } from '../db';
import { wbNote } from '../db/schema';
import { chatJson, truncate } from '../lib/llm';
import { requireRootDir, toRelId } from '../lib/vault';
import { buildRagPrompt } from '../lib/prompts';
import type { AiResult } from '../types/ai';
import type { RagRequest, RagResponse, RagSource } from '../types/rag';

/** 合并后上下文正文的总字符上限（避免超出 LLM Token 限制） */
const MAX_CONTEXT_CHARS = 6000;
/** 单条检索片段截断长度 */
const SNIPPET_CAP = 1200;
/** 文档检索：单次扫描文件数上限，防止超大库把进程拖死 */
const MAX_DOC_FILES = 4000;
/** 每个来源（文档/笔记）最多保留的命中块数 */
const TOP_PER_SOURCE = 5;
/** 单个 .md 文件超过此体积（1MB）则跳过正文扫描（极少是检索目标，且避免内存压力） */
const DOC_READ_CAP = 1024 * 1024;
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

/**
 * 文档库（vault）关键词检索：遍历 .md 文件，对命中行抽取「前后各一行」片段。
 * 复用 vault 的 requireRootDir / toRelId 保证路径始终落在文档库范围内（防越界）。
 * 文档库未初始化时静默降级为空结果（RAG 退化为仅检索笔记）。
 */
function retrieveDocs(query: string): DocHit[] {
  let root: string;
  try {
    root = requireRootDir();
  } catch {
    return [];
  }
  const terms = tokenize(query);
  if (!terms.length) return [];

  // ① 廉价地收集全部 .md 绝对路径（不读内容）
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
    const snippet = grepSnippet(abs, terms);
    if (snippet) {
      const relId = toRelId(abs);
      hits.push({
        path: relId,
        title: path.basename(abs, path.extname(abs)),
        content: snippet,
        score: snippetScore(snippet, terms),
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, TOP_PER_SOURCE);
}

/** 读取单文件，抽取命中行及其上下文行 */
function grepSnippet(abs: string, terms: string[]): string | null {
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
  const blocks: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (terms.some((t) => line.toLowerCase().includes(t))) {
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length - 1, i + 1);
      let blk = lines.slice(start, end + 1).join('\n');
      if (blk.length > SNIPPET_CAP) blk = blk.slice(0, SNIPPET_CAP) + '…';
      blocks.push(blk);
      used += blk.length;
      if (used > 1400) break;
    }
  }
  if (!blocks.length) return null;
  let out = blocks.join('\n…\n');
  if (out.length > 1500) out = out.slice(0, 1500) + '…';
  return out;
}

/**
 * 康奈尔笔记检索：在 note_column / cue_column / summary_column 三列做 LIKE 匹配。
 * 单用户场景，沿用本模块其它 AI 服务的写法（不按 userId 过滤）。
 */
function retrieveNotes(query: string): NoteHit[] {
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

/** 合并文档/笔记命中，排序并截断到上下文上限，生成编号来源块 */
function buildContextBlocks(docHits: DocHit[], noteHits: NoteHit[]): RagContextBlock[] {
  const all: Array<{ sourceType: 'doc' | 'note'; title: string; link: string; content: string; score: number }> = [
    ...docHits.map((d) => ({
      sourceType: 'doc' as const,
      title: d.title,
      link: `/library?doc=${encodeURIComponent(d.path)}`,
      content: truncate(d.content, SNIPPET_CAP),
      score: d.score,
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

  // 截断：累计正文不超过上限，至少保留 1 块
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
  }));
}

/** 把来源块拼成 Prompt 用的上下文字符串（供模型引用与照抄 link） */
function assembleContext(blocks: RagContextBlock[]): string {
  return blocks
    .map(
      (b) =>
        `[来源 ${b.index}]（${b.sourceType === 'doc' ? '文档库' : '笔记'}）\n标题：${b.title}\n链接：${b.link}\n正文：\n${b.content}`,
    )
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

  const docHits = retrieveDocs(query);
  const noteHits = retrieveNotes(query);
  const blocks = buildContextBlocks(docHits, noteHits);

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
  const validLinks = new Set(blocks.map((b) => b.link));
  const fallback: RagSource[] = blocks.map((b) => ({
    sourceType: b.sourceType,
    title: b.title,
    link: b.link,
  }));

  let sources: RagSource[] = fallback;
  if (Array.isArray(data.sources)) {
    const cited = data.sources
      .filter((s) => s && validLinks.has(s.link || ''))
      .map((s) => ({
        sourceType: (s.sourceType === 'note' ? 'note' : 'doc') as 'doc' | 'note',
        title: String(s.title || ''),
        link: String(s.link || ''),
      }));
    if (cited.length) sources = cited;
  }

  return { kind: 'ok', data: { answer, sources } };
}
