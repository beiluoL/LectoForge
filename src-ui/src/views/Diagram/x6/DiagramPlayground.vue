<template>
  <div class="x6-pg">
    <DiagramToolbar
      v-if="graphReady"
      :properties-open="propertiesOpen"
      :pen-on="penOn"
      @toggle-properties="propertiesOpen = !propertiesOpen"
      @fullscreen="toggleFullscreen"
      @pen-toggle="onPenToggle"
      @open-templates="showTemplates = true"
      @open-ai="showAi = true"
      @export="doExport"
    />

    <div class="x6-pg-main">
      <div class="x6-pg-canvas-wrap">
        <div ref="containerRef" class="x6-pg-canvas" :style="{ background: ctxCanvasBg }"></div>

        <!-- 自由画笔覆盖层（方案 B：仅在 penMode 显示，起笔 mousedown/touchstart，move/up 挂 document） -->
        <div
          v-if="penOn"
          class="pen-overlay"
          @mousedown="penBegin"
          @touchstart.prevent="penBegin"
        >
          <svg class="pen-preview"><path :d="penPreview" /></svg>
        </div>
      </div>

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
      <span class="x6-pg-save" v-if="saving">保存中…</span>
      <span class="x6-pg-save" v-else-if="lastSavedAt">已存 {{ lastSavedAt }}</span>
    </div>

    <div v-if="!graphReady" class="x6-pg-loading">X6 方案 B 验证台加载中…</div>

    <DiagramTemplateModal v-if="showTemplates" @applied="applyTemplate" @close="showTemplates = false" />
    <DiagramAiModal v-if="showAi" @generated="onAiGenerated" @close="showAi = false" />
  </div>
</template>

<script setup lang="ts">
/**
 * X6 方案 B 隐藏验证台（路由 /diagram-x6-playground）。
 * 覆盖 P1-T2（11 形状 + 3 线型）/ P1-T3（撤销/复制/对齐/布局/多页）/ P1-T4（工具栏 + 属性面板）
 * + P1-T5（画笔 / 模板 / AI / 导出 / 持久化）。
 * 不替换现有 /diagram（Vue Flow），仅本地验证。
 */
import { ref, watch, nextTick, provide } from 'vue'
import { useGraph } from './useGraph'
import { SHAPES } from '../shapeDefs'
import { buildEdgeMetadata } from './edgeFactory'
import { usePages } from './usePages'
import { usePenMode } from './usePenMode'
import { templateToX6Cells } from './templatesToCells'
import { applyAiGraph, isValidAiGraph } from './useAiGenerate'
import { exportDiagram, type ExportFormat } from './useGraphExport'
import { useGraphPersistence } from './useGraphPersistence'
import { X6_CTX_KEY, type X6Context } from './context'
import DiagramToolbar from './DiagramToolbar.vue'
import DiagramProperties from './DiagramProperties.vue'
import DiagramTemplateModal from '../components/DiagramTemplateModal.vue'
import DiagramAiModal from '../components/DiagramAiModal.vue'
import type { DiagramTemplate } from '../templates'
import type { AiDiagramNode, AiDiagramEdge } from '@/api/diagram'
import { notify } from '@/utils/toast'

const containerRef = ref<HTMLElement | null>(null)
const canvasBg = ref('#f8fafc')
const propertiesOpen = ref(true)
const showTemplates = ref(false)
const showAi = ref(false)

const { graph, graphReady, canUndo, canRedo, historySize } = useGraph({ containerRef })
const { pages, currentPageId, ensureInit, switchPage, addPage, loadPages } = usePages(graph)
const pen = usePenMode(graph, containerRef)
const penOn = pen.penMode
const penPreview = pen.previewPath
const penBegin = pen.beginStroke
const { saving, lastSavedAt, ensureDiagram, bindAutoSave, flush } = useGraphPersistence(graph, {
  serialize: () => serializePages(),
})

function serializePages() {
  return pages.value
}

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

function onPenToggle() {
  penOn.value = !penOn.value
}

function doExport(format: ExportFormat) {
  exportDiagram(graph.value, format, 'diagram')
}

/** 套用模板：非空确认 → 清屏 + fromJSON + 1 步 history + zoomToFit */
function applyTemplate(tpl: DiagramTemplate) {
  const g = graph.value
  if (!g) return
  if (g.getCells().length && !window.confirm('套用模板将替换当前画布内容，确定？')) {
    showTemplates.value = false
    return
  }
  const { cells } = templateToX6Cells(tpl)
  g.batchUpdate('applyTemplate', () => {
    g.clearCells()
    ;(g as any).addCells(cells)
  })
  g.zoomToFit({ padding: 40, maxScale: 1 })
  showTemplates.value = false
}

/** AI 生成回调：type guard 校验 → 加 cells + 自动布局 */
function onAiGenerated(payload: { nodes: AiDiagramNode[]; edges: AiDiagramEdge[]; layout: 'TB' | 'LR'; mock?: boolean }) {
  const res = { nodes: payload.nodes, edges: payload.edges, mock: payload.mock }
  if (!isValidAiGraph(res)) {
    notify('AI 返回结构不合法，请重试', 'error')
    showAi.value = false
    return
  }
  applyAiGraph(graph, res, payload.layout)
  if (payload.mock) notify('未配置 AI 服务，已生成示例流程图', 'info')
  showAi.value = false
}

function toggleFullscreen() {
  const el = containerRef.value
  if (!el) return
  if (document.fullscreenElement) document.exitFullscreen()
  else el.requestFullscreen?.()
}

/** 种子 demo 内容（全新文档首次打开，用于验收 P1-T2~T4） */
function seedDemo(g: any) {
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
}

watch(graphReady, async (ready) => {
  if (!ready || !graph.value) return
  await nextTick()
  const g = graph.value

  // ===== 持久化：取文档 id（复用 localStorage 里的 / 新建）+ 载入已存内容（旧 VueFlow 文档在此迁移）=====
  const res = await ensureDiagram()
  if (res.pages && res.pages.length) {
    const cur = res.pages.find((p) => p.id === res.currentId) || res.pages[0]
    loadPages(res.pages, res.currentId)
    g.fromJSON(cur.data || { cells: [] })
    g.cleanHistory()
  } else {
    // 全新文档：种子 demo（之后自动保存把它落库）
    seedDemo(g)
    ensureInit()
  }

  g.zoomToFit({ padding: 40, maxScale: 1 })

  // 自动保存绑定 + Ctrl+S 立即保存 + 关窗兜底
  bindAutoSave()
  g.bindKey(['meta+s', 'ctrl+s'], () => {
    flush()
    return false
  })
  window.addEventListener('beforeunload', () => {
    flush()
  })
})
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
.x6-pg-canvas-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}
.x6-pg-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.pen-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  cursor: crosshair;
  touch-action: none;
}
.pen-preview {
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.pen-preview path {
  fill: none;
  stroke: #475569;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
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
.x6-pg-save {
  font-size: 11px;
  color: var(--kb-muted-foreground, #64748b);
  margin-left: 8px;
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
