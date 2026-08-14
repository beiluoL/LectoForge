// X6 画布配置常量（方案 B：AntV X6 自研升级）。
// 所有画布参数集中在此，后续由 Pinia 的 diagramStore.graphConfig 驱动时可在此扩展。
import type { Graph } from '@antv/x6'

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
    },
  }
}
