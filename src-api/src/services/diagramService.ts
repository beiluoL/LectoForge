/* 绘图工具 / 流程图 业务层
 *
 * 职责边界（与项目三层架构一致）：
 * - routes/diagram.ts              只声明 HTTP 契约（路径 + 方法）；
 * - controllers/diagramController.ts  只做 HTTP 层（参数收口 + 错误 → 状态码）；
 * - 本文件是唯一承载业务逻辑的地方（SQL、JSON 序列化、空白图默认）。
 *
 * 数据形态要点：
 * - 整图存进 data 列（JSON 字符串），不拆子表；
 * - 新建返回空白图（nodes/edges 空、zoom=1），前端打开即画；
 * - 解析库里的 data 用 try/catch 兜底——损坏的 JSON 回退空白图，绝不抛错让详情页打不开；
 * - 写入前用 sanitizeData 只留业务字段，剔除 vue-flow 挂上来的运行时状态。
 */
import { desc, eq } from 'drizzle-orm';

import { CURRENT_USER, db, nowIso } from '../db';
import { wbDiagram } from '../db/schema';
import type {
  DiagramCreateInput,
  DiagramData,
  DiagramDetail,
  DiagramEdge,
  DiagramNode,
  DiagramPage,
  DiagramRow,
  DiagramSummary,
  DiagramUpdateInput,
} from '../types/diagram';

const DEFAULT_NAME = '未命名文件';

/** 空白多页（单页）画布，避免多处共享同一引用导致互相污染 */
function blankData(): DiagramData {
  const now = nowIso();
  return {
    currentPageId: 'p1',
    pages: [
      {
        id: 'p1',
        name: '页面 1',
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

/** 清洗单个节点（只留业务白名单字段） */
function sanitizeNodes(input: unknown): DiagramNode[] {
  if (!Array.isArray(input)) return [];
  return input.map((n) => {
    const rawData = n?.data && typeof n.data === 'object' ? (n.data as Record<string, unknown>) : {};
    return {
      id: String(n?.id ?? ''),
      type: n?.type ?? null,
      position: {
        x: Number(n?.position?.x) || 0,
        y: Number(n?.position?.y) || 0,
      },
      data: {
        label: String(rawData.label ?? ''),
        ...(typeof rawData.fill === 'string' ? { fill: rawData.fill } : {}),
        ...(typeof rawData.stroke === 'string' ? { stroke: rawData.stroke } : {}),
        ...(typeof rawData.textColor === 'string' ? { textColor: rawData.textColor } : {}),
        ...(typeof rawData.width === 'number' ? { width: rawData.width } : {}),
        ...(typeof rawData.height === 'number' ? { height: rawData.height } : {}),
        ...(typeof rawData.path === 'string' ? { path: rawData.path } : {}),
        ...(typeof rawData.points === 'string' ? { points: rawData.points } : {}),
        ...(typeof rawData.strokeWidth === 'number' ? { strokeWidth: rawData.strokeWidth } : {}),
        ...(typeof rawData.pathColor === 'string' ? { pathColor: rawData.pathColor } : {}),
      },
    };
  });
}

/** 清洗单条连线（type 归一为 'custom'，真实线型存 data.lineType） */
function sanitizeEdges(input: unknown): DiagramEdge[] {
  if (!Array.isArray(input)) return [];
  return input.map((e) => {
    const rawData = e?.data && typeof e.data === 'object' ? (e.data as Record<string, unknown>) : {};
    return {
      id: String(e?.id ?? ''),
      source: String(e?.source ?? ''),
      target: String(e?.target ?? ''),
      sourceHandle: e?.sourceHandle ?? undefined,
      targetHandle: e?.targetHandle ?? undefined,
      type: e?.type ?? null,
      label: e?.label == null ? null : String(e.label),
      data: {
        ...(typeof rawData.lineWidth === 'number' ? { lineWidth: rawData.lineWidth } : {}),
        ...(typeof rawData.dashed === 'boolean' ? { dashed: rawData.dashed } : {}),
        ...(typeof rawData.arrow === 'boolean' ? { arrow: rawData.arrow } : {}),
        ...(typeof rawData.color === 'string' ? { color: rawData.color } : {}),
        ...(typeof rawData.lineType === 'string' && ['smoothstep', 'bezier', 'straight'].includes(rawData.lineType as string)
          ? { lineType: rawData.lineType }
          : {}),
      },
    };
  });
}

/** 清洗视口 */
function sanitizeViewport(input: unknown): { x: number; y: number; zoom: number } {
  const vp = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    x: Number(vp.x) || 0,
    y: Number(vp.y) || 0,
    zoom: Number(vp.zoom) || 1,
  };
}

/** 清洗单个页面 */
function sanitizePage(input: unknown): DiagramPage {
  const p = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const now = nowIso();
  return {
    id: String(p.id || 'p1'),
    name: String(p.name || '页面 1'),
    nodes: sanitizeNodes(p.nodes),
    edges: sanitizeEdges(p.edges),
    viewport: sanitizeViewport(p.viewport),
    createdAt: String(p.createdAt || now),
    updatedAt: String(p.updatedAt || now),
  };
}

/** 解析库里的 data 字符串 → 多页结构；损坏（非多页）一律回退空白多页（新功能，不做单页迁移） */
function parseData(raw: string | null | undefined): DiagramData {
  if (!raw) return blankData();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.pages) && parsed.pages.length) {
      const pages = parsed.pages.map(sanitizePage);
      const currentPageId =
        typeof parsed.currentPageId === 'string' && pages.some((p: any) => p.id === parsed.currentPageId)
          ? parsed.currentPageId
          : pages[0].id;
      return { currentPageId, pages };
    }
    return blankData();
  } catch {
    return blankData();
  }
}

/**
 * 写入前清洗：只保留业务字段，剔除 vue-flow 可能混进来的运行时字段。
 * 只接受多页结构（{currentPageId, pages}），非多页一律回退空白多页。
 */
export function sanitizeData(input: unknown): DiagramData {
  const src = (input && typeof input === 'object' ? input : {}) as Partial<DiagramData>;

  // 多页结构
  if (Array.isArray(src.pages)) {
    const pages = src.pages.map(sanitizePage);
    if (!pages.length) return blankData();
    const currentPageId =
      typeof src.currentPageId === 'string' && pages.some((p) => p.id === src.currentPageId)
        ? src.currentPageId
        : pages[0].id;
    return { currentPageId, pages };
  }

  return blankData();
}

function toSummary(row: DiagramRow): DiagramSummary {
  let count = 0;
  try {
    const parsed = JSON.parse(row.data || '{}');
    if (Array.isArray(parsed.pages)) {
      count = parsed.pages.reduce((sum: number, p: any) => sum + (Array.isArray(p?.nodes) ? p.nodes.length : 0), 0);
    }
  } catch {
    count = 0;
  }
  return {
    id: row.id,
    name: row.name,
    nodeCount: count,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetail(row: DiagramRow): DiagramDetail {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    data: parseData(row.data),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getById(id: number): DiagramRow | undefined {
  return db.select().from(wbDiagram).where(eq(wbDiagram.id, id)).get() as DiagramRow | undefined;
}

/* ------------------------------------------------------------------ */
/* 读                                                                  */
/* ------------------------------------------------------------------ */

/** GET /api/diagram —— 本用户全部图文件，按最近编辑倒序 */
export function listDiagrams(): DiagramSummary[] {
  const rows = db
    .select()
    .from(wbDiagram)
    .where(eq(wbDiagram.userId, CURRENT_USER))
    .orderBy(desc(wbDiagram.updatedAt))
    .all() as DiagramRow[];
  return rows.map(toSummary);
}

/** GET /api/diagram/:id —— 详情，data 解析为对象 */
export function getDiagram(id: number): DiagramDetail {
  const row = getById(id);
  if (!row) throw new Error('图表不存在');
  return toDetail(row);
}

/* ------------------------------------------------------------------ */
/* 写                                                                  */
/* ------------------------------------------------------------------ */

/** POST /api/diagram —— 新建：返回空白画布，前端打开即是一片空白可直接画 */
export function createDiagram(input: DiagramCreateInput): DiagramDetail {
  const name = input.name && String(input.name).trim() ? String(input.name).trim() : DEFAULT_NAME;
  const now = nowIso();
  const res = db
    .insert(wbDiagram)
    .values({
      userId: CURRENT_USER,
      name,
      data: JSON.stringify(blankData()),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const created = getById(Number(res.lastInsertRowid));
  if (!created) throw new Error('图表创建失败');
  return toDetail(created);
}

/** PUT /api/diagram/:id —— 保存：name 与 data 都可单独传；data 经清洗只留业务字段 */
export function updateDiagram(id: number, input: DiagramUpdateInput): DiagramDetail {
  const existing = getById(id);
  if (!existing) throw new Error('图表不存在');

  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new Error('图表名称不能为空');
    patch.name = name;
  }
  if (input.data !== undefined) {
    patch.data = JSON.stringify(sanitizeData(input.data));
  }

  db.update(wbDiagram).set(patch).where(eq(wbDiagram.id, id)).run();
  const updated = getById(id);
  if (!updated) throw new Error('图表更新失败');
  return toDetail(updated);
}

/** DELETE /api/diagram/:id —— 删除 */
export function deleteDiagram(id: number): { ok: true } {
  const existing = getById(id);
  if (!existing) throw new Error('图表不存在');
  db.delete(wbDiagram).where(eq(wbDiagram.id, id)).run();
  return { ok: true };
}
