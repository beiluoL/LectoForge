// useDrawioIo：draw.io 导入导出的业务编排（P2-T4）。
//
// 纯映射逻辑在 x6ToDrawio.ts / drawioToX6.ts；本 composable 负责把纯函数
// 接到 graph 实例与多页系统（usePages），不持有 graph 单例、不碰 DOM 文件读写
// （文件读取/下载放在 playground 里，UI 关注点分离）。
import { type Ref } from 'vue'
import type { Graph } from '@antv/x6'
import { x6PagesToDrawioXml } from './x6ToDrawio'
import { parseDrawioXml } from './drawioToX6'
import type { DiagramPageData } from './usePages'

/** usePages 暴露给本 composable 的最小接口 */
export interface PagesApi {
  serialize(): DiagramPageData[]
  loadPages(data: DiagramPageData[], currentId: string): void
  currentPageId: Ref<string>
}

export function useDrawioIo(graph: Ref<Graph | null>, pages: PagesApi) {
  /** 导出当前多页为 draw.io XML 字符串（多页→多图层） */
  function exportXml(): { xml: string; degraded: number; skipped: number } {
    const result = x6PagesToDrawioXml(pages.serialize())
    return { xml: result.xml, degraded: result.degradedCount, skipped: result.skippedCount }
  }

  /**
   * 应用导入的 draw.io XML：解析 → 替换多页系统 → 载入首屏并适配视图。
   * 返回 warning 列表（降级/跳过），由调用方 toast 提示。
   */
  function applyImportedXml(xml: string): string[] {
    const { pages: imported, warnings } = parseDrawioXml(xml)
    if (!imported.length) return warnings
    pages.loadPages(imported, imported[0].id)
    const g = graph.value
    if (g) {
      g.fromJSON(imported[0].data)
      g.cleanHistory()
      g.zoomToFit()
    }
    return warnings
  }

  return { exportXml, applyImportedXml }
}
