// useGraph：X6 画布的 composable 封装（方案 B 核心桥接层）。
//
// 设计约束（来自 spec §4.1）：
// - graph 实例【严禁】模块级单例 export，必须经此 composable 返回给组件消费，
//   避免多处共享导致副作用 / 内存泄漏。
// - 生命周期绑定 onMounted / onBeforeUnmount；卸载必须 graph.dispose()。
import { onMounted, onBeforeUnmount, ref, shallowRef, type Ref } from 'vue'
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

export interface UseGraphParams {
  containerRef: Ref<HTMLElement | null>
  minimapContainerRef?: Ref<HTMLElement | null>
}

export function useGraph(params: UseGraphParams) {
  const { containerRef, minimapContainerRef } = params
  // 用 shallowRef：Graph 实例是可变对象，无需深度响应，避免 X6 内部频繁触发 Vue 响应式开销。
  const graph = shallowRef<Graph | null>(null)
  const graphReady = ref(false)

  onMounted(() => {
    if (!containerRef.value) {
      console.error('[useGraph] container ref 未挂载，无法初始化 Graph')
      return
    }
    // 注册 Vue shape（幂等）。
    registerVueShapes()

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
    g.use(new Transform({ resizing: true, rotating: true }))
    g.use(new Scroller({ enabled: true, pannable: true }))
    g.use(new Export())
    if (minimapContainerRef?.value) {
      g.use(new MiniMap({ container: minimapContainerRef.value }))
    }

    graph.value = g
    graphReady.value = true
  })

  onBeforeUnmount(() => {
    graph.value?.dispose()
    graph.value = null
    graphReady.value = false
  })

  return { graph, graphReady }
}
