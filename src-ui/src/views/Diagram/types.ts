/** 绘图工具 / 流程图 前端共享类型 */

/** 节点渲染外形（与 shapeDefs.buildShape 一一对应） */
export type ShapeRender =
  | 'rect'
  | 'rounded'
  | 'stadium'
  | 'ellipse'
  | 'diamond'
  | 'hexagon'
  | 'note'
  | 'uml'
  // P2-T1 专业形状库扩展
  | 'triangle'
  | 'parallelogram'
  | 'card'
  | 'cylinder'
  | 'disk'
  | 'document'
  | 'trapezoid'
  | 'hourglass'
  | 'pentagon'
  | 'predefined'
  | 'doubleRect'
  | 'doubleEllipse'
  | 'underlineEllipse'
  | 'doubleDiamond'
  | 'actor'
  | 'cloud'
  | 'awsBadge'
  | 'router'
  | 'switch'
  | 'firewall'
  | 'envelope'
  | 'loadbalancer'
  | 'device'
  | 'container'
  | 'swimlane'
  | 'group'
  | 'image';

/** 连线样式（全局下拉：折线 / 曲线 / 直线） */
export type EdgeLineType = 'smoothstep' | 'bezier' | 'straight';

/** 工具栏「笔刷」当前状态：新建节点的默认填充 / 描边 / 文字色 */
export interface BrushState {
  fill: string;
  stroke: string;
  textColor: string;
}

/** 当前选中元素（供属性面板联动） */
export interface SelectionState {
  nodeId: string | null;
  edgeId: string | null;
}
