// useGraphExport：导出 PNG / SVG / PDF（P1-T5.4 + P2-T4.1 多页完善）。
//
// 设计约束（spec §P1-T5.4 / §P2-T4.1）：
// - PNG / SVG 直接用 @antv/x6-plugin-export 的 graph.exportPNG / graph.exportSVG，
//   该插件【回调式自动下载】（内部生成 dataURI / SVG 字符串后触发 <a download>），
//   故这里只需传文件名 + 选项即可，无需手动构造 Blob；
// - PNG 用 pixelRatio: 2（2× 高清，满足 P1-A7 / P1-33 不发糊）；
// - PDF（P2-T4.1 完善）：多页图按 X6 页签逐页导出 SVG，包裹进独立打印窗口
//   （A4 页面 + 每页页脚「文件名·第 p 页/共 n 页·时间」），再用系统「存储为 PDF」。
//   采用依赖无关的打印窗口方案（不引入 svg2pdf.js / jsPDF 重依赖，规避 Tauri WKWebView
//   矢量渲染风险，且中文用系统字体原生清晰）；如需像素级矢量 PDF 可后续换 svg2pdf。
// - 多页导出会临时切换 graph 当前页，故由调用方传入 pause/resume 钩子暂停自动保存，
//   并在完成后从 restore 数据还原当前页。
import type { Graph } from '@antv/x6'
import type { DiagramPageData } from './usePages'

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

/** PDF 单页 MVP（保留降级用）：SVG → 打印窗口 → 系统「存储为 PDF」 */
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

/** PDF 多页完善（P2-T4.1）：逐页 SVG → A4 打印窗口（每页一 section + 页脚） */
export interface PdfExportHooks {
  /** 开始切换页前暂停自动保存 */
  pause?: () => void
  /** 结束后恢复自动保存 */
  resume?: () => void
  /** 导出完成后还原的当前页数据（避免画布停在最后一页） */
  restore?: { data: any }
}

export async function exportPdfMulti(
  graph: Graph | null,
  pagesData: DiagramPageData[],
  name = 'diagram',
  hooks: PdfExportHooks = {},
): Promise<void> {
  if (!graph || !pagesData.length) return
  const g = graph as any
  const total = pagesData.length
  const now = new Date().toLocaleString()

  hooks.pause?.()
  const svgs: string[] = []
  try {
    for (const pg of pagesData) {
      g.fromJSON(pg.data || { cells: [] })
      const svg: string = await new Promise<string>((resolve) => {
        g.toSVG((s: string) => resolve(s), { padding: 20, backgroundColor: '#ffffff' })
      })
      svgs.push(svg)
    }
  } finally {
    // 还原真实当前页
    if (hooks.restore) {
      g.fromJSON(hooks.restore.data || { cells: [] })
      g.cleanHistory()
    }
    hooks.resume?.()
  }

  const win = window.open('', '_blank')
  if (!win) {
    // 弹窗被拦截：仅告警，引导用户允许弹窗后重试
    console.warn('[export] PDF 打印窗口被拦截，请允许弹窗后重试')
    return
  }
  const sections = svgs
    .map(
      (svg, i) =>
        `<section class="page">${svg}<div class="footer">${escapeHtml(name)} · 第 ${i + 1} 页 / 共 ${total} 页 · ${escapeHtml(now)}</div></section>`,
    )
    .join('')
  win.document.open()
  win.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>` +
      `<style>
        @page { size: A4; margin: 0; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        .page { width: 210mm; min-height: 297mm; page-break-after: always; position: relative; padding: 14mm 14mm 18mm; }
        .page:last-child { page-break-after: auto; }
        .page svg { width: 100%; height: auto; max-height: 262mm; display: block; }
        .footer { position: absolute; bottom: 8mm; left: 0; right: 0; text-align: center; font-size: 9pt; color: #64748b; font-family: system-ui, -apple-system, "PingFang SC", sans-serif; }
      </style></head><body>${sections}</body></html>`,
  )
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 400)
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
