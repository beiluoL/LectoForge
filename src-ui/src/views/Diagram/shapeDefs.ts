/**
 * 绘图工具 / 流程图 —— 形状定义（左栏图形库 / 画布渲染 / 落库默认值共用）。
 *
 * 三种形状来源对应顶栏「规划 → 流程图」里的三个分组：
 * - 基础形状：矩形 / 圆形 / 菱形 / 六边形 / 圆角矩形
 * - 流程图：开始结束 / 判断 / 处理
 * - UML：类 / 接口 / 注释
 *
 * 每个形状有一个稳定 type 字符串，既是 node.type 也是 nodeTypes 的键；
 * 渲染时按 render 决定外形（rect / rounded / stadium / ellipse / diamond /
 * hexagon / note / uml），绝不在 Node 顶层塞样式——颜色/尺寸统一在 data 下。
 */
import type { ShapeRender } from './types';

export type DiagramShapeType =
  | 'rect'
  | 'rounded'
  | 'ellipse'
  | 'diamond'
  | 'hexagon'
  | 'terminal'
  | 'process'
  | 'decision'
  | 'class'
  | 'interface'
  | 'note';

export interface ShapeDef {
  type: DiagramShapeType;
  /** 图形库里显示的名字 */
  label: string;
  category: 'basic' | 'flow' | 'uml';
  /** 拖入画布时节点上的初始文字 */
  defaultText: string;
  /** 默认尺寸（可被属性面板覆盖） */
  defaultWidth: number;
  defaultHeight: number;
  /** 渲染外形 */
  render: ShapeRender;
}

export const SHAPES: ShapeDef[] = [
  // ===== 基础形状 =====
  { type: 'rect', label: '矩形', category: 'basic', defaultText: '矩形', defaultWidth: 160, defaultHeight: 64, render: 'rect' },
  { type: 'rounded', label: '圆角矩形', category: 'basic', defaultText: '圆角矩形', defaultWidth: 160, defaultHeight: 64, render: 'rounded' },
  { type: 'ellipse', label: '圆形', category: 'basic', defaultText: '圆形', defaultWidth: 160, defaultHeight: 88, render: 'ellipse' },
  { type: 'diamond', label: '菱形', category: 'basic', defaultText: '菱形', defaultWidth: 150, defaultHeight: 96, render: 'diamond' },
  { type: 'hexagon', label: '六边形', category: 'basic', defaultText: '六边形', defaultWidth: 170, defaultHeight: 84, render: 'hexagon' },
  // ===== 流程图 =====
  { type: 'terminal', label: '开始/结束', category: 'flow', defaultText: '开始', defaultWidth: 140, defaultHeight: 56, render: 'stadium' },
  { type: 'process', label: '处理', category: 'flow', defaultText: '处理', defaultWidth: 160, defaultHeight: 64, render: 'rect' },
  { type: 'decision', label: '判断', category: 'flow', defaultText: '条件？', defaultWidth: 150, defaultHeight: 96, render: 'diamond' },
  // ===== UML =====
  { type: 'class', label: '类', category: 'uml', defaultText: 'ClassName', defaultWidth: 180, defaultHeight: 96, render: 'uml' },
  { type: 'interface', label: '接口', category: 'uml', defaultText: '«interface»\nName', defaultWidth: 180, defaultHeight: 96, render: 'uml' },
  { type: 'note', label: '注释', category: 'uml', defaultText: '注释', defaultWidth: 160, defaultHeight: 80, render: 'note' },
];

export const SHAPE_BY_TYPE: Record<string, ShapeDef> = Object.fromEntries(
  SHAPES.map((s) => [s.type, s]),
);

/** 取形状定义，未知 type 回退到矩形，避免坏数据让画布渲染崩 */
export function shapeOf(type: string | null | undefined): ShapeDef {
  if (type && SHAPE_BY_TYPE[type]) return SHAPE_BY_TYPE[type];
  return SHAPE_BY_TYPE.rect;
}

/**
 * 计算节点 SVG 外形（真实像素坐标，避免 viewBox 拉伸导致描边粗细不均）。
 * 返回一个描述对象，CustomNode 据此渲染 <rect> / <ellipse> / <polygon> 或 UML 表头。
 */
export type ShapeSpec =
  | { tag: 'rect'; rx: number }
  | { tag: 'ellipse' }
  | { tag: 'polygon'; points: string }
  | { tag: 'uml'; headerHeight: number };

const STROKE = 1.5;

export function buildShape(render: ShapeRender, w: number, h: number): ShapeSpec {
  switch (render) {
    case 'rounded':
      return { tag: 'rect', rx: Math.min(14, h / 2) };
    case 'stadium':
      return { tag: 'rect', rx: h / 2 };
    case 'ellipse':
      return { tag: 'ellipse' };
    case 'diamond':
      return {
        tag: 'polygon',
        points: `${w / 2},${STROKE} ${w - STROKE},${h / 2} ${w / 2},${h - STROKE} ${STROKE},${h / 2}`,
      };
    case 'hexagon':
      return {
        tag: 'polygon',
        points: `${w * 0.18},${STROKE} ${w * 0.82},${STROKE} ${w - STROKE},${h / 2} ${w * 0.82},${h - STROKE} ${w * 0.18},${h - STROKE} ${STROKE},${h / 2}`,
      };
    case 'note':
      // 右上角折角的便签
      return {
        tag: 'polygon',
        points: `${STROKE},${STROKE} ${w - 22},${STROKE} ${w - STROKE},22 ${w - STROKE},${h - STROKE} ${STROKE},${h - STROKE}`,
      };
    case 'uml':
      return { tag: 'uml', headerHeight: 24 };
    case 'rect':
    default:
      return { tag: 'rect', rx: 2 };
  }
}
