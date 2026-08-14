// useAiGenerate：AI 自然语言生成对接（P1-T5.3）。
//
// 设计约束（spec §P1-T5.3）：
// - 后端 /api/ai/diagram/generate 返回「图结构」{ nodes: AiDiagramNode[], edges: AiDiagramEdge[], mock }，
//   type 取 shapeDefs 已知形状集合；前端负责把结构转成标准 X6 cells + dagre 自动布局；
// - 写 type guard isValidAiGraph 做响应合法性校验，防 LLM 幻觉字段让 addCells 抛错；
//   不合法时返回 false，调用方 toast 提示并重试 1 次（由弹窗层负责）。
import { SHAPE_BY_TYPE } from '../shapeDefs'
import { buildEdgeMetadata } from './edgeFactory'
import { autoLayout } from './useAutoLayout'
import type { AiDiagramEdge, AiDiagramGenResponse, AiDiagramNode } from '@/api/diagram'

const KNOWN_TYPES = new Set(Object.keys(SHAPE_BY_TYPE))

/** 响应合法性校验（防幻觉字段）。LLM 常漏 id / 给错类型 / edges 引用不存在的节点。 */
export function isValidAiGraph(v: unknown): v is AiDiagramGenResponse {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) return false
  if (!o.nodes.length) return false
  const nodesOk = o.nodes.every(
    (n) => n && typeof n === 'object' && typeof (n as any).id === 'string' && (n as any).id.trim() && typeof (n as any).label === 'string' && (n as any).label.trim(),
  )
  if (!nodesOk) return false
  const idset = new Set((o.nodes as AiDiagramNode[]).map((n) => n.id))
  const edgesOk = o.edges.every(
    (e) =>
      e &&
      typeof e === 'object' &&
      typeof (e as any).from === 'string' &&
      typeof (e as any).to === 'string' &&
      idset.has((e as any).from) &&
      idset.has((e as any).to) &&
      (e as any).from !== (e as any).to,
  )
  return edgesOk
}

/** 图结构 → 标准 X6 cells（无坐标，坐标交给 autoLayout） */
export function aiGraphToX6Cells(res: AiDiagramGenResponse): any[] {
  const cells: any[] = []
  const idMap: Record<string, string> = {}

  res.nodes.forEach((n, i) => {
    const type = n.type && KNOWN_TYPES.has(n.type) ? n.type : 'process'
    const def = SHAPE_BY_TYPE[type] || SHAPE_BY_TYPE.process
    const id = `ai-${n.id}-${i}`
    idMap[n.id] = id
    const width = def.defaultWidth
    const height = def.defaultHeight
    cells.push({
      id,
      shape: `diagram-${type}`,
      x: 0,
      y: 0,
      width,
      height,
      attrs: {
        body: { fill: '#FFFFFF', stroke: '#475569' },
        label: { text: n.label },
      },
      data: {
        label: n.label,
        fill: '#FFFFFF',
        stroke: '#475569',
        textColor: '#0F172A',
        width,
        height,
      },
    })
  })

  res.edges.forEach((e: AiDiagramEdge) => {
    const s = idMap[e.from]
    const t = idMap[e.to]
    if (!s || !t) return
    cells.push(
      buildEdgeMetadata({
        source: s,
        target: t,
        label: e.label || undefined,
        data: { lineType: 'smoothstep', color: '#475569', lineWidth: 1.6, dashed: false, arrow: true },
      }),
    )
  })

  return cells
}

/** 把 AI 响应（已通过校验）加入 graph：addCells + 自动布局，合并为 1 步 history */
export function applyAiGraph(graph: { value: any }, res: AiDiagramGenResponse, layout: 'TB' | 'LR' = 'TB') {
  const g = graph.value
  if (!g) return
  const cells = aiGraphToX6Cells(res)
  g.batchUpdate('aiGenerate', () => {
    g.addCells(cells)
    autoLayout(g, layout)
  })
  g.zoomToFit({ padding: 40, maxScale: 1 })
}
