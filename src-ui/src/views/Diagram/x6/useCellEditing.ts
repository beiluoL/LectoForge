// 单元格双击编辑（方案 B：P1-T2.2 / P1-T2.4）。
//
// X6 原生节点标签是 SVG <text>，无内建 contenteditable；这里用「浮层编辑器」方案：
// 监听 node:dblclick / edge:dblclick，在节点/标签 bbox 上方盖一个绝对定位的
// contenteditable div，Enter 保存、Esc 取消、失焦保存；提交回写到
// node.attr('label/text') + node.data.label（序列化兼容 store）。
//
// 这是 X6 官方推荐的 label 编辑做法，比在 SVG 里嵌 foreignObject 更稳，且不受 WKWebView 限制。
import { Graph } from '@antv/x6'

interface EditingContext {
  cell: any
  isEdge: boolean
  current: string
}

export function setupCellEditing(graph: Graph, container: HTMLElement): () => void {
  const editor = document.createElement('div')
  editor.contentEditable = 'plaintext-only'
  editor.spellcheck = false
  editor.style.cssText = [
    'position:absolute',
    'z-index:50',
    'display:none',
    'min-width:40px',
    'max-width:320px',
    'padding:2px 6px',
    'border:1px solid #3b6fe0',
    'border-radius:4px',
    'background:rgba(255,255,255,0.95)',
    'color:#0F172A',
    'font-size:13px',
    'line-height:1.3',
    'outline:none',
    'text-align:center',
    'cursor:text',
    'user-select:text',
    'white-space:pre-wrap',
    'word-break:break-word',
    'box-shadow:0 2px 6px rgba(0,0,0,0.15)',
  ].join(';')
  container.appendChild(editor)

  let ctx: EditingContext | null = null

  function positionFor(cell: any) {
    const bbox = cell.getBBox()
    const tl = graph.localToClient({ x: bbox.x, y: bbox.y })
    const br = graph.localToClient({ x: bbox.x + bbox.width, y: bbox.y + bbox.height })
    const cRect = container.getBoundingClientRect()
    const scale = graph.zoom()
    editor.style.left = `${tl.x - cRect.left}px`
    editor.style.top = `${tl.y - cRect.top}px`
    editor.style.width = `${Math.max(40, (br.x - tl.x) / scale)}px`
    editor.style.height = `${Math.max(24, (br.y - tl.y) / scale)}px`
  }

  function open(cell: any, isEdge: boolean) {
    const current = isEdge
      ? String(cell.prop('labels/0/attrs/label/text') ?? cell.getData()?.label ?? '')
      : String(cell.attr('label/text') ?? cell.getData()?.label ?? '')
    ctx = { cell, isEdge, current }
    editor.textContent = current
    positionFor(cell)
    editor.style.display = 'block'
    editor.focus()
    const range = document.createRange()
    range.selectNodeContents(editor)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }

  function commit() {
    if (!ctx) return
    const text = (editor.textContent ?? '').replace(/ /g, ' ').replace(/[\r\n]+/g, '\n').trim()
    const { cell, isEdge, current } = ctx
    if (text !== current) {
      if (isEdge) {
        cell.setLabels([{ position: 0.5, attrs: { label: { text, fill: '#475569', fontSize: 12, fontFamily: 'system-ui, sans-serif' } } }])
        cell.setData({ ...(cell.getData() || {}), label: text })
      } else {
        cell.attr('label/text', text)
        cell.setData({ ...(cell.getData() || {}), label: text })
      }
    }
    close()
  }

  function close() {
    ctx = null
    editor.style.display = 'none'
    editor.textContent = ''
  }

  const onNodeDbl = ({ node }: any) => open(node, false)
  const onEdgeDbl = ({ edge }: any) => open(edge, true)
  const onKeydown = (e: KeyboardEvent) => {
    if (!ctx) return
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }
  const onBlur = () => commit()

  graph.on('node:dblclick', onNodeDbl)
  graph.on('edge:dblclick', onEdgeDbl)
  editor.addEventListener('keydown', onKeydown)
  editor.addEventListener('blur', onBlur)

  return () => {
    graph.off('node:dblclick', onNodeDbl)
    graph.off('edge:dblclick', onEdgeDbl)
    editor.removeEventListener('keydown', onKeydown)
    editor.removeEventListener('blur', onBlur)
    editor.remove()
  }
}
