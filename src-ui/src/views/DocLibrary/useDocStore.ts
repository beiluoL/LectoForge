/**
 * 文档库全局状态（useDocStore）。
 *
 * 【为什么不是 Pinia】
 * 本项目未安装 Pinia，跨组件共享状态的既有范式是 utils/toast.ts 里的 reactive 单例。
 * 为一个页面引入状态库既增加依赖体积，也和现有代码风格割裂，因此这里用同样的
 * 「reactive 单例 + 导出动作函数」实现，对外用法与 Pinia 的 setup store 基本一致。
 *
 * 【自动保存的三个坑，都在这里处理了】
 * 1. 载入文件时 currentContent 被赋值会误触发 watch → 用 savedSnapshot 比对，相同则跳过。
 * 2. 防抖期间用户切换了文件 → 入队时锁定当时的 activeNoteId，保证写回正确的文件。
 * 3. 切文件 / 离开页面时防抖还没到点 → 提供 flushSave() 立即落盘，避免最后几秒的编辑丢失。
 */
import { computed, reactive, watch } from 'vue'

import {
  createFolder as apiCreateFolder,
  createNote as apiCreateNote,
  deleteEntry as apiDeleteEntry,
  getAllNotes,
  getFolderChildren,
  getNoteContent,
  getWorkspace,
  initWorkspace,
  moveEntry as apiMoveEntry,
  renameEntry as apiRenameEntry,
  searchLibrary,
  updateNote,
  type LibNoteRef,
  type LibSearchHit,
  type LibTreeNode,
} from '@/api/library'
import { getApiError, notify } from '@/utils/toast'

/** 自动保存防抖延迟（毫秒） */
export const SAVE_DEBOUNCE_MS = 600

/** 左侧目录树收起偏好本地留存，下次进页面保持上次的选择 */
const LEFT_COLLAPSE_KEY = 'kb.docLibrary.leftCollapsed'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface DocState {
  /** 工作区根目录绝对路径，未初始化为空串 */
  rootDir: string
  ready: boolean
  defaultDir: string
  /** 递归文件树 */
  fileTree: LibTreeNode[]
  /** 当前选中文件的相对路径 id */
  activeNoteId: string
  activeNoteName: string
  /** 当前编辑器中的 Markdown 文本 */
  currentContent: string
  /** 展开的文件夹 id 集合 */
  expanded: Set<string>
  /** 已成功拉取过子项的文件夹 id（含根 ''），用于懒加载去重 */
  loadedFolders: Set<string>
  /** 正在拉取子项的文件夹 id，渲染时显示加载态 */
  loadingFolders: Set<string>
  /** 文件名检索结果（搜索框使用，不依赖已展开树） */
  searchResults: LibSearchHit[]
  /** 是否正在检索 */
  searching: boolean
  loadingWorkspace: boolean
  loadingTree: boolean
  loadingContent: boolean
  saveStatus: SaveStatus
  saveMessage: string
  savedAt: number
  dirty: boolean
  /** 左侧目录树是否收起（隐藏导航区，内容区占满） */
  leftCollapsed: boolean
}

export const docState = reactive<DocState>({
  rootDir: '',
  ready: false,
  defaultDir: '',
  fileTree: [],
  activeNoteId: '',
  activeNoteName: '',
  currentContent: '',
  expanded: new Set<string>(),
  loadedFolders: new Set<string>(),
  loadingFolders: new Set<string>(),
  searchResults: [],
  searching: false,
  loadingWorkspace: false,
  loadingTree: false,
  loadingContent: false,
  saveStatus: 'idle',
  saveMessage: '',
  savedAt: 0,
  dirty: false,
  leftCollapsed: localStorage.getItem(LEFT_COLLAPSE_KEY) === '1',
})

/** 最近一次成功落盘（或刚从磁盘载入）的内容快照，用于区分「用户编辑」与「程序赋值」 */
let savedSnapshot = ''
let saveTimer: number | null = null
let pendingSave: { id: string; content: string } | null = null

// ===================== 树工具 =====================

/** 深度优先查找节点 */
export function findNode(nodes: LibTreeNode[], id: string): LibTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children) {
      const hit = findNode(n.children, id)
      if (hit) return hit
    }
  }
  return null
}

/** 取某个 id 的父文件夹 id（根目录为空串） */
export function parentDirOf(id: string): string {
  const idx = id.lastIndexOf('/')
  return idx === -1 ? '' : id.slice(0, idx)
}

/** 展开某节点的所有祖先文件夹（新建后定位、恢复选中时用） */
export function expandAncestors(id: string): void {
  const parts = id.split('/')
  let acc = ''
  for (let i = 0; i < parts.length - 1; i += 1) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i]
    docState.expanded.add(acc)
  }
}

export function toggleExpand(id: string): void {
  if (docState.expanded.has(id)) docState.expanded.delete(id)
  else docState.expanded.add(id)
}

/** 切换左侧目录树的显示 / 隐藏，并把偏好写入本地存储 */
export function toggleLeft(): void {
  docState.leftCollapsed = !docState.leftCollapsed
  localStorage.setItem(LEFT_COLLAPSE_KEY, docState.leftCollapsed ? '1' : '0')
}

/** 统计文件夹 / 文件数量，用于底部状态栏 */
export const treeStats = computed(() => {
  let files = 0
  let folders = 0
  const walk = (nodes: LibTreeNode[]) => {
    for (const n of nodes) {
      if (n.type === 'folder') {
        folders += 1
        if (n.children) walk(n.children)
      } else {
        files += 1
      }
    }
  }
  walk(docState.fileTree)
  return { files, folders }
})

// ===================== 双链 / 嵌入解析索引 =====================
// 缓存：basename（去掉 .md 扩展名、小写）→ 库内 id 列表；以及全部 id 集合（精确路径匹配）。
// 双链 [[笔记名]] 在 Obsidian 里按文件名（不含扩展名）解析，因此索引 key 用 basename。

let nameIndex = new Map<string, string[]>()
let idSet = new Set<string>()
/** 全库笔记 id 集合：用于判断「当前打开的文件是否在磁盘上被删」（懒加载下树不完整，不能只查树） */
let allNoteIds = new Set<string>()

/**
 * 重建双链 / 嵌入解析索引。改为拉取「全库笔记扁平清单」（而非遍历内存中的部分树），
 * 这样即使文件树是懒加载的、深层笔记尚未展开，点击 [[双链]] 也能在整库范围内命中。
 */
export async function rebuildVaultIndex(): Promise<void> {
  try {
    const notes: LibNoteRef[] = await getAllNotes()
    nameIndex = new Map()
    idSet = new Set()
    allNoteIds = new Set()
    for (const n of notes) {
      allNoteIds.add(n.id)
      idSet.add(n.id)
      const base = n.name.replace(/\.(md|markdown|mdx)$/i, '').toLowerCase()
      const list = nameIndex.get(base) ?? []
      list.push(n.id)
      nameIndex.set(base, list)
    }
  } catch {
    /* 索引构建失败不阻塞主流程，双链解析会降级为「未找到」提示 */
  }
}

/** 取相对 id 的目录部分（不含尾部斜杠），根目录返回 '' */
function dirOfId(id: string): string {
  const i = id.lastIndexOf('/')
  return i === -1 ? '' : id.slice(0, i)
}

/**
 * 把 Obsidian 式引用解析成库内 id：
 * 1) 带 `/` 或 `.md` 扩展名 → 视为路径引用（Obsidian 里 [[Folder/Note]] 是从库根起的绝对路径，
 *    而非相对当前笔记目录）。笔记链接常省略 .md 扩展名，因此同尝试「精确 / 补 .md / 去 .md」。
 * 2) 否则（裸名）→ 按 basename 在整库查找，优先返回与 baseId 同目录的那篇（贴近 Obsidian 行为）。
 */
export function resolveVaultRef(ref: string, baseId?: string): string | null {
  const name = ref.trim()
  if (!name) return null

  if (name.includes('/') || /\.(md|markdown|mdx)$/i.test(name)) {
    const cand = name.includes('/')
      ? name.replace(/^\.?\//, '')
      : `${dirOfId(baseId ?? '')}/${name}`.replace(/^\//, '')
    // 依次尝试：精确 → 补 .md/.markdown/.mdx → 去掉扩展名，覆盖「链接省略扩展名」与「链接带不同扩展名」写法
    const variants = [cand]
    if (/\.(md|markdown|mdx)$/i.test(cand)) {
      variants.push(cand.replace(/\.(md|markdown|mdx)$/i, ''))
    } else {
      for (const ext of ['.md', '.markdown', '.mdx']) variants.push(`${cand}${ext}`)
    }
    for (const v of variants) if (idSet.has(v)) return v
  }

  const ids = nameIndex.get(name.toLowerCase())
  if (ids && ids.length) {
    if (baseId) {
      const dir = dirOfId(baseId)
      const same = ids.find((id) => dirOfId(id) === dir)
      if (same) return same
    }
    return ids[0]
  }
  return null
}

// ===================== 工作区 =====================

export async function loadWorkspace(): Promise<void> {
  docState.loadingWorkspace = true
  try {
    const ws = await getWorkspace()
    docState.rootDir = ws.rootDir ?? ''
    docState.ready = ws.ready
    docState.defaultDir = ws.defaultDir
    if (ws.ready) await refreshTree()
  } catch (e) {
    notify(getApiError(e, '读取工作区状态失败'), 'error')
  } finally {
    docState.loadingWorkspace = false
  }
}

/** 选择 / 切换工作区根目录，成功后立即拉取文件树 */
export async function chooseWorkspace(rootDir: string, create = false): Promise<boolean> {
  try {
    const res = await initWorkspace(rootDir, create)
    docState.rootDir = res.rootDir
    docState.ready = true
    resetEditor()
    docState.expanded.clear()
    await refreshTree()
    notify(`已打开文档库：${res.rootDir}`, 'success')
    return true
  } catch (e) {
    notify(getApiError(e, '打开文件夹失败'), 'error')
    return false
  }
}

// ===================== 文件树（懒加载） =====================

/** 把某父级（id 为空串表示根目录）的子项写入树；根目录直接存到 fileTree */
function setChildren(parentId: string, children: LibTreeNode[]): void {
  if (!parentId) {
    docState.fileTree = children
    return
  }
  const node = findNode(docState.fileTree, parentId)
  if (node) node.children = children
}

/**
 * 拉取某文件夹的直接子项并写入树（懒加载核心）。
 * force=true 时无视「已加载」缓存，用于新建 / 删除后刷新该层。
 * 内部用 loadingFolders 标记，避免重复并发请求；失败仅提示，不破坏已有树。
 */
export async function loadChildren(parentId: string, force = false): Promise<void> {
  if (docState.loadingFolders.has(parentId)) return
  if (!force && docState.loadedFolders.has(parentId)) return
  docState.loadingFolders.add(parentId)
  docState.loadedFolders.delete(parentId)
  try {
    const kids = await getFolderChildren(parentId)
    setChildren(parentId, kids)
    docState.loadedFolders.add(parentId)
  } catch (e) {
    notify(getApiError(e, '加载子目录失败'), 'error')
  } finally {
    docState.loadingFolders.delete(parentId)
  }
}

/**
 * 切换文件夹展开 / 折叠；展开且尚未加载过子项时，按需拉取该层子项。
 * 这是点击树中文件夹节点的统一入口（替代旧的 toggleExpand）。
 */
export async function toggleFolder(id: string): Promise<void> {
  const willOpen = !docState.expanded.has(id)
  toggleExpand(id)
  if (willOpen) await loadChildren(id)
}

export async function refreshTree(): Promise<void> {
  if (!docState.ready) return
  docState.loadingTree = true
  try {
    // 根层级始终先拉取
    docState.fileTree = await getFolderChildren('')
    docState.loadedFolders = new Set<string>([''])
    // 双链解析索引基于全库扁平清单重建（与懒加载树解耦）
    await rebuildVaultIndex()
    // 重新填充此前已展开文件夹的子内容，保持视图不「塌缩」
    const toLoad = [...docState.expanded].filter((id) => id !== '')
    await Promise.allSettled(toLoad.map((id) => loadChildren(id)))
    // 当前打开的文件若在磁盘上被删除，清空编辑区避免继续写入
    if (docState.activeNoteId && !allNoteIds.has(docState.activeNoteId)) {
      resetEditor()
    }
  } catch (e) {
    notify(getApiError(e, '加载文件树失败'), 'error')
  } finally {
    docState.loadingTree = false
  }
}

/** 文件名检索：结果走后端全库扫描，不依赖已展开树，适配大库 */
export async function searchInLibrary(query: string): Promise<void> {
  const q = query.trim()
  if (!q) {
    docState.searchResults = []
    docState.searching = false
    return
  }
  docState.searching = true
  try {
    docState.searchResults = await searchLibrary(q)
  } catch {
    docState.searchResults = []
  } finally {
    docState.searching = false
  }
}

// ===================== 打开 / 编辑 / 保存 =====================

function resetEditor(): void {
  docState.activeNoteId = ''
  docState.activeNoteName = ''
  docState.currentContent = ''
  savedSnapshot = ''
  docState.dirty = false
  docState.saveStatus = 'idle'
  docState.saveMessage = ''
}

/** 打开文件：先把上一份未落盘的编辑冲刷掉，再载入新内容 */
export async function openNote(id: string): Promise<void> {
  if (id === docState.activeNoteId) return
  await flushSave()
  docState.loadingContent = true
  try {
    const note = await getNoteContent(id)
    docState.activeNoteId = note.id
    docState.activeNoteName = note.name
    savedSnapshot = note.content // 必须先于 currentContent 赋值，否则 watch 会误判为用户编辑
    docState.currentContent = note.content
    docState.dirty = false
    docState.saveStatus = 'idle'
    docState.saveMessage = ''
    expandAncestors(note.id)
  } catch (e) {
    notify(getApiError(e, '打开文件失败'), 'error')
  } finally {
    docState.loadingContent = false
  }
}

/** 立即把待保存内容落盘（切文件 / 离开页面 / Cmd+S 时调用） */
export async function flushSave(): Promise<void> {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  const task = pendingSave
  pendingSave = null
  if (!task) return

  docState.saveStatus = 'saving'
  try {
    await updateNote(task.id, task.content)
    // 保存耗时内用户可能又改了内容，此时不能标记为「已保存」
    if (task.id === docState.activeNoteId && docState.currentContent === task.content) {
      savedSnapshot = task.content
      docState.dirty = false
      docState.saveStatus = 'saved'
      docState.savedAt = Date.now()
      docState.saveMessage = ''
    }
    // 同步树上的文件大小，避免状态栏显示过期数据
    const node = findNode(docState.fileTree, task.id)
    if (node) node.size = new Blob([task.content]).size
  } catch (e) {
    pendingSave = task // 保留任务，下次编辑或切文件时重试，不静默丢数据
    docState.saveStatus = 'error'
    docState.saveMessage = getApiError(e, '保存失败')
    notify(docState.saveMessage, 'error')
  }
}

/* 自动保存：监听正文变化，防抖 600ms 后写回磁盘。
 * 这个 watch 建在模块作用域（单例 store 的生命周期即应用生命周期），
 * 组件反复挂载卸载不会重复注册。 */
watch(
  () => docState.currentContent,
  (val) => {
    if (!docState.activeNoteId) return
    if (val === savedSnapshot) return // 程序载入的内容，不是用户编辑
    docState.dirty = true
    pendingSave = { id: docState.activeNoteId, content: val }
    if (saveTimer !== null) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      void flushSave()
    }, SAVE_DEBOUNCE_MS)
  },
)

// ===================== 增删改 =====================

/** 新建笔记，成功后刷新该层目录并自动打开 */
export async function newNote(parentDir: string, fileName: string): Promise<void> {
  try {
    const node = await apiCreateNote(parentDir, fileName)
    await loadChildren(parentDir, true)
    expandAncestors(node.id)
    if (parentDir) docState.expanded.add(parentDir)
    await openNote(node.id)
    notify(`已创建 ${node.name}`, 'success')
  } catch (e) {
    notify(getApiError(e, '创建笔记失败'), 'error')
  }
}

export async function newFolder(parentDir: string, folderName: string): Promise<void> {
  try {
    const node = await apiCreateFolder(parentDir, folderName)
    await loadChildren(parentDir, true)
    expandAncestors(node.id)
    docState.expanded.add(node.id)
    notify(`已创建文件夹 ${node.name}`, 'success')
  } catch (e) {
    notify(getApiError(e, '创建文件夹失败'), 'error')
  }
}

export async function renameNode(node: LibTreeNode, newName: string): Promise<void> {
  try {
    const wasActive = node.id === docState.activeNoteId
    const next = await apiRenameEntry(node.id, newName)
    await refreshTree()
    if (wasActive) {
      docState.activeNoteId = ''
      await openNote(next.id)
    }
    notify('重命名成功', 'success')
  } catch (e) {
    notify(getApiError(e, '重命名失败'), 'error')
  }
}

/** 移动文件/文件夹到目标目录（targetDir 空 = 根目录），成功后刷新树 */
export async function moveNode(node: LibTreeNode, targetDir: string): Promise<void> {
  try {
    await apiMoveEntry(node.id, targetDir)
    if (docState.activeNoteId === node.id) {
      docState.activeNoteId = ''
      docState.currentContent = ''
    }
    await refreshTree()
    notify(`已移动「${node.name}」`, 'success')
  } catch (e) {
    notify(getApiError(e, '移动失败'), 'error')
  }
}

export async function removeNode(node: LibTreeNode, recursive = false): Promise<void> {
  try {
    // 删的是当前正在编辑的文件时，先撤掉待保存任务，否则会把已删文件重新写回来
    if (node.id === docState.activeNoteId || docState.activeNoteId.startsWith(`${node.id}/`)) {
      if (saveTimer !== null) window.clearTimeout(saveTimer)
      saveTimer = null
      pendingSave = null
      resetEditor()
    }
    await apiDeleteEntry(node.id, recursive)
    await refreshTree()
    notify(`已删除 ${node.name}`, 'success')
  } catch (e) {
    notify(getApiError(e, '删除失败'), 'error')
  }
}
