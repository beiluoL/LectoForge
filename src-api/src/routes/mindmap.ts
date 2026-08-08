/**
 * 思维导图路由
 *
 * 两个插件、两个前缀，刻意分开注册：
 * - default 导出 → /api/mindmaps：纯 CRUD，落本地 JSON 文件，永远可用，不依赖 AI。
 * - mindmapAiRoutes → /api/ai：AI 大纲生成，未配置 Key 时返回 Mock 结构而不是报错，
 *   保证「没有 Key 也能把整条前端链路跑通」——这是本页面能独立演示的前提。
 */
import { FastifyInstance, FastifyReply } from 'fastify';

import { LlmError, chatJson, isReady, stripHtml } from '../lib/llm';
import {
  MindMapError,
  createMindMap,
  defaultOutline,
  deleteMindMap,
  getMindMap,
  listMindMaps,
  nextId,
  normalizeOutline,
  seedIfEmpty,
  updateMindMap,
  type OutlineNode,
} from '../lib/mindmapStore';
import {
  buildMindMapPrompt,
  buildNoteMindMapPrompt,
  type MindMapOutlineNode,
  type MindMapOutput,
} from '../lib/prompts';

/** 首次加载时播种示例导图，只在 mindmaps 目录为空时生效 */
seedIfEmpty();

// ===================== CRUD =====================

export default async function (app: FastifyInstance) {
  /** GET /api/mindmaps —— 项目列表（不含正文，按 updatedAt 倒序） */
  app.get('/', async () => ({ items: listMindMaps() }));

  /** POST /api/mindmaps —— 新建，未传大纲时给一份示例内容而不是空白页 */
  app.post('/', async (req) => {
    const b = (req.body || {}) as { title?: string; outlineData?: unknown; flowchartData?: unknown };
    return createMindMap(b);
  });

  /** GET /api/mindmaps/:id —— 取完整文档（outlineData + flowchartData） */
  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    return getMindMap(id);
  });

  /**
   * PUT /api/mindmaps/:id —— 保存
   * 局部更新语义：只覆盖请求体里出现的字段，因此前端可以只推大纲、只推流程图或只改标题。
   */
  app.put('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = (req.body || {}) as { title?: unknown; outlineData?: unknown; flowchartData?: unknown };
    if (b.title === undefined && b.outlineData === undefined && b.flowchartData === undefined) {
      throw new MindMapError('请求体为空，没有需要保存的字段', 400);
    }
    const doc = updateMindMap(id, b);
    return { id: doc.id, title: doc.title, updatedAt: doc.updatedAt };
  });

  /** DELETE /api/mindmaps/:id */
  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    return deleteMindMap(id);
  });
}

// ===================== AI 生成 =====================

/** 统一异常出口，与 routes/ai.ts 的 fail() 保持同一契约（aiCode 供前端判断是否引导去设置页） */
function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof LlmError) {
    return reply.code(e.status).send({ code: e.status, message: e.message, aiCode: e.code });
  }
  const msg = e instanceof Error ? e.message : String(e);
  return reply.code(500).send({ code: 500, message: `AI 生成失败：${msg}`, aiCode: 'AI_UPSTREAM_ERROR' });
}

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

/**
 * AI 大纲生成路由（挂载在 /api/ai）
 * POST /api/ai/generate-mindmap        —— 由主题词发散
 * POST /api/ai/note/generate-mindmap   —— 由康奈尔笔记正文归纳
 */
export async function mindmapAiRoutes(app: FastifyInstance) {
  app.post('/generate-mindmap', async (req, reply) => {
    const b = (req.body || {}) as { topic?: string; depth?: number; branches?: number };
    const topic = String(b.topic || '').trim();
    if (!topic) {
      return reply.code(400).send({ code: 400, message: '请先输入主题词', aiCode: 'AI_BAD_INPUT' });
    }

    // 未配置 Key：不报错，直接给 Mock，前端整条链路（生成 → 覆盖大纲 → 渲染导图）照样跑通
    if (!isReady()) {
      return {
        title: topic.slice(0, 60),
        outline: mockOutline(topic),
        mock: true,
        model: 'mock',
        latencyMs: 0,
      };
    }

    try {
      const { data, raw } = await chatJson<MindMapOutput>(
        buildMindMapPrompt({ topic, depth: b.depth, branches: b.branches }),
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
    } catch (e) {
      return fail(reply, e);
    }
  });

  /**
   * POST /api/ai/note/generate-mindmap —— 由康奈尔笔记正文生成大纲
   *
   * 只算不存：返回 { title, outline }，由前端决定是否再调 POST /api/mindmaps 落一份导图文档。
   * 这样「生成后不满意」不会在导图列表里留垃圾。
   */
  app.post('/note/generate-mindmap', async (req, reply) => {
    const b = (req.body || {}) as {
      noteColumn?: string;
      title?: string;
      cueColumn?: string;
      depth?: number;
      branches?: number;
    };
    const note = stripHtml(b.noteColumn);
    const noteTitle = String(b.title || '').trim();
    if (!note || note.length < 30) {
      return reply
        .code(400)
        .send({ code: 400, message: '笔记正文太短（至少 30 字），先写充实一点再生成导图', aiCode: 'AI_BAD_INPUT' });
    }
    const fallbackTitle = (noteTitle || note.replace(/\s+/g, ' ').slice(0, 20)).slice(0, 60);

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

    try {
      const { data, raw } = await chatJson<MindMapOutput>(
        buildNoteMindMapPrompt({
          title: noteTitle,
          noteColumn: note,
          cueColumn: stripHtml(b.cueColumn) || undefined,
          depth: b.depth,
          branches: b.branches,
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
    } catch (e) {
      return fail(reply, e);
    }
  });
}
