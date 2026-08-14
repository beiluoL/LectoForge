// useGraphExport：导出 PNG / SVG / PDF（P1-T5.4）。
//
// 设计约束（spec §P1-T5.4）：
// - PNG / SVG 直接用 @antv/x6-plugin-export 的 graph.exportPNG / graph.exportSVG，
//   该插件【回调式自动下载】（内部生成 dataURI / SVG 字符串后触发 <a download>），
//   故这里只需传文件名 + 选项即可，无需手动构造 Blob；
// - PNG 用 pixelRatio: 2（2× 高清，满足 P1-A7 / P1-33 不发糊）；
// - PDF MVP：取 SVG 字符串 → 包裹进独立打印窗口 → 触发系统打印（macOS 可在弹窗里「存储为 PDF」）。
//   字体偶糊属已知，svg2pdf.js 完整方案留 P2-T4.1。
import type { Graph } from '@antv/x6'

export type ExportFormat = 'png' | 'svg' | 'pdf'

export function exportDiagram(graph: Graph | null, format: ExportFormat, name = 'diagram') {
  if (!graph) return
  const g = graph as any
  if (format === 'png') {
    g.exportPNG(name, { padding: 20, backgroundColor: '#ffffff', pixelRatio: 2 })
  } else if (format === 'svg') {
    g.exportSVG(name, { padding: 20, backgroundColor: '#ffffff' })
  } else {
    exportPdf(g, name)
  }
}

/** PDF MVP：SVG → 打印窗口 → 系统「存储为 PDF」 */
function exportPdf(g: any, name: string) {
  g.toSVG((svg: string) => {
    const win = window.open('', '_blank')
    if (!win) {
      // 弹窗被拦截：退化为下载 SVG，提示用户手动转 PDF
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}.svg`
      a.click()
      URL.revokeObjectURL(url)
      return
    }
    win.document.open()
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body style="margin:0">${svg}</body></html>`,
    )
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 300)
  }, { padding: 20, backgroundColor: '#ffffff' })
}
