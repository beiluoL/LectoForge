// 文档库接口层：对应后端 /api/library/*（Obsidian 式本地 Markdown 笔记）。
//
// 【为什么不写 http://localhost:3000】
// 桌面端后端端口是动态的：Rust 宿主从 8787 起探测空闲端口传给侧车，Node 侧再做 EADDRINUSE 漂移。
// 生产环境下前端由后端同源托管，开发环境由 Vite proxy 转发，因此一律使用相对路径 /api，
// 硬编码端口会让打包后的应用直接连不上后端。
import { apiGet, apiPost, apiPut, apiDeleteWithBody } from './request'

/** 文件树节点：id 为相对工作区根目录的 POSIX 路径，根目录为空串 */
export interface LibTreeNode {
  id: string
  name: string
  type: 'file' | 'folder'
  children?: LibTreeNode[]
  size?: number
  mtime?: string
}

/** 全库笔记扁平清单（双链索引用）：仅 id 与文件名 */
export interface LibNoteRef {
  id: string
  name: string
}

/** 文件名检索命中项 */
export interface LibSearchHit {
  id: string
  name: string
  parentId: string
}

export interface LibWorkspace {
  rootDir: string | null
  ready: boolean
  defaultDir: string
}

export interface LibNoteContent {
  id: string
  name: string
  content: string
  size: number
  mtime: string
}

export interface LibSaveResult {
  id: string
  size: number
  mtime: string
}

export interface LibDirEntry {
  name: string
  path: string
}

export interface LibBrowseResult {
  current: string
  parent: string | null
  dirs: LibDirEntry[]
  shortcuts: LibDirEntry[]
}

/** 当前工作区状态（页面 onMounted 首次调用，决定是否弹出目录选择器） */
export function getWorkspace() {
  return apiGet<LibWorkspace>('/library/workspace')
}

/** 初始化工作区根目录；create=true 时目录不存在会自动创建 */
export function initWorkspace(rootDir: string, create = false) {
  return apiPost<{ rootDir: string; ready: boolean }>('/library/workspace/init', { rootDir, create })
}

/** 浏览本机目录（目录选择器数据源） */
export function browseDirs(dir?: string) {
  return apiGet<LibBrowseResult>('/library/fs/browse', dir ? { dir } : undefined)
}

/** 懒加载文件树：某文件夹的直接子项（parentId 为空串=根目录）。展开文件夹时按需调用 */
export function getFolderChildren(parentId: string) {
  return apiGet<LibTreeNode[]>('/library/notes/children', parentId ? { parent: parentId } : undefined)
}

/** 全库 Markdown 文件扁平清单（双链 / 嵌入解析索引用） */
export function getAllNotes() {
  return apiGet<LibNoteRef[]>('/library/notes/all')
}

/** 按文件名检索库内笔记，返回命中列表 */
export function searchLibrary(query: string) {
  return apiGet<LibSearchHit[]>('/library/notes/search', query ? { q: query } : undefined)
}

/** 读取 Markdown 文件内容 */
export function getNoteContent(id: string) {
  return apiGet<LibNoteContent>('/library/notes/content', { id })
}

/** 新建 Markdown 文件（fileName 可不带 .md 后缀，后端自动补全） */
export function createNote(parentDir: string, fileName: string) {
  return apiPost<LibTreeNode>('/library/notes/create', { parentDir, fileName })
}

/** 新建文件夹 */
export function createFolder(parentDir: string, folderName: string) {
  return apiPost<LibTreeNode>('/library/folders/create', { parentDir, folderName })
}

/** 保存内容到磁盘（自动保存调用） */
export function updateNote(filePath: string, content: string) {
  return apiPut<LibSaveResult>('/library/notes/update', { filePath, content })
}

/** 重命名文件或文件夹 */
export function renameEntry(filePath: string, newName: string) {
  return apiPost<LibTreeNode>('/library/notes/rename', { filePath, newName })
}

/** 删除文件或文件夹（文件夹非空时需 recursive=true） */
export function deleteEntry(filePath: string, recursive = false) {
  return apiDeleteWithBody<void>('/library/notes/delete', { filePath, recursive })
}

/** 按文件名检索库内附件，返回其相对路径（双链只给文件名时解析用） */
export function findAsset(name: string) {
  return apiGet<{ path: string }>('/library/asset/find', { name })
}

// ===== 功能 A：文档库 TODO 自动提取（文档库 → 任务清单） =====

/** 单条未办待办（与后端 types/library.LibraryTodoItem 对齐） */
export interface LibraryTodoItem {
  filePath: string
  fileName: string
  taskContent: string
  lineNumber: number
}

/**
 * 扫描文档库 Markdown 中的未完成待办项。
 * 不传 file 时全库扫描；传 file 时只扫该文件（POSIX 相对路径 id）。
 */
export function scanLibraryTodos(file?: string) {
  return apiGet<LibraryTodoItem[]>('/library/notes/todos', file ? { file } : undefined)
}
