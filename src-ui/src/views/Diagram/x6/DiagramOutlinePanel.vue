<template>
  <div class="x6-outline">
    <div class="x6-outline-head">
      <span>大纲</span>
      <input v-model="q" class="x6-outline-search" type="text" placeholder="筛选…" />
    </div>
    <div class="x6-outline-body">
      <ul v-if="filtered.length" class="x6-outline-root">
        <DiagramOutlineTreeItem
          v-for="it in filtered"
          :key="it.id"
          :item="it"
          :active-id="activeId"
          @pick="onPick"
        />
      </ul>
      <p v-else class="x6-outline-empty">画布为空或没有匹配项</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 大纲面板（P2-T2.5）：树形展示 容器/泳道/分组 → 子节点 → 边。
 * 点击树节点：选中对应 cell + scrollToCell 滚到视图居中 + 高亮闪烁一次；顶部搜索框过滤（保留命中祖先）。
 */
import { ref, computed, watch, inject, onUnmounted } from 'vue'
import { X6_CTX_KEY, type X6Context } from './context'
import { isStructuralShape } from './graphConfig'
import { type OutlineItem } from './outlineTypes'
import DiagramOutlineTreeItem from './DiagramOutlineTreeItem.vue'

const ctx = inject(X6_CTX_KEY) as X6Context
const q = ref('')
const activeId = ref('')

/** 树随画布结构变化重建：监听相关事件递增 version 触发 computed 重算 */
const version = ref(0)
const EVENTS = ['cell:added', 'cell:removed', 'node:change:parent', 'node:change:data', 'node:change:attrs', 'node:change:size']
let off: (() => void) | null = null
watch(
  ctx.graph,
  (g) => {
    off?.()
    off = null
    if (g) {
      const bump = () => version.value++
      EVENTS.forEach((e) => g.on(e as any, bump))
      off = () => EVENTS.forEach((e) => g.off(e as any, bump))
    }
  },
  { immediate: true },
)
onUnmounted(() => off?.())

function shortShape(shape: string): string {
  return shape.replace(/^diagram-/, '')
}
function nodeLabel(node: any): string {
  const data = node.getData?.() || {}
  if (data.label) return String(data.label)
  const t = node.attr('label/text')
  if (t) return String(t)
  return shortShape(node.shape)
}
function edgeLabel(edge: any): string {
  const data = edge.getData?.() || {}
  if (data.label) return String(data.label)
  const labels = edge.getLabels?.() || []
  if (labels.length && labels[0]?.attrs?.label?.text) return String(labels[0].attrs.label.text)
  return '连线'
}

function toNodeItem(cell: any): OutlineItem {
  return { id: cell.id, label: nodeLabel(cell), kind: 'node', shape: shortShape(cell.shape) }
}
function toEdgeItem(edge: any): OutlineItem {
  return { id: edge.id, label: edgeLabel(edge), kind: 'edge', shape: 'edge' }
}
function buildStructItem(node: any): OutlineItem {
  const kids = (node.getChildren?.() || []).filter((c: any) => c.isNode())
  return {
    id: node.id,
    label: nodeLabel(node),
    kind: 'struct',
    shape: shortShape(node.shape),
    children: kids.map((c: any) => (isStructuralShape(c.shape) ? buildStructItem(c) : toNodeItem(c))),
  }
}

function buildTree(): OutlineItem[] {
  const g = ctx.graph.value
  if (!g) return []
  const nodes = g.getNodes()
  const edges = g.getEdges()
  const structNodes = nodes.filter((n: any) => isStructuralShape(n.shape) && !n.getParent())
  const items: OutlineItem[] = structNodes.map((n: any) => buildStructItem(n))

  const ungrouped = nodes.filter((n: any) => !isStructuralShape(n.shape) && !n.getParent())
  if (ungrouped.length) {
    items.push({ id: '__ungrouped', label: '未分组节点', kind: 'struct', shape: 'group', children: ungrouped.map(toNodeItem) })
  }
  if (edges.length) {
    items.push({ id: '__edges', label: `连线 (${edges.length})`, kind: 'struct', shape: 'edge', children: edges.map(toEdgeItem) })
  }
  return items
}

const tree = computed(() => {
  version.value // 触发依赖
  return buildTree()
})

function filterTree(items: OutlineItem[], needle: string): OutlineItem[] {
  if (!needle) return items
  const n = needle.toLowerCase()
  const out: OutlineItem[] = []
  for (const it of items) {
    const kids = it.children ? filterTree(it.children, needle) : []
    const hit = it.label.toLowerCase().includes(n) || it.shape.toLowerCase().includes(n)
    if (hit || kids.length) out.push({ ...it, children: kids.length ? kids : it.children })
  }
  return out
}
const filtered = computed(() => filterTree(tree.value, q.value.trim()))

function onPick(item: OutlineItem) {
  const g = ctx.graph.value
  if (!g) return
  const cell = g.getCellById(item.id)
  if (!cell) return
  activeId.value = item.id
  g.select(cell)
  // 滚到视图居中（scroller 插件方法）
  ;(g as any).scrollToCell?.(cell)
  flashCell(cell)
}

/** 高亮闪烁一次：临时改描边色，700ms 后还原；期间禁用 history 避免污染撤销栈 */
function flashCell(cell: any) {
  const g = ctx.graph.value
  if (!g) return
  const target = cell.isNode() ? 'body' : 'line'
  const prevStroke = cell.attr(`${target}/stroke`)
  const prevWidth = cell.attr(`${target}/strokeWidth`)
  ;(g as any).disableHistory?.()
  cell.attr(`${target}/stroke`, '#3b6fe0')
  cell.attr(`${target}/strokeWidth`, 3)
  window.setTimeout(() => {
    cell.attr(`${target}/stroke`, prevStroke)
    cell.attr(`${target}/strokeWidth`, prevWidth)
    ;(g as any).enableHistory?.()
  }, 700)
}
</script>

<style scoped>
.x6-outline {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-size: 12px;
}
.x6-outline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--kb-border, #e2e8f0);
  font-weight: 600;
}
.x6-outline-search {
  flex: 1;
  height: 26px;
  border: 1px solid var(--kb-border, #cbd5e1);
  border-radius: 6px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 400;
}
.x6-outline-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}
.x6-outline-root {
  margin: 0;
  padding: 0;
}
.x6-outline-empty {
  color: var(--kb-muted-foreground, #64748b);
  padding: 12px;
  text-align: center;
}
</style>
