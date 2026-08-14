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

/** 多页画布中的单页（页面切换 / 新增 / 重命名 / 拖拽排序基于此结构） */
export interface DiagramPage {
  id: string;
  name: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  viewport: { x: number; y: number; zoom: number };
  createdAt: string;
  updatedAt: string;
}

/**
 * 整图快照：多页结构。
 * - currentPageId：当前激活页；
 * - pages：页面数组（≥1）。
 * 新功能：只接受多页结构，不做单页迁移。
 */
export interface DiagramData {
  currentPageId: string;
  pages: DiagramPage[];
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

/* ===================== AI 生成（/api/ai/diagram/generate） ===================== */

/** AI 返回的单节点（id 稳定，type 取自已知形状集合，未知回退 process） */
export interface AiDiagramNode {
  id: string;
  label: string;
  type?: string | null;
}

/** AI 返回的单连线（from/to 引用 node id） */
export interface AiDiagramEdge {
  from: string;
  to: string;
  label?: string | null;
}

export interface AiDiagramGenRequest {
  /** 自然语言描述（如「用户登录流程」） */
  prompt: string;
  /** 自动布局方向，默认 TB（自上而下） */
  layout?: 'TB' | 'LR';
}

/** 生成结果。mock=true 表示未配置 AI Key，返回的是示例骨架 */
export interface AiDiagramGenResponse {
  nodes: AiDiagramNode[];
  edges: AiDiagramEdge[];
  mock?: boolean;
}
