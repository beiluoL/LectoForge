<template>
  <div class="x6-pg">
    <DiagramToolbar
      v-if="graphReady"
      :properties-open="propertiesOpen"
      :library-open="libraryOpen"
      :pen-on="penOn"
      @toggle-properties="propertiesOpen = !propertiesOpen"
      @toggle-library="libraryOpen = !libraryOpen"
      @fullscreen="toggleFullscreen"
      @pen-toggle="onPenToggle"
      @open-templates="showTemplates = true"
      @open-ai="showAi = true"
      @export="doExport"
      @import="triggerImport"
      @insert-image="triggerImagePick"
      @open-history="showHistory = true"
      @open-find="showFind = true"
    />

    <div class="x6-pg-main">
      <DiagramLibrary v-if="graphReady && libraryOpen" @arm-edge="onArmEdge" @insert-image="triggerImagePick" />

      <div class="x6-pg-canvas-wrap">
        <div ref="containerRef" class="x6-pg-canvas" :style="{ background: ctxCanvasBg }"></div>

        <!-- 悬停提示气泡（P2-T5.2：hover ≥500ms 显示，定位在画布容器内） -->
        <div v-if="tip.show" class="x6-tip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">{{ tip.text }}</div>

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

      <DiagramRightPanel v-if="graphReady && propertiesOpen" />
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

    <!-- 版本历史抽屉（P2-T3.1） / 查找替换面板（P2-T3.2） -->
    <DiagramVersionHistory
      v-if="graphReady && showHistory && diagramId"
      :diagram-id="diagramId"
      @close="showHistory = false"
      @restored="onHistoryRestored"
    />
    <DiagramFindReplace v-if="graphReady && showFind" @close="showFind = false" />

    <!-- 隐藏的文件选择器：draw.io XML 导入（P2-T4.2） -->
    <input
      ref="fileInput"
      type="file"
      accept=".drawio,.xml,application/xml,text/xml"
      style="display: none"
      @change="onFileChange"
    />

    <!-- 隐藏的图片选择器：插入图片节点（P2-T5.1，Tauri webview 内即系统原生选择器） -->
    <input
      ref="imageInput"
      type="file"
      accept="image/*"
      style="display: none"
      @change="onImageFileChange"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * X6 方案 B 隐藏验证台（路由 /diagram-x6-playground）。
 * 覆盖 P1-T2（11 形状 + 3 线型）/ P1-T3（撤销/复制/对齐/布局/多页）/ P1-T4（工具栏 + 属性面板）
 * + P1-T5（画笔 / 模板 / AI / 导出 / 持久化）。
 * 不替换现有 /diagram（Vue Flow），仅本地验证。
 */
import { ref, watch, nextTick, provide, onBeforeUnmount } from 'vue'
import { useGraph } from './useGraph'
import { SHAPES } from '../shapeDefs'
import { buildEdgeMetadata, buildUmlEdgeMetadata } from './edgeFactory'
import type { UmlRelationType } from '../shapeDefs'
import { UML_RELATIONS } from '../shapeDefs'
import { usePages } from './usePages'
import { usePenMode } from './usePenMode'
import { templateToX6Cells } from './templatesToCells'
import { applyAiGraph, isValidAiGraph } from './useAiGenerate'
import { exportDiagram, exportPdfMulti, type ExportFormat } from './useGraphExport'
import { useGraphPersistence } from './useGraphPersistence'
import { useDrawioIo } from './useDrawioIo'
import { X6_CTX_KEY, type X6Context } from './context'
import DiagramToolbar from './DiagramToolbar.vue'
import DiagramLibrary from './DiagramLibrary.vue'
import DiagramRightPanel from './DiagramRightPanel.vue'
import DiagramVersionHistory from './DiagramVersionHistory.vue'
import DiagramFindReplace from './DiagramFindReplace.vue'
import DiagramTemplateModal from '../components/DiagramTemplateModal.vue'
import DiagramAiModal from '../components/DiagramAiModal.vue'
import type { DiagramTemplate } from '../templates'
import type { AiDiagramNode, AiDiagramEdge } from '@/api/diagram'
import { notify } from '@/utils/toast'
import { invoke } from '@tauri-apps/api/core'

const containerRef = ref<HTMLElement | null>(null)
const canvasBg = ref('#f8fafc')
const propertiesOpen = ref(true)
const libraryOpen = ref(true)
const showTemplates = ref(false)
const showAi = ref(false)
const showHistory = ref(false)
const showFind = ref(false)

const { graph, graphReady, canUndo, canRedo, historySize } = useGraph({ containerRef })
const { pages, currentPageId, ensureInit, switchPage, addPage, loadPages } = usePages(graph)
const pen = usePenMode(graph, containerRef)
const penOn = pen.penMode
const penPreview = pen.previewPath
const penBegin = pen.beginStroke
const { saving, lastSavedAt, diagramId, ensureDiagram, bindAutoSave, bindHistory, flush, setAutoSavePaused, reload } =
  useGraphPersistence(graph, {
    serialize: () => serializePages(),
  })
const drawio = useDrawioIo(graph, { serialize: () => pages.value, loadPages, currentPageId })

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

/** UML 关系边「点两节点连边」工具（P2-T1.3） */
const armedRelation = ref<UmlRelationType | null>(null)
let pendingSource: string | null = null
function onArmEdge(rel: UmlRelationType) {
  armedRelation.value = rel
  pendingSource = null
  const label = UML_RELATIONS.find((r) => r.type === rel)?.label || rel
  notify(`已选「${label}」：先点源节点，再点目标节点`, 'info')
}

function doExport(format: ExportFormat | 'drawio') {
  if (format === 'drawio') {
    downloadDrawio()
    return
  }
  if (format === 'pdf') {
    const cur = pages.value.find((p) => p.id === currentPageId.value) || pages.value[0]
    void exportPdfMulti(graph.value, pages.value, 'diagram', {
      pause: () => setAutoSavePaused(true),
      resume: () => setAutoSavePaused(false),
      restore: { data: cur?.data },
    })
    return
  }
  exportDiagram(graph.value, format, 'diagram')
}

/** 导出当前多页为 draw.io XML 并触发下载（P2-T4.3） */
function downloadDrawio() {
  const { xml, degraded, skipped } = drawio.exportXml()
  downloadBlob('diagram.drawio', xml, 'application/xml')
  if (degraded > 0 || skipped > 0) {
    const parts: string[] = []
    if (degraded > 0) parts.push(`${degraded} 个图形无对应已降级为矩形`)
    if (skipped > 0) parts.push(`${skipped} 个页面底图/画笔节点已跳过`)
    notify(`已导出 draw.io：${parts.join('，')}`, 'info')
  } else {
    notify('已导出 draw.io XML', 'success')
  }
}

const fileInput = ref<HTMLInputElement | null>(null)
function triggerImport() {
  fileInput.value?.click()
}
async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选同一文件
  if (!file) return
  try {
    const text = await file.text()
    const warnings = drawio.applyImportedXml(text)
    if (warnings.length) notify(`导入完成：${warnings.join('；')}`, 'info')
    else notify(`已导入 ${file.name}`, 'success')
    void flush()
  } catch (err) {
    console.error('[import] draw.io 解析失败', err)
    notify('导入失败：文件可能不是有效的 draw.io XML', 'error')
  }
}

/** 通用 Blob 下载（draw.io XML 用） */
function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ===== P2-T5.1 图片节点：文件选择 / 剪贴板粘贴 / 创建 =====
const imageInput = ref<HTMLInputElement | null>(null)

function triggerImagePick() {
  imageInput.value?.click()
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function onImageFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选同一文件
  if (!file) return
  try {
    const url = await fileToDataUrl(file)
    addImageNode(url)
  } catch {
    notify('图片读取失败', 'error')
  }
}

function addImageNode(dataUrl: string) {
  const g = graph.value
  if (!g || !containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const center = g.clientToLocal(rect.left + rect.width / 2, rect.top + rect.height / 2)
  const node = g.addNode({
    shape: 'diagram-image',
    x: Math.round(center.x - 90),
    y: Math.round(center.y - 70),
    width: 180,
    height: 140,
    attrs: {
      body: { fill: '#FFFFFF', stroke: '#475569' },
      image: { 'xlink:href': dataUrl },
    },
    data: { imageUrl: dataUrl, label: '' },
  })
  g.select(node)
}

// 剪贴板粘贴图片 → 创建图片节点（P2-T5.1）
function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const it of Array.from(items)) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const file = it.getAsFile()
      if (file) {
        e.preventDefault()
        fileToDataUrl(file)
          .then(addImageNode)
          .catch(() => notify('图片读取失败', 'error'))
      }
      break
    }
  }
}

// ===== P2-T5.2 悬停提示气泡 + Ctrl/Cmd 点击超链接 =====
const tip = ref<{ show: boolean; x: number; y: number; text: string }>({ show: false, x: 0, y: 0, text: '' })
let tipTimer: number | null = null

function clearTip() {
  if (tipTimer !== null) {
    clearTimeout(tipTimer)
    tipTimer = null
  }
  tip.value.show = false
}

function showTipFor(cell: any) {
  const g = graph.value
  const wrap = containerRef.value
  if (!g || !wrap) return
  const bbox = cell.getBBox()
  const tl = g.localToClient({ x: bbox.x, y: bbox.y })
  const wr = wrap.getBoundingClientRect()
  tip.value = { show: true, x: tl.x - wr.left, y: tl.y - wr.top - 10, text: cell.getData()?.tooltip || '' }
}

function onCellEnter(payload: any) {
  const cell = payload.cell
  const data = cell?.getData?.()
  if (!data?.tooltip) return
  clearTip()
  tipTimer = window.setTimeout(() => showTipFor(cell), 500)
}

function onCellLeave() {
  clearTip()
}

function openExternal(url: string) {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    void invoke('open_external_url', { url })
  } else {
    window.open(url, '_blank', 'noopener')
  }
}

function onCellClick(payload: any) {
  const cell = payload.cell
  const data = cell?.getData?.()
  if (!data?.href) return
  const e = payload.e as MouseEvent
  if (e && (e.metaKey || e.ctrlKey)) openExternal(data.href)
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

/** 版本历史恢复后：用后端最新数据刷新画布（恢复接口已存「恢复前自动备份」安全快照） */
async function onHistoryRestored() {
  const g = graph.value
  const res = await reload()
  if (!g || !res || !res.pages.length) return
  const cur = res.pages.find((p) => p.id === res.currentId) || res.pages[0]
  loadPages(res.pages, res.currentId)
  g.fromJSON(cur.data || { cells: [] })
  g.cleanHistory()
  g.zoomToFit({ padding: 40, maxScale: 1 })
}

/** Ctrl/Cmd+F 唤起查找替换（画布未聚焦时也生效） */
function onFindKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault()
    showFind.value = true
  }
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

  // UML 关系边工具：武装后点击两节点连边（1 步 history）
  g.on('node:click', ({ node }: any) => {
    if (!armedRelation.value) return
    if (!pendingSource) {
      pendingSource = node.id
      node.attr('body/stroke', '#3b6fe0')
      node.attr('body/strokeWidth', 2.5)
    } else if (node.id !== pendingSource) {
      const meta = buildUmlEdgeMetadata({ source: pendingSource, target: node.id, relation: armedRelation.value })
      const src = g.getCellById(pendingSource)
      src?.attr('body/stroke', '#475569')
      src?.attr('body/strokeWidth', 1.5)
      g.batchUpdate('uml-edge', () => {
        const e = g.addEdge(meta as any)
        g.select(e)
      })
      pendingSource = null
      armedRelation.value = null
    }
  })

  // 自动保存 + 历史快照（30s 节流）绑定，Ctrl+S 立即保存并记一条「手动保存」快照
  bindAutoSave()
  bindHistory()
  g.bindKey(['meta+s', 'ctrl+s'], () => {
    flush(true)
    return false
  })
  window.addEventListener('beforeunload', () => {
    flush()
  })
  window.addEventListener('keydown', onFindKey)

  // P2-T5.2：悬停提示气泡 + Ctrl/Cmd 点击超链接
  g.on('cell:mouseenter', onCellEnter)
  g.on('cell:mouseleave', onCellLeave)
  g.on('cell:click', onCellClick)
  window.addEventListener('paste', onPaste as any)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onFindKey)
  window.removeEventListener('paste', onPaste as any)
  clearTip()
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
/* 悬停提示气泡（P2-T5.2）：绝对定位在画布容器内，跟随 cell bbox 顶部上方 */
.x6-tip {
  position: absolute;
  z-index: 20;
  max-width: 260px;
  transform: translateY(-100%);
  padding: 5px 9px;
  border-radius: 6px;
  background: #0f172a;
  color: #f8fafc;
  font-size: 12px;
  line-height: 1.4;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  pointer-events: none;
  white-space: pre-wrap;
  word-break: break-word;
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
/* 参考线（Snapline）粉色强化：X6 的 snapline 是动态注入到画布容器内的 <line>，
 * 默认无描边或蓝色，这里统一覆盖为 #FF5C93 / 2px（P2-T3.3）。 */
.x6-pg :deep(.x6-widget-snapline-vertical),
.x6-pg :deep(.x6-widget-snapline-horizontal) {
  stroke: #ff5c93;
  stroke-width: 2;
  pointer-events: none;
}
</style>
