// 形状注册工厂（方案 B：P1-T2.1 起，P2-T1 扩充到 50+）。
//
// 读取 ../shapeDefs.ts 的 ALL_SHAPES，按各形状的 render 种类向 X6 注册原生 shape：
//   diagram-<type>。所有形状走纯 SVG（非 Vue-shape），500+ 节点性能远好于逐节点挂 Vue 组件。
//
// 设计要点：
// - buildConfig 按 render 种类返回 markup + attrs；多边形用 refPoints（相对 0~1）随尺寸自动缩放，
//   椭圆/矩形用 refWidth/refHeight 自动缩放，复杂形状（圆柱/云/参与者）用相对定位的复合 markup。
// - 菱形/六边形/便签/三角形/平行四边形/梯形/五角/沙漏/双框 等也用 refPoints 自适应。
// - UML 三段式（class/interface）保留 body+header+label。
// - 标签居中（textVerticalAnchor middle）+ 自动换行 textWrap。
// - 每个形状配四向 ports（top/right/bottom/left），替代旧 Vue Flow 的 4 个 Handle。
import { Graph } from '@antv/x6'
import { ALL_SHAPES, type DiagramShapeType, type ShapeDef } from '../shapeDefs'
import type { ShapeRender } from '../types'

/** 端口组（四向），所有形状共用 */
const PORTS = {
  groups: {
    top: { position: 'top', attrs: { circle: { r: 4, magnet: true, fill: '#3b6fe0', stroke: '#fff', strokeWidth: 1.5 } } },
    right: { position: 'right', attrs: { circle: { r: 4, magnet: true, fill: '#3b6fe0', stroke: '#fff', strokeWidth: 1.5 } } },
    bottom: { position: 'bottom', attrs: { circle: { r: 4, magnet: true, fill: '#3b6fe0', stroke: '#fff', strokeWidth: 1.5 } } },
    left: { position: 'left', attrs: { circle: { r: 4, magnet: true, fill: '#3b6fe0', stroke: '#fff', strokeWidth: 1.5 } } },
  },
  items: [
    { id: 'top', group: 'top' },
    { id: 'right', group: 'right' },
    { id: 'bottom', group: 'bottom' },
    { id: 'left', group: 'left' },
  ],
}

const LABEL_BASE = {
  fill: '#0F172A',
  fontSize: 13,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif',
  textAnchor: 'middle' as const,
  textVerticalAnchor: 'middle' as const,
  textWrap: { width: -14, height: -10, ellipsis: true },
}

const BODY_BASE = { fill: '#FFFFFF', stroke: '#475569', strokeWidth: 1.5 }

/** 通用：body + label 两选择器 */
function bodyLabel(body: Record<string, unknown>, label = LABEL_BASE) {
  return {
    inherit: 'rect',
    markup: [
      { tag: 'rect', selector: 'body' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: { body: { ...BODY_BASE, ...body }, label },
    ports: PORTS,
  }
}

/** render 种类 → X6 注册配置 */
const RENDER_BUILDERS: Record<ShapeRender, (def: ShapeDef) => any> = {
  rect: () => bodyLabel({ rx: 2 }),
  rounded: () => bodyLabel({ rx: 14 }),
  stadium: () => bodyLabel({ rx: 28 }),
  ellipse: () => ({
    inherit: 'ellipse',
    markup: [
      { tag: 'ellipse', selector: 'body' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: { body: { ...BODY_BASE }, label: LABEL_BASE },
    ports: PORTS,
  }),
  diamond: () => ({ ...bodyLabel({ refPoints: '0.5,0 1,0.5 0.5,1 0,0.5', strokeLinejoin: 'round' }), inherit: 'polygon' }),
  hexagon: () => ({ ...bodyLabel({ refPoints: '0.18,0 0.82,0 1,0.5 0.82,1 0.18,1 0,0.5', strokeLinejoin: 'round' }), inherit: 'polygon' }),
  note: () => ({ ...bodyLabel({ refPoints: '0,0 0.86,0 1,0.18 1,1 0,1', strokeLinejoin: 'round' }), inherit: 'polygon' }),
  triangle: () => ({ ...bodyLabel({ refPoints: '0.5,0 1,1 0,1', strokeLinejoin: 'round' }), inherit: 'polygon' }),
  parallelogram: () => ({ ...bodyLabel({ refPoints: '0.2,0 1,0 0.8,1 0,1', strokeLinejoin: 'round' }), inherit: 'polygon' }),
  card: () => bodyLabel({ rx: 14 }),
  cylinder: () => ({
    inherit: 'rect',
    markup: [
      { tag: 'rect', selector: 'body' },
      { tag: 'ellipse', selector: 'top' },
      { tag: 'ellipse', selector: 'bottom' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { ...BODY_BASE, refX: 0, refY: 11, refWidth: '100%', refHeight: '100%-22' },
      top: { refX: 0, refY: 0, refWidth: '100%', refHeight: 22, fill: '#FFFFFF', stroke: '#475569', strokeWidth: 1.5 },
      bottom: { refX: 0, refY: '100%-22', refWidth: '100%', refHeight: 22, fill: '#FFFFFF', stroke: '#475569', strokeWidth: 1.5 },
      label: { ...LABEL_BASE, refY: 22, textVerticalAnchor: 'middle' },
    },
    ports: PORTS,
  }),
  disk: () => ({
    inherit: 'rect',
    markup: [
      { tag: 'rect', selector: 'body' },
      { tag: 'ellipse', selector: 'top' },
      { tag: 'ellipse', selector: 'bottom' },
      { tag: 'line', selector: 'band' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { ...BODY_BASE, refX: 0, refY: 11, refWidth: '100%', refHeight: '100%-22' },
      top: { refX: 0, refY: 0, refWidth: '100%', refHeight: 22, fill: '#FFFFFF', stroke: '#475569', strokeWidth: 1.5 },
      bottom: { refX: 0, refY: '100%-22', refWidth: '100%', refHeight: 22, fill: '#FFFFFF', stroke: '#475569', strokeWidth: 1.5 },
      band: { refX: 0, refY: '50%', refX2: '100%', refY2: '50%', stroke: '#475569', strokeWidth: 1, strokeDasharray: '2 3' },
      label: { ...LABEL_BASE, refY: 22, textVerticalAnchor: 'middle' },
    },
    ports: PORTS,
  }),
  document: () => ({ ...bodyLabel({ refPoints: '0,0 1,0 1,0.82 0.78,1 0,1', strokeLinejoin: 'round' }), inherit: 'polygon' }),
  trapezoid: () => ({ ...bodyLabel({ refPoints: '0.15,0 0.85,0 1,1 0,1', strokeLinejoin: 'round' }), inherit: 'polygon' }),
  hourglass: () => ({ ...bodyLabel({ refPoints: '0,0 1,0 0.5,0.5 1,1 0,1 0.5,0.5', strokeLinejoin: 'round' }), inherit: 'polygon' }),
  pentagon: () => ({ ...bodyLabel({ refPoints: '0.5,0 1,0.35 0.82,1 0.18,1 0,0.35', strokeLinejoin: 'round' }), inherit: 'polygon' }),
  predefined: () => ({
    inherit: 'rect',
    markup: [
      { tag: 'rect', selector: 'body' },
      { tag: 'rect', selector: 'inner' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { ...BODY_BASE, rx: 2 },
      inner: { refX: 4, refY: 4, refWidth: '100%-8', refHeight: '100%-8', fill: 'none', stroke: '#475569', strokeWidth: 1 },
      label: LABEL_BASE,
    },
    ports: PORTS,
  }),
  doubleRect: () => ({
    inherit: 'rect',
    markup: [
      { tag: 'rect', selector: 'body' },
      { tag: 'rect', selector: 'inner' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { ...BODY_BASE, rx: 2 },
      inner: { refX: 3, refY: 3, refWidth: '100%-6', refHeight: '100%-6', fill: 'none', stroke: '#475569', strokeWidth: 1 },
      label: LABEL_BASE,
    },
    ports: PORTS,
  }),
  doubleEllipse: () => ({
    inherit: 'ellipse',
    markup: [
      { tag: 'ellipse', selector: 'body' },
      { tag: 'ellipse', selector: 'inner' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { ...BODY_BASE },
      inner: { refX: 3, refY: 3, refWidth: '100%-6', refHeight: '100%-6', fill: 'none', stroke: '#475569', strokeWidth: 1 },
      label: LABEL_BASE,
    },
    ports: PORTS,
  }),
  underlineEllipse: () => ({
    inherit: 'ellipse',
    markup: [
      { tag: 'ellipse', selector: 'body' },
      { tag: 'line', selector: 'ul' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { ...BODY_BASE },
      ul: { refX: '12%', refY: '78%', refX2: '88%', refY2: '78%', stroke: '#475569', strokeWidth: 1 },
      label: LABEL_BASE,
    },
    ports: PORTS,
  }),
  doubleDiamond: () => ({
    inherit: 'polygon',
    markup: [
      { tag: 'polygon', selector: 'body' },
      { tag: 'polygon', selector: 'inner' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { ...BODY_BASE, refPoints: '0.5,0 1,0.5 0.5,1 0,0.5', strokeLinejoin: 'round' },
      inner: { refPoints: '0.5,0.12 0.88,0.5 0.5,0.88 0.12,0.5', fill: 'none', stroke: '#475569', strokeWidth: 1 },
      label: LABEL_BASE,
    },
    ports: PORTS,
  }),
  actor: () => ({
    inherit: 'rect',
    markup: [
      { tag: 'ellipse', selector: 'head' },
      { tag: 'line', selector: 'bodyLine' },
      { tag: 'line', selector: 'arms' },
      { tag: 'line', selector: 'legL' },
      { tag: 'line', selector: 'legR' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      head: { refX: '50%', refY: '6%', refWidth: '34%', refHeight: '20%', fill: '#FFFFFF', stroke: '#475569', strokeWidth: 1.5 },
      bodyLine: { refX: '50%', refY: '26%', refX2: '50%', refY2: '62%', stroke: '#475569', strokeWidth: 1.5 },
      arms: { refX: '22%', refY: '34%', refX2: '78%', refY2: '34%', stroke: '#475569', strokeWidth: 1.5 },
      legL: { refX: '50%', refY: '62%', refX2: '32%', refY2: '94%', stroke: '#475569', strokeWidth: 1.5 },
      legR: { refX: '50%', refY: '62%', refX2: '68%', refY2: '94%', stroke: '#475569', strokeWidth: 1.5 },
      label: { ...LABEL_BASE, refY: '100%', textVerticalAnchor: 'bottom', refX: '50%' },
    },
    ports: PORTS,
  }),
  cloud: () => ({
    inherit: 'rect',
    markup: [
      { tag: 'ellipse', selector: 'c' },
      { tag: 'ellipse', selector: 't1' },
      { tag: 'ellipse', selector: 't2' },
      { tag: 'ellipse', selector: 't3' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      c: { refX: 0, refY: '10%', refWidth: '100%', refHeight: '90%', fill: '#FFFFFF', stroke: '#475569', strokeWidth: 1.5 },
      t1: { refX: '8%', refY: '0%', refWidth: '34%', refHeight: '42%', fill: '#FFFFFF', stroke: '#475569', strokeWidth: 1.5 },
      t2: { refX: '42%', refY: '0%', refWidth: '40%', refHeight: '40%', fill: '#FFFFFF', stroke: '#475569', strokeWidth: 1.5 },
      t3: { refX: '52%', refY: '28%', refWidth: '40%', refHeight: '44%', fill: '#FFFFFF', stroke: '#475569', strokeWidth: 1.5 },
      label: { ...LABEL_BASE, refY: '100%', textVerticalAnchor: 'bottom', refX: '50%' },
    },
    ports: PORTS,
  }),
  awsBadge: (def) => ({
    inherit: 'rect',
    markup: [
      { tag: 'rect', selector: 'body' },
      { tag: 'text', selector: 'badge' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { fill: '#FFF1DD', stroke: '#FF9900', strokeWidth: 1.5, rx: 10 },
      badge: { refX: '50%', refY: '42%', textAnchor: 'middle', textVerticalAnchor: 'middle', fill: '#FF9900', fontSize: 26, fontWeight: 700, fontFamily: 'system-ui, sans-serif' },
      label: { ...LABEL_BASE, refY: '100%-14', textVerticalAnchor: 'bottom', refX: '50%', fontSize: 12 },
    },
    ports: PORTS,
  }),
  router: () => ({
    inherit: 'ellipse',
    markup: [
      { tag: 'ellipse', selector: 'body' },
      { tag: 'line', selector: 'a1' },
      { tag: 'line', selector: 'a2' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { ...BODY_BASE },
      a1: { refX: '20%', refY: '42%', refX2: '80%', refY2: '42%', stroke: '#475569', strokeWidth: 1.5 },
      a2: { refX: '20%', refY: '62%', refX2: '80%', refY2: '62%', stroke: '#475569', strokeWidth: 1.5 },
      label: { ...LABEL_BASE, refY: '100%', textVerticalAnchor: 'bottom', refX: '50%' },
    },
    ports: PORTS,
  }),
  switch: () => ({
    inherit: 'rect',
    markup: [
      { tag: 'rect', selector: 'body' },
      { tag: 'line', selector: 'a1' },
      { tag: 'line', selector: 'a2' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { ...BODY_BASE, rx: 4 },
      a1: { refX: '22%', refY: '34%', refX2: '78%', refY2: '34%', stroke: '#475569', strokeWidth: 1.5 },
      a2: { refX: '22%', refY: '66%', refX2: '78%', refY2: '66%', stroke: '#475569', strokeWidth: 1.5 },
      label: { ...LABEL_BASE, refY: '100%', textVerticalAnchor: 'bottom', refX: '50%' },
    },
    ports: PORTS,
  }),
  firewall: () => ({
    inherit: 'rect',
    markup: [
      { tag: 'rect', selector: 'body' },
      { tag: 'polyline', selector: 'cren' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { ...BODY_BASE, rx: 2 },
      cren: { refPoints: '0,0 0.16,0.18 0.33,0 0.5,0.18 0.66,0 0.83,0.18 1,0', refX: 0, refY: 0, refWidth: '100%', refHeight: 18, fill: 'none', stroke: '#475569', strokeWidth: 1.5 },
      label: { ...LABEL_BASE, refY: '60%', textVerticalAnchor: 'middle', refX: '50%' },
    },
    ports: PORTS,
  }),
  envelope: () => ({
    inherit: 'rect',
    markup: [
      { tag: 'rect', selector: 'body' },
      { tag: 'path', selector: 'flap' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { ...BODY_BASE, rx: 2 },
      flap: { refX: 0, refY: 0, refWidth: '100%', refHeight: '50%', refD: 'M 0 0 L 50 28 L 100 0', fill: 'none', stroke: '#475569', strokeWidth: 1.5 },
      label: { ...LABEL_BASE, refY: '100%', textVerticalAnchor: 'bottom', refX: '50%' },
    },
    ports: PORTS,
  }),
  loadbalancer: () => ({
    inherit: 'rect',
    markup: [
      { tag: 'rect', selector: 'body' },
      { tag: 'line', selector: 'a1' },
      { tag: 'line', selector: 'a2' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { ...BODY_BASE, rx: 4 },
      a1: { refX: '24%', refY: '30%', refX2: '76%', refY2: '70%', stroke: '#475569', strokeWidth: 1.5 },
      a2: { refX: '76%', refY: '30%', refX2: '24%', refY2: '70%', stroke: '#475569', strokeWidth: 1.5 },
      label: { ...LABEL_BASE, refY: '100%', textVerticalAnchor: 'bottom', refX: '50%' },
    },
    ports: PORTS,
  }),
  device: () => ({
    inherit: 'rect',
    markup: [
      { tag: 'rect', selector: 'body' },
      { tag: 'rect', selector: 'screen' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { ...BODY_BASE, rx: 10 },
      screen: { refX: 7, refY: 7, refWidth: '100%-14', refHeight: '100%-14', fill: '#EFF6FF', stroke: '#94A3B8', strokeWidth: 1 },
      label: { ...LABEL_BASE, refY: '100%', textVerticalAnchor: 'bottom', refX: '50%' },
    },
    ports: PORTS,
  }),
  uml: () => ({
    inherit: 'rect',
    markup: [
      { tag: 'rect', selector: 'body' },
      { tag: 'rect', selector: 'header' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { ...BODY_BASE, rx: 2 },
      header: { refX: 0, refY: 0, refWidth: '100%', height: 24, fill: '#475569', stroke: 'none' },
      label: { ...LABEL_BASE, refX: '50%', refY: 30, textVerticalAnchor: 'top', textWrap: { width: -14, height: -34, ellipsis: true } },
    },
    ports: PORTS,
  }),
  container: () => ({
    inherit: 'rect',
    markup: [
      { tag: 'rect', selector: 'body' },
      { tag: 'rect', selector: 'header' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { fill: '#F8FAFC', stroke: '#94A3B8', strokeWidth: 1.5, rx: 4 },
      header: { refX: 0, refY: 0, refWidth: '100%', height: 26, fill: '#E2E8F0', stroke: 'none' },
      label: { refX: 10, refY: 13, textAnchor: 'start', textVerticalAnchor: 'middle', fill: '#334155', fontSize: 13, fontWeight: 600, fontFamily: 'system-ui, sans-serif' },
    },
    zIndex: 0,
  }),
  swimlane: () => ({
    inherit: 'rect',
    markup: [
      { tag: 'rect', selector: 'body' },
      { tag: 'rect', selector: 'header' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { fill: '#F8FAFC', stroke: '#94A3B8', strokeWidth: 1.5, rx: 2 },
      header: { refX: 0, refY: 0, refWidth: '100%', height: 24, fill: '#CBD5E1', stroke: 'none' },
      label: { refX: 10, refY: 12, textAnchor: 'start', textVerticalAnchor: 'middle', fill: '#334155', fontSize: 12, fontWeight: 600, fontFamily: 'system-ui, sans-serif' },
    },
    zIndex: 0,
  }),
  group: () => ({
    inherit: 'rect',
    markup: [
      { tag: 'rect', selector: 'body' },
      { tag: 'text', selector: 'label' },
    ],
    attrs: {
      body: { fill: 'transparent', stroke: '#3b6fe0', strokeWidth: 1.5, strokeDasharray: '6 4', rx: 4 },
      label: { refX: 8, refY: -6, textAnchor: 'start', textVerticalAnchor: 'bottom', fill: '#3b6fe0', fontSize: 12, fontWeight: 600, fontFamily: 'system-ui, sans-serif' },
    },
    zIndex: 0,
  }),
}

function buildConfig(def: ShapeDef): any {
  const builder = RENDER_BUILDERS[def.render] || RENDER_BUILDERS.rect
  const cfg = builder(def)
  if (def.render === 'awsBadge') {
    cfg.attrs.badge.text = def.badge || def.label
  }
  return cfg
}

let registered = false

/** 无边框文本节点（顶栏「插入文本」用）：仅 label，body 透明 */
const TEXT_CONFIG = {
  inherit: 'rect',
  markup: [
    { tag: 'rect', selector: 'body' },
    { tag: 'text', selector: 'label' },
  ],
  attrs: {
    body: { fill: 'transparent', stroke: 'transparent', strokeWidth: 0 },
    label: { ...LABEL_BASE, textWrap: null, textAnchor: 'start', textVerticalAnchor: 'middle', refX: 8 },
  },
  ports: PORTS,
}

/** 表格节点（顶栏「插入表格」用）：表头分隔线 + 两行两列占位 */
const TABLE_CONFIG = {
  inherit: 'rect',
  markup: [
    { tag: 'rect', selector: 'body' },
    { tag: 'line', selector: 'headerLine' },
    { tag: 'line', selector: 'colLine' },
    { tag: 'text', selector: 'label' },
  ],
  attrs: {
    body: { ...BODY_BASE, rx: 2 },
    headerLine: { refX: 0, refY: 28, refX2: '100%', refY2: 28, stroke: '#475569', strokeWidth: 1 },
    colLine: { refX1: '50%', refY1: 28, refX2: '50%', refY2: '100%', stroke: '#475569', strokeWidth: 1 },
    label: { ...LABEL_BASE, refX: '50%', refY: 14, textVerticalAnchor: 'middle', text: '表格' },
  },
  ports: PORTS,
}

/** 页面底图（绘图面板设置页面尺寸时绘制，置于最底层、不可选中、不进序列化） */
const PAGE_CONFIG = {
  inherit: 'rect',
  markup: [
    { tag: 'rect', selector: 'body' },
  ],
  attrs: {
    body: { fill: '#FFFFFF', stroke: '#cbd5e1', strokeWidth: 1 },
  },
  zIndex: -1,
}

/** 自由画笔节点（P1-T5.1）：path 用相对坐标（节点左上角为原点），bg 透明承载命中区 */
const DRAWING_CONFIG = {
  inherit: 'rect',
  markup: [
    { tag: 'rect', selector: 'bg' },
    { tag: 'path', selector: 'body' },
  ],
  attrs: {
    bg: { fill: 'transparent', stroke: 'transparent' },
    body: {
      fill: 'none',
      stroke: '#475569',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
  },
}

/** 幂等注册全部形状（50+） + 4 种工具形状 */
export function registerDiagramShapes(): void {
  if (registered) return
  for (const s of ALL_SHAPES) {
    const name = `diagram-${s.type}`
    Graph.registerNode(name, buildConfig(s), true)
  }
  Graph.registerNode('diagram-text', TEXT_CONFIG as any, true)
  Graph.registerNode('diagram-table', TABLE_CONFIG as any, true)
  Graph.registerNode('diagram-page', PAGE_CONFIG as any, true)
  Graph.registerNode('diagram-drawing', DRAWING_CONFIG as any, true)
  registered = true
}
