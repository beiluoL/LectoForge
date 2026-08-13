/**
 * 本地向量索引与语义关联服务。
 *
 * 向量落库到 wb_embedding（本地 SQLite），相似度在应用层用 JS 计算——
 * better-sqlite3 无原生 vector 类型，且本地数据量级（千条内）完全够用。
 * 绝不触碰任何业务表。
 */
import fs from 'node:fs';
import path from 'node:path';

import { and, eq } from 'drizzle-orm';

import { db } from '../db';
import { wbCapture, wbEmbedding, wbNote, wbStory } from '../db/schema';
import { embed, embeddingsReady, readEmbeddingConfig, stripHtml } from '../lib/llm';
import { requireRootDir, safeResolve, toRelId } from '../lib/vault';
import type { AiResult, AssociateDTO, AssociateVO, EmbeddingsSyncDTO, EmbeddingsSyncVO } from '../types/ai';

/** 向量化服务未配置时的统一出口，由前端据 aiCode 引导去设置页 */
function notConfigured(): AiResult<never> {
  return {
    kind: 'fail',
    status: 409,
    message: '尚未配置向量化服务，请在「AI 设置」中填写 Embeddings 地址、Key 与模型',
    aiCode: 'AI_NOT_CONFIGURED',
  };
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

/** 计算待向量化文本（取标题+正文，纯文本化并截断） */
function embeddingText(entity: { title?: string | null; content?: string | null; noteColumn?: string | null }): string {
  const parts = [entity.title || '', entity.content || entity.noteColumn || ''];
  return stripHtml(parts.join('\n')).slice(0, 6000).trim();
}

/** 轻量内容指纹：用于判断是否需要重算（避免每次同步都重复调用向量服务） */
function contentHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

/** 按实体类型+id 读取实体（供关联结果回填标题/摘要）。
 * id 可能为数字(capture/note/story)或字符串文档相对路径(doc)。 */
function loadEntity(
  type: string,
  id: number | string,
): { title?: string | null; content?: string | null; noteColumn?: string | null } | null {
  if (type === 'capture') return db.select().from(wbCapture).where(eq(wbCapture.id, Number(id))).get() as any;
  if (type === 'note') return db.select().from(wbNote).where(eq(wbNote.id, Number(id))).get() as any;
  if (type === 'story') return db.select().from(wbStory).where(eq(wbStory.id, Number(id))).get() as any;
  if (type === 'doc') {
    try {
      const abs = safeResolve(String(id));
      const raw = fs.readFileSync(abs, 'utf8');
      return { title: path.basename(abs, path.extname(abs)), content: raw, noteColumn: raw };
    } catch {
      return null;
    }
  }
  return null;
}

/** 从待向量化文本截取展示摘要 */
function snippetOf(text: string): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

/** 关联结果的可点击前端路由 */
function entityRoute(type: string, id: number | string): string {
  if (type === 'capture') return '/inbox';
  if (type === 'note') return `/workbench/notes/${id}`;
  if (type === 'story') return `/workbench/story/${id}`;
  if (type === 'doc') return `/library?doc=${encodeURIComponent(String(id))}`;
  return '/workbench';
}

/** 文档库扫描限制：与 aiRagService 保持一致 */
const MAX_DOC_FILES = 4000;
const DOC_READ_CAP = 1024 * 1024;
const DOC_SKIP_DIRS = new Set([
  '.git', '.svn', '.hg', 'node_modules', '.obsidian', '.trash',
  '.DS_Store', '__pycache__', '.idea', '.vscode',
]);

/** 把文档库中的 .md 文件也纳入向量索引，供 RAG 语义检索使用。 */
function collectDocsForEmbed(): Array<{ type: 'doc'; id: string; text: string; hash: string }> {
  let root: string;
  try {
    root = requireRootDir();
  } catch {
    return [];
  }

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
      if (e.name.startsWith('.') || DOC_SKIP_DIRS.has(e.name)) continue;
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

  return files
    .map((abs) => {
      try {
        const st = fs.statSync(abs);
        if (st.size > DOC_READ_CAP) return null;
        const raw = fs.readFileSync(abs, 'utf8');
        const relId = toRelId(abs);
        const text = embeddingText({ title: path.basename(abs, path.extname(abs)), content: raw });
        return { type: 'doc' as const, id: relId, text, hash: contentHash(text) };
      } catch {
        return null;
      }
    })
    .filter((x): x is { type: 'doc'; id: string; text: string; hash: string } => !!x && x.text.length > 0);
}

// ===================== P3-G3：向量索引重建 =====================

/**
 * 重建/补齐本地向量索引：扫描 captures/notes/stories，对缺失或变更的内容调用 embeddings 服务。
 * force=true 时忽略内容指纹全量重算。
 */
export async function syncEmbeddings(b: EmbeddingsSyncDTO): Promise<AiResult<EmbeddingsSyncVO>> {
  const cfg = readEmbeddingConfig();
  if (!embeddingsReady()) return notConfigured();

  const model = cfg.model;
  const now = new Date().toISOString();
  const collect = (rows: any[], type: string) =>
    rows
      .map((r) => ({ type, id: r.id, text: embeddingText(r), hash: contentHash(embeddingText(r)) }))
      .filter((x) => x.text.length > 0);

  const items = [
    ...collect(db.select().from(wbCapture).all() as any[], 'capture'),
    ...collect(db.select().from(wbNote).all() as any[], 'note'),
    ...collect(db.select().from(wbStory).all() as any[], 'story'),
    // 文档库(.md)同样纳入向量索引，供 RAG 语义检索命中具体文档
    ...collectDocsForEmbed(),
  ];

  // 已有索引（按 实体+模型）用于跳过未变更项
  const existing = db
    .select({ entityType: wbEmbedding.entityType, entityId: wbEmbedding.entityId, contentHash: wbEmbedding.contentHash })
    .from(wbEmbedding)
    .where(eq(wbEmbedding.model, model))
    .all() as { entityType: string; entityId: string; contentHash: string | null }[];
  const existingMap = new Map(existing.map((e) => [`${e.entityType}:${e.entityId}`, e.contentHash]));

  const todo = items.filter((it) => b.force || existingMap.get(`${it.type}:${it.id}`) !== it.hash);
  let synced = 0;
  const BATCH = 16;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const vectors = await embed(chunk.map((c) => c.text), { config: cfg });
    const rows = chunk.map((c, idx) => ({
      entityType: c.type,
      entityId: String(c.id),
      model,
      dim: vectors[idx].length,
      vector: JSON.stringify(vectors[idx]),
      contentHash: c.hash,
      createdAt: now,
      updatedAt: now,
    }));
    for (const row of rows) {
      db.insert(wbEmbedding)
        .values(row)
        .onConflictDoUpdate({
          target: [wbEmbedding.entityType, wbEmbedding.entityId, wbEmbedding.model],
          set: { dim: row.dim, vector: row.vector, contentHash: row.contentHash, updatedAt: now },
        })
        .run();
      synced += 1;
    }
  }
  return { kind: 'ok', data: { synced, skipped: items.length - synced, total: items.length, model, latencyMs: 0 } };
}

// ===================== P3-G3：语义关联 =====================

/**
 * 给定实体或自由文本，返回最相似的其它内容。
 * 源向量即时计算并落库（若缺失），相似度在本地 JS 计算。
 */
export async function associate(b: AssociateDTO): Promise<AiResult<AssociateVO>> {
  const limit = Math.max(1, Math.min(20, Number(b.limit) || 6));
  const cfg = readEmbeddingConfig();
  if (!embeddingsReady()) return notConfigured();

  let sourceText = (b.text || '').trim();
  let sourceRef: { type: string; id: number } | null = null;
  if (!sourceText && b.entityType && b.entityId) {
    sourceRef = { type: b.entityType, id: Number(b.entityId) };
    const row = loadEntity(b.entityType, Number(b.entityId));
    if (!row) return { kind: 'fail', status: 404, message: '关联源不存在', aiCode: 'AI_BAD_INPUT' };
    sourceText = embeddingText(row);
  }
  if (!sourceText) {
    return { kind: 'fail', status: 400, message: '请提供 entityType+entityId 或 text', aiCode: 'AI_BAD_INPUT' };
  }

  // 确保源向量已落库（缺失则计算并存入）
  if (sourceRef) {
    const have = db
      .select({ id: wbEmbedding.id })
      .from(wbEmbedding)
      .where(
        and(
          eq(wbEmbedding.entityType, sourceRef.type),
          eq(wbEmbedding.entityId, String(sourceRef.id)),
          eq(wbEmbedding.model, cfg.model),
        ),
      )
      .get();
    if (!have) {
      const [vec] = await embed([sourceText], { config: cfg });
      const now = new Date().toISOString();
      db.insert(wbEmbedding)
        .values({
          entityType: sourceRef.type,
          entityId: String(sourceRef.id),
          model: cfg.model,
          dim: vec.length,
          vector: JSON.stringify(vec),
          contentHash: contentHash(sourceText),
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }
  const [sourceVec] = await embed([sourceText], { config: cfg });
  /**
   * 拉取全部已索引向量，计算余弦相似度。
   *
   * 只 select 打分真正需要的四列：向量本体动辄上千维 JSON，
   * `select()` 全列会把 contentHash / createdAt / updatedAt 一并读进内存，纯属浪费。
   *
   * ⚠️ 这里**不能**再写 `as any[]`：历史上正是这个断言遮蔽了下方的字段名错误
   * （读 `e.entity_type`，而 Drizzle 返回的是驼峰 `entityType`），
   * 导致 /associate 的 entityType 恒为 undefined、title 恒为「(已删除)」，
   * 且编译期毫无提示。保持强类型，让同类错误在 tsc 阶段就暴露。
   */
  const all = db
    .select({
      entityType: wbEmbedding.entityType,
      entityId: wbEmbedding.entityId,
      model: wbEmbedding.model,
      vector: wbEmbedding.vector,
    })
    .from(wbEmbedding)
    .all();
  const scored = all
    .map((e) => {
      let vec: number[];
      try {
        vec = JSON.parse(e.vector);
      } catch {
        return null;
      }
      // 维度不一致（用户中途换过 embedding 模型）时 cosineSimilarity 返回 0，
      // 会被下方 score > 0 过滤掉，不会污染结果。
      const score = cosineSimilarity(sourceVec, vec);
      return { type: e.entityType, id: e.entityId, score, model: e.model };
    })
    .filter((x): x is { type: string; id: string; score: number; model: string } => !!x && x.score > 0)
    .filter((x) => !(sourceRef && x.type === sourceRef.type && x.id === String(sourceRef.id)))
    .sort((a, b2) => b2.score - a.score)
    .slice(0, limit);

  const items = scored.map((s) => {
    const row = loadEntity(s.type, s.type === 'doc' ? s.id : Number(s.id));
    const title = row ? row.title || '(无标题)' : '(已删除)';
    const snippet = row ? snippetOf(embeddingText(row)) : '';
    return {
      entityType: s.type,
      entityId: s.id,
      title,
      snippet,
      score: Math.round(s.score * 1000) / 1000,
      route: entityRoute(s.type, s.id),
    };
  });
  return { kind: 'ok', data: { items, model: cfg.model, latencyMs: 0 } };
}
