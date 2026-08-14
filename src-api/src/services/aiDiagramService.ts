/**
 * 绘图工具 —— AI 自然语言生成流程图业务层。
 *
 * 设计要点（与 mindmapAiService 对齐）：
 * - 复用 lib/llm 的 chatJson（OpenAI 兼容 / 统一 JSON 解析 / LlmError）。
 * - 未配置 Key（isReady()=false）时**不报错**，返回结构与真实输出完全一致的示例骨架，
 *   保证「没有 Key 也能把整条前端链路（生成 → 覆盖画布 → 自动布局）跑通」，
 *   同时用 mock=true 让前端提示「未配置 AI，已生成示例」。
 * - 配置就绪但模型解析失败时同样兜底成示例，不让用户面对空画布。
 *
 * 只产出「图结构」（nodes/edges，无坐标），坐标由前端用 dagre 自动布局计算——
 * 这样无论后端模型如何，最终节点位置都整齐，避免 AI 乱给坐标导致重叠。
 */
import { chatJson, isReady } from '../lib/llm';
import type { AiDiagramEdge, AiDiagramGenRequest, AiDiagramGenResponse, AiDiagramNode } from '../types/diagram';

/** 已知形状集合（与前端 shapeDefs 对齐），用于校验模型给的 type */
const KNOWN_TYPES = new Set([
  'terminal',
  'process',
  'decision',
  'rect',
  'ellipse',
  'diamond',
  'hexagon',
  'note',
]);

const SYSTEM_PROMPT = `你是流程图生成助手。用户用自然语言描述一个流程，你输出一个 JSON 流程图。
严格要求：
- 只输出一个 JSON 对象，不要 markdown 代码块、不要任何解释文字。
- 结构：{"nodes":[{"id":"n1","label":"开始","type":"terminal"}, ...],"edges":[{"from":"n1","to":"n2","label":""}, ...]}
- type 只能取以下之一：terminal（开始/结束）、process（处理/步骤）、decision（判断/分支）、rect（普通矩形）、ellipse（椭圆/输入输出）、diamond（菱形）、hexagon（六边形）、note（注释）。不确定时用 process。
- id 用 n1、n2…… 这种稳定字符串；edges 的 from/to 必须引用真实存在的 node id。
- 流程要连通、有开始有结束，标签用中文，简洁明了。
- nodes 控制在 4~12 个，edges 不冗余（不要两两互连）。`;

/** 未配置 Key / 解析失败时的示例骨架（结构与真实输出一致） */
function mockGraph(prompt: string): { nodes: AiDiagramNode[]; edges: AiDiagramEdge[] } {
  const t = (prompt.trim().slice(0, 16) || '流程');
  return {
    nodes: [
      { id: 'n1', label: '开始', type: 'terminal' },
      { id: 'n2', label: `处理：${t}`, type: 'process' },
      { id: 'n3', label: '是否完成？', type: 'decision' },
      { id: 'n4', label: '结束', type: 'terminal' },
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
      { from: 'n3', to: 'n4', label: '是' },
      { from: 'n3', to: 'n2', label: '否' },
    ],
  };
}

function normalize(raw: { nodes?: AiDiagramNode[]; edges?: AiDiagramEdge[] } | null | undefined): {
  nodes: AiDiagramNode[];
  edges: AiDiagramEdge[];
} {
  const nodes = Array.isArray(raw?.nodes)
    ? raw!.nodes!
        .filter((n) => n && String(n.id ?? '').trim() && String(n.label ?? '').trim())
        .slice(0, 30)
        .map((n) => ({
          id: String(n.id).trim(),
          label: String(n.label).replace(/[\r\n]+/g, ' ').trim().slice(0, 200),
          type: n.type && KNOWN_TYPES.has(n.type) ? n.type : 'process',
        }))
    : [];
  const idset = new Set(nodes.map((n) => n.id));
  const edges = Array.isArray(raw?.edges)
    ? raw!.edges!
        .filter((e) => e && idset.has(String(e.from)) && idset.has(String(e.to)) && String(e.from) !== String(e.to))
        .slice(0, 80)
        .map((e) => ({
          from: String(e.from),
          to: String(e.to),
          label: e.label == null ? null : String(e.label).replace(/[\r\n]+/g, ' ').trim().slice(0, 60),
        }))
    : [];
  return { nodes, edges };
}

/**
 * 由自然语言生成流程图结构（无坐标）。
 * 空 prompt 由 controller 判 400；本层假设 prompt 已非空。
 */
export async function generateDiagram(input: AiDiagramGenRequest): Promise<AiDiagramGenResponse> {
  const prompt = String(input.prompt || '').trim();

  // 未配置 Key：不报错，直接给示例骨架，前端整条链路照样跑通
  if (!isReady()) {
    return { ...mockGraph(prompt), mock: true };
  }

  try {
    const { data } = await chatJson<{ nodes: AiDiagramNode[]; edges: AiDiagramEdge[] }>(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `请为以下需求生成流程图：${prompt}` },
      ],
      { temperature: 0.5, maxTokens: 2000 },
    );
    const { nodes, edges } = normalize(data);
    if (!nodes.length || !edges.length) {
      return { ...mockGraph(prompt), mock: true };
    }
    return { nodes, edges, mock: false };
  } catch {
    // 模型返回非法 JSON 等：兜底成示例，不让用户面对空画布
    return { ...mockGraph(prompt), mock: true };
  }
}
