/**
 * 文档库（Obsidian 式 Markdown 笔记）路由。
 *
 * 挂载前缀：/api/library
 * 所有磁盘操作统一走 lib/vault.ts，路由层只负责参数提取与错误语义。
 *
 * 响应约定：沿用 index.ts 的 onSend 信封钩子——成功时直接 return 裸对象，
 * 会被自动包成 { code: 200, data }；错误抛 VaultError（自带 statusCode）由全局
 * errorHandler 转成 { code, message }，前端 request.ts 拦截器再还原成 Error。
 */
import fs from 'node:fs';
import path from 'node:path';

import { FastifyInstance } from 'fastify';

import {
  browseDirs,
  createFolder,
  createNote,
  defaultVaultDir,
  deleteEntry,
  findAsset,
  getRootDir,
  listAllNotes,
  listChildren,
  readNote,
  renameEntry,
  safeResolve,
  searchNotes,
  setRootDir,
  writeNote,
  VaultError,
} from '../lib/vault';

/** 允许通过资源接口返回的文件类型（图片 / 矢量 / PDF），其余一律拒绝，避免泄露任意文件 */
const ASSET_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
};

export default async function (app: FastifyInstance) {
  // ===== 工作区 =====

  /** 当前工作区状态：供前端 onMounted 判断是否需要引导用户选目录 */
  app.get('/workspace', async () => {
    const rootDir = getRootDir();
    /* ready 必须复核目录是否还在磁盘上：上次记住的库可能已被用户在 Finder 里
     * 删除 / 改名 / 是外置盘未挂载。只看「记录里有路径」会让前端直接进三栏界面，
     * 随后每个接口都抛 409，用户看到的是一连串报错而不是「请重新选择文件夹」。 */
    const exists = Boolean(rootDir) && fs.existsSync(rootDir as string);
    return {
      rootDir,
      ready: exists,
      defaultDir: defaultVaultDir(),
    };
  });

  /**
   * 初始化工作区：校验路径存在并记为后续所有操作的根目录。
   * body: { rootDir: string, create?: boolean }
   */
  app.post('/workspace/init', async (req) => {
    const b = (req.body ?? {}) as { rootDir?: string; create?: boolean };
    const rootDir = setRootDir(b.rootDir ?? '', b.create === true);
    return { rootDir, ready: true };
  });

  /** 目录浏览器：前端「打开本地文件夹」选择器的数据源（只读、只列目录） */
  app.get('/fs/browse', async (req) => {
    const q = req.query as { dir?: string };
    return browseDirs(q.dir);
  });

  // ===== 笔记树与内容 =====

  /**
   * 文件树（懒加载）：根目录层级。前端展开某文件夹时再调 /notes/children 拉取该层子项，
   * 避免一次性把上万节点塞进前端 DOM。返回与旧 /notes/tree 同构的数组。
   */
  app.get('/notes/tree', async () => {
    return listChildren('');
  });

  /** 某个文件夹的直接子项（展开时调用）。query: ?parent=相对路径，缺省为空串=根目录 */
  app.get('/notes/children', async (req) => {
    const q = req.query as { parent?: string };
    return listChildren(q.parent ?? '');
  });

  /** 文件名检索（搜索框）。query: ?q=关键字，返回命中列表上限 200 */
  app.get('/notes/search', async (req) => {
    const q = req.query as { q?: string };
    return searchNotes(q.q ?? '');
  });

  /**
   * 全库 Markdown 文件扁平清单（{ id, name }），供前端构建双链 / 嵌入解析索引。
   * 不做递归树组装，体积远小于整树，即使数万文件也能快速返回。
   */
  app.get('/notes/all', async () => {
    return listAllNotes();
  });

  /** 读取单个 Markdown 文件的 UTF-8 内容。query: ?id=相对路径 */
  app.get('/notes/content', async (req) => {
    const q = req.query as { id?: string };
    if (!q.id) throw new VaultError('缺少参数 id');
    return readNote(q.id);
  });

  /** 新建 Markdown 文件。body: { parentDir: string, fileName: string } */
  app.post('/notes/create', async (req, reply) => {
    const b = (req.body ?? {}) as { parentDir?: string; fileName?: string };
    const node = await createNote(b.parentDir ?? '', b.fileName ?? '');
    return reply.code(201).send(node);
  });

  /** 新建文件夹。body: { parentDir: string, folderName: string } */
  app.post('/folders/create', async (req, reply) => {
    const b = (req.body ?? {}) as { parentDir?: string; folderName?: string };
    const node = await createFolder(b.parentDir ?? '', b.folderName ?? '');
    return reply.code(201).send(node);
  });

  /** 保存内容（自动保存）。body: { filePath: string, content: string } */
  app.put('/notes/update', async (req) => {
    const b = (req.body ?? {}) as { filePath?: string; content?: string };
    if (!b.filePath) throw new VaultError('缺少参数 filePath');
    return writeNote(b.filePath, b.content ?? '');
  });

  /** 重命名文件或文件夹。body: { filePath: string, newName: string } */
  app.post('/notes/rename', async (req) => {
    const b = (req.body ?? {}) as { filePath?: string; newName?: string };
    if (!b.filePath) throw new VaultError('缺少参数 filePath');
    return renameEntry(b.filePath, b.newName ?? '');
  });

  /**
   * 删除文件或文件夹。
   * 兼容两种传参：body { filePath, recursive } 与 query ?filePath=&recursive=
   * （部分 HTTP 客户端不给 DELETE 发送 body）。
   */
  app.delete('/notes/delete', async (req, reply) => {
    const b = (req.body ?? {}) as { filePath?: string; recursive?: boolean };
    const q = (req.query ?? {}) as { filePath?: string; recursive?: string };
    const filePath = b.filePath ?? q.filePath;
    if (!filePath) throw new VaultError('缺少参数 filePath');
    const recursive = b.recursive === true || q.recursive === 'true';
    await deleteEntry(filePath, recursive);
    return reply.code(204).send();
  });

  // ===== 资源（图片 / 矢量 / PDF 等附件） =====

  /**
   * 按库内相对路径返回附件二进制（预览区 <img> / 嵌入图片的数据源）。
   * query: ?path=POSIX相对路径。统一经 safeResolve 防越界，并限 MIME 白名单。
   */
  app.get('/asset', async (req, reply) => {
    const q = req.query as { path?: string };
    if (!q.path) throw new VaultError('缺少参数 path');
    const abs = safeResolve(decodeURIComponent(q.path));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new VaultError('资源不存在', 404);
    }
    const ext = path.extname(abs).toLowerCase();
    const mime = ASSET_MIME[ext];
    if (!mime) throw new VaultError(`不支持的资源类型：${ext}`, 415);
    // SVG 经 <img> 加载不会执行脚本，安全；但显式声明 nosniff 进一步收紧
    reply.header('Content-Type', mime);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send(fs.createReadStream(abs));
  });

  /**
   * 按文件名检索库内附件（双链只给文件名、不给路径时解析用）。
   * query: ?name=photo.png → { path: 相对id }；未找到 404。
   */
  app.get('/asset/find', async (req) => {
    const q = req.query as { name?: string };
    const found = await findAsset(q.name ?? '');
    if (!found) throw new VaultError('未找到匹配的资源', 404);
    return { path: found };
  });
}
