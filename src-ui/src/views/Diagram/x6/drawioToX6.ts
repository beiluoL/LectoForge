// drawioToX6：解析 draw.io mxGraphModel XML → X6 多页（P2-T4.2）。
//
// 纯函数，依赖浏览器 DOMParser（运行时浏览器环境，合规）。
// 设计约束：
// - draw.io 的【图层】（parent="0"、无 vertex/edge）映射为我们的一个 page；
// - 节点 style → 我们的 shape（ellipse/rhombus/几个 mxgraph.flowchart.* / cloud / text），
//   否则圆角矩形（rect）；fill/stroke/fontColor 提取；
// - 连线：source/target → 端点；edgeStyle/curved → lineType；endArrow → arrow；
//   dashed → 虚线；points(Array) → vertices（航点）；
// - 找不到端点的 orphan 边、无对应形状降级为矩形的节点，分别收集 warning 提示用户。
import { buildEdgeMetadata } from './edgeFactory'
import { SHAPE_BY_TYPE } from '../shapeDefs'
import type { DiagramPageData } from './usePages'

function decodeXml(s: string): string {
  const txt = document.createElement('textarea')
  txt.innerHTML = s
  return txt.value
}

function styleMap(style: string): Map<string, string> {
  const m = new Map<string, string>()
  style.split(';').forEach((part) => {
    const i = part.indexOf('=')
    if (i > 0) m.set(part.slice(0, i).trim(), part.slice(i + 1).trim())
  })
  return m
}

/** draw.io style 片段 → 我们的 shape type（未知→rect） */
function vertexType(style: string, sm: Map<string, string>): string {
  if (style.split(';').map((s) => s.trim()).includes('text')) return 'text'
  const table: [string, string][] = [
    ['ellipse', 'ellipse'],
    ['rhombus', 'diamond'],
    ['shape=mxgraph.flowchart.hexagon', 'hexagon'],
    ['shape=mxgraph.flowchart.terminator', 'terminal'],
    ['shape=mxgraph.flowchart.cylinder', 'database'],
    ['shape=mxgraph.flowchart.parallelogram', 'parallelogram'],
    ['shape=mxgraph.flowchart.document', 'document'],
    ['shape=mxgraph.flowchart.predefinedProcess', 'predefined'],
    ['shape=mxgraph.flowchart.actor', 'actor'],
    ['shape=mxgraph.basic.cloud', 'cloud'],
    ['shape=mxgraph.flowchart.display', 'note'],
  ]
  for (const [key, type] of table) {
    if (style.includes(key)) return type
  }
  if (sm.get('rounded') === '1') return 'rounded'
  return 'rect'
}

function mapArrow(name: string): 'block' | 'classic' | 'diamond' | 'circle' | 'async' | 'none' {
  switch (name) {
    case 'none':
      return 'none'
    case 'oval':
      return 'circle'
    case 'classic':
      return 'classic'
    case 'diamond':
      return 'diamond'
    case 'async':
      return 'async'
    default:
      return 'block'
  }
}

function parseVertex(c: Element): { cell: any; degraded: boolean } | null {
  const id = c.getAttribute('id')
  if (!id) return null
  const style = c.getAttribute('style') || ''
  const sm = styleMap(style)
  const type = vertexType(style, sm)
  const value = decodeXml(c.getAttribute('value') || '')
  const fillRaw = sm.get('fillColor') || '#FFFFFF'
  const fill = fillRaw === 'none' ? 'transparent' : fillRaw
  const stroke = sm.get('strokeColor') || '#475569'
  const textColor = sm.get('fontColor') || '#0F172A'
  const geo = c.getElementsByTagName('mxGeometry')[0]
  const x = geo ? Number(geo.getAttribute('x') || 0) : 0
  const y = geo ? Number(geo.getAttribute('y') || 0) : 0
  const w = geo ? Number(geo.getAttribute('width') || 120) : 120
  const h = geo ? Number(geo.getAttribute('height') || 60) : 60

  const def = SHAPE_BY_TYPE[type]
  const degraded = !def && type !== 'text'

  if (type === 'text') {
    return {
      degraded: false,
      cell: {
        id,
        shape: 'diagram-text',
        x,
        y,
        width: w,
        height: h,
        attrs: {
          body: { fill: 'transparent', stroke: 'transparent' },
          label: { text: value, fill: textColor },
        },
        data: { label: value },
      },
    }
  }

  return {
    degraded,
    cell: {
      id,
      shape: `diagram-${type}`,
      x,
      y,
      width: w,
      height: h,
      attrs: {
        body: { fill, stroke },
        label: { text: value, fill: textColor },
      },
      data: { label: value, fill, stroke, textColor, width: w, height: h },
    },
  }
}

function parseEdge(c: Element, byId: Map<string, Element>): { cell: any; skipped: boolean } | null {
  const id = c.getAttribute('id')
  const source = c.getAttribute('source')
  const target = c.getAttribute('target')
  if (!id || !source || !target) return { cell: null, skipped: true }
  // 端点必须存在且是节点（防止指向已删除/图层单元）
  const sEl = byId.get(source)
  const tEl = byId.get(target)
  if (!sEl || !tEl || sEl.getAttribute('vertex') !== '1' || tEl.getAttribute('vertex') !== '1') {
    return { cell: null, skipped: true }
  }
  const sm = styleMap(c.getAttribute('style') || '')
  const value = decodeXml(c.getAttribute('value') || '')
  const color = sm.get('strokeColor') || '#475569'
  const lineWidth = Number(sm.get('strokeWidth') || '1.6')
  const dashed = sm.get('dashed') === '1'
  const arrow = mapArrow(sm.get('endArrow') || 'block')
  const lineType: 'smoothstep' | 'bezier' | 'straight' =
    sm.get('curved') === '1' ? 'bezier' : sm.get('edgeStyle') === 'orthogonalEdgeStyle' ? 'smoothstep' : 'straight'

  const meta: any = buildEdgeMetadata({
    source,
    target,
    label: value || undefined,
    data: { lineType, color, lineWidth, dashed, arrow: arrow !== 'none' },
  })
  // 还原航点
  const arr = c.getElementsByTagName('Array')[0]
  if (arr) {
    const pts = Array.from(arr.getElementsByTagName('mxPoint')).map((p) => ({
      x: Number(p.getAttribute('x')),
      y: Number(p.getAttribute('y')),
    }))
    if (pts.length) meta.vertices = pts
  }
  return { cell: meta, skipped: false }
}

export interface DrawioImportResult {
  pages: DiagramPageData[]
  warnings: string[]
}

/** 解析 draw.io XML 文本 → X6 多页（layer→page）+ 警告列表 */
export function parseDrawioXml(xml: string): DrawioImportResult {
  const warnings: string[] = []
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) {
    warnings.push('XML 解析失败：文件可能不是有效的 draw.io 格式')
    return { pages: [], warnings }
  }
  const cells = Array.from(doc.getElementsByTagName('mxCell')) as Element[]
  const byId = new Map<string, Element>()
  cells.forEach((c) => {
    const id = c.getAttribute('id')
    if (id) byId.set(id, c)
  })

  // 识别图层（parent="0"、非顶点/边、非 0/1）
  const layers: { id: string; name: string }[] = []
  cells.forEach((c) => {
    const id = c.getAttribute('id') || ''
    if (id === '0' || id === '1') return
    const parent = c.getAttribute('parent')
    const isVertex = c.getAttribute('vertex') === '1'
    const isEdge = c.getAttribute('edge') === '1'
    if (parent === '0' && !isVertex && !isEdge) {
      layers.push({ id, name: c.getAttribute('value') || '页面' })
    }
  })
  if (!layers.find((l) => l.id === '1')) layers.unshift({ id: '1', name: '页面 1' })

  const pages: DiagramPageData[] = layers.map((layer, idx) => {
    const pageCells: any[] = []
    let degraded = 0
    let skippedEdges = 0
    cells.forEach((c) => {
      const id = c.getAttribute('id') || ''
      if (id === '0' || id === '1') return
      if (c.getAttribute('parent') !== layer.id) return
      if (c.getAttribute('vertex') === '1') {
        const r = parseVertex(c)
        if (r) {
          pageCells.push(r.cell)
          if (r.degraded) degraded++
        }
      } else if (c.getAttribute('edge') === '1') {
        const r = parseEdge(c, byId)
        if (r) {
          if (r.cell) pageCells.push(r.cell)
          if (r.skipped) skippedEdges++
        }
      }
    })
    if (degraded) warnings.push(`「${layer.name}」中有 ${degraded} 个图形无对应，已降级为矩形`)
    if (skippedEdges) warnings.push(`「${layer.name}」中有 ${skippedEdges} 条连线因找不到端点被跳过`)
    return { id: `p${idx + 1}-import`, name: layer.name, data: { cells: pageCells } }
  })

  if (!pages.length) warnings.push('未识别到任何可导入的图形')
  return { pages, warnings }
}
