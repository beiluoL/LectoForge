<template>
  <div class="x6-pg">
    <div class="x6-pg-hint">
      X6 方案 B 验证台（P1-T2）：双击节点/边标签改字 · 拖节点四向锚点连线 · 选中节点拖动角点 resize · 选中边拖拐点改路径
    </div>
    <div ref="containerRef" class="x6-pg-canvas"></div>
  </div>
</template>

<script setup lang="ts">
/**
 * X6 方案 B 隐藏验证台（路由 /diagram-x6-playground）。
 * 仅用于本地验证 11 种原生形状 + 3 种连线在 X6 下渲染 / 编辑 / 连线 / resize 是否正常，
 * 不替换现有 /diagram（Vue Flow）。
 */
import { ref, watch, nextTick } from 'vue'
import { useGraph } from './useGraph'
import { SHAPES } from '../shapeDefs'
import { buildEdgeMetadata } from './edgeFactory'

const containerRef = ref<HTMLElement | null>(null)
const { graph, graphReady } = useGraph({ containerRef })

watch(graphReady, async (ready) => {
  if (!ready || !graph.value) return
  await nextTick()
  const g = graph.value

  // 11 种形状按 4 列网格铺开
  const colW = 220
  const rowH = 150
  const ids: Record<string, string> = {}
  SHAPES.forEach((s, i) => {
    const col = i % 4
    const row = Math.floor(i / 4)
    const id = `demo-${s.type}`
    ids[s.type] = id
    const isUml = s.render === 'uml'
    g.addNode({
      id,
      shape: `diagram-${s.type}`,
      x: 40 + col * colW,
      y: 60 + row * rowH,
      width: s.defaultWidth,
      height: s.defaultHeight,
      attrs: {
        body: { fill: '#FFFFFF', stroke: '#475569' },
        label: { text: s.defaultText },
        ...(isUml ? { header: { fill: '#475569' } } : {}),
      },
      data: {
        label: s.defaultText,
        fill: '#FFFFFF',
        stroke: '#475569',
        textColor: '#0F172A',
        width: s.defaultWidth,
        height: s.defaultHeight,
      },
    })
  })

  // 3 种线型示例边
  const samples: Array<{ from: string; to: string; lineType: any; label: string }> = [
    { from: 'process', to: 'decision', lineType: 'smoothstep', label: '平滑折线' },
    { from: 'decision', to: 'rounded', lineType: 'bezier', label: '曲线' },
    { from: 'rounded', to: 'ellipse', lineType: 'straight', label: '直线' },
  ]
  for (const s of samples) {
    const fromId = ids[s.from]
    const toId = ids[s.to]
    if (!fromId || !toId) continue
    g.addEdge(
      buildEdgeMetadata({
        source: fromId,
        target: toId,
        label: s.label,
        data: { lineType: s.lineType, color: '#475569', lineWidth: 1.6, dashed: false, arrow: true },
      }) as any,
    )
  }

  g.zoomToFit({ padding: 40, maxScale: 1 })
})
</script>

<style scoped>
.x6-pg {
  position: relative;
  width: 100%;
  height: 100%;
  background: #f8fafc;
}
.x6-pg-canvas {
  position: relative;
  width: 100%;
  height: 100%;
}
.x6-pg-hint {
  position: absolute;
  z-index: 20;
  top: 8px;
  left: 12px;
  right: 12px;
  font-size: 12px;
  color: #475569;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 6px 10px;
  pointer-events: none;
}
</style>
