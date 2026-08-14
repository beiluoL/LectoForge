// useArrange：批量对齐与分布（方案 B 对应 spec §P1-T3.3）。
//
// 设计约束：
// - 取当前选中节点，用 getBBox() 算包围盒；
// - 所有变更包裹在 graph.batchUpdate(name, fn) 内，X6 History 会将其合并为【一条】历史记录，
//   撤销时整体回滚（对齐/分布一步可撤销）。
// - 对齐：left/right/top/bottom/hcenter/vcenter（< 2 个忽略）。
// - 分布：hdistribute/vdistribute（< 3 个忽略，端点不动、中间均分）。
import type { Graph, Node } from '@antv/x6'

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter'
export type DistributeMode = 'hdistribute' | 'vdistribute'

function selectedNodes(graph: Graph): Node[] {
  return graph
    .getSelectedCells()
    .filter((c) => c.isNode()) as Node[]
}

export function alignNodes(graph: Graph, mode: AlignMode) {
  const nodes = selectedNodes(graph)
  if (nodes.length < 2) return

  const boxes = nodes.map((n) => {
    const b = (n as any).getBBox()
    return {
      node: n,
      x: b.x,
      y: b.y,
      w: b.width,
      h: b.height,
      cx: b.x + b.width / 2,
      cy: b.y + b.height / 2,
    }
  })

  let target = 0
  if (mode === 'left') target = Math.min(...boxes.map((s) => s.x))
  else if (mode === 'right') target = Math.max(...boxes.map((s) => s.x + s.w))
  else if (mode === 'top') target = Math.min(...boxes.map((s) => s.y))
  else if (mode === 'bottom') target = Math.max(...boxes.map((s) => s.y + s.h))
  else if (mode === 'hcenter') target = boxes.reduce((a, s) => a + s.cx, 0) / boxes.length
  else target = boxes.reduce((a, s) => a + s.cy, 0) / boxes.length

  graph.batchUpdate('align', () => {
    boxes.forEach((s) => {
      let x = s.x
      let y = s.y
      if (mode === 'left') x = target
      else if (mode === 'right') x = target - s.w
      else if (mode === 'top') y = target
      else if (mode === 'bottom') y = target - s.h
      else if (mode === 'hcenter') x = target - s.w / 2
      else y = target - s.h / 2
      ;(s.node as any).position(Math.round(x), Math.round(y))
    })
  })
}

export function distributeNodes(graph: Graph, mode: DistributeMode) {
  const nodes = selectedNodes(graph)
  if (nodes.length < 3) return

  const boxes = nodes.map((n) => {
    const b = (n as any).getBBox()
    return {
      node: n,
      x: b.x,
      y: b.y,
      w: b.width,
      h: b.height,
      cx: b.x + b.width / 2,
      cy: b.y + b.height / 2,
    }
  })
  const sorted = [...boxes].sort((a, b) => (mode === 'hdistribute' ? a.cx - b.cx : a.cy - b.cy))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const span = mode === 'hdistribute' ? last.cx - first.cx : last.cy - first.cy
  const gap = span / (sorted.length - 1)

  graph.batchUpdate('distribute', () => {
    sorted.forEach((s, i) => {
      const center = mode === 'hdistribute' ? first.cx + gap * i : first.cy + gap * i
      if (mode === 'hdistribute') (s.node as any).position(Math.round(center - s.w / 2), s.y)
      else (s.node as any).position(s.x, Math.round(center - s.h / 2))
    })
  })
}
