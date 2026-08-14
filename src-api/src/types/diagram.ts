/* 绘图工具 / 流程图模块 DTO / VO。
 *
 * 命名口径：
 * - 库表行字段用 camelCase（userId / createdAt / updatedAt），与 wb_* 既有模块一致；
 * - data 列内部的 nodes / edges / viewport 结构单独定义成 DiagramData，前端 store
 *   直接复用同一套形状，两侧零映射。
 *
 * ⚠️ 本文件是**纯类型层**，禁止出现任何运行时值（常量、函数）。
 *    默认空白 JSON、节点/边兜底逻辑一律放 services/diagramService.ts。
 */

/** 画布节点（纯净业务字段，不含 vue-flow 运行时状态） */
export interface DiagramNode {
  id: string;
  /** 节点类型（形状）：rect / rounded / diamond / ellipse / hexagon / ... */
  type?: string | null;
  position: { x: number; y: number };
  /** 业务与视觉数据统一挂在 data 下，绝不放 Node 顶层（vue-flow 约定）。
   *  label 为节点文字；fill/stroke/textColor 为填充/描边/文字色；
   *  width/height 为显式尺寸（缺省按形状默认）。 */
  data?: {
    label?: string;
    fill?: string;
    stroke?: string;
    textColor?: string;
    width?: number;
    height?: number;
    [k: string]: unknown;
  };
}

/** 画布连线 */
export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  /** 连线样式：smoothstep（折线）/ bezier（曲线）/ straight（直线） */
  type?: string | null;
  label?: string | null;
  /** 连线的视觉样式（与节点 data 同理，统一挂在 data 下，避免落库时丢失）：
   *  lineWidth 线宽 / dashed 是否虚线 / arrow 是否带箭头 / color 线色。 */
  data?: {
    lineWidth?: number;
    dashed?: boolean;
    arrow?: boolean;
    color?: string;
    [k: string]: unknown;
  };
}

/** 整图快照：nodes + edges + 视口 */
export interface DiagramData {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  viewport: { x: number; y: number; zoom: number };
}

/** 库表行（wb_diagram），data 为 JSON 字符串 */
export interface DiagramRow {
  id: number;
  userId: number;
  name: string;
  data: string;
  createdAt: string;
  updatedAt: string;
}

/** 列表项：data 不随列表返回，只回解析出的节点数 + 时间，减轻传输 */
export interface DiagramSummary {
  id: number;
  name: string;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 详情：data 已解析为对象，前端拿到即用 */
export interface DiagramDetail {
  id: number;
  userId: number;
  name: string;
  data: DiagramData;
  createdAt: string;
  updatedAt: string;
}

export interface DiagramCreateInput {
  name?: string;
}

/** PUT 保存：name 与 data 都可单独传，未传字段保持原值 */
export interface DiagramUpdateInput {
  name?: string;
  data?: DiagramData;
}
