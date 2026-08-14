<template>
  <div class="x6-pg">
    <div v-if="graphReady" class="x6-pg-toolbar">
      <button :disabled="!canUndo" @click="undo" title="⌘Z">↶ 撤销</button>
      <button :disabled="!canRedo" @click="redo" title="⌘⇧Z">↷ 重做</button>
      <span v-if="historySize" class="step">步数 {{ historySize }}</span>
      <span class="sep"></span>
      <button @click="copySel">复制</button>
      <button @click="pasteSel">粘贴</button>
      <button @click="deleteSel">删除</button>
      <span class="sep"></span>
      <span class="grp">对齐</span>
      <button @click="align('left')">左</button>
      <button @click="align('right')">右</button>
      <button @click="align('top')">上</button>
      <button @click="align('bottom')">下</button>
      <button @click="align('hcenter')">水平中</button>
      <button @click="align('vcenter')">垂直中</button>
      <span class="sep"></span>
      <span class="grp">分布</span>
      <button @click="distribute('hdistribute')">水平</button>
      <button @click="distribute('vdistribute')">垂直</button>
      <span class="sep"></span>
      <span class="grp">布局</span>
      <button @click="layout('TB')">纵向</button>
      <button @click="layout('LR')">横向</button>
    </div>

    <div ref="containerRef" class="x6-pg-canvas"></div>

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
 * 覆盖 P1-T2（11 形状 + 3 线型渲染/编辑/连线/resize）+ P1-T3（撤销重做 / 复制粘贴 / 对齐分布 / 自动布局 / 多页）。
 * 不替换现有 /diagram（Vue Flow），仅本地验证。
 */
import { ref, watch, nextTick } from 'vue'
import { useGraph } from './useGraph'
import { SHAPES } from '../shapeDefs'
import { buildEdgeMetadata } from './edgeFactory'
import { alignNodes, distributeNodes, type AlignMode, type DistributeMode } from './useArrange'
import { autoLayout } from './useAutoLayout'
import { usePages } from './usePages'

const containerRef = ref<HTMLElement | null>(null)
const { graph, graphReady, canUndo, canRedo, historySize } = useGraph({ containerRef })
const { pages, currentPageId, ensureInit, switchPage, addPage } = usePages(graph)

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

// ===== 工具栏动作（P1-T3 验证）=====
function undo() {
  graph.value?.undo()
}
function redo() {
  graph.value?.redo()
}
function copySel() {
  const c = graph.value?.getSelectedCells()
  if (c && c.length && graph.value) graph.value.copy(c)
}
function pasteSel() {
  const gg = graph.value
  if (gg && !gg.isClipboardEmpty()) {
    const p = gg.paste({ offset: 24 })
    gg.cleanSelection()
    gg.select(p)
  }
}
function deleteSel() {
  const c = graph.value?.getSelectedCells()
  if (c && c.length && graph.value) graph.value.removeCells(c)
}
function align(m: AlignMode) {
  if (graph.value) alignNodes(graph.value, m)
}
function distribute(m: DistributeMode) {
  if (graph.value) distributeNodes(graph.value, m)
}
function layout(dir: 'TB' | 'LR') {
  if (graph.value) autoLayout(graph.value, dir)
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
.x6-pg-toolbar {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--kb-border, #e2e8f0);
  background: var(--kb-background, #fff);
}
.x6-pg-toolbar button {
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--kb-border, #cbd5e1);
  border-radius: 6px;
  background: var(--kb-muted, #f1f5f9);
  color: var(--kb-foreground, #0f172a);
  cursor: pointer;
}
.x6-pg-toolbar button:hover:not(:disabled) {
  border-color: var(--kb-primary, #3b6fe0);
  color: var(--kb-primary, #3b6fe0);
}
.x6-pg-toolbar button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.x6-pg-toolbar .sep {
  width: 1px;
  height: 18px;
  background: var(--kb-border, #e2e8f0);
  margin: 0 2px;
}
.x6-pg-toolbar .grp {
  font-size: 11px;
  color: var(--kb-muted-foreground, #64748b);
}
.x6-pg-toolbar .step {
  font-size: 11px;
  color: var(--kb-muted-foreground, #64748b);
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
