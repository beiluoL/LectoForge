<template>
  <div class="mm-outline">
    <div class="mm-outline-scroll" @click.self="focusLastRow">
      <div
        v-for="row in rows"
        :key="row.node.id"
        class="mm-row"
        :class="{
          'is-selected': mapState.selectedNodeId === row.node.id,
          'is-drop-before': dropHint.id === row.node.id && dropHint.pos === 'before',
          'is-drop-after': dropHint.id === row.node.id && dropHint.pos === 'after',
          'is-drop-child': dropHint.id === row.node.id && dropHint.pos === 'child',
          'is-dragging': draggingId === row.node.id,
        }"
        @dragover.prevent="onDragOver(row, $event)"
        @dragleave="onDragLeave(row)"
        @drop.prevent="onDrop(row)"
      >
        <span class="mm-row-indent" :style="{ width: `${row.depth * 22}px` }" />

        <!-- 折叠开关：没有子节点时占位但不可点，保证所有行的文字左边界对齐 -->
        <button
          v-if="row.hasChildren"
          type="button"
          class="mm-row-toggle"
          :title="row.node.collapsed ? '展开子节点' : '折叠子节点'"
          @click="toggleCollapse(row.node.id)"
        >
          <Icon :name="row.node.collapsed ? 'chevron-right' : 'chevron-down'" size="xs" />
        </button>
        <span v-else class="mm-row-toggle mm-row-toggle--empty" />

        <!-- 圆点同时是拖拽手柄：拖整行会和文本选区打架，所以只让这个小圆点可拖 -->
        <span
          class="mm-row-bullet"
          :class="{ 'has-collapsed': row.node.collapsed && row.hasChildren }"
          draggable="true"
          title="拖拽调整层级 / 排序"
          @dragstart="onDragStart(row, $event)"
          @dragend="onDragEnd"
          @click="toggleCollapse(row.node.id)"
        />

        <div
          :ref="(el) => setRowEl(row.node.id, el as HTMLElement | null)"
          v-mm-text="row.node.text"
          class="mm-row-text"
          contenteditable="plaintext-only"
          spellcheck="false"
          data-placeholder="输入内容，Tab 缩进，Enter 新建"
          @input="onInput(row, $event)"
          @keydown="onKeydown(row, $event)"
          @focus="mapState.selectedNodeId = row.node.id"
          @paste="onPaste"
        />

        <button
          type="button"
          class="mm-row-del"
          title="删除该节点（子节点会提升一级）"
          @click="onDelete(row.node.id)"
        >
          <Icon name="trash-2" size="xs" />
        </button>
      </div>

      <button v-if="!rows.length" type="button" class="mm-empty-add" @click="appendRoot">
        <Icon name="plus" size="sm" /> 添加第一个节点
      </button>
    </div>

    <footer class="mm-outline-hints">
      <span><kbd>Tab</kbd> 缩进</span>
      <span><kbd>⇧Tab</kbd> 升级</span>
      <span><kbd>Enter</kbd> 新建</span>
      <span><kbd>Backspace</kbd> 删空行</span>
      <span><kbd>⌥⇧↑↓</kbd> 移动</span>
      <span><kbd>⌘Enter</kbd> 折叠</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
/**
 * 极简大纲编辑器（对标幕布 / Workflowy）
 *
 * 【为什么用 contenteditable 而不是 input】
 * 大纲节点需要自动换行与自适应高度，一行一个 <input> 做不到；用 <textarea> 又要手动算高度。
 * contenteditable 天然满足，代价是不能用 v-model —— 这引出下面这个坑。
 *
 * 【光标跳到末尾的坑】
 * 如果用 {{ node.text }} 插值渲染，用户每敲一个字 → 数据变 → Vue 重写 textContent →
 * 浏览器把光标重置到末尾，中文输入直接没法用。
 * 解法是自定义指令 v-mm-text：只有当 DOM 里的文本与数据「真的不一致」时才写回 DOM。
 * 用户输入时 innerText 已经等于数据，不会触发写入，光标自然不动；
 * 而 AI 生成 / 撤销这类外部改动会让两者不一致，此时才同步。
 *
 * 【中文输入法】
 * keydown 在 IME 组合期间也会触发（keyCode 229），此时拦截 Enter 会把选词回车吃掉。
 * 所以所有按键处理前先判 isComposing。
 */
import { computed, nextTick, reactive, ref, watch } from 'vue'

import Icon from '@/components/ui/Icon.vue'

import {
  appendRoot,
  indentNode,
  insertAfter,
  mapState,
  moveNode,
  moveNodeTo,
  outdentNode,
  removeNode,
  requestFocus,
  setNodeText,
  toggleCollapse,
  visibleRows,
  type FlatRow,
} from '../useMindMapStore'

const rows = computed(() => visibleRows.value)

/** 行 id → DOM 元素，用于聚焦与光标定位 */
const rowEls = new Map<string, HTMLElement>()
function setRowEl(id: string, el: HTMLElement | null) {
  if (el) rowEls.set(id, el)
  else rowEls.delete(id)
}

/**
 * 文本同步指令：只在 DOM 与数据不一致时写回，保住光标位置。
 * script setup 中以 v 开头的驼峰变量会自动注册为 v-mm-text。
 */
const vMmText = {
  mounted(el: HTMLElement, binding: { value: string }) {
    el.innerText = binding.value ?? ''
  },
  updated(el: HTMLElement, binding: { value: string }) {
    const next = binding.value ?? ''
    if (el.innerText !== next) el.innerText = next
  },
}

// ===================== 光标 =====================

function placeCaret(el: HTMLElement, caret: 'start' | 'end') {
  const range = document.createRange()
  const sel = window.getSelection()
  range.selectNodeContents(el)
  range.collapse(caret === 'start')
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/** store 派发聚焦请求 → DOM 更新后消费 */
watch(
  () => mapState.pendingFocus,
  async (pf) => {
    if (!pf) return
    await nextTick()
    const el = rowEls.get(pf.id)
    if (el) {
      el.focus()
      placeCaret(el, pf.caret)
      el.scrollIntoView({ block: 'nearest' })
    }
    mapState.pendingFocus = null
  },
)

function focusRowAt(index: number, caret: 'start' | 'end' = 'end') {
  const row = rows.value[index]
  if (row) requestFocus(row.node.id, caret)
}

function focusLastRow() {
  if (rows.value.length) focusRowAt(rows.value.length - 1)
}

// ===================== 输入与按键 =====================

function onInput(row: FlatRow, e: Event) {
  setNodeText(row.node.id, (e.target as HTMLElement).innerText)
}

/** 粘贴一律降级为纯文本，避免把网页样式和 <div> 结构塞进节点 */
function onPaste(e: ClipboardEvent) {
  e.preventDefault()
  const text = (e.clipboardData?.getData('text/plain') || '').replace(/[\r\n]+/g, ' ')
  document.execCommand('insertText', false, text)
}

function onKeydown(row: FlatRow, e: KeyboardEvent) {
  // 输入法组合中：一律放行，否则会吃掉选词的回车与退格
  if (e.isComposing || e.keyCode === 229) return

  const id = row.node.id
  const el = e.target as HTMLElement
  const rowIndex = rows.value.findIndex((r) => r.node.id === id)

  // ⌘/Ctrl + Enter：折叠 / 展开
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    toggleCollapse(id)
    return
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    insertAfter(id)
    return
  }
  if (e.key === 'Tab') {
    e.preventDefault()
    if (e.shiftKey) outdentNode(id)
    else indentNode(id)
    return
  }
  // ⌥⇧ + ↑/↓：同级排序（放在方向键导航之前判断）
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey && e.shiftKey) {
    e.preventDefault()
    moveNode(id, e.key === 'ArrowUp' ? -1 : 1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    focusRowAt(rowIndex - 1)
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    focusRowAt(rowIndex + 1)
    return
  }
  // 空行退格：删除本行并把光标退到上一行，与幕布一致
  if (e.key === 'Backspace' && !el.innerText.trim() && rows.value.length > 1) {
    e.preventDefault()
    removeNode(id)
  }
}

function onDelete(id: string) {
  removeNode(id)
}

// ===================== 拖拽 =====================

const draggingId = ref('')
/** 落点提示：目标行 + 落在它的前 / 后 / 子级 */
const dropHint = reactive<{ id: string; pos: 'before' | 'after' | 'child' | '' }>({ id: '', pos: '' })

function onDragStart(row: FlatRow, e: DragEvent) {
  draggingId.value = row.node.id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // Firefox 必须 setData 才会真正发起拖拽
    e.dataTransfer.setData('text/plain', row.node.id)
  }
}

function onDragEnd() {
  draggingId.value = ''
  dropHint.id = ''
  dropHint.pos = ''
}

/** 按鼠标在行内的纵向位置三等分：上 1/4 前插、下 1/4 后插、中间成为子节点 */
function onDragOver(row: FlatRow, e: DragEvent) {
  if (!draggingId.value || draggingId.value === row.node.id) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = (e.clientY - rect.top) / rect.height
  dropHint.id = row.node.id
  dropHint.pos = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'child'
}

function onDragLeave(row: FlatRow) {
  if (dropHint.id === row.node.id) {
    dropHint.id = ''
    dropHint.pos = ''
  }
}

function onDrop(row: FlatRow) {
  if (draggingId.value && dropHint.pos) {
    moveNodeTo(draggingId.value, row.node.id, dropHint.pos)
  }
  onDragEnd()
}
</script>
