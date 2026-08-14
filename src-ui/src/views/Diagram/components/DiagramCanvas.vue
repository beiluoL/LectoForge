<template>
  <div
    ref="canvasEl"
    class="lf-canvas"
    @drop="onDrop"
    @dragover.prevent
  >
    <VueFlow
      v-model:nodes="nodes"
      v-model:edges="edges"
      :node-types="nodeTypes"
      :connection-mode="ConnectionMode.Loose"
      :delete-key-code="null"
      :default-edge-options="defaultEdgeOptions"
      :min-zoom="0.2"
      :max-zoom="2.5"
      :snap-to-grid="true"
      :snap-grid="[8, 8]"
      :fit-view-on-init="false"
      @connect="onConnect"
      @node-click="onNodeClick"
      @edge-click="onEdgeClick"
      @pane-click="onPaneClick"
      @node-drag-stop="onNodeDragStop"
      @nodes-change="onNodesChange"
      @edges-change="onEdgesChange"
      @move-end="onMoveEnd"
      @pane-context-menu="(e: any) => emit('context-menu', { kind: 'pane', event: e.event, flowPos: screenToFlowCoordinate({ x: e.event.clientX, y: e.event.clientY }) })"
      @node-context-menu="(e: any) => emit('context-menu', { kind: 'node', event: e.event, nodeId: e.node.id, flowPos: screenToFlowCoordinate({ x: e.event.clientX, y: e.event.clientY }) })"
      @edge-context-menu="(e: any) => emit('context-menu', { kind: 'edge', event: e.event, edgeId: e.edge.id, flowPos: screenToFlowCoordinate({ x: e.event.clientX, y: e.event.clientY }) })"
    >
      <Background :gap="16" :size="1.4" pattern-color="var(--kb-border)" />
      <Controls position="bottom-right" :show-interactive="false" />
      <MiniMap pannable zoomable position="bottom-left" />
    </VueFlow>

    <p v-if="!nodes.length" class="lf-empty">
      从左侧拖入图形开始绘制，或点击图形直接添加到画布中心
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * 流程图画布（基于 @vue-flow/core）
 *
 * 【为什么 nodes/edges 直接绑 store 的 ref】
 * VueFlow 需要在节点对象上挂 computedPosition / handleBounds 等运行时字段，
 * 若另起本地 ref 再手动同步，容易把运行时字段落库。这里直接绑 store，
 * 落库前由 store.toDiagramData() 只挑业务字段（与后端 sanitizeData 对称）。
 *
 * 【Loose 连接】四个圆点都能互连，符合 ProcessOn / draw.io 直觉。
 *
 * 【自动保存时机】只在「有意义的结束事件」上 touch：连线完成、拖拽停止、
 * 视口移动结束、删除。VueFlow 内部 augment 节点不会触发这些事件，避免空保存。
 */
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';

import {
  ConnectionMode,
  MarkerType,
  VueFlow,
  useVueFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';

import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/controls/dist/style.css';
import '@vue-flow/minimap/dist/style.css';

import { useDiagramStore } from '@/store/diagram-store';
import { notify } from '@/utils/toast';
import { SHAPES } from '../shapeDefs';

import CustomNode from './CustomNode.vue';

const store = useDiagramStore();
const { nodes, edges, edgeLineType, pendingShape, isEditing, currentDiagramId, viewport } = storeToRefs(store);
const { addEdges, screenToFlowCoordinate, fitView, setViewport, getViewport, getSelectedNodes, getSelectedEdges } =
  useVueFlow();

// 每个形状类型都映射到同一个 CustomNode（按 props.type 自行渲染外形）
// Object.fromEntries 的返回值 index 签名与 VueFlow 的 NodeTypes 不完全匹配，这里收窄为 any。
const nodeTypes = Object.fromEntries(SHAPES.map((s) => [s.type, markRaw(CustomNode)])) as any;

const canvasEl = ref<HTMLElement | null>(null);

const defaultEdgeOptions = computed(() => ({
  type: edgeLineType.value,
  markerEnd: MarkerType.ArrowClosed,
  style: { stroke: 'var(--kb-muted-foreground)', strokeWidth: 1.6 },
}));

let seq = 0;
function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}

// ===================== 边视觉装饰 =====================

function decorateEdge(e: any) {
  const d = e.data || {};
  const color = String(d.color || '#475569');
  e.style = {
    stroke: color,
    strokeWidth: Number(d.lineWidth || 1.6),
    ...(d.dashed ? { strokeDasharray: '6 4' } : {}),
  };
  e.markerEnd = d.arrow === false ? undefined : { type: MarkerType.ArrowClosed, color, width: 18, height: 18 };
}

watch(
  edges,
  (list) => {
    list.forEach(decorateEdge);
  },
  { deep: true },
);

// ===================== 连接 / 拖放 / 选择 =====================

const emit = defineEmits<{
  (e: 'context-menu', payload: CanvasContextMenuPayload): void;
  (e: 'fit'): void;
}>();

export interface CanvasContextMenuPayload {
  kind: 'pane' | 'node' | 'edge';
  event: MouseEvent;
  nodeId?: string;
  edgeId?: string;
  flowPos: { x: number; y: number };
}

function onConnect(params: Connection) {
  addEdges([
    {
      ...params,
      id: newId('e'),
      type: edgeLineType.value,
      data: { arrow: true, lineWidth: 1.6, dashed: false, color: '#475569' },
    },
  ]);
  store.touch();
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  const type = e.dataTransfer?.getData('application/diagram-shape');
  if (!type) return;
  const position = screenToFlowCoordinate({ x: e.clientX, y: e.clientY });
  store.addNode(type as any, position);
}

function onNodeClick({ node }: { node: { id: string } }) {
  store.setSelection(node.id, null);
}
function onEdgeClick({ edge }: { edge: { id: string } }) {
  store.setSelection(null, edge.id);
}
function onPaneClick() {
  store.setSelection(null, null);
}
function onNodeDragStop() {
  store.touch();
}

function onNodesChange(changes: NodeChange[]) {
  if (changes.some((c) => c.type === 'remove')) {
    const removed = changes.filter((c) => c.type === 'remove').map((c) => (c as any).id);
    if (removed.includes(store.selection.nodeId)) store.setSelection(null, null);
    store.touch();
  }
}
function onEdgesChange(changes: EdgeChange[]) {
  if (changes.some((c) => c.type === 'remove')) {
    const removed = changes.filter((c) => c.type === 'remove').map((c) => (c as any).id);
    if (removed.includes(store.selection.edgeId)) store.setSelection(null, null);
    store.touch();
  }
}

function onMoveEnd(payload: { flowTransform: { x: number; y: number; zoom: number } }) {
  store.setViewport(payload.flowTransform);
}

// ===================== 选择态同步 =====================

watch(
  [getSelectedNodes, getSelectedEdges],
  ([selectedNodes, selectedEdges]) => {
    store.setSelected(
      selectedNodes.map((n: any) => n.id),
      selectedEdges.map((e: any) => e.id),
    );
  },
  { deep: true },
);

// ===================== 键盘删除 =====================

function onKeydown(e: KeyboardEvent) {
  if (isEditing.value) return;
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const nodeIds = getSelectedNodes.value.map((n: any) => n.id);
  const edgeIds = getSelectedEdges.value.map((e: any) => e.id);
  if (!nodeIds.length && !edgeIds.length) return;
  e.preventDefault();
  store.deleteElements([...nodeIds, ...edgeIds]);
}

// ===================== 左栏「点击添加到中心」 =====================
watch(pendingShape, (type) => {
  if (!type) return;
  const el = canvasEl.value;
  const rect = el?.getBoundingClientRect();
  const pos = rect
    ? screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 })
    : { x: 200, y: 120 };
  store.addNode(type as any, pos);
  store.consumePending();
});

// ===================== 切换文档后恢复视口或自适应 =====================
watch(currentDiagramId, () => {
  void nextTick(() => {
    restoreOrFit();
  });
});

async function restoreOrFit() {
  await nextTick();
  if (!nodes.value.length) return;
  const vp = viewport.value;
  if (vp && (vp.zoom !== 1 || vp.x || vp.y)) {
    setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom });
  } else {
    fitView({ padding: 0.2 });
  }
}

function fitNow() {
  if (nodes.value.length) {
    fitView({ padding: 0.2 });
    store.setViewport(getViewport());
  }
}

// ===================== PNG 导出 =====================

async function exportPng(filename?: string) {
  try {
    const html2canvas = (await import('html2canvas')).default;
    const vpEl = document.querySelector('.vue-flow__viewport') as HTMLElement | null;
    const rect = canvasEl.value?.getBoundingClientRect();
    if (!vpEl || !rect) return;

    // 计算全图 bbox
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes.value as any[]) {
      const def = n.type ? SHAPES.find((s) => s.type === n.type) : null;
      const w = Number(n.data?.width) || def?.defaultWidth || 160;
      const h = Number(n.data?.height) || def?.defaultHeight || 64;
      const x = Number(n.position?.x) || 0;
      const y = Number(n.position?.y) || 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
    const padding = 40;
    const bboxW = Math.max(1, maxX - minX + padding * 2);
    const bboxH = Math.max(1, maxY - minY + padding * 2);
    const zoom = Math.min(rect.width / bboxW, rect.height / bboxH, 2);
    const offsetX = padding - minX * zoom + (rect.width - (maxX - minX + padding * 2) * zoom) / 2;
    const offsetY = padding - minY * zoom + (rect.height - (maxY - minY + padding * 2) * zoom) / 2;

    const savedViewport = { ...getViewport() };
    setViewport({ x: offsetX, y: offsetY, zoom });
    await nextTick();

    const canvas = await html2canvas(vpEl, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
    });
    // 还原视口
    setViewport(savedViewport);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(filename || store.currentName || '流程图').replace(/[\\/:*?"<>|]/g, '_')}.png`;
      a.click();
      URL.revokeObjectURL(url);
      notify('已导出 PNG', 'success');
    });
  } catch (e) {
    notify(e instanceof Error ? e.message : '导出 PNG 失败', 'error');
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});

defineExpose({ fitNow, exportPng });
</script>

<style scoped>
.lf-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.lf-empty {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: var(--kb-muted-foreground);
  font-size: 13px;
  pointer-events: none;
  text-align: center;
}
</style>
