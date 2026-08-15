<template>
  <div class="x6-toolbar">
    <!-- 撤销 / 重做 -->
    <button class="kb-btn kb-btn-sm" :disabled="!ctx.canUndo.value" title="⌘Z" @click="undo">↶ 撤销</button>
    <button class="kb-btn kb-btn-sm" :disabled="!ctx.canRedo.value" title="⌘⇧Z" @click="redo">↷ 重做</button>
    <span class="x6-toolbar-step" v-if="ctx.historySize.value">{{ ctx.historySize.value }} 步</span>

    <span class="x6-toolbar-sep"></span>

    <!-- 删除 / 层级 -->
    <button class="kb-btn kb-btn-sm kb-btn-danger" :disabled="!sel.hasSelection.value" @click="remove">🗑 删除</button>
    <button class="kb-btn kb-btn-sm" :disabled="!sel.hasSelection.value" title="置前" @click="bringFront">⬆ 置前</button>
    <button class="kb-btn kb-btn-sm" :disabled="!sel.hasSelection.value" title="置后" @click="sendBack">⬇ 置后</button>

    <span class="x6-toolbar-sep"></span>

    <!-- 填充色（节点选中） -->
    <label class="x6-toolbar-color" :class="{ 'is-disabled': !sel.hasNode.value }">
      <span>填充</span>
      <input
        type="color"
        :disabled="!sel.hasNode.value"
        :value="currentFill"
        @input="(e) => setFill((e.target as HTMLInputElement).value)"
      />
    </label>
    <!-- 线条色（节点选中） -->
    <label class="x6-toolbar-color" :class="{ 'is-disabled': !sel.hasNode.value }">
      <span>描边</span>
      <input
        type="color"
        :disabled="!sel.hasNode.value"
        :value="currentStroke"
        @input="(e) => setStroke((e.target as HTMLInputElement).value)"
      />
    </label>
    <!-- 阴影开关（节点选中） -->
    <label class="x6-toolbar-check" :class="{ 'is-disabled': !sel.hasNode.value }">
      <input type="checkbox" :disabled="!sel.hasNode.value" v-model="shadowOn" @change="toggleShadow" />
      <span>阴影</span>
    </label>

    <span class="x6-toolbar-sep"></span>

    <!-- 连线样式（边选中） -->
    <label class="x6-toolbar-select" :class="{ 'is-disabled': !sel.hasEdge.value }">
      <span>线型</span>
      <select :disabled="!sel.hasEdge.value" :value="currentLineType" @change="(e) => setLineType((e.target as HTMLSelectElement).value as any)">
        <option value="smoothstep">平滑折线</option>
        <option value="bezier">曲线</option>
        <option value="straight">直线</option>
      </select>
    </label>
    <!-- 航点开关（边选中） -->
    <button class="kb-btn kb-btn-sm" :disabled="!sel.hasEdge.value" :class="{ 'is-active': waypointOn }" @click="toggleWaypoints">拐点</button>

    <span class="x6-toolbar-sep"></span>

    <!-- 插入 -->
    <button class="kb-btn kb-btn-sm" @click="insertText">＋文本</button>
    <button class="kb-btn kb-btn-sm" @click="insertTable">＋表格</button>

    <span class="x6-toolbar-sep"></span>

    <!-- 结构：容器 / 泳道 / 分组（P2-T2） -->
    <button class="kb-btn kb-btn-sm" title="插入容器节点" @click="insertStruct('container')">▢ 容器</button>
    <button class="kb-btn kb-btn-sm" title="插入泳道节点" @click="insertStruct('swimlane')">▤ 泳道</button>
    <button class="kb-btn kb-btn-sm" :disabled="!sel.hasNode.value" title="把选中节点分组（Ctrl+G）" @click="groupBtn">⊞ 分组</button>

    <span class="x6-toolbar-sep"></span>

    <!-- 高级功能：画笔 / 模板 / AI / 导出 -->
    <button class="kb-btn kb-btn-sm" :class="{ 'is-active': props.penOn }" title="自由画笔（方案 B）" @click="emit('pen-toggle')">✏ 画笔</button>
    <button class="kb-btn kb-btn-sm" @click="emit('open-templates')">▦ 模板</button>
    <button class="kb-btn kb-btn-sm" @click="emit('open-ai')">✨ AI</button>
    <label class="x6-toolbar-select">
      <span>导出</span>
      <select :value="''" @change="(e) => onExport((e.target as HTMLSelectElement).value)">
        <option value="" disabled>格式</option>
        <option value="png">PNG</option>
        <option value="svg">SVG</option>
        <option value="pdf">PDF</option>
      </select>
    </label>

    <span class="x6-toolbar-sep"></span>

    <button class="kb-btn kb-btn-sm" @click="emit('fullscreen')" title="全屏">⛶ 全屏</button>
    <button class="kb-btn kb-btn-sm" :class="{ 'is-active': props.libraryOpen }" @click="emit('toggle-library')">
      ▤ 图形库
    </button>
    <button class="kb-btn kb-btn-sm" :class="{ 'is-active': props.propertiesOpen }" @click="emit('toggle-properties')">
      ⚙ 格式
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * X6 方案 B 顶栏（P1-T4.1）。
 * 所有按钮直接调 graph 方法 / composable，【不】访问 Pinia.nodes/edges；
 * 选中态经 useSelection 派生，无选中时相关按钮 disabled 联动。
 */
import { computed, inject, ref } from 'vue'
import { X6_CTX_KEY, type X6Context } from './context'
import { useSelection } from './useSelection'
import { useStructure } from './useStructure'
import { edgeConnectorRouter, buildEdgeMarker } from './edgeFactory'
import { notify } from '@/utils/toast'
import type { ArrowStyle } from './types'
import type { EdgeLineType } from '../types'
import type { ExportFormat } from './useGraphExport'

const props = defineProps<{ propertiesOpen?: boolean; penOn?: boolean; libraryOpen?: boolean }>()
const emit = defineEmits<{
  (e: 'toggle-properties'): void
  (e: 'toggle-library'): void
  (e: 'fullscreen'): void
  (e: 'pen-toggle'): void
  (e: 'open-templates'): void
  (e: 'open-ai'): void
  (e: 'export', format: ExportFormat): void
}>()

function onExport(format: string) {
  if (format === 'png' || format === 'svg' || format === 'pdf') emit('export', format)
}

const ctx = inject(X6_CTX_KEY) as X6Context
const sel = useSelection(ctx.graph)

function undo() {
  ctx.graph.value?.undo()
}
function redo() {
  ctx.graph.value?.redo()
}
function remove() {
  const g = ctx.graph.value
  if (g && sel.selectedCells.value.length) g.removeCells(sel.selectedCells.value as any)
}
function bringFront() {
  const g = ctx.graph.value
  if (g) sel.selectedCells.value.forEach((c) => (g as any).cellToFront(c as any))
}
function sendBack() {
  const g = ctx.graph.value
  if (g) sel.selectedCells.value.forEach((c) => (g as any).cellToBack(c as any))
}

function applyToNodes(fn: (node: any) => void) {
  const g = ctx.graph.value
  if (!g || !sel.selectedNodes.value.length) return
  g.batchUpdate('node-style', () => sel.selectedNodes.value.forEach((c) => fn(c)))
}
function applyToEdges(fn: (edge: any) => void) {
  const g = ctx.graph.value
  if (!g || !sel.selectedEdges.value.length) return
  g.batchUpdate('edge-style', () => sel.selectedEdges.value.forEach((c) => fn(c)))
}

const currentFill = computed(() => {
  const n = sel.selectedNodes.value[0] as any
  return (n?.attr('body/fill') as string) || '#FFFFFF'
})
const currentStroke = computed(() => {
  const n = sel.selectedNodes.value[0] as any
  return (n?.attr('body/stroke') as string) || '#475569'
})
function setFill(color: string) {
  applyToNodes((n) => n.attr('body/fill', color))
}
function setStroke(color: string) {
  applyToNodes((n) => n.attr('body/stroke', color))
}

const shadowOn = ref(false)
function toggleShadow() {
  applyToNodes((n) => {
    n.attr(
      'body/filter',
      shadowOn.value
        ? { name: 'dropShadow', args: { dx: 2, dy: 2, blur: 4, color: '#00000033' } }
        : null,
    )
  })
}

const currentLineType = computed<EdgeLineType>(() => {
  const e = sel.selectedEdges.value[0] as any
  return (e?.getData()?.lineType as EdgeLineType) || 'smoothstep'
})
function setLineType(t: EdgeLineType) {
  applyToEdges((e) => {
    const { connector, router } = edgeConnectorRouter(t)
    e.setConnector(connector)
    e.setRouter(router)
    const data = e.getData() || {}
    e.setData({ ...data, lineType: t })
  })
}

const waypointOn = ref(false)
function toggleWaypoints() {
  const g = ctx.graph.value
  if (!g) return
  waypointOn.value = !waypointOn.value
  sel.selectedEdges.value.forEach((e: any) => {
    if (waypointOn.value) e.addTools(['vertices', 'segments'])
    else {
      e.removeTools()
    }
  })
}

function insertText() {
  const g = ctx.graph.value
  if (!g) return
  const node = g.addNode({
    shape: 'diagram-text',
    x: 80,
    y: 80,
    width: 160,
    height: 40,
    attrs: {
      label: { text: '文本', fill: '#0F172A', fontSize: 16, textAnchor: 'start', textVerticalAnchor: 'middle' },
    },
    data: { label: '文本' },
  })
  g.select(node)
}
function insertTable() {
  const g = ctx.graph.value
  if (!g) return
  const node = g.addNode({
    shape: 'diagram-table',
    x: 80,
    y: 160,
    width: 200,
    height: 120,
    attrs: { body: { fill: '#FFFFFF', stroke: '#475569' } },
    data: { label: '表格' },
  })
  g.select(node)
}

// ===== 结构节点插入 / 分组（P2-T2）=====
function structApi() {
  const g = ctx.graph.value
  return g ? useStructure(g) : null
}
function insertStruct(kind: 'container' | 'swimlane') {
  const s = structApi()
  if (!s) return
  if (kind === 'container') s.insertContainer()
  else s.insertSwimlane('h')
}
function groupBtn() {
  if (!sel.hasNode.value || sel.selectedNodes.value.length < 2) {
    notify('请先选中 2 个以上节点再分组（或按 Ctrl+G）', 'info')
    return
  }
  structApi()?.groupSelection()
}
</script>

<style scoped>
.x6-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--kb-border, #e2e8f0);
  background: var(--kb-card, #fff);
}
.x6-toolbar .kb-btn.is-active {
  border-color: var(--kb-primary, #3b6fe0);
  background: color-mix(in srgb, var(--kb-primary, #3b6fe0) 12%, transparent);
}
.x6-toolbar-sep {
  width: 1px;
  height: 18px;
  background: var(--kb-border, #e2e8f0);
  margin: 0 2px;
}
.x6-toolbar-step {
  font-size: 11px;
  color: var(--kb-muted-foreground, #64748b);
}
.x6-toolbar-color,
.x6-toolbar-check,
.x6-toolbar-select {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--kb-foreground, #0f172a);
}
.x6-toolbar-color input[type='color'] {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--kb-border, #cbd5e1);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
.x6-toolbar-select select {
  height: 28px;
  border: 1px solid var(--kb-border, #cbd5e1);
  border-radius: 6px;
  background: var(--kb-card, #fff);
  font-size: 12px;
}
.x6-toolbar-color.is-disabled,
.x6-toolbar-check.is-disabled,
.x6-toolbar-select.is-disabled {
  opacity: 0.5;
}
</style>
