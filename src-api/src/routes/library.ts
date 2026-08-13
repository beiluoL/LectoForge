/**
 * 文档库（Obsidian 式 Markdown 笔记）路由。
 *
 * 挂载前缀：/api/library —— 这里的 "notes" 指磁盘上的 .md 文件，
 * 与 /api/notes（数据库康奈尔笔记）是两套语义，前缀必须分开。
 *
 * 本文件只声明 HTTP 契约：业务与磁盘访问见 services/libraryService.ts，
 * 底层文件操作仍统一走 lib/vault.ts。
 *
 * 响应约定：沿用 index.ts 的 onSend 信封钩子——成功时直接 return 裸对象，
 * 会被自动包成 { code: 200, data }；错误抛 VaultError（自带 statusCode）由全局
 * errorHandler 转成 { code, message }，前端 request.ts 拦截器再还原成 Error。
 */
import type { FastifyInstance } from 'fastify';
import * as libraryController from '../controllers/libraryController';

export default async function (app: FastifyInstance) {
  // ===== 工作区 =====
  app.get('/workspace', libraryController.workspace);
  app.post('/workspace/init', libraryController.workspaceInit);
  app.get('/fs/browse', libraryController.browse);

  // ===== 笔记树与内容 =====
  app.get('/notes/tree', libraryController.tree);
  app.get('/notes/children', libraryController.children);
  app.get('/notes/search', libraryController.search);
  app.get('/notes/all', libraryController.allNotes);
  app.get('/notes/content', libraryController.content);
  app.post('/notes/create', libraryController.createNote);
  app.post('/folders/create', libraryController.createFolder);
  app.put('/notes/update', libraryController.updateNote);
  app.post('/notes/rename', libraryController.rename);
  app.delete('/notes/delete', libraryController.remove);
  // 功能 A：扫描全库 Markdown 中的未完成待办（文档库 → 任务清单）
  app.get('/notes/todos', libraryController.scanTodos);

  // ===== 资源（图片 / 矢量 / PDF 等附件） =====
  app.get('/asset', libraryController.asset);
  app.get('/asset/find', libraryController.assetFind);
}
