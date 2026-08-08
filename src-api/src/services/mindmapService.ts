/**
 * 思维导图 CRUD 业务层（落本地 JSON 文件，永远可用，不依赖 AI）。
 *
 * 磁盘读写全部委托 lib/mindmapStore.ts；本层只负责「请求体是否有可保存字段」
 * 这类与 HTTP 无关的业务前置校验，并继续抛 MindMapError（自带 statusCode）
 * 交给 index.ts 的全局 errorHandler 统一转成 { code, message }。
 */
import {
  MindMapError,
  createMindMap,
  deleteMindMap,
  getMindMap,
  listMindMaps,
  seedIfEmpty,
  updateMindMap,
  type MindMapDoc,
  type MindMapMeta,
} from '../lib/mindmapStore';
import type { CreateMindMapDTO, UpdateMindMapDTO, UpdateMindMapVO } from '../types/mindmap';

/* 首次加载时播种示例导图，只在 mindmaps 目录为空时生效。
 * 放在 service 顶层而非路由文件：本模块被 controller → route → index 逐层引入，
 * 副作用发生的时机与重构前（路由文件顶层调用）在同一次 import 中，行为不变。 */
seedIfEmpty();

/** 项目列表（不含正文，按 updatedAt 倒序） */
export function list(): { items: MindMapMeta[] } {
  return { items: listMindMaps() };
}

/** 取完整文档（outlineData + flowchartData）；不存在时 store 抛 404 */
export function detail(id: string): MindMapDoc {
  return getMindMap(id);
}

/** 新建导图 */
export function create(input: CreateMindMapDTO): MindMapDoc {
  return createMindMap(input);
}

/**
 * 保存导图（局部更新语义：只覆盖请求体里出现的字段，
 * 因此前端可以只推大纲、只推流程图或只改标题）。
 */
export function update(id: string, patch: UpdateMindMapDTO): UpdateMindMapVO {
  if (patch.title === undefined && patch.outlineData === undefined && patch.flowchartData === undefined) {
    throw new MindMapError('请求体为空，没有需要保存的字段', 400);
  }
  const doc = updateMindMap(id, patch);
  return { id: doc.id, title: doc.title, updatedAt: doc.updatedAt };
}

/** 删除导图；不存在时 store 抛 404 */
export function remove(id: string): { id: string } {
  return deleteMindMap(id);
}
