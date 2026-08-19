// usePages：多页系统（方案 B 对应 spec §P1-T3.5）。
//
// 设计约束：
// - 每个 page 对应一份 graph.toJSON() 快照，切换时 graph.fromJSON() 载入目标页并清空 history；
// - 切换前先把当前页内容写回 pages 数组对应项，保证数据不丢；
// - 与现有 DiagramBottomBar.vue 解耦（底栏只消费 pages/currentPageId，引擎无关），
//   真正的 X6 化替换留待 P1 末路由切换时统一做。
// - graph 为 shallowRef<Graph|null>，需在 onMounted 后（graph ready）调用 ensureInit。
import { ref, type Ref } from 'vue'
import type { Graph } from '@antv/x6'

export interface DiagramPageData {
  id: string
  name: string
  data: any // graph.toJSON() 结果
}

export function usePages(graph: Ref<Graph | null>) {
  const pages = ref<DiagramPageData[]>([])
  const currentPageId = ref<string>('')

  function snapshotCurrent() {
    const g = graph.value
    if (!g) return
    const cur = pages.value.find((p) => p.id === currentPageId.value)
    if (cur) cur.data = g.toJSON()
  }

  function ensureInit() {
    if (pages.value.length) return
    const id = 'p1'
    pages.value = [{ id, name: '页面 1', data: graph.value ? graph.value.toJSON() : { cells: [] } }]
    currentPageId.value = id
  }

  function switchPage(id: string) {
    const g = graph.value
    if (!g || id === currentPageId.value) return
    snapshotCurrent()
    const target = pages.value.find((p) => p.id === id)
    if (target) {
      g.fromJSON(target.data || { cells: [] })
      g.cleanHistory()
      currentPageId.value = id
    }
  }

  function addPage() {
    const g = graph.value
    if (!g) return
    snapshotCurrent()
    const id = `p${pages.value.length + 1}-${Date.now().toString(36)}`
    pages.value = [
      ...pages.value,
      { id, name: `页面 ${pages.value.length + 1}`, data: { cells: [] } },
    ]
    g.fromJSON({ cells: [] })
    g.cleanHistory()
    currentPageId.value = id
  }

  function removePage(id: string) {
    if (pages.value.length <= 1) return
    const idx = pages.value.findIndex((p) => p.id === id)
    if (idx < 0) return
    pages.value = pages.value.filter((p) => p.id !== id)
    if (currentPageId.value === id) {
      const next = pages.value[Math.max(0, idx - 1)]
      currentPageId.value = next.id
      if (graph.value) {
        graph.value.fromJSON(next.data || { cells: [] })
        graph.value.cleanHistory()
      }
    }
  }

  function renamePage(id: string, name: string) {
    const trimmed = name.trim()
    pages.value = pages.value.map((p) => (p.id === id ? { ...p, name: trimmed || p.name } : p))
  }

  function movePage(from: number, to: number) {
    if (from < 0 || to < 0 || from >= pages.value.length || to >= pages.value.length || from === to) return
    const list = pages.value.slice()
    const [moved] = list.splice(from, 1)
    list.splice(to, 0, moved)
    pages.value = list
  }

  /** 序列化：先写回当前页，再返回完整 pages（含当前页最新内容），供持久化落库 */
  function serialize(): DiagramPageData[] {
    snapshotCurrent()
    return pages.value
  }

  /** 载入已持久化的多页（打开文档 / 旧数据迁移时用） */
  function loadPages(data: DiagramPageData[], currentId: string) {
    pages.value = data
    currentPageId.value = currentId
  }

  return { pages, currentPageId, ensureInit, switchPage, addPage, removePage, renamePage, movePage, serialize, loadPages }
}
