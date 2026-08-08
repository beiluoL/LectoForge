/* 思维导图领域类型
 *
 * 文档结构（MindMapDoc / MindMapMeta / OutlineNode / FlowchartData）仍以
 * lib/mindmapStore.ts 为唯一定义源，这里只补充路由层的 DTO / VO，避免重复声明。
 */
import type { OutlineNode } from '../lib/mindmapStore';

/** POST /api/mindmaps —— 未传大纲时 store 会给一份示例内容而不是空白页 */
export interface CreateMindMapDTO {
  title?: string;
  outlineData?: unknown;
  flowchartData?: unknown;
}

/** PUT /api/mindmaps/:id —— 局部更新：只覆盖请求体里出现的字段 */
export interface UpdateMindMapDTO {
  title?: unknown;
  outlineData?: unknown;
  flowchartData?: unknown;
}

/** 保存成功后只回传三个字段，避免把整棵树再回传一次 */
export interface UpdateMindMapVO {
  id: string;
  title: string;
  updatedAt: number;
}

/** POST /api/ai/generate-mindmap —— 由主题词发散 */
export interface GenerateMindMapDTO {
  topic?: string;
  depth?: number;
  branches?: number;
}

/** POST /api/ai/note/generate-mindmap —— 由康奈尔笔记正文归纳 */
export interface GenerateNoteMindMapDTO {
  noteColumn?: string;
  title?: string;
  cueColumn?: string;
  depth?: number;
  branches?: number;
}

/**
 * AI 大纲生成的统一返回体。
 * mock=true 表示这份结果没有真正调模型（未配置 Key 或模型返回空），
 * 前端据此决定要不要提示「当前为演示数据」。
 */
export interface GenerateOutlineVO {
  title: string;
  outline: OutlineNode[];
  mock: boolean;
  model: string;
  latencyMs: number;
}
