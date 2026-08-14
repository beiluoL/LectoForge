// usePenMode：自由画笔（方案 B · WKWebView 兼容层）。
//
// 设计约束（spec §4 决策块第 4 点 + P1-T5.1 验收）：
// - penMode 时 graph.setInteracting(false)，关掉 X6 标准交互，避免与画笔抢指针；
// - 起笔用 mousedown / touchstart，**move/up 挂 document**（正是 X6 内部自身保证兼容的手法），
//   【不用 setPointerCapture】——WKWebView 跨 DOM 边界快速移动会丢捕获/误发 pointercancel 导致断笔；
// - 松手把收集到的 client 坐标经 graph.clientToLocal() 转成画布本地坐标，算出相对 path，
//   一次性 graph.addNode（仅在 mouseup 落 1 个 cell → 1 步 history，非逐点入栈）；
// - 画笔节点本身用 diagram-drawing（path 相对坐标），可被整体拖动 / 改色 / 改描边宽。
import { computed, ref, watch, type Ref } from 'vue'
import type { Graph } from '@antv/x6'

export interface PenPoint {
  x: number
  y: number
}

export function usePenMode(graph: Ref<Graph | null>, containerRef: Ref<HTMLElement | null>) {
  const penMode = ref(false)
  const drawing = ref(false)
  /** 起笔后的 client 坐标点（用于实时预览 + 最终落点） */
  const clientPoints = ref<PenPoint[]>([])

  const penColor = ref('#475569')
  const penWidth = ref(3)

  /** 实时预览 path（容器本地坐标，覆盖层内渲染） */
  const previewPath = computed(() => {
    const rect = containerRef.value?.getBoundingClientRect()
    if (!rect || clientPoints.value.length < 2) return ''
    return clientPoints.value
      .map((p, i) => {
        const x = (p.x - rect.left).toFixed(1)
        const y = (p.y - rect.top).toFixed(1)
        return `${i ? 'L' : 'M'} ${x} ${y}`
      })
      .join(' ')
  })

  // penMode 切换时关/开 X6 交互（进画笔模式禁交互，避免误拖节点）。
  // X6 v2 无 setInteracting API，交互开关读 graph.options.interacting，直接覆写即可。
  watch(penMode, (on) => {
    const g = graph.value as any
    if (g) g.options.interacting = !on
  })

  function getPoint(e: any): PenPoint | null {
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY }
    if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY }
    if (typeof e.clientX === 'number') return { x: e.clientX, y: e.clientY }
    return null
  }

  function onMove(e: any) {
    if (!drawing.value) return
    const p = getPoint(e)
    if (p) clientPoints.value.push(p)
  }
  function onUp() {
    if (!drawing.value) return
    drawing.value = false
    detachDoc()
    finalize()
  }
  function onKey(e: KeyboardEvent) {
    // 画笔进行中按 Esc 取消整条
    if (drawing.value && e.key === 'Escape') {
      drawing.value = false
      detachDoc()
      clientPoints.value = []
    }
  }

  function attachDoc() {
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onUp)
    document.addEventListener('keydown', onKey)
  }
  function detachDoc() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onUp)
    document.removeEventListener('keydown', onKey)
  }

  /** 起笔（覆盖层 mousedown / touchstart 调用） */
  function beginStroke(e: any) {
    if (!penMode.value || !graph.value) return
    const p = getPoint(e)
    if (!p) return
    // 触屏滚动默认行为会打断画笔，阻止
    if (e.cancelable) e.preventDefault()
    drawing.value = true
    clientPoints.value = [p]
    attachDoc()
  }

  /** 松手落点：client → 画布本地坐标 → 相对 path → 1 个节点 */
  function finalize() {
    const g = graph.value
    const pts = clientPoints.value
    clientPoints.value = []
    if (!g || pts.length < 2) return
    const locals = pts.map((p) => g.clientToLocal({ x: p.x, y: p.y }))
    const xs = locals.map((p) => p.x)
    const ys = locals.map((p) => p.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const maxX = Math.max(...xs)
    const maxY = Math.max(...ys)
    const w = Math.max(2, Math.ceil(maxX - minX))
    const h = Math.max(2, Math.ceil(maxY - minY))
    const d = locals
      .map((p, i) => `${i ? 'L' : 'M'} ${(p.x - minX).toFixed(1)} ${(p.y - minY).toFixed(1)}`)
      .join(' ')
    const pointsRel = locals.map((p) => ({ x: +(p.x - minX).toFixed(1), y: +(p.y - minY).toFixed(1) }))

    const node = g.batchUpdate('pen', () =>
      g.addNode({
        shape: 'diagram-drawing',
        x: Math.round(minX),
        y: Math.round(minY),
        width: w,
        height: h,
        attrs: {
          body: { d, stroke: penColor.value, strokeWidth: penWidth.value },
        },
        data: {
          label: '',
          path: d,
          points: JSON.stringify(pointsRel),
          pathColor: penColor.value,
          strokeWidth: penWidth.value,
        },
      }),
    )
    g.select(node as any)
  }

  return { penMode, drawing, previewPath, penColor, penWidth, beginStroke }
}
