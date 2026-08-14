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
 *
 * ID 不可变：defineStore 第一参数 'diagram' 是 store 唯一标识，永不修改。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

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
  const isSaving = ref(false);
  const dirty = ref(false);
  const brush = ref<BrushState>({ ...DEFAULT_BRUSH });
  const edgeLineType = ref<EdgeLineType>('smoothstep');
  /** 左栏点击「加到视图中心」时暂存待添加的形状，由 Canvas watch 消费 */
  const pendingShape = ref<string | null>(null);
  /** 是否正在编辑某节点文字：为真时屏蔽 Delete/Backspace 的节点删除，避免误删 */
  const isEditing = ref(false);

  /** 撤销 / 重做：快照式历史（VueFlow core 无内建 history） */
  const past = ref<string[]>([]);
  const future = ref<string[]>([]);
  const HISTORY_LIMIT = 50;
  const canUndo = computed(() => past.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);

  function snapshot(): string {
    return JSON.stringify({ nodes: nodes.value, edges: edges.value });
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

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** 载入 / 初始化期间屏蔽 watch，避免 VueFlow augment 节点触发无意义保存 */
  let suppress = false;

  // ===== 派生 =====
  const nodeCount = computed(() => nodes.value.length);
  const selectedNode = computed(() =>
    selection.value.nodeId ? (nodes.value.find((n) => n.id === selection.value.nodeId) as any) || null : null,
  );
  const selectedEdge = computed(() =>
    selection.value.edgeId ? (edges.value.find((e) => e.id === selection.value.edgeId) as any) || null : null,
  );

  // ===== 序列化（只留业务字段）=====
  function toDiagramData(): DiagramData {
    const cleanNodes: DiagramNode[] = nodes.value.map((n: any) => {
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
    });
    const cleanEdges: DiagramEdge[] = edges.value.map((e: any) => {
      const d = (e?.data && typeof e.data === 'object' ? e.data : {}) as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      if (typeof d.lineWidth === 'number') data.lineWidth = d.lineWidth;
      if (typeof d.dashed === 'boolean') data.dashed = d.dashed;
      if (typeof d.arrow === 'boolean') data.arrow = d.arrow;
      if (typeof d.color === 'string') data.color = d.color;
      return {
        id: String(e?.id ?? ''),
        source: String(e?.source ?? ''),
        target: String(e?.target ?? ''),
        sourceHandle: e?.sourceHandle ?? undefined,
        targetHandle: e?.targetHandle ?? undefined,
        type: e?.type ?? null,
        label: e?.label == null ? null : String(e.label),
        data: data as DiagramEdge['data'],
      };
    });
    return { nodes: cleanNodes, edges: cleanEdges, viewport: { ...viewport.value } };
  }

  // ===== 保存 =====
  function touch() {
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
        type: e.type || edgeLineType.value,
        label: e.label == null ? undefined : String(e.label),
        data: {
          ...(typeof e.data?.lineWidth === 'number' ? { lineWidth: e.data.lineWidth } : {}),
          ...(typeof e.data?.dashed === 'boolean' ? { dashed: e.data.dashed } : {}),
          ...(typeof e.data?.arrow === 'boolean' ? { arrow: e.data.arrow } : {}),
          ...(typeof e.data?.color === 'string' ? { color: e.data.color } : {}),
        },
      }));
      viewport.value = d.data.viewport || { x: 0, y: 0, zoom: 1 };
      selection.value = { nodeId: null, edgeId: null };
      dirty.value = false;
      // 等 VueFlow 消费完这批节点再解除屏蔽，避免其内部 augment 触发空保存
      await Promise.resolve();
      suppress = false;
    } catch (e) {
      notify(e instanceof Error ? e.message : '图表加载失败', 'error');
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
      dirty.value = false;
      await Promise.resolve();
      suppress = false;
      await loadList();
      notify('已新建流程图', 'success');
      return d.id;
    } catch (e) {
      notify(e instanceof Error ? e.message : '新建失败', 'error');
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
      }
      await loadList();
      notify('已删除流程图', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : '删除失败', 'error');
    }
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

  function patchNode(id: string, patch: Record<string, unknown>) {
    pushHistory();
    nodes.value = nodes.value.map((n: any) => {
      if (n.id !== id) return n;
      const next: any = { ...n };
      if (patch.x !== undefined || patch.y !== undefined) {
        next.position = {
          x: patch.x !== undefined ? Number(patch.x) : n.position.x,
          y: patch.y !== undefined ? Number(patch.y) : n.position.y,
        };
      }
      if (patch.label !== undefined || patch.fill !== undefined || patch.stroke !== undefined || patch.textColor !== undefined || patch.width !== undefined || patch.height !== undefined) {
        next.data = {
          ...(n.data || {}),
          ...(patch.label !== undefined ? { label: String(patch.label) } : {}),
          ...(patch.fill !== undefined ? { fill: String(patch.fill) } : {}),
          ...(patch.stroke !== undefined ? { stroke: String(patch.stroke) } : {}),
          ...(patch.textColor !== undefined ? { textColor: String(patch.textColor) } : {}),
          ...(patch.width !== undefined ? { width: Number(patch.width) } : {}),
          ...(patch.height !== undefined ? { height: Number(patch.height) } : {}),
        };
      }
      return next;
    });
    touch();
  }

  function patchEdge(id: string, patch: Record<string, unknown>) {
    pushHistory();
    edges.value = edges.value.map((e: any) => {
      if (e.id !== id) return e;
      const next: any = { ...e };
      if (patch.label !== undefined) next.label = String(patch.label);
      if (patch.lineWidth !== undefined || patch.dashed !== undefined || patch.arrow !== undefined || patch.color !== undefined) {
        next.data = {
          ...(e.data || {}),
          ...(patch.lineWidth !== undefined ? { lineWidth: Number(patch.lineWidth) } : {}),
          ...(patch.dashed !== undefined ? { dashed: Boolean(patch.dashed) } : {}),
          ...(patch.arrow !== undefined ? { arrow: Boolean(patch.arrow) } : {}),
          ...(patch.color !== undefined ? { color: String(patch.color) } : {}),
        };
      }
      return next;
    });
    touch();
  }

  /** 通用入口：按 id 路由到节点或边（属性面板调用） */
  function updateElement(id: string, patch: Record<string, unknown>) {
    if (nodes.value.some((n: any) => n.id === id)) patchNode(id, patch);
    else if (edges.value.some((e: any) => e.id === id)) patchEdge(id, patch);
  }

  function removeSelected() {
    pushHistory();
    if (selection.value.nodeId) {
      const id = selection.value.nodeId;
      nodes.value = nodes.value.filter((n: any) => n.id !== id);
      // 同时删掉连到该节点的边
      edges.value = edges.value.filter((e: any) => e.source !== id && e.target !== id);
      selection.value = { nodeId: null, edgeId: null };
      touch();
    } else if (selection.value.edgeId) {
      const id = selection.value.edgeId;
      edges.value = edges.value.filter((e: any) => e.id !== id);
      selection.value = { nodeId: null, edgeId: null };
      touch();
    }
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

  function setEditing(v: boolean) {
    isEditing.value = v;
  }

  // ===== 导出 =====
  async function exportToPNG(target: HTMLElement, filename?: string) {
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(target, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
      });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(filename || currentName.value || '流程图').replace(/[\\/:*?"<>|]/g, '_')}.png`;
        a.click();
        URL.revokeObjectURL(url);
        notify('已导出 PNG', 'success');
      });
    } catch (e) {
      notify(e instanceof Error ? e.message : '导出 PNG 失败', 'error');
    }
  }

  /**
   * 导出 SVG（基于当前 nodes/edges 的几何信息重新绘制，不依赖画布 DOM 像素）。
   * 节点按外形画矩形 / 椭圆 / 菱形 / 六边形 / 便签 / UML；边按源→目标中心连线并带箭头。
   * 这是「矢量可缩放」导出，文本可能因字体差异略偏，但结构完整、可无限放大。
   */
  function exportToSVG(filename?: string) {
    try {
      const ns = 'http://www.w3.org/2000/svg';
      const W = 1600;
      const H = 1000;
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
      defs.innerHTML =
        '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#475569"/></marker>';
      svg.appendChild(defs);

      // 节点
      for (const n of nodes.value as any[]) {
        const def = shapeOf(n.type);
        const w = Number(n.data?.width) || def.defaultWidth;
        const h = Number(n.data?.height) || def.defaultHeight;
        const x = Number(n.position?.x) || 0;
        const y = Number(n.position?.y) || 0;
        const fill = String(n.data?.fill || '#FFFFFF');
        const stroke = String(n.data?.stroke || '#475569');
        const label = String(n.data?.label || '');
        const cx = x + w / 2;
        const cy = y + h / 2;
        let el: SVGElement;
        if (def.render === 'ellipse') {
          el = document.createElementNS(ns, 'ellipse');
          (el as SVGEllipseElement).setAttribute('cx', String(cx));
          (el as SVGEllipseElement).setAttribute('cy', String(cy));
          (el as SVGEllipseElement).setAttribute('rx', String(w / 2));
          (el as SVGEllipseElement).setAttribute('ry', String(h / 2));
        } else if (def.render === 'diamond') {
          el = document.createElementNS(ns, 'polygon');
          (el as SVGPolygonElement).setAttribute('points', `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`);
        } else if (def.render === 'hexagon') {
          el = document.createElementNS(ns, 'polygon');
          (el as SVGPolygonElement).setAttribute(
            'points',
            `${x + w * 0.18},${y} ${x + w * 0.82},${y} ${x + w},${cy} ${x + w * 0.82},${y + h} ${x + w * 0.18},${y + h} ${x},${cy}`,
          );
        } else if (def.render === 'note') {
          el = document.createElementNS(ns, 'polygon');
          (el as SVGPolygonElement).setAttribute(
            'points',
            `${x},${y} ${x + w - 22},${y} ${x + w},${y + 22} ${x + w},${y + h} ${x},${y + h}`,
          );
        } else {
          el = document.createElementNS(ns, 'rect');
          (el as SVGRectElement).setAttribute('x', String(x));
          (el as SVGRectElement).setAttribute('y', String(y));
          (el as SVGRectElement).setAttribute('width', String(w));
          (el as SVGRectElement).setAttribute('height', String(h));
          const rx = def.render === 'stadium' ? h / 2 : def.render === 'rounded' ? 12 : 2;
          (el as SVGRectElement).setAttribute('rx', String(rx));
          if (def.render === 'uml') {
            const header = document.createElementNS(ns, 'rect');
            header.setAttribute('x', String(x));
            header.setAttribute('y', String(y));
            header.setAttribute('width', String(w));
            header.setAttribute('height', '24');
            header.setAttribute('rx', String(rx));
            header.setAttribute('fill', stroke);
            svg.appendChild(header);
          }
        }
        el.setAttribute('fill', fill);
        el.setAttribute('stroke', stroke);
        el.setAttribute('stroke-width', '1.5');
        svg.appendChild(el);

        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', String(cx));
        text.setAttribute('y', String(cy));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('font-size', '14');
        text.setAttribute('fill', String(n.data?.textColor || '#0F172A'));
        text.textContent = label;
        svg.appendChild(text);
      }

      // 边
      const nodeCenter = (id: string) => {
        const n = (nodes.value as any[]).find((m) => m.id === id);
        if (!n) return null;
        const w = Number(n.data?.width) || shapeOf(n.type).defaultWidth;
        const h = Number(n.data?.height) || shapeOf(n.type).defaultHeight;
        return { x: Number(n.position?.x) + w / 2, y: Number(n.position?.y) + h / 2 };
      };
      for (const e of edges.value as any[]) {
        const s = nodeCenter(e.source);
        const t = nodeCenter(e.target);
        if (!s || !t) continue;
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', String(s.x));
        line.setAttribute('y1', String(s.y));
        line.setAttribute('x2', String(t.x));
        line.setAttribute('y2', String(t.y));
        line.setAttribute('stroke', String(e.data?.color || '#475569'));
        line.setAttribute('stroke-width', String(e.data?.lineWidth || 1.6));
        if (e.data?.dashed) line.setAttribute('stroke-dasharray', '6 4');
        if (e.data?.arrow !== false) line.setAttribute('marker-end', 'url(#arrow)');
        svg.appendChild(line);
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
    removeSelected,
    rename,
    setViewport,
    setSelection,
    setEditing,
    pushHistory,
    undo,
    redo,
    touch,
    saveDiagram,
    remove,
    exportToPNG,
    exportToSVG,
  };
});
