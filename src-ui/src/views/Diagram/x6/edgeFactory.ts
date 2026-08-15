// 连线工厂（方案 B：P1-T2.3）。
//
// 把现有 CustomEdge 的 3 种线型 + 箭头样式，映射到 X6 原生 edge 的 connector/router/marker：
// - smoothstep → connector 'rounded'(radius 8) + router 'manhattan'（正交折线，对标 VueFlow getSmoothStepPath）
// - bezier     → connector 'smooth' + router 'normal'（贝塞尔曲线）
// - straight   → connector 'normal' + router 'normal'（直线）
//
// 箭头 6 种（属性面板下拉）：block / classic / diamond / circle / async / none(关闭)，
// 由 edge.data.arrow 派生（none ⇔ arrow=false）。
import type { EdgeLineType } from '../types'
import type { ArrowStyle, DiagramEdgeData } from './types'
import type { UmlRelationType } from '../shapeDefs'

/** 线型 → X6 connector/router 配置 */
export function edgeConnectorRouter(lineType: EdgeLineType = 'smoothstep'): {
  connector: { name: string; args?: Record<string, unknown> }
  router: { name: string; args?: Record<string, unknown> }
} {
  switch (lineType) {
    case 'bezier':
      return { connector: { name: 'smooth' }, router: { name: 'normal' } }
    case 'straight':
      return { connector: { name: 'normal' }, router: { name: 'normal' } }
    case 'smoothstep':
    default:
      return { connector: { name: 'rounded', args: { radius: 8 } }, router: { name: 'manhattan', args: { padding: 12 } } }
  }
}

/** 箭头样式 → X6 marker 配置（none 返回 undefined，等同 arrow=false） */
export function buildEdgeMarker(style: ArrowStyle, color: string, size = 8): Record<string, unknown> | undefined {
  if (style === 'none') return undefined
  return { name: style, args: { size } }
}

/** 由 edge.data 计算 line attrs（stroke / 线宽 / 虚线 / 终点箭头） */
export function edgeLineAttrs(data: DiagramEdgeData = {}): Record<string, unknown> {
  const color = String(data.color || '#475569')
  const lineWidth = Number(data.lineWidth || 1.6)
  const arrow: ArrowStyle = data.arrow === false ? 'none' : 'block'
  const attrs: Record<string, unknown> = {
    stroke: color,
    strokeWidth: lineWidth,
    strokeDasharray: data.dashed ? '6 4' : undefined,
    targetMarker: buildEdgeMarker(arrow, color),
  }
  return attrs
}

/** 构造一条 X6 连线的完整 metadata（供 graph.addEdge / store 使用） */
export function buildEdgeMetadata(opts: {
  source: string
  target: string
  data?: DiagramEdgeData
  label?: string
}) {
  const data: DiagramEdgeData = {
    lineType: 'smoothstep',
    color: '#475569',
    lineWidth: 1.6,
    dashed: false,
    arrow: true,
    ...(opts.data || {}),
  }
  const { connector, router } = edgeConnectorRouter(data.lineType)
  return {
    shape: 'edge',
    source: opts.source,
    target: opts.target,
    connector,
    router,
    attrs: { line: edgeLineAttrs(data) },
    labels: opts.label
      ? [{ position: 0.5, attrs: { label: { text: opts.label, fill: '#475569', fontSize: 12, fontFamily: 'system-ui, sans-serif' } } }]
      : [],
    data,
  }
}

/** UML 关系边样式预设（P2-T1.3）：6 种关系箭头 */
export interface UmlEdgePreset {
  connector: { name: string; args?: Record<string, unknown> }
  router: { name: string; args?: Record<string, unknown> }
  dashed: boolean
  targetMarker: Record<string, unknown> | undefined
  label: string
}

const HOLLOW = (size = 10) => ({ name: 'block', args: { size, fill: '#FFFFFF', stroke: '#475569', strokeWidth: 1.2 } })
const HOLLOW_DIAMOND = (size = 10) => ({ name: 'diamond', args: { size, fill: '#FFFFFF', stroke: '#475569', strokeWidth: 1.2 } })
const SOLID_DIAMOND = (color: string, size = 10) => ({ name: 'diamond', args: { size, fill: color } })
const ARROW = (color: string, size = 8) => ({ name: 'block', args: { size, fill: color } })

export const UML_EDGE_PRESETS: Record<UmlRelationType, UmlEdgePreset> = {
  generalization: { connector: { name: 'rounded', args: { radius: 8 } }, router: { name: 'manhattan', args: { padding: 12 } }, dashed: false, targetMarker: HOLLOW(), label: '继承' },
  realization: { connector: { name: 'rounded', args: { radius: 8 } }, router: { name: 'manhattan', args: { padding: 12 } }, dashed: true, targetMarker: HOLLOW(), label: '实现' },
  aggregation: { connector: { name: 'rounded', args: { radius: 8 } }, router: { name: 'manhattan', args: { padding: 12 } }, dashed: false, targetMarker: HOLLOW_DIAMOND(), label: '聚合' },
  composition: { connector: { name: 'rounded', args: { radius: 8 } }, router: { name: 'manhattan', args: { padding: 12 } }, dashed: false, targetMarker: SOLID_DIAMOND('#475569'), label: '组合' },
  association: { connector: { name: 'rounded', args: { radius: 8 } }, router: { name: 'manhattan', args: { padding: 12 } }, dashed: false, targetMarker: ARROW('#475569'), label: '关联' },
  dependency: { connector: { name: 'rounded', args: { radius: 8 } }, router: { name: 'manhattan', args: { padding: 12 } }, dashed: true, targetMarker: ARROW('#475569'), label: '依赖' },
}

/** 构造一条 UML 关系边（供图形库「点两节点连边」工具使用） */
export function buildUmlEdgeMetadata(opts: {
  source: string
  target: string
  relation: UmlRelationType
  label?: string
}) {
  const preset = UML_EDGE_PRESETS[opts.relation]
  const color = '#475569'
  return {
    shape: 'edge',
    source: opts.source,
    target: opts.target,
    connector: preset.connector,
    router: preset.router,
    attrs: {
      line: {
        stroke: color,
        strokeWidth: 1.6,
        strokeDasharray: preset.dashed ? '6 4' : undefined,
        targetMarker: preset.targetMarker,
      },
    },
    labels: opts.label
      ? [{ position: 0.5, attrs: { label: { text: opts.label, fill: color, fontSize: 12, fontFamily: 'system-ui, sans-serif' } } }]
      : [],
    data: { umlRelation: opts.relation },
  }
}
