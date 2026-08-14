// useGraph：X6 画布的 composable 封装（方案 B 核心桥接层）。
//
// 设计约束（来自 spec §4.1）：
// - graph 实例【严禁】模块级单例 export，必须经此 composable 返回给组件消费，
//   避免多处共享导致副作用 / 内存泄漏。
// - 生命周期绑定 onMounted / onBeforeUnmount；卸载必须 graph.dispose()。
import { onMounted, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { Graph } from '@antv/x6'
import { History } from '@antv/x6-plugin-history'
import { Keyboard } from '@antv/x6-plugin-keyboard'
import { Selection } from '@antv/x6-plugin-selection'
import { Clipboard } from '@antv/x6-plugin-clipboard'
import { Snapline } from '@antv/x6-plugin-snapline'
import { Transform } from '@antv/x6-plugin-transform'
import { Scroller } from '@antv/x6-plugin-scroller'
import { MiniMap } from '@antv/x6-plugin-minimap'
import { Export } from '@antv/x6-plugin-export'
import { createGraphOptions, HISTORY_STACK_SIZE } from './graphConfig'
import { registerVueShapes } from './vue-shapes'
import { registerDiagramShapes } from './shapeFactory'
import { setupCellEditing } from './useCellEditing'
import { setupHistoryBindings } from './useHistory'

export interface UseGraphParams {
  containerRef: Ref<HTMLElement | null>
  minimapContainerRef?: Ref<HTMLElement | null>
}

export function useGraph(params: UseGraphParams) {
  const { containerRef, minimapContainerRef } = params
  // 用 shallowRef：Graph 实例是可变对象，无需深度响应，避免 X6 内部频繁触发 Vue 响应式开销。
  const graph = shallowRef<Graph | null>(null)
  const graphReady = ref(false)
  // 撤销/重做状态（X6 History 插件驱动，工具栏据此置灰按钮 / 显示步数）
  const canUndo = ref(false)
  const canRedo = ref(false)
  const historySize = ref(0)
  let cleanupEditing: (() => void) | null = null

  onMounted(() => {
    if (!containerRef.value) {
      console.error('[useGraph] container ref 未挂载，无法初始化 Graph')
      return
    }
    // 注册 Vue shape（幂等）+ 11 种原生 diagram shape（幂等）。
    registerVueShapes()
    registerDiagramShapes()

    const g = new Graph(createGraphOptions(containerRef.value))

    // 插件按 spec T1.3 全量挂载；minimap 仅在提供了容器时启用。
    g.use(new History({ enabled: true, stackSize: HISTORY_STACK_SIZE }))
    g.use(new Keyboard({ enabled: true }))
    g.use(
      new Selection({
        enabled: true,
        multiple: true,
        rubberband: true,
        showNodeSelectionBox: true,
        modifiers: null, // 框选无需按住修饰键
      }),
    )
    g.use(new Clipboard({ enabled: true }))
    g.use(new Snapline({ enabled: true }))
    g.use(new Transform({ resizing: { minWidth: 60, minHeight: 36 }, rotating: true }))
    g.use(new Scroller({ enabled: true, pannable: true }))
    g.use(new Export())
    if (minimapContainerRef?.value) {
      g.use(new MiniMap({ container: minimapContainerRef.value }))
    }

    // ===== 选中态工具：节点加 transform（resize/rotate），边加 vertices+segments（拐点编辑） =====
    g.on('node:selected', ({ node }: any) => {
      // 自由画笔节点（diagram-drawing）只移动、不缩放/旋转，避免 path d 不随尺寸缩放导致错位
      if (!node.getShape().endsWith('-drawing')) node.addTools('transform')
    })
    g.on('node:unselected', ({ node }: any) => {
      node.removeTools()
    })
    g.on('edge:selected', ({ edge }: any) => {
      edge.attr('line/strokeWidth', Number(edge.attr('line/strokeWidth') || 1.6) + 1)
      edge.addTools(['vertices', 'segments'])
    })
    g.on('edge:unselected', ({ edge }: any) => {
      edge.attr('line/strokeWidth', Math.max(1, Number(edge.attr('line/strokeWidth') || 1.6) - 1))
      edge.removeTools()
    })

    // ===== 形状保真：terminal 胶囊 rx 随高变化；uml header 填充跟随描边 =====
    g.on('node:change:size', ({ node }: any) => {
      if (node.getShape().endsWith('-terminal')) {
        node.attr('body/rx', Math.max(2, node.getSize().height / 2))
      }
    })
    g.on('node:change:attrs', ({ node }: any) => {
      const shape = node.getShape()
      if (shape.endsWith('-class') || shape.endsWith('-interface')) {
        const desired = node.attr('body/stroke') || '#475569'
        if (node.attr('header/fill') !== desired) {
          node.attr('header/fill', desired)
        }
      }
    })

    // ===== 双击编辑节点 / 边标签 =====
    cleanupEditing = setupCellEditing(g, containerRef.value)

    // ===== 撤销/重做/复制/粘贴/删除 快捷键（History + Clipboard 插件接管）=====
    const hb = setupHistoryBindings(g)
    watch([hb.canUndo, hb.canRedo, hb.historySize], ([cu, cr, hs]) => {
      canUndo.value = cu
      canRedo.value = cr
      historySize.value = hs
    })

    graph.value = g
    graphReady.value = true
  })

  onBeforeUnmount(() => {
    cleanupEditing?.()
    graph.value?.dispose()
    graph.value = null
    graphReady.value = false
  })

  return { graph, graphReady, canUndo, canRedo, historySize }
}
