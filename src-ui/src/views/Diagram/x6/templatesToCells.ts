// templatesToCells：把现有 DiagramTemplate（骨架结构）转成标准 X6 cells（P1-T5.2）。
//
// 模板内 nodes 仅有 {ref, type, label, x, y, width?, height?}，edges 仅有 {from, to, label?}；
// 这里映射成 X6 addCells 直接消费的 cell 元数据：节点用 diagram-<type> + 业务 data，
// 连线用 edgeFactory.buildEdgeMetadata（3 线型默认 smoothstep + block 箭头）。
import { SHAPE_BY_TYPE } from '../shapeDefs'
import { buildEdgeMetadata } from './edgeFactory'
import type { DiagramTemplate } from '../templates'

export interface X6Cells {
  cells: any[]
}

const DEFAULT_EDGE = { lineType: 'smoothstep' as const, color: '#475569', lineWidth: 1.6, dashed: false, arrow: true }

/** DiagramTemplate → { cells: X6 cell 元数据数组 } */
export function templateToX6Cells(tpl: DiagramTemplate): X6Cells {
  const cells: any[] = []
  const idMap: Record<string, string> = {}

  tpl.nodes.forEach((n, i) => {
    const def = SHAPE_BY_TYPE[n.type] || SHAPE_BY_TYPE.rect
    const id = `tpl-${tpl.id}-${n.ref}-${i}`
    idMap[n.ref] = id
    const width = n.width ?? def.defaultWidth
    const height = n.height ?? def.defaultHeight
    cells.push({
      id,
      shape: `diagram-${n.type}`,
      x: n.x,
      y: n.y,
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

  tpl.edges.forEach((e) => {
    const s = idMap[e.from]
    const t = idMap[e.to]
    if (!s || !t) return
    cells.push(
      buildEdgeMetadata({
        source: s,
        target: t,
        label: e.label,
        data: { ...DEFAULT_EDGE },
      }),
    )
  })

  return { cells }
}
