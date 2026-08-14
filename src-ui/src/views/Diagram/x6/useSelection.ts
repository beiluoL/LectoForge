// useSelection：从 graph 派生响应式选中态（方案 B 工具栏 / 属性面板共用）。
//
// 设计约束：
// - 仅在 selection:changed 事件时同步，避免高频重渲染；
// - 组件卸载时解绑事件 + 停止 watch，防止内存泄漏；
// - graph 经 provide 注入为 shallowRef，故用 watch 监听其从 null → 实例的就绪过程。
import { ref, watch, onUnmounted, type Ref } from 'vue'
import type { Graph, Cell } from '@antv/x6'

export function useSelection(graph: Ref<Graph | null>) {
  const selectedCells = ref<Cell[]>([])
  const selectedNodes = ref<Cell[]>([])
  const selectedEdges = ref<Cell[]>([])
  const hasSelection = ref(false)
  const hasNode = ref(false)
  const hasEdge = ref(false)

  function sync() {
    const g = graph.value
    if (!g) {
      selectedCells.value = []
      selectedNodes.value = []
      selectedEdges.value = []
      hasSelection.value = hasNode.value = hasEdge.value = false
      return
    }
    const cells = g.getSelectedCells()
    selectedCells.value = cells
    selectedNodes.value = cells.filter((c) => c.isNode())
    selectedEdges.value = cells.filter((c) => c.isEdge())
    hasSelection.value = cells.length > 0
    hasNode.value = selectedNodes.value.length > 0
    hasEdge.value = selectedEdges.value.length > 0
  }

  let off: (() => void) | null = null
  const stop = watch(
    graph,
    (g) => {
      off?.()
      off = null
      if (g) {
        g.on('selection:changed', sync)
        off = () => g.off('selection:changed', sync)
        sync()
      }
    },
    { immediate: true },
  )

  onUnmounted(() => {
    off?.()
    stop()
  })

  return { selectedCells, selectedNodes, selectedEdges, hasSelection, hasNode, hasEdge, sync }
}
