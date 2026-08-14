// X6 方案（方案 B）共享类型。
// 节点 / 连线业务字段与现有 diagram-store 的落库结构保持一致：
//   node.data: { label, fill, stroke, textColor, width, height }
//   edge.data: { lineType, color, lineWidth, dashed, arrow }
// X6 用 attrs.body / attrs.label 驱动视觉，data 保留业务字段供序列化。

/** 节点业务数据（与 store 的 normalizeNode 一致） */
export interface DiagramNodeData {
  label?: string
  fill?: string
  stroke?: string
  textColor?: string
  width?: number
  height?: number
  /** 画笔节点专用 */
  path?: string
  pathColor?: string
  strokeWidth?: number
}

/** 连线业务数据（与 store 的 normalizeEdge 一致） */
export interface DiagramEdgeData {
  lineType?: 'smoothstep' | 'bezier' | 'straight'
  color?: string
  lineWidth?: number
  dashed?: boolean
  arrow?: boolean
}

/** 箭头样式（属性面板下拉 6 种：5 种 + 关闭） */
export type ArrowStyle = 'block' | 'classic' | 'diamond' | 'circle' | 'async' | 'none'

/** 节点形状对应的 X6 shape 名：diagram-<type> */
export function shapeNameOf(type: string): string {
  return `diagram-${type}`
}
