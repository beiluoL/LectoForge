/* 绘图工具 / 流程图 版本历史业务层
 *
 * 职责边界（与项目三层架构一致）：
 * - routes/diagramHistory.ts            只声明 HTTP 契约（路径 + 方法）；
 * - controllers/diagramHistoryController.ts  只做 HTTP 层（参数收口 + 错误 → 状态码）；
 * - 本文件是唯一承载业务逻辑的地方（SQL、JSON 序列化、裁剪策略）。
 *
 * 核心语义：
 * - 每条历史 = 某图文件某个时间点的整图（多页）JSON 副本；
 * - 记录（recordHistory）写入后即时裁剪到每个 diagram 最近 100 条，超出删最旧；
 * - 恢复（restoreHistory）把历史 JSON 写回 wb_diagram.data，覆盖前先存一条
 *   「恢复前自动备份」安全快照，保证原状态永远可回退（即「不污染原文档」）；
 * - 下载（getHistory）直接回快照对象，前端据此落盘为 .json。
 *
 * 全同步：better-sqlite3 是同步 API，本文件不得出现 async/await（与 diagramService 一致）。
 */
import { asc, desc, eq, inArray } from 'drizzle-orm';

import { db, nowIso } from '../db';
import { wbDiagram, wbDiagramHistory } from '../db/schema';
import { getDiagram, sanitizeData } from './diagramService';
import type { DiagramData, DiagramDetail, DiagramHistorySummary } from '../types/diagram';

/** 每个图文件保留的历史条数上限（超出删最旧） */
const MAX_HISTORY_PER_DIAGRAM = 100;

/** 解析快照 JSON → 多页结构；损坏一律回退空白多页，绝不抛错 */
function parseSnapshot(raw: string | null | undefined): DiagramData {
  if (!raw) return { currentPageId: 'p1', pages: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.pages)) return parsed as DiagramData;
    return { currentPageId: 'p1', pages: [] };
  } catch {
    return { currentPageId: 'p1', pages: [] };
  }
}

/** 统计某快照的节点总数（跨所有页） */
function countNodes(snapshotJson: string): number {
  const parsed = parseSnapshot(snapshotJson);
  return parsed.pages.reduce((sum, p) => sum + (Array.isArray(p.nodes) ? p.nodes.length : 0), 0);
}

/** 图文件是否存在（逻辑外键校验，不存在抛「图表不存在」→ 控制器翻 404） */
function assertDiagram(id: number): void {
  const row = db.select({ id: wbDiagram.id }).from(wbDiagram).where(eq(wbDiagram.id, id)).get();
  if (!row) throw new Error('图表不存在');
}

/**
 * 写入一条历史快照，并裁剪到最近 100 条。
 * @param snapshot 完整多页结构（经 sanitizeData 清洗后落库）
 * @param actionLabel 动作标签，可空
 * @returns 新建历史行的 id
 */
export function recordHistory(id: number, snapshot: unknown, actionLabel?: string | null): number {
  assertDiagram(id);
  const clean = sanitizeData(snapshot);
  const res = db
    .insert(wbDiagramHistory)
    .values({
      diagramId: id,
      snapshotJson: JSON.stringify(clean),
      actionLabel: actionLabel && String(actionLabel).trim() ? String(actionLabel).trim() : null,
      createdAt: nowIso(),
    })
    .run();
  const newId = Number(res.lastInsertRowid);

  // 裁剪：超出上限删最旧的几条（created_at ASC 取前 N-100 个）
  const all = db
    .select({ id: wbDiagramHistory.id })
    .from(wbDiagramHistory)
    .where(eq(wbDiagramHistory.diagramId, id))
    .orderBy(asc(wbDiagramHistory.createdAt))
    .all();
  if (all.length > MAX_HISTORY_PER_DIAGRAM) {
    const overflow = all.slice(0, all.length - MAX_HISTORY_PER_DIAGRAM).map((r) => r.id);
    db.delete(wbDiagramHistory).where(inArray(wbDiagramHistory.id, overflow)).run();
  }
  return newId;
}

/** GET /api/diagram/:id/history —— 某图文件的最近历史列表（倒序） */
export function listHistory(id: number): DiagramHistorySummary[] {
  assertDiagram(id);
  const rows = db
    .select()
    .from(wbDiagramHistory)
    .where(eq(wbDiagramHistory.diagramId, id))
    .orderBy(desc(wbDiagramHistory.createdAt))
    .all();
  return rows.map((r) => ({
    id: r.id,
    actionLabel: r.actionLabel,
    createdAt: r.createdAt,
    nodeCount: countNodes(r.snapshotJson),
  }));
}

/** 取单条历史快照对象（供下载 / 预览），不属于该图文件则抛错 */
export function getHistory(id: number, historyId: number): DiagramData {
  const hist = db
    .select()
    .from(wbDiagramHistory)
    .where(eq(wbDiagramHistory.id, historyId))
    .get();
  if (!hist) throw new Error('历史版本不存在');
  if (hist.diagramId !== id) throw new Error('历史版本不属于该图表');
  return parseSnapshot(hist.snapshotJson);
}

/**
 * POST /api/diagram/:id/history/restore/:historyId —— 恢复到此版本。
 * 覆盖前先存一条「恢复前自动备份」安全快照，保证原状态可回退（不污染原文档语义）。
 * 返回恢复后的图文件详情（data 已解析为对象）。
 */
export function restoreHistory(id: number, historyId: number): DiagramDetail {
  assertDiagram(id);
  const hist = db
    .select()
    .from(wbDiagramHistory)
    .where(eq(wbDiagramHistory.id, historyId))
    .get();
  if (!hist) throw new Error('历史版本不存在');
  if (hist.diagramId !== id) throw new Error('历史版本不属于该图表');

  // 1) 安全快照：覆盖前把当前态写进历史，确保可回退
  const current = db.select({ data: wbDiagram.data }).from(wbDiagram).where(eq(wbDiagram.id, id)).get();
  if (current) {
    try {
      const currentSnapshot = parseSnapshot(current.data);
      db.insert(wbDiagramHistory)
        .values({
          diagramId: id,
          snapshotJson: JSON.stringify(currentSnapshot),
          actionLabel: '恢复前自动备份',
          createdAt: nowIso(),
        })
        .run();
    } catch {
      /* 当前态损坏也不阻断恢复：最坏情况丢失一次回退点 */
    }
  }

  // 2) 覆盖：把历史快照写回 wb_diagram.data（snapshot_json 本身已是清洗过的多页结构）
  db.update(wbDiagram).set({ data: hist.snapshotJson, updatedAt: nowIso() }).where(eq(wbDiagram.id, id)).run();

  // 3) 裁剪（安全快照可能把总量推过上限）
  const all = db
    .select({ id: wbDiagramHistory.id })
    .from(wbDiagramHistory)
    .where(eq(wbDiagramHistory.diagramId, id))
    .orderBy(asc(wbDiagramHistory.createdAt))
    .all();
  if (all.length > MAX_HISTORY_PER_DIAGRAM) {
    const overflow = all.slice(0, all.length - MAX_HISTORY_PER_DIAGRAM).map((r) => r.id);
    db.delete(wbDiagramHistory).where(inArray(wbDiagramHistory.id, overflow)).run();
  }

  return getDiagram(id);
}
