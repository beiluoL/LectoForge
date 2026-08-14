// 形状注册工厂（方案 B：P1-T2.1）。
//
// 读取 ../shapeDefs.ts 的 SHAPES，把 11 种形状注册为 X6 原生 shape：
//   diagram-rect / diagram-rounded / diagram-ellipse / diagram-diamond /
//   diagram-hexagon / diagram-terminal / diagram-process / diagram-decision /
//   diagram-class / diagram-interface / diagram-note
//
// 设计要点：
// - 用原生 shape（非 Vue-shape），渲染走纯 SVG，符合 spec T2.1「用 X6 Shape.Rect.register()
//   或 SVG path 注册」，且 500+ 节点性能远好于逐节点挂 Vue 组件。
// - 菱形/六边形/便签用 polygon + refPoints（相对 0~1 坐标），随节点尺寸自动缩放，无需重算 points。
// - 视觉对齐旧 CustomNode：stroke 1.5、圆角/胶囊 rx、UML 三段式（body+header+label）、
//   标签居中（textVerticalAnchor middle）+ 自动换行 textWrap。
// - 每个 shape 配 4 向 ports（top/right/bottom/left），magnet 可连，替代旧 Vue Flow 的 4 个 Handle。
import { Graph } from '@antv/x6'
import { SHAPES, type DiagramShapeType } from '../shapeDefs'

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

/** 标签基础样式（居中 + 自动换行） */
const LABEL_BASE = {
  fill: '#0F172A',
  fontSize: 13,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif',
  textAnchor: 'middle' as const,
  textVerticalAnchor: 'middle' as const,
  textWrap: { width: -14, height: -10, ellipsis: true },
}

const BODY_BASE = { fill: '#FFFFFF', stroke: '#475569', strokeWidth: 1.5 }

function bodyAttrs(extra: Record<string, unknown> = {}) {
  return { ...BODY_BASE, ...extra }
}

/** 各形状注册配置 */
function buildConfig(type: DiagramShapeType): any {
  const label = { ...LABEL_BASE }
  switch (type) {
    case 'rect':
    case 'process':
    case 'decision':
      return {
        inherit: 'rect',
        markup: [
          { tag: 'rect', selector: 'body' },
          { tag: 'text', selector: 'label' },
        ],
        attrs: { body: bodyAttrs({ rx: 2 }), label },
        ports: PORTS,
      }
    case 'rounded':
      return {
        inherit: 'rect',
        markup: [
          { tag: 'rect', selector: 'body' },
          { tag: 'text', selector: 'label' },
        ],
        attrs: { body: bodyAttrs({ rx: 14 }), label },
        ports: PORTS,
      }
    case 'terminal':
      return {
        inherit: 'rect',
        markup: [
          { tag: 'rect', selector: 'body' },
          { tag: 'text', selector: 'label' },
        ],
        // rx 固定为默认高(56)/2；节点 resize 后由 useGraph 同步更新（保持胶囊形）
        attrs: { body: bodyAttrs({ rx: 28 }), label },
        ports: PORTS,
      }
    case 'ellipse':
      return {
        inherit: 'ellipse',
        markup: [
          { tag: 'ellipse', selector: 'body' },
          { tag: 'text', selector: 'label' },
        ],
        attrs: { body: bodyAttrs(), label },
        ports: PORTS,
      }
    case 'diamond':
      return {
        inherit: 'polygon',
        markup: [
          { tag: 'polygon', selector: 'body' },
          { tag: 'text', selector: 'label' },
        ],
        attrs: {
          body: bodyAttrs({ refPoints: '0.5,0 1,0.5 0.5,1 0,0.5', strokeLinejoin: 'round' }),
          label,
        },
        ports: PORTS,
      }
    case 'hexagon':
      return {
        inherit: 'polygon',
        markup: [
          { tag: 'polygon', selector: 'body' },
          { tag: 'text', selector: 'label' },
        ],
        attrs: {
          body: bodyAttrs({ refPoints: '0.18,0 0.82,0 1,0.5 0.82,1 0.18,1 0,0.5', strokeLinejoin: 'round' }),
          label,
        },
        ports: PORTS,
      }
    case 'note':
      // 五边形（右上角折起）模拟便签
      return {
        inherit: 'polygon',
        markup: [
          { tag: 'polygon', selector: 'body' },
          { tag: 'text', selector: 'label' },
        ],
        attrs: {
          body: bodyAttrs({ refPoints: '0,0 0.86,0 1,0.18 1,1 0,1', strokeLinejoin: 'round' }),
          label,
        },
        ports: PORTS,
      }
    case 'class':
    case 'interface':
      // UML 三段式：body + header（类名条，填充=描边色）+ label（置于 header 下方）
      return {
        inherit: 'rect',
        markup: [
          { tag: 'rect', selector: 'body' },
          { tag: 'rect', selector: 'header' },
          { tag: 'text', selector: 'label' },
        ],
        attrs: {
          body: bodyAttrs({ rx: 2 }),
          header: { refX: 0, refY: 0, refWidth: '100%', height: 24, fill: '#475569', stroke: 'none' },
          label: { ...LABEL_BASE, refX: '50%', refY: 30, textVerticalAnchor: 'top', textWrap: { width: -14, height: -34, ellipsis: true } },
        },
        ports: PORTS,
      }
    default:
      return {
        inherit: 'rect',
        markup: [
          { tag: 'rect', selector: 'body' },
          { tag: 'text', selector: 'label' },
        ],
        attrs: { body: bodyAttrs({ rx: 2 }), label },
        ports: PORTS,
      }
  }
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
    body: bodyAttrs({ rx: 2 }),
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

/** 幂等注册全部 11 种 X6 原生形状 + 3 种工具形状 */
export function registerDiagramShapes(): void {
  if (registered) return
  for (const s of SHAPES) {
    const name = `diagram-${s.type}`
    Graph.registerNode(name, buildConfig(s.type), true)
  }
  Graph.registerNode('diagram-text', TEXT_CONFIG as any, true)
  Graph.registerNode('diagram-table', TABLE_CONFIG as any, true)
  Graph.registerNode('diagram-page', PAGE_CONFIG as any, true)
  Graph.registerNode('diagram-drawing', DRAWING_CONFIG as any, true)
  registered = true
}
