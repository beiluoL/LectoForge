/**
 * useDiagramStore —— 绘图工具 / 流程图 全局状态。
 *
 * 设计要点：
 * - nodes / edges / viewport 直接作为 ref 交给 DiagramCanvas 的 VueFlow 做 v-model，
 *   VueFlow 会在节点对象上挂 computedPosition / handleBounds 等运行时字段——
 *   落库前一律用 toDiagramData() 只挑业务字段（见 service 的 sanitizeData 同理），
 *   绝不把运行时状态写进库；
 * - 保存走 2000ms 防抖（touch → scheduleSave），拖拽 / 改样式 / 连线的「结束」事件
 *   才触发 touch，避免 VueFlow 内部 augment 节点时产生无意义空保存；
 * - 新建节点的默认填充 / 描边 / 文字色来自 brush（工具栏排版区可控）；
 * - 列表（diagrams）与当前图（currentDiagramId）分离：切换文档先 loadDiagram 再画。
 * - patchNode/patchEdge 改为原地修改，保留 VueFlow 运行时字段；历史栈只存业务字段快照。
 *
 * ID 不可变：defineStore 第一参数 'diagram' 是 store 唯一标识，永不修改。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { MarkerType } from '@vue-flow/core';
import dagre from '@dagrejs/dagre';

import {
  createDiagram as apiCreate,
  deleteDiagram as apiDelete,
  fetchDiagram as apiFetch,
  fetchDiagrams as apiList,
  updateDiagram as apiUpdate,
} from '@/api/diagram';
import type { DiagramData, DiagramEdge, DiagramNode, DiagramSummary } from '@/api/diagram';
import { notify } from '@/utils/toast';

import { SHAPE_BY_TYPE, shapeOf, type DiagramShapeType } from '@/views/Diagram/shapeDefs';
import type { BrushState, EdgeLineType, SelectionState } from '@/views/Diagram/types';

/** 防抖保存间隔（ms） */
const SAVE_DEBOUNCE = 2000;
/** 撤销历史深度上限 */
const HISTORY_LIMIT = 50;
/** 复制/粘贴偏移量 */
const CLIPBOARD_OFFSET = 24;

let seq = 0;
function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}

const DEFAULT_BRUSH: BrushState = {
  fill: '#FFFFFF',
  stroke: '#475569',
  textColor: '#0F172A',
};

export const useDiagramStore = defineStore('diagram', () => {
  // ===== 列表 =====
  const diagrams = ref<DiagramSummary[]>([]);
  const loadingList = ref(false);

  // ===== 当前图 =====
  const currentDiagramId = ref<number | null>(null);
  const currentName = ref('未命名文件');
  /** ⚠️ 用 any[] 规避 vue-tsc 在 Node[]/Edge[] 赋值链路上的 TS2589（与 MindMap FlowchartEditor 一致） */
  const nodes = ref<any[]>([]);
  const edges = ref<any[]>([]);
  const viewport = ref<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });

  // ===== 交互态 =====
  const selection = ref<SelectionState>({ nodeId: null, edgeId: null });
  /** VueFlow 内部多选与 store 单选的桥接：所有当前选中的节点/边 id */
  const selectedNodeIds = ref<string[]>([]);
  const selectedEdgeIds = ref<string[]>([]);
  const isSaving = ref(false);
  const dirty = ref(false);
  const brush = ref<BrushState>({ ...DEFAULT_BRUSH });
  const edgeLineType = ref<EdgeLineType>('smoothstep');
  /** 左栏点击「加到视图中心」时暂存待添加的形状，由 Canvas watch 消费 */
  const pendingShape = ref<string | null>(null);
  /** 是否正在编辑某节点文字：为真时屏蔽 Delete/Backspace 的节点删除，避免误删 */
  const isEditing = ref(false);
  /** 复制剪贴板（内存级，非系统剪贴板） */
  const clipboard = ref<{ nodes: any[]; edges: any[] } | null>(null);

  /** 撤销 / 重做：快照式历史（VueFlow core 无内建 history） */
  const past = ref<string[]>([]);
  const future = ref<string[]>([]);
  const canUndo = computed(() => past.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);

  // ===== 派生 =====
  const nodeCount = computed(() => nodes.value.length);
  const selectedNode = computed(() =>
    selection.value.nodeId ? (nodes.value.find((n) => n.id === selection.value.nodeId) as any) || null : null,
  );
  const selectedEdge = computed(() =>
    selection.value.edgeId ? (edges.value.find((e) => e.id === selection.value.edgeId) as any) || null : null,
  );
  const hasSelection = computed(() => selectedNodeIds.value.length > 0 || selectedEdgeIds.value.length > 0);

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** 载入 / 初始化期间屏蔽 touch，避免 VueFlow augment 节点触发无意义保存 */
  let suppress = false;

  // ===== 序列化（只留业务字段）=====
  function cleanNode(n: any): DiagramNode {
    const d = (n?.data && typeof n.data === 'object' ? n.data : {}) as Record<string, unknown>;
    const data: Record<string, unknown> = { label: String(d.label ?? '') };
    if (typeof d.fill === 'string') data.fill = d.fill;
    if (typeof d.stroke === 'string') data.stroke = d.stroke;
    if (typeof d.textColor === 'string') data.textColor = d.textColor;
    if (typeof d.width === 'number') data.width = d.width;
    if (typeof d.height === 'number') data.height = d.height;
    return {
      id: String(n?.id ?? ''),
      type: n?.type ?? null,
      position: { x: Math.round(n?.position?.x ?? 0), y: Math.round(n?.position?.y ?? 0) },
      data: data as DiagramNode['data'],
    };
  }

  function cleanEdge(e: any): DiagramEdge {
    const d = (e?.data && typeof e.data === 'object' ? e.data : {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (typeof d.lineWidth === 'number') data.lineWidth = d.lineWidth;
    if (typeof d.dashed === 'boolean') data.dashed = d.dashed;
    if (typeof d.arrow === 'boolean') data.arrow = d.arrow;
    if (typeof d.color === 'string') data.color = d.color;
    if (typeof d.lineType === 'string' && ['smoothstep', 'bezier', 'straight'].includes(d.lineType as string)) {
      data.lineType = d.lineType;
    }
    return {
      id: String(e?.id ?? ''),
      source: String(e?.source ?? ''),
      target: String(e?.target ?? ''),
      sourceHandle: e?.sourceHandle ?? undefined,
      targetHandle: e?.targetHandle ?? undefined,
      // 连线统一为自定义类型，真实线型存 data.lineType（由 CustomEdge 渲染）
      type: 'custom',
      label: e?.label == null ? null : String(e.label),
      data: data as DiagramEdge['data'],
    };
  }

  /** 供 toDiagramData / snapshot 共用 */
  function serialize(): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
    return {
      nodes: nodes.value.map(cleanNode),
      edges: edges.value.map(cleanEdge),
    };
  }

  /**
   * 由 edge.data 推出 VueFlow 的 markerEnd 配置（箭头对象）。
   * VueFlow 会据此生成 marker 并把解析后的 url 字符串传给 CustomEdge 的 props.markerEnd，
   * 再由 BaseEdge 渲染。落库不需要此字段（由 data.arrow/color 派生），故仅运行时挂载。
   */
  function edgeMarker(data: any): { type: MarkerType; color: string; width: number; height: number } | undefined {
    if (!data || data.arrow === false) return undefined;
    return { type: MarkerType.ArrowClosed, color: String(data?.color || '#475569'), width: 18, height: 18 };
  }

  function toDiagramData(): DiagramData {
    return { ...serialize(), viewport: { ...viewport.value } };
  }

  // ===== 保存 =====
  function touch() {
    if (suppress) return;
    dirty.value = true;
    scheduleSave();
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveNow();
    }, SAVE_DEBOUNCE);
  }

  async function saveNow(): Promise<boolean> {
    if (currentDiagramId.value == null) return false;
    isSaving.value = true;
    try {
      const payload = toDiagramData();
      const d = await apiUpdate(currentDiagramId.value, { name: currentName.value, data: payload });
      currentName.value = d.name;
      dirty.value = false;
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : '保存失败', 'error');
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  /**
   * 保存入口。
   * - { immediate: true }：手动保存（点「保存」按钮 / 切换文档前），清掉防抖立即落盘；
   * - 否则：排进 2000ms 防抖（自动保存）。
   */
  async function saveDiagram(opts?: { immediate?: boolean }): Promise<boolean> {
    if (opts?.immediate) {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      return saveNow();
    }
    scheduleSave();
    return true;
  }

  // ===== 列表 / 加载 =====
  async function loadList() {
    loadingList.value = true;
    try {
      diagrams.value = await apiList();
    } catch (e) {
      notify(e instanceof Error ? e.message : '图表列表加载失败', 'error');
      diagrams.value = [];
    } finally {
      loadingList.value = false;
    }
  }

  async function loadDiagram(id: number) {
    try {
      const d = await apiFetch(id);
      suppress = true;
      currentDiagramId.value = d.id;
      currentName.value = d.name;
      nodes.value = (d.data.nodes || []).map((n) => ({
        id: String(n.id),
        type: (SHAPE_BY_TYPE[n.type as string] ? n.type : 'rect') as string,
        position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 },
        data: {
          label: String(n.data?.label ?? ''),
          ...(n.data?.fill ? { fill: n.data.fill } : {}),
          ...(n.data?.stroke ? { stroke: n.data.stroke } : {}),
          ...(n.data?.textColor ? { textColor: n.data.textColor } : {}),
          ...(n.data?.width ? { width: n.data.width } : {}),
          ...(n.data?.height ? { height: n.data.height } : {}),
        },
      }));
      edges.value = (d.data.edges || []).map((e) => ({
        id: String(e.id || newId('e')),
        source: String(e.source),
        target: String(e.target),
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
        type: 'custom',
        label: e.label == null ? undefined : String(e.label),
        markerEnd: edgeMarker(e.data),
        data: {
          ...(typeof e.data?.lineWidth === 'number' ? { lineWidth: e.data.lineWidth } : {}),
          ...(typeof e.data?.dashed === 'boolean' ? { dashed: e.data.dashed } : {}),
          ...(typeof e.data?.arrow === 'boolean' ? { arrow: e.data.arrow } : {}),
          ...(typeof e.data?.color === 'string' ? { color: e.data.color } : {}),
          ...(typeof e.data?.lineType === 'string' && ['smoothstep', 'bezier', 'straight'].includes(e.data.lineType)
            ? { lineType: e.data.lineType }
            : {}),
        },
      }));
      viewport.value = d.data.viewport || { x: 0, y: 0, zoom: 1 };
      selection.value = { nodeId: null, edgeId: null };
      selectedNodeIds.value = [];
      selectedEdgeIds.value = [];
      dirty.value = false;
      // 等 VueFlow 消费完这批节点再解除屏蔽，避免其内部 augment 触发空保存
      await Promise.resolve();
      suppress = false;
    } catch (e) {
      notify(e instanceof Error ? e.message : '图表加载失败', 'error');
      suppress = false;
    }
  }

  async function createNew(name?: string): Promise<number | null> {
    try {
      const d = await apiCreate(name);
      suppress = true;
      currentDiagramId.value = d.id;
      currentName.value = d.name;
      nodes.value = [];
      edges.value = [];
      viewport.value = { x: 0, y: 0, zoom: 1 };
      selection.value = { nodeId: null, edgeId: null };
      selectedNodeIds.value = [];
      selectedEdgeIds.value = [];
      dirty.value = false;
      await Promise.resolve();
      suppress = false;
      await loadList();
      notify('已新建流程图', 'success');
      return d.id;
    } catch (e) {
      notify(e instanceof Error ? e.message : '新建失败', 'error');
      suppress = false;
      return null;
    }
  }

  async function remove(id: number) {
    try {
      await apiDelete(id);
      if (currentDiagramId.value === id) {
        currentDiagramId.value = null;
        nodes.value = [];
        edges.value = [];
        selection.value = { nodeId: null, edgeId: null };
        selectedNodeIds.value = [];
        selectedEdgeIds.value = [];
      }
      await loadList();
      notify('已删除流程图', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : '删除失败', 'error');
    }
  }

  // ===== 历史（快照式）=====
  function snapshot(): string {
    return JSON.stringify(serialize());
  }

  /** 在结构性改动前调用，记录当前状态 */
  function pushHistory() {
    past.value.push(snapshot());
    if (past.value.length > HISTORY_LIMIT) past.value.shift();
    future.value = [];
  }

  function restore(json: string) {
    try {
      const s = JSON.parse(json);
      nodes.value = Array.isArray(s.nodes) ? s.nodes : [];
      edges.value = Array.isArray(s.edges) ? s.edges : [];
    } catch {
      /* 损坏快照直接忽略 */
    }
  }

  function undo() {
    if (!past.value.length) return;
    future.value.push(snapshot());
    restore(past.value.pop() as string);
    touch();
  }

  function redo() {
    if (!future.value.length) return;
    past.value.push(snapshot());
    restore(future.value.pop() as string);
    touch();
  }

  // ===== 节点 / 边编辑 =====
  function addNode(type: DiagramShapeType, position: { x: number; y: number }) {
    const def = shapeOf(type);
    const node = {
      id: newId('n'),
      type,
      position: { x: Math.round(position.x), y: Math.round(position.y) },
      data: {
        label: def.defaultText,
        fill: brush.value.fill,
        stroke: brush.value.stroke,
        textColor: brush.value.textColor,
        width: def.defaultWidth,
        height: def.defaultHeight,
      },
    };
    pushHistory();
    nodes.value = [...nodes.value, node];
    touch();
    return node.id;
  }

  /** 左栏点击 → 排队由 Canvas 在视图中心添加 */
  function queueAddAtCenter(type: string) {
    pendingShape.value = type;
  }

  /** Canvas 消费 pendingShape 后调用 */
  function consumePending() {
    pendingShape.value = null;
  }

  function patchNode(id: string, patch: Record<string, unknown>, opts?: { history?: boolean }) {
    if (opts?.history !== false) pushHistory();
    const n = nodes.value.find((x: any) => x.id === id);
    if (!n) return;
    if (patch.x !== undefined || patch.y !== undefined) {
      n.position = {
        x: patch.x !== undefined ? Number(patch.x) : n.position.x,
        y: patch.y !== undefined ? Number(patch.y) : n.position.y,
      };
    }
    if (
      patch.label !== undefined ||
      patch.fill !== undefined ||
      patch.stroke !== undefined ||
      patch.textColor !== undefined ||
      patch.width !== undefined ||
      patch.height !== undefined
    ) {
      n.data = {
        ...(n.data || {}),
        ...(patch.label !== undefined ? { label: String(patch.label) } : {}),
        ...(patch.fill !== undefined ? { fill: String(patch.fill) } : {}),
        ...(patch.stroke !== undefined ? { stroke: String(patch.stroke) } : {}),
        ...(patch.textColor !== undefined ? { textColor: String(patch.textColor) } : {}),
        ...(patch.width !== undefined ? { width: Number(patch.width) } : {}),
        ...(patch.height !== undefined ? { height: Number(patch.height) } : {}),
      };
    }
    touch();
  }

  function patchEdge(id: string, patch: Record<string, unknown>, opts?: { history?: boolean }) {
    if (opts?.history !== false) pushHistory();
    const e = edges.value.find((x: any) => x.id === id);
    if (!e) return;
    if (patch.label !== undefined) e.label = String(patch.label);
    if (patch.lineType !== undefined) {
      e.data = { ...(e.data || {}), lineType: String(patch.lineType) };
    }
    if (
      patch.lineWidth !== undefined ||
      patch.dashed !== undefined ||
      patch.arrow !== undefined ||
      patch.color !== undefined
    ) {
      e.data = {
        ...(e.data || {}),
        ...(patch.lineWidth !== undefined ? { lineWidth: Number(patch.lineWidth) } : {}),
        ...(patch.dashed !== undefined ? { dashed: Boolean(patch.dashed) } : {}),
        ...(patch.arrow !== undefined ? { arrow: Boolean(patch.arrow) } : {}),
        ...(patch.color !== undefined ? { color: String(patch.color) } : {}),
      };
      e.markerEnd = edgeMarker(e.data);
    }
    touch();
  }

  /** 通用入口：按 id 路由到节点或边（属性面板调用） */
  function updateElement(id: string, patch: Record<string, unknown>, opts?: { history?: boolean }) {
    if (nodes.value.some((n: any) => n.id === id)) patchNode(id, patch, opts);
    else if (edges.value.some((e: any) => e.id === id)) patchEdge(id, patch, opts);
  }

  function deleteElements(ids: string[]) {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    for (const id of ids) {
      if (nodes.value.some((n: any) => n.id === id)) nodeIds.add(id);
      else if (edges.value.some((e: any) => e.id === id)) edgeIds.add(id);
    }
    if (!nodeIds.size && !edgeIds.size) return;
    pushHistory();
    if (nodeIds.size) {
      nodes.value = nodes.value.filter((n: any) => !nodeIds.has(n.id));
      // 同时删掉连到被删节点的边
      edges.value = edges.value.filter((e: any) => !nodeIds.has(e.source) && !nodeIds.has(e.target));
    }
    if (edgeIds.size) {
      edges.value = edges.value.filter((e: any) => !edgeIds.has(e.id));
    }
    // 清选择
    if (selection.value.nodeId && (nodeIds.has(selection.value.nodeId) || edgeIds.has(selection.value.nodeId))) {
      selection.value.nodeId = null;
    }
    if (selection.value.edgeId && edgeIds.has(selection.value.edgeId)) {
      selection.value.edgeId = null;
    }
    selectedNodeIds.value = selectedNodeIds.value.filter((id) => !nodeIds.has(id));
    selectedEdgeIds.value = selectedEdgeIds.value.filter((id) => !edgeIds.has(id));
    touch();
  }

  /** 兼容旧入口：工具栏「删除选中」走统一 deleteElements */
  function removeSelected() {
    const ids: string[] = [];
    if (selection.value.nodeId) ids.push(selection.value.nodeId);
    if (selection.value.edgeId) ids.push(selection.value.edgeId);
    if (ids.length) deleteElements(ids);
  }

  function rename(name: string) {
    currentName.value = name;
    touch();
  }

  function setViewport(vp: { x: number; y: number; zoom: number }) {
    viewport.value = { x: Math.round(vp.x), y: Math.round(vp.y), zoom: Number(vp.zoom) || 1 };
    touch();
  }

  function setSelection(nodeId: string | null, edgeId: string | null) {
    selection.value = { nodeId, edgeId };
  }

  /** 与 VueFlow 内部多选同步 */
  function setSelected(nodeIds: string[], edgeIds: string[]) {
    selectedNodeIds.value = nodeIds;
    selectedEdgeIds.value = edgeIds;
    selection.value = {
      nodeId: nodeIds[0] ?? null,
      edgeId: edgeIds[0] ?? null,
    };
  }

  function setEditing(v: boolean) {
    isEditing.value = v;
  }

  // ===== 复制 / 粘贴 =====
  function copyToClipboard() {
    if (!selectedNodeIds.value.length && !selectedEdgeIds.value.length) return;
    const nodeIdMap = new Map<string, string>();
    const copiedNodes = selectedNodeIds.value
      .map((id) => nodes.value.find((n: any) => n.id === id))
      .filter(Boolean)
      .map((n: any) => {
        const newNodeId = newId('n');
        nodeIdMap.set(n.id, newNodeId);
        return {
          ...n,
          id: newNodeId,
          position: { x: n.position.x + CLIPBOARD_OFFSET, y: n.position.y + CLIPBOARD_OFFSET },
          selected: false,
        };
      });
    const copiedEdges = selectedEdgeIds.value
      .map((id) => edges.value.find((e: any) => e.id === id))
      .filter((e: any) => nodeIdMap.has(e.source) && nodeIdMap.has(e.target))
      .map((e: any) => ({
        ...e,
        id: newId('e'),
        source: nodeIdMap.get(e.source),
        target: nodeIdMap.get(e.target),
        selected: false,
      }));
    clipboard.value = { nodes: copiedNodes, edges: copiedEdges };
  }

  function pasteFromClipboard() {
    if (!clipboard.value) return;
    const { nodes: copiedNodes, edges: copiedEdges } = clipboard.value;
    if (!copiedNodes.length) return;
    pushHistory();
    const nodeIdMap = new Map<string, string>();
    const pastedNodes = copiedNodes.map((n: any) => {
      const newNodeId = newId('n');
      nodeIdMap.set(n.id, newNodeId);
      return {
        ...n,
        id: newNodeId,
        position: { x: n.position.x + CLIPBOARD_OFFSET, y: n.position.y + CLIPBOARD_OFFSET },
        selected: false,
      };
    });
    const pastedEdges = copiedEdges.map((e: any) => ({
      ...e,
      id: newId('e'),
      source: nodeIdMap.get(e.source),
      target: nodeIdMap.get(e.target),
      selected: false,
    }));
    nodes.value = [...nodes.value, ...pastedNodes];
    edges.value = [...edges.value, ...pastedEdges];
    setSelected(
      pastedNodes.map((n: any) => n.id),
      pastedEdges.map((e: any) => e.id),
    );
    touch();
  }

  // ===== 自动布局 =====
  function autoLayout(dir: 'TB' | 'LR' = 'TB') {
    if (!nodes.value.length) return;
    pushHistory();
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: dir, nodesep: 40, ranksep: 60, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of nodes.value as any[]) {
      const w = Number(n.data?.width) || shapeOf(n.type).defaultWidth;
      const h = Number(n.data?.height) || shapeOf(n.type).defaultHeight;
      g.setNode(n.id, { width: w, height: h });
    }
    for (const e of edges.value as any[]) {
      g.setEdge(e.source, e.target);
    }
    dagre.layout(g);
    for (const n of nodes.value as any[]) {
      const nodeWithPosition = g.node(n.id);
      if (!nodeWithPosition) continue;
      const w = Number(n.data?.width) || shapeOf(n.type).defaultWidth;
      const h = Number(n.data?.height) || shapeOf(n.type).defaultHeight;
      n.position = {
        x: Math.round(nodeWithPosition.x - w / 2),
        y: Math.round(nodeWithPosition.y - h / 2),
      };
    }
    touch();
  }

  // ===== 批量对齐 / 分布 =====
  /**
   * 对齐选中节点。mode：left/right/top/bottom/hcenter/vcenter。
   * 选中 < 2 个时直接忽略。重赋值 nodes（而非原地改）以确保 VueFlow 收到新引用并重排。
   */
  function alignNodes(mode: 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter') {
    const selSet = new Set(selectedNodeIds.value);
    if (selSet.size < 2) return;
    const list = (nodes.value as any[])
      .filter((n) => selSet.has(n.id))
      .map((n) => {
        const def = shapeOf(n.type);
        const w = Number(n.data?.width) || def.defaultWidth;
        const h = Number(n.data?.height) || def.defaultHeight;
        return { id: n.id, x: n.position.x, y: n.position.y, w, h, cx: n.position.x + w / 2, cy: n.position.y + h / 2 };
      });
    if (list.length < 2) return;

    let target = 0;
    if (mode === 'left') target = Math.min(...list.map((s) => s.x));
    else if (mode === 'right') target = Math.max(...list.map((s) => s.x + s.w));
    else if (mode === 'top') target = Math.min(...list.map((s) => s.y));
    else if (mode === 'bottom') target = Math.max(...list.map((s) => s.y + s.h));
    else if (mode === 'hcenter') target = list.reduce((a, s) => a + s.cx, 0) / list.length;
    else target = list.reduce((a, s) => a + s.cy, 0) / list.length;

    const next = new Map<string, { x: number; y: number }>();
    for (const s of list) {
      if (mode === 'left') next.set(s.id, { x: Math.round(target), y: s.y });
      else if (mode === 'right') next.set(s.id, { x: Math.round(target - s.w), y: s.y });
      else if (mode === 'top') next.set(s.id, { x: s.x, y: Math.round(target) });
      else if (mode === 'bottom') next.set(s.id, { x: s.x, y: Math.round(target - s.h) });
      else if (mode === 'hcenter') next.set(s.id, { x: Math.round(target - s.w / 2), y: s.y });
      else next.set(s.id, { x: s.x, y: Math.round(target - s.h / 2) });
    }
    pushHistory();
    nodes.value = (nodes.value as any[]).map((n) =>
      selSet.has(n.id) && next.has(n.id) ? { ...n, position: next.get(n.id) } : n,
    );
    touch();
  }

  /**
   * 等距分布选中节点。mode：hdistribute/vdistribute。选中 < 3 个时无意义（2 个仅端点不动），忽略。
   * 以中心点为基准，在首个与最末个节点之间均分间距。
   */
  function distributeNodes(mode: 'hdistribute' | 'vdistribute') {
    const selSet = new Set(selectedNodeIds.value);
    if (selSet.size < 3) return;
    const list = (nodes.value as any[])
      .filter((n) => selSet.has(n.id))
      .map((n) => {
        const def = shapeOf(n.type);
        const w = Number(n.data?.width) || def.defaultWidth;
        const h = Number(n.data?.height) || def.defaultHeight;
        return { id: n.id, x: n.position.x, y: n.position.y, w, h, cx: n.position.x + w / 2, cy: n.position.y + h / 2 };
      });
    if (list.length < 3) return;

    const sorted = [...list].sort((a, b) => (mode === 'hdistribute' ? a.cx - b.cx : a.cy - b.cy));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = (mode === 'hdistribute' ? last.cx - first.cx : last.cy - first.cy);
    const gap = span / (sorted.length - 1);

    const next = new Map<string, { x: number; y: number }>();
    sorted.forEach((s, i) => {
      const center = (mode === 'hdistribute' ? first.cx + gap * i : first.cy + gap * i);
      if (mode === 'hdistribute') next.set(s.id, { x: Math.round(center - s.w / 2), y: s.y });
      else next.set(s.id, { x: s.x, y: Math.round(center - s.h / 2) });
    });
    pushHistory();
    nodes.value = (nodes.value as any[]).map((n) =>
      selSet.has(n.id) && next.has(n.id) ? { ...n, position: next.get(n.id) } : n,
    );
    touch();
  }

  // ===== 导出 =====
  /**
   * 导出 SVG（基于当前 nodes/edges 的几何信息重新绘制，不依赖画布 DOM 像素）。
   * 节点按外形画矩形 / 椭圆 / 菱形 / 六边形 / 便签 / UML；边按源→目标中心连线并带箭头。
   * 这是「矢量可缩放」导出，文本可能因字体差异略偏，但结构完整、可无限放大。
   */
  function exportToSVG(filename?: string) {
    try {
      const ns = 'http://www.w3.org/2000/svg';
      const padding = 40;

      // 计算全图 bbox
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of nodes.value as any[]) {
        const def = shapeOf(n.type);
        const w = Number(n.data?.width) || def.defaultWidth;
        const h = Number(n.data?.height) || def.defaultHeight;
        const x = Number(n.position?.x) || 0;
        const y = Number(n.position?.y) || 0;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
      }
      if (!nodes.value.length) {
        minX = 0;
        minY = 0;
        maxX = 400;
        maxY = 300;
      }
      const W = Math.max(1, Math.ceil(maxX - minX + padding * 2));
      const H = Math.max(1, Math.ceil(maxY - minY + padding * 2));
      const offX = -minX + padding;
      const offY = -minY + padding;

      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('xmlns', ns);
      svg.setAttribute('width', String(W));
      svg.setAttribute('height', String(H));
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

      const bg = document.createElementNS(ns, 'rect');
      bg.setAttribute('width', String(W));
      bg.setAttribute('height', String(H));
      bg.setAttribute('fill', '#ffffff');
      svg.appendChild(bg);

      const defs = document.createElementNS(ns, 'defs');
      svg.appendChild(defs);

      // 动态创建 marker 的辅助函数
      function ensureArrowMarker(color: string) {
        const markerId = `arrow-${color.replace('#', '')}`;
        if (document.getElementById(markerId)) return markerId;
        const marker = document.createElementNS(ns, 'marker');
        marker.setAttribute('id', markerId);
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '9');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '7');
        marker.setAttribute('markerHeight', '7');
        marker.setAttribute('orient', 'auto-start-reverse');
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', 'M0,0 L10,5 L0,10 z');
        path.setAttribute('fill', color);
        marker.appendChild(path);
        defs.appendChild(marker);
        return markerId;
      }

      const nodeCenter = (id: string) => {
        const n = (nodes.value as any[]).find((m) => m.id === id);
        if (!n) return null;
        const w = Number(n.data?.width) || shapeOf(n.type).defaultWidth;
        const h = Number(n.data?.height) || shapeOf(n.type).defaultHeight;
        return { x: (Number(n.position?.x) || 0) + w / 2 + offX, y: (Number(n.position?.y) || 0) + h / 2 + offY };
      };

      // 边
      for (const e of edges.value as any[]) {
        const s = nodeCenter(e.source);
        const t = nodeCenter(e.target);
        if (!s || !t) continue;
        const color = String(e.data?.color || '#475569');
        const lineWidth = Number(e.data?.lineWidth || 1.6);
        const type = e.type || edgeLineType.value;
        const path = document.createElementNS(ns, 'path');
        let d = '';
        if (type === 'straight') {
          d = `M ${s.x} ${s.y} L ${t.x} ${t.y}`;
        } else if (type === 'bezier') {
          const c1x = s.x + (t.x - s.x) * 0.5;
          const c1y = s.y;
          const c2x = s.x + (t.x - s.x) * 0.5;
          const c2y = t.y;
          d = `M ${s.x} ${s.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${t.x} ${t.y}`;
        } else {
          // smoothstep：折线，先水平再垂直
          const midX = (s.x + t.x) / 2;
          d = `M ${s.x} ${s.y} L ${midX} ${s.y} L ${midX} ${t.y} L ${t.x} ${t.y}`;
        }
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', String(lineWidth));
        if (e.data?.dashed) path.setAttribute('stroke-dasharray', '6 4');
        if (e.data?.arrow !== false) path.setAttribute('marker-end', `url(#${ensureArrowMarker(color)})`);
        svg.appendChild(path);
      }

      // 节点
      for (const n of nodes.value as any[]) {
        const def = shapeOf(n.type);
        const w = Number(n.data?.width) || def.defaultWidth;
        const h = Number(n.data?.height) || def.defaultHeight;
        const x = (Number(n.position?.x) || 0) + offX;
        const y = (Number(n.position?.y) || 0) + offY;
        const fill = String(n.data?.fill || '#FFFFFF');
        const stroke = String(n.data?.stroke || '#475569');
        const label = String(n.data?.label || '');
        const cx = x + w / 2;
        const cy = y + h / 2;
        const rx = def.render === 'stadium' ? h / 2 : def.render === 'rounded' ? 12 : 2;

        const group = document.createElementNS(ns, 'g');

        let shapeEl: SVGElement;
        if (def.render === 'ellipse') {
          shapeEl = document.createElementNS(ns, 'ellipse');
          (shapeEl as SVGEllipseElement).setAttribute('cx', String(cx));
          (shapeEl as SVGEllipseElement).setAttribute('cy', String(cy));
          (shapeEl as SVGEllipseElement).setAttribute('rx', String(w / 2));
          (shapeEl as SVGEllipseElement).setAttribute('ry', String(h / 2));
        } else if (def.render === 'diamond') {
          shapeEl = document.createElementNS(ns, 'polygon');
          (shapeEl as SVGPolygonElement).setAttribute('points', `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`);
        } else if (def.render === 'hexagon') {
          shapeEl = document.createElementNS(ns, 'polygon');
          (shapeEl as SVGPolygonElement).setAttribute(
            'points',
            `${x + w * 0.18},${y} ${x + w * 0.82},${y} ${x + w},${cy} ${x + w * 0.82},${y + h} ${x + w * 0.18},${y + h} ${x},${cy}`,
          );
        } else if (def.render === 'note') {
          shapeEl = document.createElementNS(ns, 'polygon');
          (shapeEl as SVGPolygonElement).setAttribute(
            'points',
            `${x},${y} ${x + w - 22},${y} ${x + w},${y + 22} ${x + w},${y + h} ${x},${y + h}`,
          );
        } else {
          shapeEl = document.createElementNS(ns, 'rect');
          (shapeEl as SVGRectElement).setAttribute('x', String(x));
          (shapeEl as SVGRectElement).setAttribute('y', String(y));
          (shapeEl as SVGRectElement).setAttribute('width', String(w));
          (shapeEl as SVGRectElement).setAttribute('height', String(h));
          (shapeEl as SVGRectElement).setAttribute('rx', String(rx));
          if (def.render === 'uml') {
            const header = document.createElementNS(ns, 'rect');
            header.setAttribute('x', String(x));
            header.setAttribute('y', String(y));
            header.setAttribute('width', String(w));
            header.setAttribute('height', '24');
            header.setAttribute('rx', String(rx));
            header.setAttribute('fill', stroke);
            group.appendChild(header);
          }
        }
        shapeEl.setAttribute('fill', fill);
        shapeEl.setAttribute('stroke', stroke);
        shapeEl.setAttribute('stroke-width', '1.5');
        group.appendChild(shapeEl);

        // 文本按词换行
        const textColor = String(n.data?.textColor || '#0F172A');
        const words = label.split(/\s+/);
        const lineHeight = 16;
        const maxLineChars = Math.max(4, Math.floor((w - 16) / 8));
        const lines: string[] = [];
        let currentLine = '';
        for (const word of words) {
          if (!word) continue;
          if ((currentLine + ' ' + word).trim().length > maxLineChars && currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = currentLine ? `${currentLine} ${word}` : word;
          }
        }
        if (currentLine) lines.push(currentLine);
        if (!lines.length && label) lines.push(label);
        if (!lines.length) lines.push('');
        const startY = cy - ((lines.length - 1) * lineHeight) / 2 + 2;
        const textEl = document.createElementNS(ns, 'text');
        textEl.setAttribute('x', String(cx));
        textEl.setAttribute('y', String(startY));
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('font-size', '14');
        textEl.setAttribute('fill', textColor);
        lines.forEach((line, i) => {
          const tspan = document.createElementNS(ns, 'tspan');
          tspan.setAttribute('x', String(cx));
          tspan.setAttribute('dy', i === 0 ? '0' : String(lineHeight));
          tspan.textContent = line;
          textEl.appendChild(tspan);
        });
        group.appendChild(textEl);
        svg.appendChild(group);
      }

      const xml = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([xml], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(filename || currentName.value || '流程图').replace(/[\\/:*?"<>|]/g, '_')}.svg`;
      a.click();
      URL.revokeObjectURL(url);
      notify('已导出 SVG', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : '导出 SVG 失败', 'error');
    }
  }

  return {
    // state
    diagrams,
    loadingList,
    currentDiagramId,
    currentName,
    nodes,
    edges,
    viewport,
    selection,
    selectedNodeIds,
    selectedEdgeIds,
    isSaving,
    dirty,
    brush,
    edgeLineType,
    pendingShape,
    isEditing,
    canUndo,
    canRedo,
    // derived
    nodeCount,
    selectedNode,
    selectedEdge,
    hasSelection,
    // actions
    loadList,
    loadDiagram,
    createNew,
    addNode,
    queueAddAtCenter,
    consumePending,
    patchNode,
    patchEdge,
    updateElement,
    deleteElements,
    removeSelected,
    rename,
    setViewport,
    setSelection,
    setSelected,
    setEditing,
    pushHistory,
    undo,
    redo,
    touch,
    saveDiagram,
    remove,
    copyToClipboard,
    pasteFromClipboard,
    autoLayout,
    alignNodes,
    distributeNodes,
    exportToSVG,
  };
});
