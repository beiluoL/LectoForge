<template>
  <div class="mm-flow">
    <!-- 左侧形状面板：可拖入画布，也可直接点击加到视图中心 -->
    <aside class="mm-flow-palette">
      <p class="mm-palette-title">基础图形</p>
      <button
        v-for="s in SHAPES"
        :key="s.type"
        type="button"
        class="mm-palette-item"
        draggable="true"
        :title="`拖入画布，或点击直接添加：${s.label}`"
        @dragstart="onPaletteDragStart(s.type, $event)"
        @click="addNodeAtCenter(s.type)"
      >
        <span class="mm-shape-preview" :class="`is-${s.type}`" />
        <span>{{ s.label }}</span>
      </button>

      <p class="mm-palette-title" style="margin-top: var(--kb-space-4);">连线样式</p>
      <select v-model="edgeType" class="kb-select mm-palette-select">
        <option value="smoothstep">折线（直角）</option>
        <option value="bezier">曲线</option>
        <option value="straight">直线</option>
      </select>

      <div class="mm-palette-actions">
        <button type="button" class="kb-btn kb-btn-sm" title="按大纲层级自动生成流程图" @click="fromOutline">
          <Icon name="list-tree" size="xs" /> 从大纲生成
        </button>
        <button type="button" class="kb-btn kb-btn-sm kb-btn-danger" @click="clearAll">
          <Icon name="trash-2" size="xs" /> 清空画布
        </button>
      </div>

      <p class="mm-palette-tip">
        双击节点改文字<br />
        拖节点边缘圆点连线<br />
        选中后 <kbd>Delete</kbd> 删除
      </p>
    </aside>

    <!-- 画布 -->
    <div class="mm-flow-canvas" @drop="onDrop" @dragover.prevent @contextmenu.prevent="onCanvasContextMenu">
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        :connection-mode="ConnectionMode.Loose"
        :delete-key-code="editingId ? null : ['Delete', 'Backspace']"
        :default-edge-options="defaultEdgeOptions"
        :min-zoom="0.2"
        :max-zoom="2.5"
        :snap-to-grid="true"
        :snap-grid="[8, 8]"
        fit-view-on-init
        @connect="onConnect"
        @node-double-click="onNodeDoubleClick"
      >
        <Background :gap="16" :size="1.4" pattern-color="var(--kb-border)" />
        <Controls position="bottom-right" :show-interactive="false" />

        <!-- 五种形状共用一个渲染模板，差异全交给 CSS 类 -->
        <template v-for="s in SHAPES" #[`node-${s.type}`]="props" :key="s.type">
          <div
            class="mm-node"
            :class="[`is-${s.type}`, { 'is-selected': props.selected, 'is-editing': editingId === props.id }]"
          >
            <span class="mm-node-shape" />
            <div
              v-if="editingId === props.id"
              :ref="setEditorEl"
              class="mm-node-label mm-node-input"
              contenteditable="plaintext-only"
              spellcheck="false"
              @keydown.stop="onLabelKeydown(props.id, $event)"
              @blur="commitLabel(props.id, $event)"
            />
            <span v-else class="mm-node-label">{{ props.data.label || '双击编辑' }}</span>

            <Handle type="source" :position="Position.Top" class="mm-handle" />
            <Handle type="source" :position="Position.Right" class="mm-handle" />
            <Handle type="source" :position="Position.Bottom" class="mm-handle" />
            <Handle type="source" :position="Position.Left" class="mm-handle" />
          </div>
        </template>
      </VueFlow>

      <!-- 右键菜单 -->
      <div
        v-if="menu.open"
        class="mm-context-menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @mouseleave="menu.open = false"
      >
        <p class="mm-context-title">在此处添加</p>
        <button v-for="s in SHAPES" :key="s.type" type="button" @click="addNodeFromMenu(s.type)">
          <span class="mm-shape-preview" :class="`is-${s.type}`" />{{ s.label }}
        </button>
      </div>

      <p v-if="!nodes.length" class="mm-flow-empty">
        从左侧拖入图形开始绘制，或点击「从大纲生成」
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 流程图编辑器（基于 @vue-flow/core）
 *
 * 【连接模式为什么用 Loose】
 * 严格模式下 source 只能连 target，用户必须记住「从哪个点拖出、往哪个点拖入」。
 * Loose 模式下四个圆点都能互相连，符合 ProcessOn / draw.io 的直觉。
 *
 * 【Delete 键的冲突】
 * vue-flow 的 deleteKeyCode 是全局键盘监听。双击节点进入文本编辑后，用户按退格本意是删字，
 * 却会把整个节点删掉。所以编辑态下把 deleteKeyCode 置空，退出编辑再恢复。
 *
 * 【为什么不直接把 store 的数组绑给 VueFlow】
 * VueFlow 会在节点对象上挂 computedPosition / handleBounds / dimensions 等运行时字段，
 * 直接持久化会把这些内部状态一起写进文件。这里保持本地 ref，落库前用 toPlain 只挑业务字段。
 */
import {
  computed,
  nextTick,
  onMounted,
  reactive,
  ref,
  watch,
  type ComponentPublicInstance,
} from 'vue'

import {
  ConnectionMode,
  Handle,
  MarkerType,
  Position,
  VueFlow,
  useVueFlow,
  type Connection,
  type Node,
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

import Icon from '@/components/ui/Icon.vue'
import { notify } from '@/utils/toast'

import { buildFlowFromOutline, mapState } from '../useMindMapStore'

type ShapeType = 'rect' | 'rounded' | 'diamond' | 'ellipse' | 'parallelogram'

const SHAPES: { type: ShapeType; label: string }[] = [
  { type: 'rect', label: '处理（矩形）' },
  { type: 'rounded', label: '开始/结束' },
  { type: 'diamond', label: '判断（菱形）' },
  { type: 'ellipse', label: '节点（椭圆）' },
  { type: 'parallelogram', label: '数据（平行四边形）' },
]

const { addEdges, screenToFlowCoordinate, fitView, getSelectedNodes } = useVueFlow()

// 实测确认：在 nodes / edges 上做 .map 或展开再赋给 Node[] / Edge[] 会触发 TS2589
// （vue-flow 的 Node / Edge 在赋值与类型实例化链路上展开过深，非输入类型本身递归）。
// 故这里用 any[] 承接，v-model 仍能被 VueFlow 的 Node[] / Edge[] prop 接受
// （any 可赋值给具体类型）。其余局部 any（map 回调参数、PlainNode/PlainEdge 字段等）
// 已在本次重构中收窄为具体类型。
const nodes = ref<any[]>([])
const edges = ref<any[]>([])
const edgeType = ref<'smoothstep' | 'bezier' | 'straight'>('smoothstep')
const editingId = ref('')
const menu = reactive({ open: false, x: 0, y: 0, flowX: 0, flowY: 0 })

/* 必须是 computed：写成普通对象字面量的话，edgeType 这个 ref 会被原样塞进对象，
 * VueFlow 拿到的是 RefImpl 而不是字符串，切换连线样式不会生效。 */
const defaultEdgeOptions = computed(() => ({
  type: edgeType.value,
  markerEnd: MarkerType.ArrowClosed,
  style: { stroke: 'var(--kb-muted-foreground)', strokeWidth: 1.6 },
}))

let seq = 0
function newId(prefix: string) {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`
}

// ===================== store ↔ 画布 =====================

/** 只挑业务字段落库，剔除 vue-flow 挂上来的运行时状态。 */
interface PlainNode {
  id: string
  type?: string | null
  position: { x: number; y: number }
  data?: { label?: unknown }
}
interface PlainEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  type?: string | null
  label?: unknown
}
function toPlain() {
  const srcNodes = nodes.value as PlainNode[]
  const srcEdges = edges.value as PlainEdge[]
  return {
    nodes: srcNodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      data: { label: String(n.data?.label ?? '') },
    })),
    edges: srcEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      type: e.type,
      label: e.label,
      markerEnd: MarkerType.ArrowClosed,
    })),
  }
}

/** 从 store 载入到画布（切换文档 / 从大纲生成时） */
function loadFromStore() {
  const data = mapState.flowchartData || { nodes: [], edges: [] }
  nodes.value = (data.nodes || []).map((n) => ({
    id: String(n.id),
    type: (SHAPES.some((s) => s.type === n.type) ? n.type : 'rect') as string,
    position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 },
    data: { label: String(n.data?.label ?? '') },
  }))
  edges.value = (data.edges || []).map((e) => ({
    id: String(e.id || newId('e')),
    source: String(e.source),
    target: String(e.target),
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    type: e.type || edgeType.value,
    label: e.label == null ? undefined : String(e.label),
    markerEnd: MarkerType.ArrowClosed,
  }))
  void nextTick(() => {
    if (nodes.value.length) fitView({ padding: 0.2 })
  })
}

onMounted(loadFromStore)
// 切换文档时重载画布（activeMapId 变化即视为换了一份文档）
watch(() => mapState.activeMapId, loadFromStore)

/** 画布改动回写 store，交由 store 的防抖自动保存落盘 */
watch(
  [nodes, edges],
  () => {
    mapState.flowchartData = toPlain()
  },
  { deep: true },
)

// ===================== 节点增删改 =====================

function createNode(type: ShapeType, position: { x: number; y: number }): Node {
  const label = type === 'diamond' ? '条件？' : type === 'rounded' ? '开始' : '新节点'
  return { id: newId('n'), type, position, data: { label } }
}

/** 追加节点 */
function addNode(node: Node) {
  nodes.value = [...nodes.value, node]
}

function addNodeAtCenter(type: ShapeType) {
  const el = document.querySelector('.mm-flow-canvas')
  const rect = el?.getBoundingClientRect()
  const pos = rect
    ? screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 })
    : { x: 200, y: 120 }
  addNode(createNode(type, pos))
}

function onPaletteDragStart(type: ShapeType, e: DragEvent) {
  e.dataTransfer?.setData('application/mm-shape', type)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  const type = e.dataTransfer?.getData('application/mm-shape') as ShapeType
  if (!type) return
  const position = screenToFlowCoordinate({ x: e.clientX, y: e.clientY })
  addNode(createNode(type, position))
}

function onCanvasContextMenu(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  menu.open = true
  menu.x = e.clientX - rect.left
  menu.y = e.clientY - rect.top
  const flow = screenToFlowCoordinate({ x: e.clientX, y: e.clientY })
  menu.flowX = flow.x
  menu.flowY = flow.y
}

function addNodeFromMenu(type: ShapeType) {
  addNode(createNode(type, { x: menu.flowX, y: menu.flowY }))
  menu.open = false
}

function onConnect(params: Connection) {
  addEdges([
    {
      ...params,
      id: newId('e'),
      type: edgeType.value,
      markerEnd: MarkerType.ArrowClosed,
    },
  ])
}

// ===================== 双击编辑文本 =====================

/** 进入编辑态后把当前文案塞进可编辑区并全选，直接敲字即覆盖 */
function setEditorEl(el: Element | ComponentPublicInstance | null) {
  if (!el || !(el instanceof HTMLElement)) return
  const node = nodes.value.find((n) => n.id === editingId.value)
  el.innerText = String(node?.data?.label ?? '')
  void nextTick(() => {
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  })
}

function onNodeDoubleClick({ node }: { node: Node }) {
  editingId.value = node.id
}

function commitLabel(id: string, e: Event) {
  const text = (e.target as HTMLElement).innerText.replace(/[\r\n]+/g, ' ').trim()
  nodes.value = nodes.value.map((n) =>
    n.id === id ? { ...n, data: { ...n.data, label: text } } : n,
  ) as unknown as Node[]
  editingId.value = ''
}

function onLabelKeydown(id: string, e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return
  if (e.key === 'Enter') {
    e.preventDefault()
    ;(e.target as HTMLElement).blur()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    editingId.value = ''
  }
}

// ===================== 批量操作 =====================

function fromOutline() {
  const flow = buildFlowFromOutline()
  if (!flow.nodes.length) {
    notify('大纲还是空的，先去写几行', 'warning')
    return
  }
  mapState.flowchartData = flow
  loadFromStore()
  notify(`已按大纲生成 ${flow.nodes.length} 个节点`, 'success')
}

function clearAll() {
  nodes.value = []
  edges.value = []
  notify('画布已清空', 'info')
}

defineExpose({ fitView, getSelectedNodes })
</script>
