/**
 * 思维导图 AI 大纲生成业务层。
 *
 * 关键设计：未配置 Key 时**不报错**，而是返回结构完全一致的 Mock / 硬解析结果，
 * 保证「没有 Key 也能把整条前端链路（生成 → 覆盖大纲 → 渲染导图）跑通」——
 * 这是该页面能独立演示的前提。
 *
 * 入参的空值 / 长度校验留在 controller（那属于 HTTP 400 语义），
 * 本层只提供 normalizeTopic / prepareNoteText 这类纯函数供其调用。
 */
import { chatJson, isReady, stripHtml } from '../lib/llm';
import {
  defaultOutline,
  nextId,
  normalizeOutline,
  type OutlineNode,
} from '../lib/mindmapStore';
import {
  buildMindMapPrompt,
  buildNoteMindMapPrompt,
  type MindMapOutlineNode,
  type MindMapOutput,
} from '../lib/prompts';
import type { GenerateOutlineVO } from '../types/mindmap';

/** 模型返回的裸树 → 带 id 的 OutlineNode 树 */
function attachIds(nodes: MindMapOutlineNode[] | undefined, depth = 0): OutlineNode[] {
  if (!Array.isArray(nodes) || depth > 8) return [];
  return nodes
    .filter((n) => n && typeof n === 'object' && String(n.text ?? '').trim())
    .slice(0, 30)
    .map((n) => ({
      id: nextId('n'),
      text: String(n.text).replace(/[\r\n]+/g, ' ').trim().slice(0, 200),
      children: attachIds(n.children, depth + 1),
    }));
}

/**
 * 未配置 Key 时的兜底大纲。
 * 结构与真实 AI 输出完全一致，前端拿到就能渲染，方便无 Key 环境下调 UI。
 */
function mockOutline(topic: string): OutlineNode[] {
  const t = topic.trim() || '未命名主题';
  const n = (text: string, children: OutlineNode[] = []): OutlineNode => ({
    id: nextId('n'),
    text,
    children,
  });
  return [
    n('核心概念', [
      n(`${t} 是什么`, [n('定义与边界'), n('解决什么问题')]),
      n('关键术语', [n('术语 A'), n('术语 B')]),
    ]),
    n('知识体系', [
      n('基础层', [n('前置知识'), n('必备工具')]),
      n('进阶层', [n('常见模式'), n('性能与优化')]),
    ]),
    n('实践路径', [
      n('入门练习', [n('最小可运行示例')]),
      n('综合项目', [n('端到端实现'), n('复盘与重构')]),
    ]),
    n('常见误区', [n('易混淆的点'), n('踩坑清单')]),
    n('延伸资源', [n('官方文档'), n('经典书籍与课程')]),
  ];
}

/**
 * 无 Key 时由笔记正文「硬解析」出的大纲。
 *
 * 与 mockOutline 的区别：mockOutline 是与内容无关的示例骨架，
 * 这里则真的按 Markdown 标题层级 + 列表缩进还原笔记结构——
 * 笔记本身写得有结构时，不调模型也能得到一张可用的导图。
 */
function outlineFromNoteText(text: string): OutlineNode[] {
  const root: OutlineNode = { id: nextId('n'), text: 'root', children: [] };
  const stack: { level: number; node: OutlineNode }[] = [{ level: 0, node: root }];
  let headingLevel = 0;
  let count = 0;

  const push = (level: number, raw: string) => {
    const t = raw
      .replace(/[*_`~]/g, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    if (!t) return;
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const node: OutlineNode = { id: nextId('n'), text: t, children: [] };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ level, node });
    count += 1;
  };

  for (const line of text.split(/\r?\n/)) {
    if (count >= 60) break;
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) {
      headingLevel = h[1].length;
      push(headingLevel, h[2]);
      continue;
    }
    const b = /^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (b) {
      const indent = Math.floor(b[1].replace(/\t/g, '  ').length / 2);
      push(headingLevel + 1 + Math.min(indent, 3), b[2]);
    }
  }

  // 纯段落笔记：退化成「每段取首句」，至少让节点是笔记里的原话
  if (!root.children.length) {
    text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 6)
      .forEach((p) => push(1, p.split(/(?<=[。！？.!?])\s*/)[0] || p));
  }
  return root.children;
}

/** 主题词归一化（供 controller 做空值 400 判断） */
export function normalizeTopic(raw?: string): string {
  return String(raw || '').trim();
}

/** 笔记正文去标签（供 controller 做长度 400 判断） */
export function prepareNoteText(raw?: string): string {
  return stripHtml(raw);
}

/** 笔记没给标题时，用正文前 20 字兜底 */
export function buildNoteFallbackTitle(noteTitle: string, note: string): string {
  return (noteTitle || note.replace(/\s+/g, ' ').slice(0, 20)).slice(0, 60);
}

/** 由主题词发散生成大纲 */
export async function generateFromTopic(input: {
  topic: string;
  depth?: number;
  branches?: number;
}): Promise<GenerateOutlineVO> {
  const { topic } = input;

  // 未配置 Key：不报错，直接给 Mock，前端整条链路照样跑通
  if (!isReady()) {
    return {
      title: topic.slice(0, 60),
      outline: mockOutline(topic),
      mock: true,
      model: 'mock',
      latencyMs: 0,
    };
  }

  const { data, raw } = await chatJson<MindMapOutput>(
    buildMindMapPrompt({ topic, depth: input.depth, branches: input.branches }),
    { temperature: 0.6 },
  );
  const outline = attachIds(data.outline);
  if (!outline.length) {
    // 模型偶尔会把整棵树塞进 title 或返回空数组，这里兜底成示例结构而不是丢给用户一个空页面
    return {
      title: String(data.title || topic).slice(0, 60),
      outline: normalizeOutline(defaultOutline()),
      mock: true,
      model: raw.model,
      latencyMs: raw.latencyMs,
    };
  }
  return {
    title: String(data.title || topic).trim().slice(0, 60) || topic.slice(0, 60),
    outline,
    mock: false,
    model: raw.model,
    latencyMs: raw.latencyMs,
  };
}

/**
 * 由康奈尔笔记正文归纳生成大纲。
 *
 * 只算不存：返回 { title, outline }，由前端决定是否再调 POST /api/mindmaps 落一份导图文档。
 * 这样「生成后不满意」不会在导图列表里留垃圾。
 */
export async function generateFromNote(input: {
  note: string;
  noteTitle: string;
  fallbackTitle: string;
  cueColumn?: string;
  depth?: number;
  branches?: number;
}): Promise<GenerateOutlineVO> {
  const { note, noteTitle, fallbackTitle } = input;

  // 未配置 Key：用标题层级硬解析，整条链路照样跑通
  if (!isReady()) {
    const parsed = outlineFromNoteText(note);
    return {
      title: fallbackTitle,
      outline: parsed.length ? parsed : mockOutline(fallbackTitle),
      mock: true,
      model: 'mock',
      latencyMs: 0,
    };
  }

  const { data, raw } = await chatJson<MindMapOutput>(
    buildNoteMindMapPrompt({
      title: noteTitle,
      noteColumn: note,
      cueColumn: stripHtml(input.cueColumn) || undefined,
      depth: input.depth,
      branches: input.branches,
    }),
    { temperature: 0.4 },
  );
  const outline = attachIds(data.outline);
  if (!outline.length) {
    const parsed = outlineFromNoteText(note);
    return {
      title: String(data.title || fallbackTitle).slice(0, 60),
      outline: parsed.length ? parsed : normalizeOutline(defaultOutline()),
      mock: true,
      model: raw.model,
      latencyMs: raw.latencyMs,
    };
  }
  return {
    title: String(data.title || fallbackTitle).trim().slice(0, 60) || fallbackTitle,
    outline,
    mock: false,
    model: raw.model,
    latencyMs: raw.latencyMs,
  };
}
