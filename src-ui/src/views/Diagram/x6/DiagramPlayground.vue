<template>
  <div class="x6-pg">
    <DiagramToolbar
      v-if="graphReady"
      :properties-open="propertiesOpen"
      @toggle-properties="propertiesOpen = !propertiesOpen"
      @fullscreen="toggleFullscreen"
    />

    <div class="x6-pg-main">
      <div
        ref="containerRef"
        class="x6-pg-canvas"
        :style="{ background: ctxCanvasBg }"
      ></div>

      <DiagramProperties v-if="graphReady && propertiesOpen" />
    </div>

    <div v-if="graphReady" class="x6-pg-pages">
      <button
        v-for="p in pages"
        :key="p.id"
        :class="{ active: p.id === currentPageId }"
        @click="switchPage(p.id)"
      >{{ p.name }}</button>
      <button class="add" @click="addPage">+ 页</button>
    </div>

    <div v-if="!graphReady" class="x6-pg-loading">X6 方案 B 验证台加载中…</div>
  </div>
</template>

<script setup lang="ts">
/**
 * X6 方案 B 隐藏验证台（路由 /diagram-x6-playground）。
 * 覆盖 P1-T2（11 形状 + 3 线型渲染/编辑/连线/resize）+ P1-T3（撤销重做 / 复制粘贴 / 对齐分布 / 自动布局 / 多页）
 * + P1-T4（顶栏 DiagramToolbar + 右侧绘图/样式面板）。
 * 不替换现有 /diagram（Vue Flow），仅本地验证。
 */
import { ref, watch, nextTick, provide } from 'vue'
import { useGraph } from './useGraph'
import { SHAPES } from '../shapeDefs'
import { buildEdgeMetadata } from './edgeFactory'
import { alignNodes, distributeNodes, type AlignMode, type DistributeMode } from './useArrange'
import { autoLayout } from './useAutoLayout'
import { usePages } from './usePages'
import { X6_CTX_KEY, type X6Context } from './context'
import DiagramToolbar from './DiagramToolbar.vue'
import DiagramProperties from './DiagramProperties.vue'

const containerRef = ref<HTMLElement | null>(null)
const canvasBg = ref('#f8fafc')
const propertiesOpen = ref(true)

const { graph, graphReady, canUndo, canRedo, historySize } = useGraph({ containerRef })
const { pages, currentPageId, ensureInit, switchPage, addPage } = usePages(graph)

// 向工具栏 / 属性面板下发 graph 引用与撤销状态（方案 B 解耦：子组件只消费，不持有）
provide(X6_CTX_KEY, {
  graph,
  graphReady,
  canUndo,
  canRedo,
  historySize,
  canvasBg,
} as X6Context)
const ctxCanvasBg = canvasBg

watch(graphReady, async (ready) => {
  if (!ready || !graph.value) return
  await nextTick()
  const g = graph.value

  // 11 种形状按 4 列网格铺开（P1-T2 验收）
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

  // 3 种线型示例边（P1-T2 验收）
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

  // 额外散落矩形，便于演示对齐 / 分布（框选后点工具栏按钮）
  const scatter = [
    { x: 640, y: 40 },
    { x: 760, y: 180 },
    { x: 600, y: 340 },
    { x: 820, y: 460 },
  ]
  scatter.forEach((pos, i) => {
    g.addNode({
      id: `scatter-${i}`,
      shape: 'diagram-rect',
      x: pos.x,
      y: pos.y,
      width: 120,
      height: 60,
      attrs: { body: { fill: '#ECFDF5', stroke: '#16A34A' }, label: { text: `块 ${i + 1}` } },
      data: { label: `块 ${i + 1}`, fill: '#ECFDF5', stroke: '#16A34A', textColor: '#0F172A', width: 120, height: 60 },
    })
  })

  // 多页系统初始化（P1-T3.5）
  ensureInit()
  g.zoomToFit({ padding: 40, maxScale: 1 })
})

function toggleFullscreen() {
  const el = containerRef.value
  if (!el) return
  if (document.fullscreenElement) document.exitFullscreen()
  else el.requestFullscreen?.()
}
</script>

<style scoped>
.x6-pg {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--kb-background, #f8fafc);
}
.x6-pg-main {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
}
.x6-pg-canvas {
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
}
.x6-pg-pages {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-top: 1px solid var(--kb-border, #e2e8f0);
  background: var(--kb-background, #fff);
  overflow-x: auto;
}
.x6-pg-pages button {
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--kb-border, #cbd5e1);
  border-radius: 6px;
  background: var(--kb-muted, #f1f5f9);
  color: var(--kb-foreground, #0f172a);
  cursor: pointer;
  white-space: nowrap;
}
.x6-pg-pages button.active {
  border-color: var(--kb-primary, #3b6fe0);
  background: color-mix(in srgb, var(--kb-primary, #3b6fe0) 12%, transparent);
}
.x6-pg-pages button.add {
  border-style: dashed;
}
.x6-pg-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--kb-muted-foreground, #64748b);
}
</style>
