// 大纲树节点类型（P2-T2.5）。
export interface OutlineItem {
  id: string
  /** 显示名：节点 data.label / 边标签 / 形状名兜底 */
  label: string
  kind: 'struct' | 'node' | 'edge'
  /** 形状短名（diagram- 前缀已剥离） */
  shape: string
  children?: OutlineItem[]
}
