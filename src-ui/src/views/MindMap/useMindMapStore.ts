/**
 * 思维导图全局状态（useMindMapStore）
 *
 * 【为什么不是 Pinia】
 * 本项目未安装 Pinia，跨组件共享状态的既有范式是 utils/toast.ts 与 DocLibrary/useDocStore.ts
 * 里的「reactive 单例 + 导出动作函数」。这里沿用同一范式，对外用法与 Pinia 的 setup store 一致。
 *
 * 【职责边界】
 * 这个文件是三个视图（大纲 / 导图 / 流程图）唯一的数据源：
 * - 大纲的所有结构变更（缩进、升级、增删、排序、拖拽）都在这里做，组件只负责派发意图；
 * - 导图视图是 outlineData 的纯投影（outlineToMarkdown），不持有自己的状态；
 * - 流程图有独立的 flowchartData，但和大纲共享同一份文档与同一套保存链路。
 *
 * 【自动保存】
 * deep watch 整份文档，防抖 800ms 落盘；用 savedSnapshot 字符串比对区分「程序载入」与
 * 「用户编辑」，避免打开文档的瞬间就触发一次无意义的 PUT。
 */
import { computed, reactive, watch } from 'vue'

import {
  createMindMap as apiCreate,
  deleteMindMap as apiDelete,
  generateMindMapByAi,
  getMindMap,
  listMindMaps,
  saveMindMap,
  type FlowchartData,
  type MindMapMeta,
  type OutlineNode,
} from '@/api/mindmap'
import { getApiError, notify } from '@/utils/toast'

export type { OutlineNode, FlowchartData, MindMapMeta }

/** 自动保存防抖延迟（毫秒）。比文档库的 600ms 略长——结构变更往往连着好几步操作 */
export const SAVE_DEBOUNCE_MS = 800

export type ViewMode = 'outline' | 'mindmap' | 'flowchart'
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** 大纲编辑器渲染用的扁平行：把可见节点（跳过折叠子树）拍平，键盘导航按这个数组走 */
export interface FlatRow {
  node: OutlineNode
  parent: OutlineNode | null
  /** 缩进层级，从 0 起 */
  depth: number
  /** 在兄弟数组中的下标 */
  index: number
  siblings: OutlineNode[]
  hasChildren: boolean
}

export interface MindMapState {
  /** 项目列表（不含正文） */
  mindMaps: MindMapMeta[]
  /** 当前编辑的导图 id */
  activeMapId: string
  title: string
  /** 当前导图的极简大纲数据（核心数据结构） */
  outlineData: OutlineNode[]
  /** 流程图数据，vue-flow 标准格式 */
  flowchartData: FlowchartData
  /** 当前视图模式 */
  viewMode: ViewMode
  loadingList: boolean
  loadingDoc: boolean
  saveStatus: SaveStatus
  saveMessage: string
  savedAt: number
  dirty: boolean
  /** AI 生成中 */
  aiLoading: boolean
  /** 待聚焦的行，OutlineEditor 消费后置空 */
  pendingFocus: { id: string; caret: 'start' | 'end' } | null
  /** 大纲里当前选中的节点（用于工具栏操作与高亮） */
  selectedNodeId: string
}

// ===================== id 生成 =====================

let seq = 0
export function newNodeId(): string {
  seq += 1
  return `n_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 便捷构造器，写示例数据用 */
function n(text: string, children: OutlineNode[] = []): OutlineNode {
  return { id: newNodeId(), text, children }
}

/**
 * 前端内置的默认大纲（4 级深度）。
 * 后端也会播种同名文档；这份是纯离线兜底——后端没起来时页面依然有内容可操作，
 * 不至于开局就是一片空白。
 */
export function defaultOutline(): OutlineNode[] {
  return [
    n('前端工程化', [
      n('构建工具', [n('Vite：ESM + esbuild 预构建'), n('Webpack：Loader / Plugin 机制')]),
      n('框架', [
        n('Vue 3', [n('响应式原理：Proxy + 依赖收集'), n('组合式 API：setup / ref / reactive')]),
        n('React', [n('Hooks 与依赖数组'), n('虚拟 DOM 与 Fiber')]),
      ]),
      n('类型系统', [n('TypeScript 泛型'), n('类型体操与工具类型')]),
    ]),
    n('后端与服务', [
      n('Node.js', [n('Fastify：插件化与生命周期钩子'), n('事件循环与异步 I/O')]),
      n('数据存储', [n('SQLite：本地优先、零运维'), n('索引与查询优化')]),
    ]),
    n('学习方法', [
      n('费曼技巧', [n('用大白话讲给外行听'), n('讲不清楚 = 没学会')]),
      n('间隔重复', [n('SM-2 算法与遗忘曲线'), n('主动回忆优于被动重读')]),
    ]),
  ]
}

export const mapState = reactive<MindMapState>({
  mindMaps: [],
  activeMapId: '',
  title: '我的学习路线',
  outlineData: defaultOutline(),
  flowchartData: { nodes: [], edges: [] },
  viewMode: 'outline',
  loadingList: false,
  loadingDoc: false,
  saveStatus: 'idle',
  saveMessage: '',
  savedAt: 0,
  dirty: false,
  aiLoading: false,
  pendingFocus: null,
  selectedNodeId: '',
})

// ===================== 树工具（纯函数） =====================

/** 深度优先查找节点及其父节点、兄弟数组 */
export function locate(
  id: string,
  nodes: OutlineNode[] = mapState.outlineData,
  parent: OutlineNode | null = null,
): { node: OutlineNode; parent: OutlineNode | null; siblings: OutlineNode[]; index: number } | null {
  for (let i = 0; i < nodes.length; i += 1) {
    const cur = nodes[i]
    if (cur.id === id) return { node: cur, parent, siblings: nodes, index: i }
    const hit = locate(id, cur.children, cur)
    if (hit) return hit
  }
  return null
}

/** 判断 maybeAncestor 是否为 node 的祖先（拖拽时防止把父节点拖进自己的子树） */
function isAncestor(maybeAncestor: OutlineNode, id: string): boolean {
  for (const c of maybeAncestor.children) {
    if (c.id === id || isAncestor(c, id)) return true
  }
  return false
}

/** 统计节点总数与最大深度，状态栏展示用 */
export const outlineStats = computed(() => {
  let count = 0
  let maxDepth = 0
  const walk = (nodes: OutlineNode[], depth: number) => {
    for (const node of nodes) {
      count += 1
      maxDepth = Math.max(maxDepth, depth)
      walk(node.children, depth + 1)
    }
  }
  walk(mapState.outlineData, 1)
  return { count, maxDepth }
})

/** 可见行：折叠节点的子树整段跳过，是键盘上下移动的基准序列 */
export const visibleRows = computed<FlatRow[]>(() => {
  const rows: FlatRow[] = []
  const walk = (nodes: OutlineNode[], parent: OutlineNode | null, depth: number) => {
    nodes.forEach((node, index) => {
      rows.push({
        node,
        parent,
        depth,
        index,
        siblings: nodes,
        hasChildren: node.children.length > 0,
      })
      if (node.children.length && !node.collapsed) walk(node.children, node, depth + 1)
    })
  }
  walk(mapState.outlineData, null, 0)
  return rows
})

// ===================== 大纲结构操作 =====================

/** 请求把光标落到某一行（OutlineEditor 在 DOM 更新后消费） */
export function requestFocus(id: string, caret: 'start' | 'end' = 'end'): void {
  mapState.pendingFocus = { id, caret }
  mapState.selectedNodeId = id
}

export function setNodeText(id: string, text: string): void {
  const hit = locate(id)
  if (hit) hit.node.text = text
}

/**
 * Enter：在当前节点之后插入同级新节点。
 * 例外——当前节点有展开的子节点时，插入为它的第一个子节点。
 * 这是幕布/Workflowy 的既定行为：在一个有子项的标题后回车，语义上是「给它加内容」。
 */
export function insertAfter(id: string): string | null {
  const hit = locate(id)
  if (!hit) return null
  const fresh: OutlineNode = { id: newNodeId(), text: '', children: [] }
  if (hit.node.children.length && !hit.node.collapsed) {
    hit.node.children.unshift(fresh)
  } else {
    hit.siblings.splice(hit.index + 1, 0, fresh)
  }
  requestFocus(fresh.id, 'end')
  return fresh.id
}

/** 在末尾追加一个顶层节点（空文档时的入口） */
export function appendRoot(): string {
  const fresh: OutlineNode = { id: newNodeId(), text: '', children: [] }
  mapState.outlineData.push(fresh)
  requestFocus(fresh.id, 'end')
  return fresh.id
}

/**
 * Tab：降级为「前一个兄弟」的最后一个子节点。
 * 没有前兄弟时无法降级（大纲里第一项不可能有更深的父级），直接忽略。
 */
export function indentNode(id: string): boolean {
  const hit = locate(id)
  if (!hit || hit.index === 0) return false
  const prev = hit.siblings[hit.index - 1]
  hit.siblings.splice(hit.index, 1)
  prev.children.push(hit.node)
  prev.collapsed = false // 降级进去却看不见，是最容易让人以为「节点丢了」的坑
  requestFocus(id, 'end')
  return true
}

/** Shift+Tab：提升为父节点的下一个兄弟；已经在顶层则忽略 */
export function outdentNode(id: string): boolean {
  const hit = locate(id)
  if (!hit || !hit.parent) return false
  const parentHit = locate(hit.parent.id)
  if (!parentHit) return false
  hit.siblings.splice(hit.index, 1)
  parentHit.siblings.splice(parentHit.index + 1, 0, hit.node)
  requestFocus(id, 'end')
  return true
}

/**
 * 删除节点，返回删除后应该聚焦的行 id。
 * 子节点不会跟着消失——提升到原节点的位置，避免误删一整棵子树。
 */
export function removeNode(id: string): string | null {
  const rows = visibleRows.value
  const rowIdx = rows.findIndex((r) => r.node.id === id)
  const prevId = rowIdx > 0 ? rows[rowIdx - 1].node.id : null
  const hit = locate(id)
  if (!hit) return null
  const lifted = hit.node.children
  hit.siblings.splice(hit.index, 1, ...lifted)
  const fallback = prevId ?? (lifted[0]?.id || mapState.outlineData[0]?.id || null)
  if (fallback) requestFocus(fallback, 'end')
  return fallback
}

export function toggleCollapse(id: string): void {
  const hit = locate(id)
  if (!hit || !hit.node.children.length) return
  hit.node.collapsed = !hit.node.collapsed
}

/** 同级上移 / 下移（Alt+Shift+↑/↓） */
export function moveNode(id: string, dir: -1 | 1): boolean {
  const hit = locate(id)
  if (!hit) return false
  const target = hit.index + dir
  if (target < 0 || target >= hit.siblings.length) return false
  const [node] = hit.siblings.splice(hit.index, 1)
  hit.siblings.splice(target, 0, node)
  requestFocus(id, 'end')
  return true
}

/**
 * 拖拽落位：把 dragId 移动到 targetId 的前 / 后 / 子级。
 * 必须挡住「拖到自己的后代里」，否则会把子树从树上摘下来，直接丢数据。
 */
export function moveNodeTo(dragId: string, targetId: string, position: 'before' | 'after' | 'child'): boolean {
  if (dragId === targetId) return false
  const drag = locate(dragId)
  if (!drag) return false
  if (isAncestor(drag.node, targetId)) return false

  drag.siblings.splice(drag.index, 1)
  const target = locate(targetId)
  if (!target) {
    // 目标在移除后失效（理论上不会发生），把节点放回去避免丢失
    drag.siblings.splice(drag.index, 0, drag.node)
    return false
  }
  if (position === 'child') {
    target.node.children.unshift(drag.node)
    target.node.collapsed = false
  } else {
    target.siblings.splice(position === 'before' ? target.index : target.index + 1, 0, drag.node)
  }
  mapState.selectedNodeId = dragId
  return true
}

export function expandAll(): void {
  const walk = (nodes: OutlineNode[]) => {
    for (const node of nodes) {
      node.collapsed = false
      walk(node.children)
    }
  }
  walk(mapState.outlineData)
}

/** 折叠到指定层级：level=1 表示只留顶层 */
export function collapseToLevel(level = 1): void {
  const walk = (nodes: OutlineNode[], depth: number) => {
    for (const node of nodes) {
      node.collapsed = node.children.length > 0 && depth >= level
      walk(node.children, depth + 1)
    }
  }
  walk(mapState.outlineData, 1)
}

// ===================== 大纲 → Markdown（导图视图的输入） =====================

/**
 * markmap 吃的是 Markdown，不是我们的 JSON 树，所以这里做一次投影。
 * 标题作为根节点（中心主题），顶层节点作为一级分支，其余用嵌套无序列表表达层级。
 * 行首的 Markdown 元字符必须转义，否则用户写个「- 待办」就会被解析成新的列表项而错位。
 */
function escapeMarkdown(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/^(\s*)([-*+>#]|\d+\.)/, '$1\\$2')
    .trim()
}

export function outlineToMarkdown(
  nodes: OutlineNode[] = mapState.outlineData,
  title = mapState.title,
): string {
  const lines: string[] = [`# ${escapeMarkdown(title || '未命名导图')}`, '']
  const walk = (list: OutlineNode[], depth: number) => {
    for (const node of list) {
      lines.push(`${'  '.repeat(depth)}- ${escapeMarkdown(node.text) || '　'}`)
      if (node.children.length) walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return lines.join('\n')
}

// ===================== 大纲 → 流程图 =====================

/**
 * 把大纲树转成一张竖向流程图（父 → 子连边）。
 * 布局用最朴素的「按层分行、层内均分列」：足够看清结构，用户再手动拖成想要的样子。
 * 不追求自动美化——真要做正交布局得引 dagre，对这个场景性价比不高。
 */
export function buildFlowFromOutline(): FlowchartData {
  const nodes: any[] = []
  const edges: any[] = []
  const levels: OutlineNode[][] = []

  const collect = (list: OutlineNode[], depth: number) => {
    if (!levels[depth]) levels[depth] = []
    for (const node of list) {
      levels[depth].push(node)
      if (node.children.length) collect(node.children, depth + 1)
    }
  }
  collect(mapState.outlineData, 0)

  const COL_W = 220
  const ROW_H = 130
  levels.forEach((row, depth) => {
    row.forEach((node, i) => {
      nodes.push({
        id: node.id,
        type: depth === 0 ? 'rounded' : 'rect',
        position: { x: i * COL_W - ((row.length - 1) * COL_W) / 2 + 400, y: depth * ROW_H + 40 },
        data: { label: node.text || '未命名' },
      })
      for (const child of node.children) {
        edges.push({
          id: `e_${node.id}_${child.id}`,
          source: node.id,
          target: child.id,
          markerEnd: 'arrowclosed',
        })
      }
    })
  })
  return { nodes, edges }
}

// ===================== 文档加载 / 保存 =====================

/** 已落盘内容的快照，用于区分「程序载入」与「用户编辑」 */
let savedSnapshot = ''
let saveTimer: number | null = null

function snapshot(): string {
  return JSON.stringify({
    title: mapState.title,
    outlineData: mapState.outlineData,
    flowchartData: mapState.flowchartData,
  })
}

/** 载入文档后调用：把当前内容标记为「已保存」，防止 watch 误判 */
function markClean(): void {
  savedSnapshot = snapshot()
  mapState.dirty = false
  mapState.saveStatus = 'idle'
  mapState.saveMessage = ''
}

export async function loadList(): Promise<void> {
  mapState.loadingList = true
  try {
    const res = await listMindMaps()
    mapState.mindMaps = res.items || []
  } catch (e) {
    notify(getApiError(e, '加载导图列表失败'), 'error')
  } finally {
    mapState.loadingList = false
  }
}

export async function openMap(id: string): Promise<void> {
  if (!id || id === mapState.activeMapId) return
  await flushSave()
  mapState.loadingDoc = true
  try {
    const doc = await getMindMap(id)
    mapState.activeMapId = doc.id
    mapState.title = doc.title
    mapState.outlineData = doc.outlineData.length ? doc.outlineData : defaultOutline()
    mapState.flowchartData = doc.flowchartData || { nodes: [], edges: [] }
    mapState.selectedNodeId = ''
    markClean()
  } catch (e) {
    notify(getApiError(e, '打开导图失败'), 'error')
  } finally {
    mapState.loadingDoc = false
  }
}

/** 首次进入页面：拉列表 → 打开最近编辑的一份；后端不可用时退回内置示例 */
export async function bootstrap(): Promise<void> {
  await loadList()
  if (mapState.mindMaps.length) {
    await openMap(mapState.mindMaps[0].id)
  } else {
    markClean()
  }
}

export async function createMap(title = '未命名导图'): Promise<void> {
  await flushSave()
  try {
    const doc = await apiCreate({ title, outlineData: [{ id: newNodeId(), text: '中心主题', children: [] }] })
    await loadList()
    mapState.activeMapId = doc.id
    mapState.title = doc.title
    mapState.outlineData = doc.outlineData
    mapState.flowchartData = doc.flowchartData
    mapState.viewMode = 'outline'
    markClean()
    notify(`已创建《${doc.title}》`, 'success')
    if (mapState.outlineData[0]) requestFocus(mapState.outlineData[0].id, 'end')
  } catch (e) {
    notify(getApiError(e, '创建导图失败'), 'error')
  }
}

export async function removeMap(id: string): Promise<void> {
  try {
    await apiDelete(id)
    if (id === mapState.activeMapId) {
      // 删掉的正是当前文档，先断开自动保存的回写目标，否则会把已删文件重新写回来
      if (saveTimer !== null) window.clearTimeout(saveTimer)
      saveTimer = null
      mapState.activeMapId = ''
    }
    await loadList()
    if (!mapState.activeMapId && mapState.mindMaps.length) {
      await openMap(mapState.mindMaps[0].id)
    }
    notify('已删除', 'success')
  } catch (e) {
    notify(getApiError(e, '删除失败'), 'error')
  }
}

/** 立即落盘（Cmd+S / 切换文档 / 离开页面时调用） */
export async function flushSave(): Promise<void> {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!mapState.activeMapId || !mapState.dirty) return
  const id = mapState.activeMapId
  const payload = {
    title: mapState.title,
    outlineData: mapState.outlineData,
    flowchartData: mapState.flowchartData,
  }
  const sending = snapshot()
  mapState.saveStatus = 'saving'
  try {
    const res = await saveMindMap(id, payload)
    // 保存耗时内用户可能又改了内容，此时不能标记为「已保存」
    if (id === mapState.activeMapId && sending === snapshot()) {
      savedSnapshot = sending
      mapState.dirty = false
      mapState.saveStatus = 'saved'
      mapState.savedAt = res.updatedAt || Date.now()
    }
    const meta = mapState.mindMaps.find((m) => m.id === id)
    if (meta) {
      meta.title = payload.title
      meta.updatedAt = res.updatedAt || Date.now()
    }
  } catch (e) {
    mapState.saveStatus = 'error'
    mapState.saveMessage = getApiError(e, '保存失败')
    notify(mapState.saveMessage, 'error')
  }
}

/* 自动保存：deep watch 整份文档，防抖后写回。
 * watch 建在模块作用域（单例 store 的生命周期即应用生命周期），组件反复挂载不会重复注册。 */
watch(
  () => [mapState.title, mapState.outlineData, mapState.flowchartData],
  () => {
    if (!mapState.activeMapId) return
    if (snapshot() === savedSnapshot) return // 程序载入的内容，不是用户编辑
    mapState.dirty = true
    if (saveTimer !== null) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      void flushSave()
    }, SAVE_DEBOUNCE_MS)
  },
  { deep: true },
)

// ===================== AI 生成 =====================

/**
 * 调 AI 生成大纲并覆盖当前文档。
 * 后端未配置 Key 时会返回 mock=true 的兜底结构（不是错误），这里照常覆盖，
 * 只是提示文案换成「示例结构」，让用户知道现在看的不是真模型输出。
 */
export async function generateByAi(topic: string, options: { depth?: number; branches?: number } = {}): Promise<boolean> {
  const t = topic.trim()
  if (!t) {
    notify('请先输入主题', 'warning')
    return false
  }
  mapState.aiLoading = true
  try {
    const res = await generateMindMapByAi({ topic: t, ...options })
    mapState.title = res.title || t
    mapState.outlineData = res.outline
    mapState.selectedNodeId = ''
    notify(
      res.mock
        ? '未配置 AI Key，已填充示例结构（可在「AI 设置」中配置后重试）'
        : `已生成 ${outlineStats.value.count} 个节点 · ${res.model}`,
      res.mock ? 'warning' : 'success',
    )
    return true
  } catch (e) {
    notify(getApiError(e, 'AI 生成失败'), 'error')
    return false
  } finally {
    mapState.aiLoading = false
  }
}

export function setViewMode(mode: ViewMode): void {
  mapState.viewMode = mode
}
