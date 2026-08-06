// 思维导图接口层：与 /api/mindmaps（CRUD）+ /api/ai/generate-mindmap（AI）对接。
// baseURL 已在 request.ts 里固定为 '/api'，这里的路径不再重复前缀。
import { apiDelete, apiGet, apiPost, apiPut } from './request'

/** AI 生成耗时较长，沿用 api/ai.ts 的宽松超时 */
const AI_TIMEOUT = 90000

// ===================== 类型 =====================

/** 大纲节点：极简三字段递归树，前后端共用同一形状 */
export interface OutlineNode {
  id: string
  text: string
  /** 折叠状态随文档一起持久化，下次打开保持原样 */
  collapsed?: boolean
  children: OutlineNode[]
}

/** 流程图数据：vue-flow 的 { nodes, edges } 标准结构 */
export interface FlowchartData {
  nodes: any[]
  edges: any[]
}

export interface MindMapMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  nodeCount: number
}

export interface MindMapDoc {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  outlineData: OutlineNode[]
  flowchartData: FlowchartData
}

export interface AiMindMapResult {
  title: string
  outline: OutlineNode[]
  /** true = 后端未配置 Key，返回的是本地兜底结构 */
  mock: boolean
  model: string
  latencyMs: number
}

// ===================== 接口 =====================

export function listMindMaps() {
  return apiGet<{ items: MindMapMeta[] }>('/mindmaps')
}

export function getMindMap(id: string) {
  return apiGet<MindMapDoc>(`/mindmaps/${encodeURIComponent(id)}`)
}

export function createMindMap(payload: {
  title?: string
  outlineData?: OutlineNode[]
  flowchartData?: FlowchartData
}) {
  return apiPost<MindMapDoc>('/mindmaps', payload)
}

/** 局部保存：只传需要更新的字段，未传的字段服务端保持原值 */
export function saveMindMap(
  id: string,
  payload: { title?: string; outlineData?: OutlineNode[]; flowchartData?: FlowchartData },
) {
  return apiPut<{ id: string; title: string; updatedAt: number }>(
    `/mindmaps/${encodeURIComponent(id)}`,
    payload,
  )
}

export function deleteMindMap(id: string) {
  return apiDelete<{ id: string }>(`/mindmaps/${encodeURIComponent(id)}`)
}

/** AI 生成大纲；后端未配置 Key 时返回 mock=true 的兜底结构，不会抛错 */
export function generateMindMapByAi(payload: { topic: string; depth?: number; branches?: number }) {
  return apiPost<AiMindMapResult>('/ai/generate-mindmap', payload, { timeout: AI_TIMEOUT })
}
