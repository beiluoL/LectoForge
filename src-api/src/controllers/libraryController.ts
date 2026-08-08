import fs from 'node:fs';

import type { FastifyReply, FastifyRequest } from 'fastify';

import * as libraryService from '../services/libraryService';
import type {
  CreateFolderDTO,
  CreateNoteDTO,
  DeleteEntryDTO,
  RenameEntryDTO,
  UpdateNoteDTO,
  WorkspaceInitDTO,
} from '../types/library';

/** Fastify 未声明 schema 时 req.query/body 为 unknown，这里用显式结构收口，避免 any */
interface BrowseQuery {
  dir?: string;
}
interface ParentQuery {
  parent?: string;
}
interface KeywordQuery {
  q?: string;
}
interface IdQuery {
  id?: string;
}
interface PathQuery {
  path?: string;
}
interface NameQuery {
  name?: string;
}
/** DELETE 同时兼容 query 传参（部分 HTTP 客户端不给 DELETE 发送 body） */
interface DeleteQuery {
  filePath?: string;
  recursive?: string;
}

// ===== 工作区 =====

export async function workspace() {
  return libraryService.getWorkspaceStatus();
}

export async function workspaceInit(req: FastifyRequest) {
  const b = (req.body ?? {}) as WorkspaceInitDTO;
  return libraryService.initWorkspace(b);
}

export async function browse(req: FastifyRequest) {
  const q = req.query as BrowseQuery;
  return libraryService.browseDirectories(q.dir);
}

// ===== 笔记树与内容 =====

export async function tree() {
  return libraryService.getTree();
}

export async function children(req: FastifyRequest) {
  const q = req.query as ParentQuery;
  return libraryService.getChildren(q.parent);
}

export async function search(req: FastifyRequest) {
  const q = req.query as KeywordQuery;
  return libraryService.search(q.q);
}

export async function allNotes() {
  return libraryService.getAllNotes();
}

export async function content(req: FastifyRequest) {
  const q = req.query as IdQuery;
  return libraryService.getNoteContent(q.id);
}

export async function createNote(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body ?? {}) as CreateNoteDTO;
  const node = await libraryService.createNoteFile(b);
  return reply.code(201).send(node);
}

export async function createFolder(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body ?? {}) as CreateFolderDTO;
  const node = await libraryService.createFolderEntry(b);
  return reply.code(201).send(node);
}

export async function updateNote(req: FastifyRequest) {
  const b = (req.body ?? {}) as UpdateNoteDTO;
  return libraryService.updateNoteContent(b);
}

export async function rename(req: FastifyRequest) {
  const b = (req.body ?? {}) as RenameEntryDTO;
  return libraryService.renameNoteEntry(b);
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body ?? {}) as DeleteEntryDTO;
  const q = (req.query ?? {}) as DeleteQuery;
  await libraryService.removeEntry({
    filePath: b.filePath ?? q.filePath,
    recursive: b.recursive === true || q.recursive === 'true',
  });
  return reply.code(204).send();
}

// ===== 资源（图片 / 矢量 / PDF 等附件） =====

/**
 * 按库内相对路径返回附件二进制（预览区 <img> / 嵌入图片的数据源）。
 * 路径安全与 MIME 白名单在 service 内完成，这里只负责响应头与流式下发。
 */
export async function asset(req: FastifyRequest, reply: FastifyReply) {
  const q = req.query as PathQuery;
  const { absPath, mime } = libraryService.resolveAsset(q.path);
  // SVG 经 <img> 加载不会执行脚本，安全；但显式声明 nosniff 进一步收紧
  reply.header('Content-Type', mime);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Cache-Control', 'public, max-age=300');
  return reply.send(fs.createReadStream(absPath));
}

export async function assetFind(req: FastifyRequest) {
  const q = req.query as NameQuery;
  return libraryService.findAssetByName(q.name);
}
