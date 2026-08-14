/**
 * 绘图工具 / 流程图 —— 模板库。
 *
 * 预置「空白流程图骨架」：用户一键套用后直接得到带占位文字的节点 + 连线，
 * 只需改文字、调布局即可，解决「每次都从空白画布开始」的痛点（对标 Fynote / ProcessOn 模板库）。
 *
 * 设计约定：
 * - 节点用模板内局部 ref 互相引用，applyTemplate 时统一映射成真实 id，避免与库里现有 id 冲突；
 * - 坐标为「业务像素坐标」，套用后不做自动布局（保持骨架作者意图的排布）；
 * - 所有 label 为占位文字，提醒用户替换；type 必须是 shapeDefs 中存在的 DiagramShapeType。
 */
import type { DiagramShapeType } from './shapeDefs';

/** 模板内一个节点（骨架，无真实 id） */
export interface DiagramTemplateNode {
  /** 模板内局部引用键，edges.from/to 用它指代节点 */
  ref: string;
  type: DiagramShapeType;
  label: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/** 模板内一条连线 */
export interface DiagramTemplateEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  nodes: DiagramTemplateNode[];
  edges: DiagramTemplateEdge[];
}

export const DIAGRAM_TEMPLATES: DiagramTemplate[] = [
  {
    id: 'flow-basic',
    name: '基础流程图',
    description: '开始 → 处理 → 判断 → 结束，含条件分支',
    category: '流程图',
    nodes: [
      { ref: 'start', type: 'terminal', label: '开始', x: 220, y: 30, width: 140, height: 56 },
      { ref: 'proc', type: 'process', label: '处理步骤', x: 210, y: 140, width: 160, height: 64 },
      { ref: 'decide', type: 'decision', label: '条件？', x: 220, y: 260, width: 150, height: 96 },
      { ref: 'branch', type: 'process', label: '分支处理', x: 430, y: 270, width: 160, height: 64 },
      { ref: 'end', type: 'terminal', label: '结束', x: 220, y: 430, width: 140, height: 56 },
    ],
    edges: [
      { from: 'start', to: 'proc' },
      { from: 'proc', to: 'decide' },
      { from: 'decide', to: 'branch', label: '否' },
      { from: 'branch', to: 'end' },
      { from: 'decide', to: 'end', label: '是' },
    ],
  },
  {
    id: 'flow-linear',
    name: '线性流程',
    description: '顺序执行的多个步骤',
    category: '流程图',
    nodes: [
      { ref: 'start', type: 'terminal', label: '开始', x: 220, y: 30, width: 140, height: 56 },
      { ref: 's1', type: 'process', label: '步骤一', x: 210, y: 140, width: 160, height: 64 },
      { ref: 's2', type: 'process', label: '步骤二', x: 210, y: 250, width: 160, height: 64 },
      { ref: 's3', type: 'process', label: '步骤三', x: 210, y: 360, width: 160, height: 64 },
      { ref: 'end', type: 'terminal', label: '结束', x: 220, y: 470, width: 140, height: 56 },
    ],
    edges: [
      { from: 'start', to: 's1' },
      { from: 's1', to: 's2' },
      { from: 's2', to: 's3' },
      { from: 's3', to: 'end' },
    ],
  },
  {
    id: 'flow-decision',
    name: '判断分支',
    description: '单一决策点分流为两条路径',
    category: '流程图',
    nodes: [
      { ref: 'decide', type: 'decision', label: '条件？', x: 255, y: 40, width: 150, height: 96 },
      { ref: 'yes', type: 'process', label: '满足时处理', x: 110, y: 230, width: 170, height: 64 },
      { ref: 'no', type: 'process', label: '不满足时处理', x: 360, y: 230, width: 170, height: 64 },
      { ref: 'end', type: 'terminal', label: '结束', x: 240, y: 410, width: 140, height: 56 },
    ],
    edges: [
      { from: 'decide', to: 'yes', label: '是' },
      { from: 'decide', to: 'no', label: '否' },
      { from: 'yes', to: 'end' },
      { from: 'no', to: 'end' },
    ],
  },
  {
    id: 'flow-loop',
    name: '循环流程',
    description: '操作 → 判断，满足条件才退出循环',
    category: '流程图',
    nodes: [
      { ref: 'op', type: 'process', label: '执行操作', x: 210, y: 40, width: 160, height: 64 },
      { ref: 'decide', type: 'decision', label: '继续？', x: 220, y: 160, width: 150, height: 96 },
      { ref: 'end', type: 'terminal', label: '结束', x: 220, y: 360, width: 140, height: 56 },
    ],
    edges: [
      { from: 'op', to: 'decide' },
      { from: 'decide', to: 'end', label: '否' },
      { from: 'decide', to: 'op', label: '是' },
    ],
  },
  {
    id: 'org-chart',
    name: '组织架构图',
    description: '自上而下的层级汇报结构',
    category: '结构图',
    nodes: [
      { ref: 'ceo', type: 'rounded', label: '总经理', x: 250, y: 20, width: 160, height: 56 },
      { ref: 'a', type: 'rounded', label: '部门 A', x: 80, y: 160, width: 150, height: 56 },
      { ref: 'b', type: 'rounded', label: '部门 B', x: 360, y: 160, width: 150, height: 56 },
      { ref: 'a1', type: 'rect', label: '员工 A1', x: 30, y: 300, width: 130, height: 48 },
      { ref: 'a2', type: 'rect', label: '员工 A2', x: 180, y: 300, width: 130, height: 48 },
      { ref: 'b1', type: 'rect', label: '员工 B1', x: 330, y: 300, width: 130, height: 48 },
      { ref: 'b2', type: 'rect', label: '员工 B2', x: 480, y: 300, width: 130, height: 48 },
    ],
    edges: [
      { from: 'ceo', to: 'a' },
      { from: 'ceo', to: 'b' },
      { from: 'a', to: 'a1' },
      { from: 'a', to: 'a2' },
      { from: 'b', to: 'b1' },
      { from: 'b', to: 'b2' },
    ],
  },
  {
    id: 'mindmap',
    name: '思维导图骨架',
    description: '中心主题向外辐射分支（后续可一键紧凑树布局）',
    category: '思维导图',
    nodes: [
      { ref: 'center', type: 'rounded', label: '中心主题', x: 300, y: 150, width: 180, height: 64 },
      { ref: 'b1', type: 'ellipse', label: '分支一', x: 60, y: 40, width: 150, height: 64 },
      { ref: 'b2', type: 'ellipse', label: '分支二', x: 60, y: 150, width: 150, height: 64 },
      { ref: 'b3', type: 'ellipse', label: '分支三', x: 60, y: 260, width: 150, height: 64 },
      { ref: 'b4', type: 'ellipse', label: '分支四', x: 540, y: 150, width: 150, height: 64 },
    ],
    edges: [
      { from: 'center', to: 'b1' },
      { from: 'center', to: 'b2' },
      { from: 'center', to: 'b3' },
      { from: 'center', to: 'b4' },
    ],
  },
  {
    id: 'uml-class',
    name: 'UML 类图骨架',
    description: '两个类关联 + 一个注释',
    category: 'UML',
    nodes: [
      { ref: 'ca', type: 'class', label: 'ClassA', x: 180, y: 40, width: 180, height: 96 },
      { ref: 'cb', type: 'class', label: 'ClassB', x: 420, y: 40, width: 180, height: 96 },
      { ref: 'note', type: 'note', label: '关联说明', x: 180, y: 230, width: 200, height: 80 },
    ],
    edges: [
      { from: 'ca', to: 'cb', label: '关联' },
      { from: 'ca', to: 'note', label: '说明' },
    ],
  },
];
