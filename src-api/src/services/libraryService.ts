/**
 * 文档库（Obsidian 式 Markdown 笔记）业务层。
 *
 * 所有磁盘操作统一走 lib/vault.ts；本层只负责参数缺失校验、资源 MIME 白名单
 * 与工作区就绪性复核，不直接拼路径（防越界一律交给 vault.safeResolve）。
 *
 * 错误语义：继续抛 VaultError（自带 statusCode），由 index.ts 的全局 errorHandler
 * 转成 { code, message }，前端 request.ts 拦截器再还原成 Error——与重构前完全一致。
 */
import fs from 'node:fs';
import path from 'node:path';

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
  type TreeNode,
} from '../lib/vault';
import type {
  AssetResolution,
  CreateFolderDTO,
  CreateNoteDTO,
  DeleteEntryDTO,
  LibraryTodoItem,
  RenameEntryDTO,
  UpdateNoteDTO,
  WorkspaceInitDTO,
  WorkspaceInitVO,
  WorkspaceStatusVO,
} from '../types/library';

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

// ===== 工作区 =====

/** 当前工作区状态：供前端 onMounted 判断是否需要引导用户选目录 */
export function getWorkspaceStatus(): WorkspaceStatusVO {
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
}

/** 初始化工作区：校验路径存在并记为后续所有操作的根目录 */
export function initWorkspace(input: WorkspaceInitDTO): WorkspaceInitVO {
  const rootDir = setRootDir(input.rootDir ?? '', input.create === true);
  return { rootDir, ready: true };
}

/** 目录浏览器：前端「打开本地文件夹」选择器的数据源（只读、只列目录） */
export function browseDirectories(dir?: string) {
  return browseDirs(dir);
}

// ===== 笔记树与内容 =====

/**
 * 文件树（懒加载）：根目录层级。前端展开某文件夹时再调 listChildren 拉取该层子项，
 * 避免一次性把上万节点塞进前端 DOM。
 */
export function getTree(): Promise<TreeNode[]> {
  return listChildren('');
}

/** 某个文件夹的直接子项（展开时调用），缺省为空串=根目录 */
export function getChildren(parent?: string): Promise<TreeNode[]> {
  return listChildren(parent ?? '');
}

/** 文件名检索（搜索框），返回命中列表上限 200 */
export function search(keyword?: string) {
  return searchNotes(keyword ?? '');
}

/**
 * 全库 Markdown 文件扁平清单（{ id, name }），供前端构建双链 / 嵌入解析索引。
 * 不做递归树组装，体积远小于整树，即使数万文件也能快速返回。
 */
export function getAllNotes() {
  return listAllNotes();
}

/** 读取单个 Markdown 文件的 UTF-8 内容 */
export function getNoteContent(id?: string) {
  if (!id) throw new VaultError('缺少参数 id');
  return readNote(id);
}

/** 新建 Markdown 文件 */
export function createNoteFile(input: CreateNoteDTO): Promise<TreeNode> {
  return createNote(input.parentDir ?? '', input.fileName ?? '');
}

/** 新建文件夹 */
export function createFolderEntry(input: CreateFolderDTO): Promise<TreeNode> {
  return createFolder(input.parentDir ?? '', input.folderName ?? '');
}

/** 保存内容（自动保存） */
export function updateNoteContent(input: UpdateNoteDTO) {
  if (!input.filePath) throw new VaultError('缺少参数 filePath');
  return writeNote(input.filePath, input.content ?? '');
}

/** 重命名文件或文件夹 */
export function renameNoteEntry(input: RenameEntryDTO): Promise<TreeNode> {
  if (!input.filePath) throw new VaultError('缺少参数 filePath');
  return renameEntry(input.filePath, input.newName ?? '');
}

// ===== TODO 自动提取（功能 A：文档库 → 任务清单） =====

/**
 * 两种未完成待办语法都被识别：
 *  - Markdown 任务清单 `- [ ] 某事` / `* [ ] 某事`（方框内必须是单个空格，已勾选的 `[x]` 不算）
 *  - 关键字写法 `TODO: 某事` / `TODO：某事`（中英文冒号均可，大小写不敏感；允许行首 `>` 引用前缀）
 */
const TODO_CHECKBOX_RE = /^\s*[-*]\s*\[ \]\s*(.+?)\s*$/
const TODO_KEYWORD_RE = /^(?:>\s*)?TODO[：:]\s*(.+?)\s*$/i

/**
 * 扫描文档库 Markdown 中的未完成待办项，返回全部命中。
 *
 * 范围两种：传 `fileId` 只扫这一个文件（编辑器内实时提示用）；
 * 不传则全库扫描（文档库悬浮待办面板用）。全库扫描对超大库可能偏慢，
 * 但这是只读探测、不落库，且前端按需手动刷新，风险可控。
 *
 * 读不到的文件（已删 / 越界）直接跳过，不让单点失败拖垮整次扫描。
 */
export async function scanTodos(fileId?: string): Promise<LibraryTodoItem[]> {
  const targets = fileId ? [{ id: fileId, name: '' }] : await listAllNotes();
  const items: LibraryTodoItem[] = [];
  for (const note of targets) {
    let noteName = note.name
    let content = ''
    try {
      const res = await readNote(note.id)
      content = res.content ?? ''
      noteName = res.name || note.name || note.id
    } catch {
      // 跳过读不到的文件（可能已被用户在 Finder 里删除）
      continue
    }
    content.split('\n').forEach((rawLine, idx) => {
      const line = rawLine.trimEnd()
      const m = TODO_CHECKBOX_RE.exec(line) || TODO_KEYWORD_RE.exec(line)
      const text = m?.[1]?.trim()
      if (text) {
        items.push({
          filePath: note.id,
          fileName: noteName,
          taskContent: text,
          lineNumber: idx + 1,
        })
      }
    });
  }
  return items
}

/**
 * 删除文件或文件夹。
 * filePath 由 controller 从 body / query 二选一取得（部分 HTTP 客户端不给 DELETE 发送 body）。
 */
export function removeEntry(input: DeleteEntryDTO): Promise<void> {
  if (!input.filePath) throw new VaultError('缺少参数 filePath');
  return deleteEntry(input.filePath, input.recursive === true);
}

// ===== 资源（图片 / 矢量 / PDF 等附件） =====

/**
 * 把库内相对路径解析成「磁盘绝对路径 + MIME」。
 * 统一经 safeResolve 防越界，并限 MIME 白名单；实际流式下发由 controller 负责。
 */
export function resolveAsset(rawPath?: string): AssetResolution {
  if (!rawPath) throw new VaultError('缺少参数 path');
  const abs = safeResolve(decodeURIComponent(rawPath));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new VaultError('资源不存在', 404);
  }
  const ext = path.extname(abs).toLowerCase();
  const mime = ASSET_MIME[ext];
  if (!mime) throw new VaultError(`不支持的资源类型：${ext}`, 415);
  return { absPath: abs, mime };
}

/** 按文件名检索库内附件（双链只给文件名、不给路径时解析用）；未找到抛 404 */
export async function findAssetByName(name?: string): Promise<{ path: string }> {
  const found = await findAsset(name ?? '');
  if (!found) throw new VaultError('未找到匹配的资源', 404);
  return { path: found };
}
