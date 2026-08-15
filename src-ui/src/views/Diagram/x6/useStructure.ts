// 结构工具 composable（P2-T2）：容器/泳道父级约束 + Ctrl+G 分组 / Ctrl+Shift+G 解组。
//
// - embedding 已在 graphConfig 开启：拖入结构节点（容器/泳道/分组）即成为父节点，
//   移动父节点时子节点跟随（X6 自动）；此处补「子节点不能拖出父节点边界」的夹紧。
// - 分组：把选中节点包进一个 diagram-group 父节点（parent-child），
//   整体移动；解组解除父子关系并删除 group 节点。
// - 所有变更用 graph.batchUpdate 包一层 → 仅 1 步 history（分组/解组各 1 步）。
import type { Graph, Node, Cell } from '@antv/x6'
import { isStructuralShape } from './graphConfig'

const PAD = 6

export function useStructure(graph: Graph) {
  let clamping = false

  function setup() {
    // 子节点拖拽时夹紧在结构父节点边界内（P2-T2.2 验收：不能跨 lane 边界）
    graph.on('node:change:position', ({ node }: any) => {
      if (clamping) return
      const parent: Node | undefined = node.getParent?.()
      if (!parent || !isStructuralShape(parent.shape)) return
      const pb = parent.getBBox()
      const b = node.getBBox()
      let nx = b.x
      let ny = b.y
      if (b.x < pb.x + PAD) nx = pb.x + PAD
      if (b.y < pb.y + PAD) ny = pb.y + PAD
      if (b.x + b.width > pb.x + pb.width - PAD) nx = pb.x + pb.width - b.width - PAD
      if (b.y + b.height > pb.y + pb.height - PAD) ny = pb.y + pb.height - b.height - PAD
      if (nx !== b.x || ny !== b.y) {
        clamping = true
        node.position(nx, ny)
        clamping = false
      }
    })

    // Ctrl+G 分组 / Ctrl+Shift+G 解组
    graph.bindKey(['meta+g', 'ctrl+g'], () => {
      groupSelection()
      return false
    })
    graph.bindKey(['meta+shift+g', 'ctrl+shift+g'], () => {
      ungroupSelection()
      return false
    })
  }

  /** 把选中节点包进一个分组父节点（1 步 history） */
  function groupSelection() {
    const nodes = graph.getSelectedCells().filter((c: Cell) => c.isNode()) as Node[]
    const targets = nodes.filter((n) => !isStructuralShape(n.shape))
    if (targets.length < 2) return
    const bbox = targets.reduce(
      (acc, n) => {
        const b = n.getBBox()
        return {
          minX: Math.min(acc.minX, b.x),
          minY: Math.min(acc.minY, b.y),
          maxX: Math.max(acc.maxX, b.x + b.width),
          maxY: Math.max(acc.maxY, b.y + b.height),
        }
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    )
    graph.batchUpdate('group', () => {
      const g = graph.addNode({
        shape: 'diagram-group',
        x: bbox.minX - 12,
        y: bbox.minY - 12,
        width: bbox.maxX - bbox.minX + 24,
        height: bbox.maxY - bbox.minY + 24,
        attrs: { label: { text: 'Group' } },
        data: { label: 'Group' },
        zIndex: 0,
      })
      targets.forEach((n) => n.setParent(g))
      graph.select(g)
    })
  }

  /** 解组：解除选中 group 节点的父子关系并删除 group（1 步 history） */
  function ungroupSelection() {
    const groups = graph
      .getSelectedCells()
      .filter((c: Cell) => c.isNode() && c.shape.endsWith('-group')) as Node[]
    if (!groups.length) return
    graph.batchUpdate('ungroup', () => {
      groups.forEach((g) => {
        g.getChildren?.()?.forEach((c: Cell) => c.setParent(null))
        g.remove()
      })
    })
  }

  /** 计算新结构节点的落点：放在现有内容下方居中，避免与已有节点重叠 */
  function dropPoint(w: number, h: number) {
    const area = graph.getContentArea()
    const x = Math.max(20, area.x + area.width / 2 - w / 2)
    const y = Math.max(20, area.y + area.height + 40)
    return { x, y }
  }

  /** 插入容器节点（1 步 history） */
  function insertContainer() {
    const w = 320
    const h = 200
    const { x, y } = dropPoint(w, h)
    graph.batchUpdate('insert-container', () => {
      const n = graph.addNode({
        shape: 'diagram-container',
        x,
        y,
        width: w,
        height: h,
        attrs: { label: { text: '容器' } },
        data: { label: '容器' },
        zIndex: 0,
      })
      graph.select(n)
    })
  }

  /** 插入泳道节点（1 步 history）。dir='h' 横向标题栏在顶、'v' 纵向标题栏在左 */
  function insertSwimlane(dir: 'h' | 'v' = 'h') {
    const w = dir === 'h' ? 440 : 220
    const h = dir === 'h' ? 220 : 440
    const { x, y } = dropPoint(w, h)
    graph.batchUpdate('insert-swimlane', () => {
      const n = graph.addNode({
        shape: 'diagram-swimlane',
        x,
        y,
        width: w,
        height: h,
        attrs: { label: { text: '泳道' } },
        data: { label: '泳道', swimlaneDir: dir },
        zIndex: 0,
      })
      graph.select(n)
    })
  }

  return { setup, groupSelection, ungroupSelection, insertContainer, insertSwimlane }
}
