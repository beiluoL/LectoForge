<template>
  <Teleport to="body">
    <Transition name="x6-menu">
      <div v-if="open" class="x6-context-wrap">
        <!-- 透明遮罩：点击任意处关闭菜单 -->
        <div class="x6-context-backdrop" @click="close" @contextmenu.prevent="close" />
        <div
          ref="menuEl"
          class="x6-context-menu"
          :style="{ left: `${x}px`, top: `${y}px` }"
        >
          <p class="x6-context-title">{{ title }}</p>

          <template v-if="targetCell">
            <button type="button" class="x6-context-item" @click="editLabel">
              <Icon name="pencil" size="xs" /> <span class="x6-context-label">编辑文字</span>
              <span class="x6-context-shortcut">⏎</span>
            </button>
            <button type="button" class="x6-context-item" @click="copyCell">
              <Icon name="copy" size="xs" /> <span class="x6-context-label">复制</span>
              <span class="x6-context-shortcut">⌘C</span>
            </button>
            <div class="x6-context-divider" />
            <button type="button" class="x6-context-item is-danger" @click="deleteTarget">
              <Icon name="trash-2" size="xs" /> <span class="x6-context-label">删除图形</span>
              <span class="x6-context-shortcut">Del</span>
            </button>
          </template>

          <template v-else-if="hasSelection">
            <button type="button" class="x6-context-item" @click="copySelected">
              <Icon name="copy" size="xs" /> <span class="x6-context-label">复制选中</span>
              <span class="x6-context-shortcut">⌘C</span>
            </button>
            <div class="x6-context-divider" />
            <button type="button" class="x6-context-item is-danger" @click="deleteSelected">
              <Icon name="trash-2" size="xs" /> <span class="x6-context-label">删除选中图形</span>
              <span class="x6-context-shortcut">Del</span>
            </button>
          </template>

          <template v-else>
            <button type="button" class="x6-context-item" @click="fitView">
              <Icon name="maximize" size="xs" /> <span class="x6-context-label">适应屏幕</span>
            </button>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * X6 画布右键上下文菜单。
 * - 在形状上右键：弹出节点/边操作面板，提供「删除图形」等操作；
 * - 在空白处右键且存在选中图形：提供「删除选中图形」；
 * - 点击遮罩或按 Esc 关闭菜单。
 */
import { ref, shallowRef, computed, watch, nextTick, inject, onBeforeUnmount } from 'vue'
import type { Cell, Graph } from '@antv/x6'
import Icon from '@/components/ui/Icon.vue'
import { X6_CTX_KEY } from './context'

const emit = defineEmits<{
  (e: 'fit'): void
  /** 删除成功后通知上层立即同步多页快照（数据层与画布保持一致） */
  (e: 'deleted'): void
}>()

const ctx = inject(X6_CTX_KEY)
const graph = computed(() => (ctx?.graph.value as Graph | null) ?? null)

const open = ref(false)
const x = ref(0)
const y = ref(0)
// 注意：必须用 shallowRef 而非 ref —— Vue 的 ref() 会对值做 UnwrapRef，
// 把 X6 Cell 类（含 protected 成员）映射成仅公开成员的普通对象类型，
// 导致其不再满足 Cell 类型约束（缺 store/animation/_model/_parent）。
const targetCell = shallowRef<Cell | null>(null)
const hasSelection = ref(false)
const menuEl = ref<HTMLElement | null>(null)

const title = computed(() => {
  if (targetCell.value?.isNode()) return '节点操作'
  if (targetCell.value?.isEdge()) return '连线操作'
  if (hasSelection.value) return '选中操作'
  return '画布操作'
})

function close() {
  open.value = false
  targetCell.value = null
}

function positionMenu(e: MouseEvent) {
  x.value = e.clientX
  y.value = e.clientY
  void nextTick(() => {
    const rect = menuEl.value?.getBoundingClientRect()
    if (!rect) return
    if (x.value + rect.width > window.innerWidth) x.value -= rect.width
    if (y.value + rect.height > window.innerHeight) y.value -= rect.height
    x.value = Math.max(8, x.value)
    y.value = Math.max(8, y.value)
  })
}

function onCellContextMenu({ cell, e }: { cell: Cell; e: MouseEvent }) {
  e.preventDefault()
  const g = graph.value
  if (!g) return
  const selected = g.getSelectedCells()
  if (!selected.some((c) => c.id === cell.id)) {
    g.select(cell)
  }
  targetCell.value = cell
  hasSelection.value = selected.length > 0
  positionMenu(e)
  open.value = true
}

function onBlankContextMenu({ e }: { e: MouseEvent }) {
  e.preventDefault()
  const g = graph.value
  if (!g) return
  const selected = g.getSelectedCells()
  targetCell.value = null
  hasSelection.value = selected.length > 0
  if (!hasSelection.value) {
    // 空白处且无选中时，不弹菜单（桌面端 webview 无原生右键菜单，此处静默）
    return
  }
  positionMenu(e)
  open.value = true
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

watch(
  graph,
  (g, oldG) => {
    oldG?.off('cell:contextmenu', onCellContextMenu)
    oldG?.off('blank:contextmenu', onBlankContextMenu)
    if (g) {
      g.on('cell:contextmenu', onCellContextMenu)
      g.on('blank:contextmenu', onBlankContextMenu)
    }
  },
  { immediate: true },
)

watch(open, (v) => {
  if (v) window.addEventListener('keydown', onKeyDown)
  else window.removeEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  graph.value?.off('cell:contextmenu', onCellContextMenu)
  graph.value?.off('blank:contextmenu', onBlankContextMenu)
  window.removeEventListener('keydown', onKeyDown)
})

/**
 * 执行删除。要点（修复「删除后画布不刷新、需切页才生效」）：
 * 1. 只删除当前模型中真实存在的 cell —— X6 Selection 的 select() 是 add 语义，
 *    跨页 fromJSON 后选中集合可能残留上一页的陈旧 cell 引用，
 *    直接 removeCells 会因 has(cell)===false 静默 no-op；
 * 2. 先 cleanSelection 再 removeCells —— 避免移除过程中 node:unselected → removeTools
 *    与模型移除交错执行、中断视图刷新链；
 * 3. batchUpdate 把模型移除+视图收尾合并为单次原子渲染，删除立即反映到画布；
 * 4. 删除成功后 emit('deleted')，上层立即同步 pages 快照，数据层不再停留在删除前状态。
 */
function doDelete(cells: Cell[]) {
  const g = graph.value
  if (!g || !cells.length) return
  const live = cells.filter((c) => g.getCellById(c.id))
  if (!live.length) {
    close()
    return
  }
  g.cleanSelection()
  g.batchUpdate('context-delete', () => {
    g.removeCells(live)
  })
  emit('deleted')
  close()
}

function deleteTarget() {
  const cell = targetCell.value
  if (!cell) return
  const g = graph.value
  if (!g) return
  // 优先删除当前模型中真实存在的选中项；没有（陈旧引用）才退化为右键目标 cell
  const selected = g.getSelectedCells().filter((c) => g.getCellById(c.id))
  doDelete(selected.length > 0 ? selected : [cell])
}

function deleteSelected() {
  const g = graph.value
  if (!g) return
  doDelete(g.getSelectedCells().filter((c) => g.getCellById(c.id)))
}

function copyCell() {
  const g = graph.value
  const cell = targetCell.value
  if (!g || !cell) return
  g.select(cell)
  g.copy([cell])
  close()
}

function copySelected() {
  const g = graph.value
  if (!g) return
  g.copy(g.getSelectedCells())
  close()
}

function editLabel() {
  const g = graph.value
  const cell = targetCell.value
  if (!g || !cell) return
  g.select(cell)
  if (cell.isNode()) {
    cell.setData({ ...cell.getData(), editing: true })
    window.dispatchEvent(new CustomEvent('diagram:edit-node', { detail: { id: cell.id } }))
  } else {
    window.dispatchEvent(new CustomEvent('diagram:edit-edge', { detail: { id: cell.id } }))
  }
  close()
}

function fitView() {
  emit('fit')
  close()
}
</script>

<style scoped>
.x6-context-wrap {
  position: fixed;
  inset: 0;
  z-index: 100;
  pointer-events: none;
}
.x6-context-backdrop {
  position: absolute;
  inset: 0;
  pointer-events: auto;
}
.x6-context-menu {
  position: fixed;
  z-index: 100;
  pointer-events: auto;
  min-width: 184px;
  padding: 6px 0;
  background: var(--kb-popover, #fff);
  border: 1px solid var(--kb-border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
  font-size: 13px;
  color: var(--kb-foreground);
}
:global([data-theme='dark']) .x6-context-menu {
  background: var(--kb-card, #1f1f1f);
}
.x6-context-title {
  margin: 0;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--kb-muted-foreground);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.x6-context-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  border: none;
  background: transparent;
  color: var(--kb-foreground);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}
.x6-context-label {
  flex: 1;
  white-space: nowrap;
}
.x6-context-shortcut {
  margin-left: 16px;
  font-size: 11px;
  color: var(--kb-muted-foreground);
  letter-spacing: 0.3px;
}
.x6-context-item:hover {
  background: var(--kb-muted, #f1f5f9);
}
.x6-context-item.is-danger {
  color: var(--kb-destructive, #dc2626);
}
.x6-context-item.is-danger .x6-context-shortcut {
  color: color-mix(in srgb, var(--kb-destructive) 70%, var(--kb-muted-foreground));
}
.x6-context-item.is-danger:hover {
  background: color-mix(in srgb, var(--kb-destructive) 10%, transparent);
}
.x6-context-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--kb-border);
}
.x6-menu-enter-active,
.x6-menu-leave-active {
  transition: opacity 0.12s, transform 0.12s;
}
.x6-menu-enter-from,
.x6-menu-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
