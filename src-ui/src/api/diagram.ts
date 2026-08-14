// 绘图工具 / 流程图 API 客户端：对接后端 /api/diagram/*。
// 字段名与后端 DTO 完全一致，前端 store 不再做映射。
import { apiDelete, apiGet, apiPost, apiPut } from './request';

/** 画布节点（业务 + 视觉数据统一在 data 下） */
export interface DiagramNode {
  id: string;
  type?: string | null;
  position: { x: number; y: number };
  data?: {
    label?: string;
    fill?: string;
    stroke?: string;
    textColor?: string;
    width?: number;
    height?: number;
    [k: string]: unknown;
  };
}

/** 画布连线（视觉样式在 data 下，避免落库丢失） */
export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string | null;
  label?: string | null;
  data?: {
    lineWidth?: number;
    dashed?: boolean;
    arrow?: boolean;
    color?: string;
    [k: string]: unknown;
  };
}

/** 多页画布中的单页 */
export interface DiagramPage {
  id: string;
  name: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  viewport: { x: number; y: number; zoom: number };
  createdAt: string;
  updatedAt: string;
}

/** 整图快照：多页结构（currentPageId + pages）。旧单页 {nodes,edges,viewport} 由 store 兼容。 */
export interface DiagramData {
  currentPageId: string;
  pages: DiagramPage[];
}

/** 列表项（不随列表返回完整 data，只回节点数） */
export interface DiagramSummary {
  id: number;
  name: string;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 详情（data 已解析为对象） */
export interface DiagramDetail {
  id: number;
  userId: number;
  name: string;
  data: DiagramData;
  createdAt: string;
  updatedAt: string;
}

/** 拉取图文件列表 */
export function fetchDiagrams(): Promise<DiagramSummary[]> {
  return apiGet<DiagramSummary[]>('/diagram');
}

/** 拉取单个图文件详情 */
export function fetchDiagram(id: number): Promise<DiagramDetail> {
  return apiGet<DiagramDetail>(`/diagram/${id}`);
}

/** 新建空白图文件 */
export function createDiagram(name?: string): Promise<DiagramDetail> {
  return apiPost<DiagramDetail>('/diagram', name && name.trim() ? { name } : {});
}

/** 保存（防抖自动保存 / 手动保存）。name 与 data 都可单独传 */
export function updateDiagram(
  id: number,
  data: { name?: string; data?: DiagramData },
): Promise<DiagramDetail> {
  return apiPut<DiagramDetail>(`/diagram/${id}`, data);
}

/** 删除图文件 */
export function deleteDiagram(id: number): Promise<{ ok: true }> {
  return apiDelete(`/diagram/${id}`);
}
