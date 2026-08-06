/**
 * 思维导图本地文件存储（fs + JSON）
 *
 * 【为什么不走 SQLite】
 * 大纲树与流程图都是「整块读、整块写」的嵌套 JSON，没有按字段查询的需求；
 * 拆成关系表反而要写递归组装逻辑。这里沿用 lib/vault.ts 的思路直接落盘，
 * 一个导图一个文件，用户可以直接拷走 / 备份 / 版本管理，符合本地优先的产品定位。
 *
 * 落盘位置：<dataDir>/mindmaps/<id>.json（dataDir 由 lib/paths.ts 统一解析）
 */
import fs from 'node:fs';
import path from 'node:path';

import { resolveDataDir } from './paths';

// ===================== 类型 =====================

/** 大纲节点：极简三字段树，children 恒为数组（缺省时归一化为 []） */
export interface OutlineNode {
  id: string;
  text: string;
  /** 是否折叠子节点，仅影响展示 */
  collapsed?: boolean;
  children: OutlineNode[];
}

/** 流程图数据：直接沿用 vue-flow 的 { nodes, edges } 标准结构，服务端不做语义校验 */
export interface FlowchartData {
  nodes: unknown[];
  edges: unknown[];
}

export interface MindMapDoc {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  outlineData: OutlineNode[];
  flowchartData: FlowchartData;
}

/** 列表项：只回传列表页要用的字段，避免把整棵树塞进列表响应 */
export interface MindMapMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 大纲节点总数，列表页展示规模用 */
  nodeCount: number;
}

/** 带 HTTP 状态码的业务异常，交给 index.ts 的 setErrorHandler 统一转成 { code, message } */
export class MindMapError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'MindMapError';
    this.statusCode = statusCode;
  }
}

// ===================== 目录与 id =====================

/** id 白名单：只允许字母数字与 - _，杜绝 ../ 路径穿越 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function mapsDir(): string {
  const dir = path.join(resolveDataDir(), 'mindmaps');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileOf(id: string): string {
  if (!ID_PATTERN.test(id)) throw new MindMapError('非法的导图 id', 400);
  return path.join(mapsDir(), `${id}.json`);
}

let seq = 0;
export function nextId(prefix = 'mm'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ===================== 归一化 =====================

/**
 * 递归清洗外部传入的大纲树。
 * 做三件事：补 id、去掉多余字段、限制深度与总量——防止前端 bug 或恶意载荷把文件撑爆。
 */
export function normalizeOutline(input: unknown, depth = 0, counter = { n: 0 }): OutlineNode[] {
  if (!Array.isArray(input) || depth > 12) return [];
  const out: OutlineNode[] = [];
  for (const raw of input) {
    if (counter.n >= 2000) break;
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    counter.n += 1;
    const node: OutlineNode = {
      id: typeof item.id === 'string' && item.id ? item.id.slice(0, 64) : nextId('n'),
      text: String(item.text ?? '').replace(/[\r\n]+/g, ' ').slice(0, 500),
      children: normalizeOutline(item.children, depth + 1, counter),
    };
    if (item.collapsed === true) node.collapsed = true;
    out.push(node);
  }
  return out;
}

/** 流程图只校验外壳，节点内部结构交给 vue-flow 自己消化 */
function normalizeFlowchart(input: unknown): FlowchartData {
  const obj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    nodes: Array.isArray(obj.nodes) ? obj.nodes.slice(0, 1000) : [],
    edges: Array.isArray(obj.edges) ? obj.edges.slice(0, 2000) : [],
  };
}

function countNodes(nodes: OutlineNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

// ===================== 读写 =====================

function readFileSafe(id: string): MindMapDoc | null {
  const file = fileOf(id);
  if (!fs.existsSync(file)) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<MindMapDoc>;
    return {
      id,
      title: String(doc.title || '未命名导图').slice(0, 120),
      createdAt: Number(doc.createdAt) || Date.now(),
      updatedAt: Number(doc.updatedAt) || Date.now(),
      outlineData: normalizeOutline(doc.outlineData),
      flowchartData: normalizeFlowchart(doc.flowchartData),
    };
  } catch {
    // 单个文件损坏不应该让整个列表接口挂掉，跳过即可
    return null;
  }
}

/**
 * 原子写：先写临时文件再 rename。
 * 直接覆盖写在保存瞬间断电/崩溃时会留下半截 JSON，下次启动整张导图就没了。
 */
function writeFileAtomic(doc: MindMapDoc): void {
  const file = fileOf(doc.id);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function listMindMaps(): MindMapMeta[] {
  const dir = mapsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const metas: MindMapMeta[] = [];
  for (const f of files) {
    const doc = readFileSafe(path.basename(f, '.json'));
    if (!doc) continue;
    metas.push({
      id: doc.id,
      title: doc.title,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      nodeCount: countNodes(doc.outlineData),
    });
  }
  // 最近编辑的排前面，与列表侧栏的使用直觉一致
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getMindMap(id: string): MindMapDoc {
  const doc = readFileSafe(id);
  if (!doc) throw new MindMapError('导图不存在或已被删除', 404);
  return doc;
}

export function createMindMap(input: {
  title?: string;
  outlineData?: unknown;
  flowchartData?: unknown;
}): MindMapDoc {
  const now = Date.now();
  const doc: MindMapDoc = {
    id: nextId(),
    title: String(input.title || '未命名导图').trim().slice(0, 120) || '未命名导图',
    createdAt: now,
    updatedAt: now,
    outlineData: input.outlineData ? normalizeOutline(input.outlineData) : defaultOutline(),
    flowchartData: normalizeFlowchart(input.flowchartData),
  };
  writeFileAtomic(doc);
  return doc;
}

/** 局部更新：只覆盖显式传入的字段，前端可以只 PUT 大纲或只 PUT 流程图 */
export function updateMindMap(
  id: string,
  patch: { title?: unknown; outlineData?: unknown; flowchartData?: unknown },
): MindMapDoc {
  const doc = getMindMap(id);
  if (patch.title !== undefined) {
    doc.title = String(patch.title || '').trim().slice(0, 120) || doc.title;
  }
  if (patch.outlineData !== undefined) doc.outlineData = normalizeOutline(patch.outlineData);
  if (patch.flowchartData !== undefined) doc.flowchartData = normalizeFlowchart(patch.flowchartData);
  doc.updatedAt = Date.now();
  writeFileAtomic(doc);
  return doc;
}

export function deleteMindMap(id: string): { id: string } {
  const file = fileOf(id);
  if (!fs.existsSync(file)) throw new MindMapError('导图不存在或已被删除', 404);
  fs.unlinkSync(file);
  return { id };
}

// ===================== 种子数据 =====================

/** 内置示例大纲：4 级深度，保证第一次打开页面就有内容可看、可操作 */
export function defaultOutline(): OutlineNode[] {
  const n = (text: string, children: OutlineNode[] = []): OutlineNode => ({
    id: nextId('n'),
    text,
    children,
  });
  return [
    n('前端工程化', [
      n('构建工具', [n('Vite：ESM + esbuild 预构建'), n('Webpack：Loader / Plugin 机制')]),
      n('框架', [
        n('Vue 3', [n('响应式原理：Proxy + 依赖收集'), n('组合式 API：setup / ref / reactive')]),
        n('React', [n('Hooks 与依赖数组'), n('虚拟 DOM 与 Fiber')]),
      ]),
      n('类型系统', [n('TypeScript 泛型'), n('类型体操与工具类型')]),
    ]),
    n('后端与服务', [
      n('Node.js', [n('Fastify：插件化与生命周期钩子'), n('事件循环与异步 I/O')]),
      n('数据存储', [n('SQLite：本地优先、零运维'), n('索引与查询优化')]),
      n('接口设计', [n('RESTful 资源建模'), n('统一响应信封与错误码')]),
    ]),
    n('学习方法', [
      n('费曼技巧', [n('用大白话讲给外行听'), n('讲不清楚 = 没学会')]),
      n('间隔重复', [n('SM-2 算法与遗忘曲线'), n('主动回忆优于被动重读')]),
    ]),
  ];
}

/** 内置示例流程图：一条最小可用的「开始 → 判断 → 结束」链路 */
function defaultFlowchart(): FlowchartData {
  return {
    nodes: [
      { id: 'f1', type: 'rounded', position: { x: 260, y: 40 }, data: { label: '开始学习' } },
      { id: 'f2', type: 'rect', position: { x: 240, y: 160 }, data: { label: '阅读资料 / 做笔记' } },
      { id: 'f3', type: 'diamond', position: { x: 245, y: 290 }, data: { label: '能讲清楚吗？' } },
      { id: 'f4', type: 'rect', position: { x: 40, y: 430 }, data: { label: '回到原文补漏' } },
      { id: 'f5', type: 'rounded', position: { x: 450, y: 430 }, data: { label: '进入间隔复习' } },
    ],
    edges: [
      { id: 'e1', source: 'f1', target: 'f2', markerEnd: 'arrowclosed' },
      { id: 'e2', source: 'f2', target: 'f3', markerEnd: 'arrowclosed' },
      { id: 'e3', source: 'f3', target: 'f4', label: '否', markerEnd: 'arrowclosed' },
      { id: 'e4', source: 'f3', target: 'f5', label: '是', markerEnd: 'arrowclosed' },
      { id: 'e5', source: 'f4', target: 'f2', markerEnd: 'arrowclosed' },
    ],
  };
}

/**
 * 首次启动播种。
 * 只在目录完全为空时执行，用户删光了自己的导图也不会被反复塞回示例。
 */
export function seedIfEmpty(): void {
  try {
    const dir = mapsDir();
    if (fs.readdirSync(dir).some((f) => f.endsWith('.json'))) return;
    const now = Date.now();
    writeFileAtomic({
      id: 'mm_demo_learning_path',
      title: '我的学习路线',
      createdAt: now,
      updatedAt: now,
      outlineData: defaultOutline(),
      flowchartData: defaultFlowchart(),
    });
  } catch (e) {
    console.error('[mindmap] 种子数据写入失败', e);
  }
}
