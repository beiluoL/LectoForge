// X6 画布配置常量（方案 B：AntV X6 自研升级）。
// 所有画布参数集中在此，后续由 Pinia 的 diagramStore.graphConfig 驱动时可在此扩展。
import { Graph, Shape } from '@antv/x6'
import { edgeConnectorRouter, edgeLineAttrs } from './edgeFactory'

/** 网格尺寸（px） */
export const GRID_SIZE = 8

/** 撤销栈上限（默认 50，对应 spec ENV 验收） */
export const HISTORY_STACK_SIZE = 50

/**
 * 构建 Graph 构造参数。minimap 容器不在此处传入——
 * 它由 @antv/x6-plugin-minimap 的 MiniMap 插件在 useGraph 中接管。
 */
export function createGraphOptions(container: HTMLElement): Graph.Options {
  return {
    container,
    autoResize: true,
    background: { color: '#ffffff' },
    grid: { size: GRID_SIZE, visible: true },
    mousewheel: {
      enabled: true,
      modifiers: ['ctrl', 'meta'],
      minScale: 0.4,
      maxScale: 2.5,
    },
    connecting: {
      router: { name: 'manhattan', args: { padding: 12 } },
      connector: { name: 'rounded', args: { radius: 8 } },
      anchor: 'center',
      connectionPoint: 'anchor',
      allowBlank: false,
      allowLoop: false,
      snap: { radius: 24 },
      highlight: true,
      // 拖动连接时生成的边：默认 smoothstep + block 箭头（与现有 CustomEdge 默认一致）
      createEdge() {
        const { connector, router } = edgeConnectorRouter('smoothstep')
        return new Shape.Edge({
          shape: 'edge',
          connector,
          router,
          attrs: { line: edgeLineAttrs() },
          data: { lineType: 'smoothstep', color: '#475569', lineWidth: 1.6, dashed: false, arrow: true },
        })
      },
    },
    // 容器 / 泳道 / 分组：拖入结构节点即成为父节点（P2-T2.1/2.2/2.3）
    embedding: {
      enabled: true,
      findParent({ node, graph }: any) {
        const b = node.getBBox()
        const parent = graph
          .getNodes()
          .find(
            (n: any) =>
              n.id !== node.id &&
              isStructuralShape(n.shape) &&
              n.getBBox().contains(b),
          )
        return parent || null
      },
    },
  }
}

/** 是否为结构型父节点（容器 / 泳道 / 分组） */
export function isStructuralShape(shape: string): boolean {
  return shape.endsWith('-container') || shape.endsWith('-swimlane') || shape.endsWith('-group')
}
