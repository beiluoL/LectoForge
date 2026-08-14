// useGraphPersistence：序列化 / 持久化（P1-T5.5）。
//
// 设计约束（spec §P1-T5.5）：
// - 序列化直接 graph.toJSON()（经 usePages.serialize() 汇总多页），再经 diagramDataAdapter 转后端多页结构；
// - 自动保存：graph 变更事件触发 2000ms 防抖 flush；Ctrl+S 立即 flush；beforeunload 兜底 flush；
// - 加载：fetchDiagram(id) → diagramDetailToX6Pages 转 X6 cells（旧 VueFlow 文档即在此处完成迁移）；
// - 文档 id 存在 localStorage，刷新后回到同一份文档，便于验证「编辑→保存→刷新→数据完整」。
import { ref, type Ref } from 'vue'
import type { Graph } from '@antv/x6'
import { createDiagram, fetchDiagram, updateDiagram, type DiagramData } from '@/api/diagram'
import { diagramDetailToX6Pages, x6PagesToDiagramData } from './diagramDataAdapter'
import type { DiagramPageData } from './usePages'

const LS_KEY = 'x6-pg-diagram-id'
const AUTOSAVE_MS = 2000

export interface PagesSource {
  serialize(): DiagramPageData[]
}

export function useGraphPersistence(graph: Ref<Graph | null>, pages: PagesSource) {
  const diagramId = ref<number | null>(null)
  const saving = ref(false)
  const lastSavedAt = ref<string>('')
  let timer: ReturnType<typeof setTimeout> | null = null

  /** 序列化当前多页 → 后端 DiagramData */
  function buildData(): DiagramData {
    return x6PagesToDiagramData(pages.serialize())
  }

  /** 立即 flush（Ctrl+S / beforeunload） */
  async function flush(): Promise<boolean> {
    if (diagramId.value == null) return false
    saving.value = true
    try {
      await updateDiagram(diagramId.value, { data: buildData() })
      lastSavedAt.value = new Date().toLocaleTimeString()
      return true
    } catch (e) {
      console.error('[persistence] 保存失败', e)
      return false
    } finally {
      saving.value = false
    }
  }

  /** 防抖自动保存 */
  function scheduleSave(delay = AUTOSAVE_MS) {
    if (diagramId.value == null) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      flush()
    }, delay)
  }

  /** 加载：后端多页结构 → X6 cells（旧 VueFlow 文档在此迁移） */
  async function load(id: number): Promise<{ pages: DiagramPageData[]; currentId: string } | null> {
    try {
      const detail = await fetchDiagram(id)
      const conv = diagramDetailToX6Pages(detail)
      const currentId = detail.data.currentPageId || conv[0]?.id || 'p1'
      return { pages: conv, currentId }
    } catch (e) {
      console.error('[persistence] 加载失败', e)
      return null
    }
  }

  /** 取得一个可用的文档 id：localStorage 里有且能加载就复用，否则新建空白图。返回已加载的多页（无则 null） */
  async function ensureDiagram(): Promise<{ id: number; pages: DiagramPageData[] | null; currentId: string }> {
    const cached = Number(localStorage.getItem(LS_KEY) || 0)
    if (cached) {
      const res = await load(cached)
      if (res && res.pages.length) {
        diagramId.value = cached
        return { id: cached, pages: res.pages, currentId: res.currentId }
      }
    }
    const created = await createDiagram('X6 方案 B 验证台')
    localStorage.setItem(LS_KEY, String(created.id))
    diagramId.value = created.id
    return { id: created.id, pages: null, currentId: 'p1' }
  }

  /** 绑定 graph 变更 → 自动保存；返回清理函数 */
  function bindAutoSave(): () => void {
    const g = graph.value
    if (!g) return () => {}
    const events = [
      'cell:added',
      'cell:removed',
      'node:change:position',
      'node:change:size',
      'node:change:attrs',
      'edge:connected',
      'edge:change:attrs',
    ]
    events.forEach((ev) => g.on(ev as any, scheduleSave))
    const off = () => events.forEach((ev) => g.off(ev as any, scheduleSave))
    return off
  }

  return { diagramId, saving, lastSavedAt, load, flush, scheduleSave, ensureDiagram, bindAutoSave }
}
