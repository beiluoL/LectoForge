// x6ToDrawio：X6 多页 → draw.io mxGraphModel XML（P2-T4.3）。
//
// 纯函数，无 graph / DOM 依赖，便于单测与复用。
// 设计约束：
// - 每个 X6 page 映射为 draw.io 一个【图层】（layer），从而无损保留多页；
//   单页文档落到 draw.io 默认图层（id="1"），多页追加 lf-layer-2/3...；
// - shape 样式映射只取 draw.io 原生支持、app.diagrams.net 必能渲染的子集
//   （rounded / ellipse / rhombus / 几个 mxgraph.flowchart.* stencil / cloud）；
//   其余形状（三角形 / ER 双框 / AWS 徽标 / 路由交换防火墙 / 泳道容器分组 等）
//   降级为圆角矩形并计入 degradedCount，由调用方提示用户；
// - 跳过页面底图（diagram-page）与自由画笔节点（diagram-drawing，矢量 path 无等价）；
// - 连线：正交→orthogonalEdgeStyle、曲线→curved=1、直线→none；箭头/虚线/线宽/颜色映射。
import { SHAPE_BY_TYPE } from '../shapeDefs'
import type { DiagramPageData } from './usePages'

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** render 种类 → draw.io 原生 style 片段（无等价则缺省） */
const RENDER_STYLE: Record<string, string> = {
  rect: 'rounded=0',
  rounded: 'rounded=1;arcSize=20',
  stadium: 'shape=mxgraph.flowchart.terminator',
  ellipse: 'ellipse',
  diamond: 'rhombus',
  hexagon: 'shape=mxgraph.flowchart.hexagon',
  cylinder: 'shape=mxgraph.flowchart.cylinder',
  parallelogram: 'shape=mxgraph.flowchart.parallelogram',
  document: 'shape=mxgraph.flowchart.document',
  note: 'shape=mxgraph.flowchart.display',
  predefined: 'shape=mxgraph.flowchart.predefinedProcess',
  actor: 'shape=mxgraph.flowchart.actor',
  cloud: 'shape=mxgraph.basic.cloud',
}

function drawioStyleForCell(cell: any): { style: string; skipped: boolean; degraded: boolean } {
  const shape: string = String(cell.shape || '')
  if (shape === 'diagram-page') return { style: '', skipped: true, degraded: false }
  if (shape === 'diagram-drawing') return { style: '', skipped: true, degraded: true }
  if (shape === 'diagram-text') {
    return { style: 'text;html=1;fillColor=none;strokeColor=none', skipped: false, degraded: false }
  }
  const type = shape.replace('diagram-', '')
  const def = SHAPE_BY_TYPE[type]
  const render = def?.render || 'rect'
  const r = RENDER_STYLE[render]
  if (r) return { style: r, skipped: false, degraded: false }
  return { style: 'rounded=0', skipped: false, degraded: true }
}

function firstEdgeLabel(cell: any): string {
  const l = cell.labels?.[0]?.attrs?.label?.text
  if (l) return String(l)
  if (cell.data?.label) return String(cell.data.label)
  return ''
}

function nodeCellXml(cell: any, layerId: string): { xml: string; degraded: boolean } {
  const w = Math.round(cell.width || 120)
  const h = Math.round(cell.height || 60)
  const x = Math.round(cell.x || 0)
  const y = Math.round(cell.y || 0)

  // 图片节点：draw.io image 形状内联 base64（P2-T5.1）
  if (String(cell.shape || '') === 'diagram-image') {
    const dataUrl = cell.data?.imageUrl || ''
    const raw = dataUrl.includes('base64,') ? dataUrl.split('base64,')[1] : dataUrl
    const extra: string[] = []
    if (cell.data?.href) extra.push(`lfHref=${encodeURIComponent(cell.data.href)}`)
    if (cell.data?.tooltip) extra.push(`lfTooltip=${encodeURIComponent(cell.data.tooltip)}`)
    const styleStr = ['image', `imageData=${raw}`, 'html=1', ...extra].join(';') + ';'
    const xml =
      `<mxCell id="${esc(cell.id)}" value="" style="${esc(styleStr)}" vertex="1" parent="${layerId}">` +
      `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`
    return { xml, degraded: false }
  }

  const { style, degraded } = drawioStyleForCell(cell)
  const body = cell.attrs?.body || {}
  const label = cell.attrs?.label || {}
  const fill = body.fill && body.fill !== 'transparent' ? String(body.fill) : 'none'
  const stroke = body.stroke && body.stroke !== 'transparent' ? String(body.stroke) : '#475569'
  const fontColor = label.fill ? String(label.fill) : '#0F172A'
  const text = String(label.text || cell.data?.label || '')
  const extra: string[] = []
  if (cell.data?.href) extra.push(`lfHref=${encodeURIComponent(cell.data.href)}`)
  if (cell.data?.tooltip) extra.push(`lfTooltip=${encodeURIComponent(cell.data.tooltip)}`)
  const styleStr = [
    style,
    'whiteSpace=wrap',
    'html=1',
    `fillColor=${fill}`,
    `strokeColor=${stroke}`,
    `fontColor=${fontColor}`,
    ...extra,
  ].join(';') + ';'
  const xml =
    `<mxCell id="${esc(cell.id)}" value="${esc(text)}" style="${esc(styleStr)}" vertex="1" parent="${layerId}">` +
    `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`
  return { xml, degraded }
}

function edgeEndId(v: any): string | null {
  if (!v) return null
  if (typeof v === 'string') return v
  if (typeof v.cell === 'string') return v.cell
  if (v.id) return v.id
  return null
}

function edgeCellXml(cell: any, layerId: string): { xml: string; degraded: boolean } {
  const d = cell.data || {}
  const lineType: string = d.lineType || 'smoothstep'
  const color = String(d.color || cell.attrs?.line?.stroke || '#475569')
  const lineWidth = Number(d.lineWidth || cell.attrs?.line?.strokeWidth || 1.6)
  const dashed = !!d.dashed || !!cell.attrs?.line?.strokeDasharray
  let arrow: string = d.arrow === false ? 'none' : 'block'
  if (typeof d.arrow === 'string') arrow = d.arrow
  const labelText = firstEdgeLabel(cell)
  const edgeStyle =
    lineType === 'bezier' ? 'none;curved=1' : lineType === 'straight' ? 'none' : 'orthogonalEdgeStyle'
  const extra: string[] = []
  if (d.href) extra.push(`lfHref=${encodeURIComponent(d.href)}`)
  if (d.tooltip) extra.push(`lfTooltip=${encodeURIComponent(d.tooltip)}`)
  const styleStr = [
    `edgeStyle=${edgeStyle}`,
    'rounded=0',
    'html=1',
    `strokeColor=${color}`,
    `strokeWidth=${lineWidth}`,
    dashed ? 'dashed=1' : '',
    `endArrow=${arrow}`,
    'startArrow=none',
    ...extra,
  ]
    .filter(Boolean)
    .join(';') + ';'
  const src = edgeEndId(cell.source)
  const tgt = edgeEndId(cell.target)
  if (!src || !tgt) return { xml: '', degraded: true }
  const pts = (cell.vertices || [])
    .map((v: any) => `<mxPoint x="${Math.round(v.x)}" y="${Math.round(v.y)}"/>`)
    .join('')
  const geo = pts
    ? `<mxGeometry relative="1" as="geometry"><Array as="points">${pts}</Array></mxGeometry>`
    : `<mxGeometry relative="1" as="geometry"/>`
  const xml =
    `<mxCell id="${esc(cell.id)}" value="${esc(labelText)}" style="${esc(styleStr)}" edge="1" ` +
    `parent="${layerId}" source="${esc(src)}" target="${esc(tgt)}">${geo}</mxCell>`
  return { xml, degraded: false }
}

export interface DrawioExportResult {
  xml: string
  degradedCount: number
  skippedCount: number
}

/**
 * X6 多页 → draw.io XML 字符串。
 * 单页文档落到默认图层（id="1"），多页追加 lf-layer-N，保证重新导入可还原多页。
 */
export function x6PagesToDrawioXml(pages: DiagramPageData[]): DrawioExportResult {
  let degradedCount = 0
  let skippedCount = 0
  const layers: string[] = []

  pages.forEach((pg, i) => {
    // 首页落到 draw.io 默认图层（id="1"，root 已包含，无需再发图层单元）；
    // 其余页追加独立图层 lf-layer-N，保证重新导入可还原多页。
    const isDefault = i === 0
    const layerId = isDefault ? '1' : `lf-layer-${i + 1}`
    const cells = (pg.data?.cells as any[]) || []
    const body: string[] = []
    for (const c of cells) {
      const shape = String(c.shape || '')
      if (shape === 'diagram-page') {
        skippedCount++
        continue
      }
      if (shape === 'diagram-drawing') {
        skippedCount++
        continue
      }
      const isEdge = shape === 'edge' || (c.source && c.target)
      if (isEdge) {
        const r = edgeCellXml(c, layerId)
        if (r.xml) body.push(r.xml)
        if (r.degraded) degradedCount++
      } else {
        const r = nodeCellXml(c, layerId)
        body.push(r.xml)
        if (r.degraded) degradedCount++
      }
    }
    if (isDefault) {
      layers.push(body.join(''))
    } else {
      const layerName = esc(pg.name || `页面 ${i + 1}`)
      layers.push(
        `<mxCell id="${layerId}" value="${layerName}" style="locked=0;" parent="0" vertex="0" connectable="0">` +
          `<mxGeometry x="0" y="0" as="geometry"/></mxCell>` +
          body.join(''),
      )
    }
  })

  const root = `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${layers.join('')}</root>`
  const model =
    `<mxGraphModel dx="850" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" ` +
    `arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">${root}</mxGraphModel>`
  return { xml: '<?xml version="1.0" encoding="UTF-8"?>\n' + model, degradedCount, skippedCount }
}
