// useHistory：X6 History + Clipboard 插件接管撤销/重做/复制/粘贴（方案 B 核心能力）。
//
// 设计约束（来自 spec §P1-T3.1 / P1-T3.2）：
// - 撤销/重做改用 X6 History 插件的 graph.undo()/graph.redo()，【替代】旧 JSON 快照 pushHistory；
//   Pinia 仅保留步数 counter（此处用响应式 ref 暴露，store 层旧 pushHistory 逻辑留待 P1 末路由切换时统一移除）。
// - 复制/粘贴改用 X6 Clipboard 插件的 graph.copy()/cut()/paste()，【替代】旧内存剪贴板；
//   paste 偏移 24px，节点+边整体粘贴，重复粘贴不重叠。
// - 快捷键统一在此绑定（meta = ⌘ on macOS / ctrl on win-linux）。
// - canUndo/canRedo/historySize 响应式暴露给工具栏：画布空时按钮置灰、显示步数。
import { ref, type Ref } from 'vue'
import type { Graph } from '@antv/x6'

export interface HistoryBindings {
  canUndo: Ref<boolean>
  canRedo: Ref<boolean>
  historySize: Ref<number>
}

export function setupHistoryBindings(graph: Graph): HistoryBindings {
  const canUndo = ref(false)
  const canRedo = ref(false)
  const historySize = ref(0)

  function sync() {
    canUndo.value = graph.canUndo()
    canRedo.value = graph.canRedo()
    historySize.value = graph.getHistoryStackSize?.() ?? 0
  }
  sync()
  graph.on('history:change', sync)

  // ===== 撤销 / 重做 =====
  graph.bindKey(['meta+z', 'ctrl+z'], () => {
    if (graph.canUndo()) graph.undo()
    return false
  })
  graph.bindKey(['meta+shift+z', 'ctrl+shift+z'], () => {
    if (graph.canRedo()) graph.redo()
    return false
  })
  graph.bindKey(['meta+y', 'ctrl+y'], () => {
    if (graph.canRedo()) graph.redo()
    return false
  })

  // ===== 复制 / 剪切 / 粘贴（X6 Clipboard 插件，原内存剪贴板移除）=====
  graph.bindKey(['meta+c', 'ctrl+c'], () => {
    const cells = graph.getSelectedCells()
    if (cells.length) graph.copy(cells)
    return false
  })
  graph.bindKey(['meta+x', 'ctrl+x'], () => {
    const cells = graph.getSelectedCells()
    if (cells.length) graph.cut(cells)
    return false
  })
  graph.bindKey(['meta+v', 'ctrl+v'], () => {
    if (!graph.isClipboardEmpty()) {
      const pasted = graph.paste({ offset: 24 })
      graph.cleanSelection()
      graph.select(pasted)
    }
    return false
  })

  // ===== 删除选中（Delete / Backspace）=====
  // X6 Keyboard 默认 guard 会在 input/textarea/contenteditable 聚焦时跳过，避免编辑文字误删节点。
  graph.bindKey(['delete', 'backspace'], () => {
    const cells = graph.getSelectedCells()
    if (cells.length) graph.removeCells(cells)
    return false
  })

  return { canUndo, canRedo, historySize }
}
