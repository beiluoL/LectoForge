// diagramDataAdapter：X6 多页 ↔ 后端 DiagramData 互转（P1-T5.5）。
//
// 关键决策：
// - 后端 data 列契约是 { currentPageId, pages:[{ id, name, nodes, edges, viewport }] }（节点 Vue Flow 形态：
//   node = { id, type, position:{x,y}, data:{label,fill,stroke,...} }），service 层 sanitize 只留白名单字段；
// - X6 端用 graph.toJSON()（{ cells:[...] }）承载，二者结构不同；
// - 因此做双向适配：
//     x6PagesToDiagramData(pages)  → X6 cells 落库成后端多页结构（零后端改动即可存）；
//     diagramDetailToX6Pages(detail) → 后端多页结构（含旧 VueFlow 文档）转 X6 cells，
//       即「打开旧文档自动出现在 X6 画布」的【旧数据迁移】路径（满足 P1-34）。
//   说明：X6 富文本 innerHTML / 渐变 / 阴影等增强样式不在后端白名单内，重载会回退为基础样式，
//   完整原生 X6 落库（diagramLegacyConvert.ts 后端直存 cells）留 P1 末路由切换时统一做。
import type { DiagramData, DiagramDetail, DiagramEdge, DiagramNode, DiagramPage } from '@/api/diagram'
import type { DiagramPageData } from './usePages'
import { SHAPE_BY_TYPE, SHAPES, type DiagramShapeType } from '../shapeDefs'
import { buildEdgeMetadata } from './edgeFactory'

const KNOWN_TYPES = new Set(SHAPES.map((s) => s.type))

/** X6 多页 → 后端多页结构（用于保存 / 自动保存） */
export function x6PagesToDiagramData(pages: DiagramPageData[]): DiagramData {
  const now = new Date().toISOString()
  return {
    currentPageId: pages[0]?.id || 'p1',
    pages: pages.map((p) => {
      const cells: any[] = (p.data?.cells as any[]) || []
      const nodes: DiagramNode[] = []
      const edges: DiagramEdge[] = []
      for (const c of cells) {
        const isEdge = c.shape === 'edge' || (c.source && c.target)
        if (isEdge) {
          if (!c.source || !c.target) continue
          const d = c.data || {}
          edges.push({
            id: c.id,
            source: c.source,
            target: c.target,
            data: {
              lineType: d.lineType || 'smoothstep',
              color: d.color || '#475569',
              lineWidth: d.lineWidth || 1.6,
              dashed: !!d.dashed,
              arrow: d.arrow !== false,
              href: d.href,
              tooltip: d.tooltip,
            },
          })
        } else {
          const type = String(c.shape || '').replace('diagram-', '')
          const body = c.attrs?.body || {}
          const label = c.attrs?.label || {}
          const data = c.data || {}
          const isDrawing = type === 'drawing'
          nodes.push({
            id: c.id,
            type: type && KNOWN_TYPES.has(type as DiagramShapeType) ? type : isDrawing ? 'drawing' : null,
            position: { x: Math.round(c.x || 0), y: Math.round(c.y || 0) },
            data: {
              label: String(label.text || ''),
              fill: body.fill,
              stroke: body.stroke,
              textColor: label.fill,
              width: c.width,
              height: c.height,
              href: data.href,
              tooltip: data.tooltip,
              ...(isDrawing
                ? { path: data.path, points: data.points, strokeWidth: data.strokeWidth, pathColor: data.pathColor }
                : {}),
              ...(type === 'image' ? { imageUrl: data.imageUrl } : {}),
            },
          })
        }
      }
      return {
        id: p.id,
        name: p.name,
        nodes,
        edges,
        viewport: { x: 0, y: 0, zoom: 1 },
        createdAt: now,
        updatedAt: now,
      }
    }),
  }
}

/** 后端多页结构 → X6 多页（用于加载 / 打开旧 VueFlow 文档 = 迁移） */
export function diagramDetailToX6Pages(detail: DiagramDetail): DiagramPageData[] {
  return detail.data.pages.map((pg: DiagramPage) => {
    const cells: any[] = []
    const idMap: Record<string, string> = {}

    pg.nodes.forEach((n) => {
      const rawType = n.type && KNOWN_TYPES.has(n.type as DiagramShapeType) ? n.type : n.data?.path ? 'drawing' : 'rect'
      const type = rawType || 'rect'
      const def = SHAPE_BY_TYPE[type as DiagramShapeType] || SHAPE_BY_TYPE.rect
      const w = n.data?.width ?? def.defaultWidth
      const h = n.data?.height ?? def.defaultHeight
      const data = n.data || {}
      const base: any = {
        id: n.id,
        shape: `diagram-${type}`,
        x: n.position.x,
        y: n.position.y,
        width: w,
        height: h,
        attrs: {
          body: { fill: data.fill || '#FFFFFF', stroke: data.stroke || '#475569' },
          label: { text: String(data.label || '') },
        },
        data: {
          label: data.label,
          fill: data.fill,
          stroke: data.stroke,
          textColor: data.textColor,
          width: w,
          height: h,
          href: data.href,
          tooltip: data.tooltip,
        },
      }
      if (type === 'drawing') {
        base.shape = 'diagram-drawing'
        base.attrs.body = { d: data.path || '', stroke: data.pathColor || '#475569', strokeWidth: data.strokeWidth || 2, fill: 'none' }
        base.data.path = data.path
        base.data.points = data.points
        base.data.pathColor = data.pathColor
        base.data.strokeWidth = data.strokeWidth
      } else if (type === 'image') {
        // 图片节点：body 边框 + image 选择器承载 base64（P2-T5.1）
        base.shape = 'diagram-image'
        base.attrs.image = { 'xlink:href': data.imageUrl || '' }
        base.data.imageUrl = data.imageUrl
      }
      cells.push(base)
      idMap[n.id] = n.id
    })

    pg.edges.forEach((e) => {
      const s = idMap[e.source]
      const t = idMap[e.target]
      if (!s || !t) return
      cells.push(
        buildEdgeMetadata({
          source: s,
          target: t,
          label: e.label || undefined,
          data: {
            lineType: (e.data?.lineType as any) || 'smoothstep',
            color: e.data?.color || '#475569',
            lineWidth: e.data?.lineWidth || 1.6,
            dashed: !!e.data?.dashed,
            arrow: e.data?.arrow !== false,
            href: (e.data?.href as string | undefined) || undefined,
            tooltip: (e.data?.tooltip as string | undefined) || undefined,
          },
        }),
      )
    })

    return { id: pg.id, name: pg.name, data: { cells } }
  })
}
