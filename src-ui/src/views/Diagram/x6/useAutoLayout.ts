// useAutoLayout：dagre 自动布局（方案 B 对应 spec §P1-T3.4）。
//
// 设计约束：
// - 复用已装的 @dagrejs/dagre@3.1.1，对接 X6 标准 nodes/edges 结构；
// - rankdir 支持 TB / LR 两个方向；
// - 所有坐标更新包裹在 graph.batchUpdate('autoLayout', fn) 内，合并为【一条】历史记录（布局一步可撤销）；
// - dagre 给出的是节点【中心点】，转成 X6 的【左上角】坐标。
import dagre from '@dagrejs/dagre'
import type { Graph, Edge } from '@antv/x6'

export function autoLayout(graph: Graph, dir: 'TB' | 'LR' = 'TB') {
  const nodes = graph.getNodes()
  const edges = graph.getEdges()
  if (!nodes.length) return

  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: dir, nodesep: 40, ranksep: 60, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))

  nodes.forEach((n: any) => {
    const size = n.getSize()
    g.setNode(n.id, { width: size.width, height: size.height })
  })
  edges.forEach((e: any) => {
    const s = e.getSourceCellId?.()
    const t = e.getTargetCellId?.()
    if (s && t) g.setEdge(s, t)
  })

  dagre.layout(g)

  graph.batchUpdate('autoLayout', () => {
    nodes.forEach((n: any) => {
      const pos = g.node(n.id)
      if (!pos) return
      const size = n.getSize()
      n.position(Math.round(pos.x - size.width / 2), Math.round(pos.y - size.height / 2))
    })
  })
}
