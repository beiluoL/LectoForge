/**
 * 绘图工具 / 流程图 —— 形状定义（左栏图形库 / 画布渲染 / 落库默认值共用）。
 *
 * Phase 1 的 11 种基础形状 + Phase 2（P2-T1）扩充到 50+ 专业形状，
 * 覆盖：基础 / 流程图·BPMN / UML / ER / AWS / 网络·通用 6 个分组。
 *
 * 每个形状有一个稳定 type 字符串，既是 node.shape 后缀也是 shape 表的键；
 * 渲染时按 render 决定外形（X6 由 shapeFactory 据此注册），绝不在 Node 顶层塞样式
 * ——颜色/尺寸统一在 data 下。
 */
import type { ShapeRender } from './types';

export type DiagramShapeType =
  // ===== 基础（basic）=====
  | 'rect' | 'rounded' | 'ellipse' | 'diamond' | 'hexagon' | 'triangle' | 'parallelogram'
  // ===== 流程图 / BPMN（flow）=====
  | 'terminal' | 'process' | 'decision' | 'io' | 'preparation' | 'note' | 'card'
  | 'database' | 'disk' | 'document' | 'storedData' | 'manual' | 'delay' | 'predefined'
  | 'loopLimit' | 'pageRef' | 'offpage'
  // ===== UML（uml）=====
  | 'class' | 'interface' | 'annotation' | 'actor' | 'usecase' | 'package'
  | 'component' | 'state' | 'start' | 'end'
  // ===== ER（er）=====
  | 'entity' | 'weakEntity' | 'attribute' | 'multiAttr' | 'keyAttr' | 'relation' | 'weakRelation'
  // ===== AWS（aws）=====
  | 'ec2' | 's3' | 'rds' | 'lambda' | 'cloudfront' | 'dynamodb' | 'sqs' | 'sns' | 'alb'
  | 'apigateway' | 'cloudwatch' | 'vpc' | 'subnet' | 'iam' | 'route53' | 'kms' | 'eks'
  | 'elasticache' | 'cloudtrail' | 'stepfunctions'
  // ===== 网络·通用（network）=====
  | 'server' | 'router' | 'switch' | 'firewall' | 'loadbalancer' | 'cloud' | 'user'
  | 'pc' | 'phone' | 'tablet' | 'laptop' | 'mail' | 'storage'
  // ===== 结构（struct）=====
  | 'container' | 'swimlane' | 'group';

export type ShapeCategory = 'basic' | 'flow' | 'uml' | 'er' | 'aws' | 'network' | 'struct';

export interface ShapeDef {
  type: DiagramShapeType;
  /** 图形库里显示的名字 */
  label: string;
  category: ShapeCategory;
  /** 拖入画布时节点上的初始文字 */
  defaultText: string;
  /** 默认尺寸（可被属性面板覆盖） */
  defaultWidth: number;
  defaultHeight: number;
  /** 渲染外形（驱动 X6 shapeFactory 注册） */
  render: ShapeRender;
  /** 是否为胶囊形（resize 时 rx 跟随高度） */
  capsule?: boolean;
  /** AWS 徽标缩写（awsBadge 渲染用） */
  badge?: string;
}

/** Phase 1 的 11 种基础形状（种子 demo / 兼容性保留） */
export const SHAPES: ShapeDef[] = [
  { type: 'rect', label: '矩形', category: 'basic', defaultText: '矩形', defaultWidth: 160, defaultHeight: 64, render: 'rect' },
  { type: 'rounded', label: '圆角矩形', category: 'basic', defaultText: '圆角矩形', defaultWidth: 160, defaultHeight: 64, render: 'rounded' },
  { type: 'ellipse', label: '圆形', category: 'basic', defaultText: '圆形', defaultWidth: 160, defaultHeight: 88, render: 'ellipse' },
  { type: 'diamond', label: '菱形', category: 'basic', defaultText: '菱形', defaultWidth: 150, defaultHeight: 96, render: 'diamond' },
  { type: 'hexagon', label: '六边形', category: 'basic', defaultText: '六边形', defaultWidth: 170, defaultHeight: 84, render: 'hexagon' },
  { type: 'terminal', label: '开始/结束', category: 'flow', defaultText: '开始', defaultWidth: 140, defaultHeight: 56, render: 'stadium', capsule: true },
  { type: 'process', label: '处理', category: 'flow', defaultText: '处理', defaultWidth: 160, defaultHeight: 64, render: 'rect' },
  { type: 'decision', label: '判断', category: 'flow', defaultText: '条件？', defaultWidth: 150, defaultHeight: 96, render: 'diamond' },
  { type: 'class', label: '类', category: 'uml', defaultText: 'ClassName', defaultWidth: 180, defaultHeight: 96, render: 'uml' },
  { type: 'interface', label: '接口', category: 'uml', defaultText: '«interface»\nName', defaultWidth: 180, defaultHeight: 96, render: 'uml' },
  { type: 'note', label: '注释', category: 'uml', defaultText: '注释', defaultWidth: 160, defaultHeight: 80, render: 'note' },
];

/** Phase 2-T1 扩充的专业形状（50+） */
export const EXTRA_SHAPES: ShapeDef[] = [
  // ===== 基础（补齐） =====
  { type: 'triangle', label: '三角形', category: 'basic', defaultText: '三角', defaultWidth: 140, defaultHeight: 120, render: 'triangle' },
  { type: 'parallelogram', label: '平行四边形', category: 'basic', defaultText: '输入/输出', defaultWidth: 160, defaultHeight: 72, render: 'parallelogram' },

  // ===== 流程图 / BPMN（17 种） =====
  { type: 'io', label: '输入/输出', category: 'flow', defaultText: 'I/O', defaultWidth: 160, defaultHeight: 72, render: 'parallelogram' },
  { type: 'preparation', label: '准备', category: 'flow', defaultText: '准备', defaultWidth: 160, defaultHeight: 80, render: 'hexagon' },
  { type: 'card', label: '卡片', category: 'flow', defaultText: '卡片', defaultWidth: 150, defaultHeight: 90, render: 'card' },
  { type: 'database', label: '数据库', category: 'flow', defaultText: 'DB', defaultWidth: 140, defaultHeight: 110, render: 'cylinder' },
  { type: 'disk', label: '磁盘', category: 'flow', defaultText: '磁盘', defaultWidth: 140, defaultHeight: 120, render: 'disk' },
  { type: 'document', label: '文档', category: 'flow', defaultText: '文档', defaultWidth: 150, defaultHeight: 100, render: 'document' },
  { type: 'storedData', label: '数据存储', category: 'flow', defaultText: '数据', defaultWidth: 160, defaultHeight: 80, render: 'trapezoid' },
  { type: 'manual', label: '手动输入', category: 'flow', defaultText: '手动', defaultWidth: 150, defaultHeight: 90, render: 'rect' },
  { type: 'delay', label: '延时', category: 'flow', defaultText: '延时', defaultWidth: 120, defaultHeight: 120, render: 'hourglass' },
  { type: 'predefined', label: '预定义过程', category: 'flow', defaultText: '子过程', defaultWidth: 170, defaultHeight: 80, render: 'predefined' },
  { type: 'loopLimit', label: '循环边界', category: 'flow', defaultText: '循环', defaultWidth: 150, defaultHeight: 90, render: 'card' },
  { type: 'pageRef', label: '页面引用', category: 'flow', defaultText: '页面', defaultWidth: 140, defaultHeight: 120, render: 'pentagon' },
  { type: 'offpage', label: '离页连接', category: 'flow', defaultText: '接', defaultWidth: 140, defaultHeight: 120, render: 'pentagon' },

  // ===== UML（节点） =====
  { type: 'annotation', label: 'UML 注释', category: 'uml', defaultText: '注释', defaultWidth: 160, defaultHeight: 80, render: 'note' },
  { type: 'actor', label: '参与者', category: 'uml', defaultText: 'Actor', defaultWidth: 90, defaultHeight: 120, render: 'actor' },
  { type: 'usecase', label: '用例', category: 'uml', defaultText: '用例', defaultWidth: 130, defaultHeight: 90, render: 'ellipse' },
  { type: 'package', label: '包', category: 'uml', defaultText: '«package»', defaultWidth: 170, defaultHeight: 90, render: 'rect' },
  { type: 'component', label: '组件', category: 'uml', defaultText: '«component»', defaultWidth: 170, defaultHeight: 90, render: 'rect' },
  { type: 'state', label: '状态', category: 'uml', defaultText: 'State', defaultWidth: 150, defaultHeight: 80, render: 'rounded' },
  { type: 'start', label: '初始节点', category: 'uml', defaultText: '●', defaultWidth: 56, defaultHeight: 56, render: 'stadium', capsule: true },
  { type: 'end', label: '终止节点', category: 'uml', defaultText: '●', defaultWidth: 56, defaultHeight: 56, render: 'stadium', capsule: true },

  // ===== ER（7 种） =====
  { type: 'entity', label: '实体', category: 'er', defaultText: '实体', defaultWidth: 160, defaultHeight: 80, render: 'rect' },
  { type: 'weakEntity', label: '弱实体', category: 'er', defaultText: '弱实体', defaultWidth: 170, defaultHeight: 86, render: 'doubleRect' },
  { type: 'attribute', label: '属性', category: 'er', defaultText: '属性', defaultWidth: 150, defaultHeight: 80, render: 'ellipse' },
  { type: 'multiAttr', label: '多值属性', category: 'er', defaultText: '多值', defaultWidth: 160, defaultHeight: 84, render: 'doubleEllipse' },
  { type: 'keyAttr', label: '键属性', category: 'er', defaultText: '键', defaultWidth: 150, defaultHeight: 80, render: 'underlineEllipse' },
  { type: 'relation', label: '关系', category: 'er', defaultText: '关系', defaultWidth: 130, defaultHeight: 90, render: 'diamond' },
  { type: 'weakRelation', label: '弱关系', category: 'er', defaultText: '弱关系', defaultWidth: 140, defaultHeight: 96, render: 'doubleDiamond' },

  // ===== AWS（20 个，自绘矢量徽标，非官方版权素材） =====
  { type: 'ec2', label: 'EC2', category: 'aws', defaultText: 'EC2', defaultWidth: 120, defaultHeight: 100, render: 'awsBadge', badge: 'EC2' },
  { type: 's3', label: 'S3', category: 'aws', defaultText: 'S3', defaultWidth: 120, defaultHeight: 100, render: 'awsBadge', badge: 'S3' },
  { type: 'rds', label: 'RDS', category: 'aws', defaultText: 'RDS', defaultWidth: 120, defaultHeight: 100, render: 'awsBadge', badge: 'RDS' },
  { type: 'lambda', label: 'Lambda', category: 'aws', defaultText: 'Lambda', defaultWidth: 120, defaultHeight: 100, render: 'awsBadge', badge: 'λ' },
  { type: 'cloudfront', label: 'CloudFront', category: 'aws', defaultText: 'CloudFront', defaultWidth: 130, defaultHeight: 100, render: 'awsBadge', badge: 'CF' },
  { type: 'dynamodb', label: 'DynamoDB', category: 'aws', defaultText: 'DynamoDB', defaultWidth: 130, defaultHeight: 100, render: 'awsBadge', badge: 'DDB' },
  { type: 'sqs', label: 'SQS', category: 'aws', defaultText: 'SQS', defaultWidth: 120, defaultHeight: 100, render: 'awsBadge', badge: 'SQS' },
  { type: 'sns', label: 'SNS', category: 'aws', defaultText: 'SNS', defaultWidth: 120, defaultHeight: 100, render: 'awsBadge', badge: 'SNS' },
  { type: 'alb', label: 'ALB', category: 'aws', defaultText: 'ALB', defaultWidth: 120, defaultHeight: 100, render: 'awsBadge', badge: 'ALB' },
  { type: 'apigateway', label: 'API Gateway', category: 'aws', defaultText: 'API GW', defaultWidth: 130, defaultHeight: 100, render: 'awsBadge', badge: 'API' },
  { type: 'cloudwatch', label: 'CloudWatch', category: 'aws', defaultText: 'CloudWatch', defaultWidth: 130, defaultHeight: 100, render: 'awsBadge', badge: 'CW' },
  { type: 'vpc', label: 'VPC', category: 'aws', defaultText: 'VPC', defaultWidth: 120, defaultHeight: 100, render: 'awsBadge', badge: 'VPC' },
  { type: 'subnet', label: 'Subnet', category: 'aws', defaultText: 'Subnet', defaultWidth: 120, defaultHeight: 100, render: 'awsBadge', badge: 'SUB' },
  { type: 'iam', label: 'IAM', category: 'aws', defaultText: 'IAM', defaultWidth: 120, defaultHeight: 100, render: 'awsBadge', badge: 'IAM' },
  { type: 'route53', label: 'Route 53', category: 'aws', defaultText: 'Route53', defaultWidth: 130, defaultHeight: 100, render: 'awsBadge', badge: 'R53' },
  { type: 'kms', label: 'KMS', category: 'aws', defaultText: 'KMS', defaultWidth: 120, defaultHeight: 100, render: 'awsBadge', badge: 'KMS' },
  { type: 'eks', label: 'EKS', category: 'aws', defaultText: 'EKS', defaultWidth: 120, defaultHeight: 100, render: 'awsBadge', badge: 'EKS' },
  { type: 'elasticache', label: 'ElastiCache', category: 'aws', defaultText: 'ElastiCache', defaultWidth: 140, defaultHeight: 100, render: 'awsBadge', badge: 'EC' },
  { type: 'cloudtrail', label: 'CloudTrail', category: 'aws', defaultText: 'CloudTrail', defaultWidth: 140, defaultHeight: 100, render: 'awsBadge', badge: 'CT' },
  { type: 'stepfunctions', label: 'Step Functions', category: 'aws', defaultText: 'Step Fn', defaultWidth: 140, defaultHeight: 100, render: 'awsBadge', badge: 'SF' },

  // ===== 网络·通用（13 种） =====
  { type: 'server', label: '服务器', category: 'network', defaultText: 'Server', defaultWidth: 140, defaultHeight: 110, render: 'cylinder' },
  { type: 'router', label: '路由器', category: 'network', defaultText: 'Router', defaultWidth: 130, defaultHeight: 110, render: 'router' },
  { type: 'switch', label: '交换机', category: 'network', defaultText: 'Switch', defaultWidth: 150, defaultHeight: 90, render: 'switch' },
  { type: 'firewall', label: '防火墙', category: 'network', defaultText: 'Firewall', defaultWidth: 150, defaultHeight: 110, render: 'firewall' },
  { type: 'loadbalancer', label: '负载均衡', category: 'network', defaultText: 'LB', defaultWidth: 160, defaultHeight: 90, render: 'loadbalancer' },
  { type: 'cloud', label: '云', category: 'network', defaultText: 'Cloud', defaultWidth: 150, defaultHeight: 100, render: 'cloud' },
  { type: 'user', label: '用户', category: 'network', defaultText: 'User', defaultWidth: 90, defaultHeight: 120, render: 'actor' },
  { type: 'pc', label: '桌面 PC', category: 'network', defaultText: 'PC', defaultWidth: 130, defaultHeight: 100, render: 'device' },
  { type: 'phone', label: '手机', category: 'network', defaultText: 'Phone', defaultWidth: 80, defaultHeight: 130, render: 'device' },
  { type: 'tablet', label: '平板', category: 'network', defaultText: 'Tablet', defaultWidth: 100, defaultHeight: 130, render: 'device' },
  { type: 'laptop', label: '笔记本', category: 'network', defaultText: 'Laptop', defaultWidth: 150, defaultHeight: 100, render: 'device' },
  { type: 'mail', label: '邮件', category: 'network', defaultText: 'Mail', defaultWidth: 140, defaultHeight: 100, render: 'envelope' },
  { type: 'storage', label: '存储桶', category: 'network', defaultText: 'Storage', defaultWidth: 140, defaultHeight: 110, render: 'cylinder' },

  // ===== 结构（容器 / 泳道 / 分组） =====
  { type: 'container', label: '容器', category: 'struct', defaultText: 'Container', defaultWidth: 280, defaultHeight: 180, render: 'container' },
  { type: 'swimlane', label: '泳道', category: 'struct', defaultText: '泳道', defaultWidth: 520, defaultHeight: 160, render: 'swimlane' },
  { type: 'group', label: '分组', category: 'struct', defaultText: 'Group', defaultWidth: 240, defaultHeight: 160, render: 'group' },
];

/** 全部形状（注册 / 落库映射用） */
export const ALL_SHAPES: ShapeDef[] = [...SHAPES, ...EXTRA_SHAPES];

export const SHAPE_BY_TYPE: Record<string, ShapeDef> = Object.fromEntries(
  ALL_SHAPES.map((s) => [s.type, s]),
);

/** 图形库分组（P2-T1.1 手风琴） */
export interface LibraryGroup {
  id: ShapeCategory;
  name: string;
  shapes: DiagramShapeType[];
}

export const SHAPE_GROUPS: LibraryGroup[] = [
  { id: 'basic', name: '基础形状', shapes: ['rect', 'rounded', 'ellipse', 'diamond', 'hexagon', 'triangle', 'parallelogram'] },
  {
    id: 'flow',
    name: '流程图 / BPMN',
    shapes: [
      'terminal', 'process', 'decision', 'io', 'preparation', 'note', 'card',
      'database', 'disk', 'document', 'storedData', 'manual', 'delay', 'predefined',
      'loopLimit', 'pageRef', 'offpage',
    ],
  },
  {
    id: 'uml',
    name: 'UML',
    shapes: ['class', 'interface', 'annotation', 'actor', 'usecase', 'package', 'component', 'state', 'start', 'end'],
  },
  {
    id: 'er',
    name: 'ER 图',
    shapes: ['entity', 'weakEntity', 'attribute', 'multiAttr', 'keyAttr', 'relation', 'weakRelation'],
  },
  {
    id: 'aws',
    name: 'AWS',
    shapes: [
      'ec2', 's3', 'rds', 'lambda', 'cloudfront', 'dynamodb', 'sqs', 'sns', 'alb',
      'apigateway', 'cloudwatch', 'vpc', 'subnet', 'iam', 'route53', 'kms', 'eks',
      'elasticache', 'cloudtrail', 'stepfunctions',
    ],
  },
  {
    id: 'network',
    name: '网络 / 通用',
    shapes: ['server', 'router', 'switch', 'firewall', 'loadbalancer', 'cloud', 'user', 'pc', 'phone', 'tablet', 'laptop', 'mail', 'storage'],
  },
  {
    id: 'struct',
    name: '结构',
    shapes: ['container', 'swimlane', 'group'],
  },
];

/** UML 关系边工具（图形库 UML 分组下的连线工具，点两节点连边） */
export type UmlRelationType =
  | 'generalization' | 'realization' | 'aggregation' | 'composition' | 'association' | 'dependency';

export const UML_RELATIONS: { type: UmlRelationType; label: string }[] = [
  { type: 'generalization', label: '继承' },
  { type: 'realization', label: '实现' },
  { type: 'aggregation', label: '聚合' },
  { type: 'composition', label: '组合' },
  { type: 'association', label: '关联' },
  { type: 'dependency', label: '依赖' },
];

/** 取形状定义，未知 type 回退到矩形，避免坏数据让画布渲染崩 */
export function shapeOf(type: string | null | undefined): ShapeDef {
  if (type && SHAPE_BY_TYPE[type]) return SHAPE_BY_TYPE[type];
  return SHAPE_BY_TYPE.rect;
}

/**
 * 计算节点 SVG 外形（真实像素坐标，避免 viewBox 拉伸导致描边粗细不均）。
 * 返回一个描述对象，CustomNode 据此渲染 <rect> / <ellipse> / <polygon> 或 UML 表头。
 * P2-T1 新增 render 种类统一走 default（矩形）兜底，旧 Vue Flow 路径不受影响。
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
