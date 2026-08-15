<template>
  <div class="fr-panel" role="dialog" aria-label="查找替换">
    <div class="fr-row">
      <input
        ref="qInput"
        v-model="query"
        class="fr-input"
        type="text"
        placeholder="查找节点 / 连线文字"
        @input="onQueryInput"
        @keydown.enter.prevent="next"
      />
      <button class="kb-btn kb-btn-sm" :disabled="!matches.length" @click="prev" title="上一个 (Shift+Enter)">↑</button>
      <button class="kb-btn kb-btn-sm" :disabled="!matches.length" @click="next" title="下一个 (Enter)">↓</button>
      <span class="fr-count" v-if="matches.length">{{ currentIndex + 1 }} / {{ matches.length }}</span>
      <span class="fr-count" v-else-if="query">无匹配</span>
      <button class="kb-btn kb-btn-sm" @click="emit('close')">✕</button>
    </div>

    <div class="fr-row">
      <label class="fr-check"><input type="checkbox" v-model="caseSensitive" @change="onQueryInput" />区分大小写</label>
      <label class="fr-check"><input type="checkbox" v-model="wholeWord" @change="onQueryInput" />全词匹配</label>
      <span class="fr-sep"></span>
      <input v-model="replaceText" class="fr-input fr-input-sm" type="text" placeholder="替换为" @keydown.enter.prevent="replaceOne" />
      <button class="kb-btn kb-btn-sm" :disabled="!matches.length" @click="replaceOne">替换</button>
      <button class="kb-btn kb-btn-sm" :disabled="!matches.length" @click="replaceAll">全部替换</button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 查找 / 替换（P2-T3.2，Ctrl+F 唤起）。
 * - 扫描全部节点 / 连线的可见文字（节点：attr label/text + data.label；连线：labels/0 + data.label）；
 * - 实时统计匹配数，↑/↓ 在匹配间跳转并把目标居中高亮（disableHistory 包裹，不污染撤销栈）；
 * - 替换 / 全部替换：节点改 attr('label/text') + data.label，连线改 setLabels + data.label；
 *   全部替换整体包 1 步 history。
 */
import { ref, inject, onMounted, nextTick } from 'vue'
import { X6_CTX_KEY, type X6Context } from './context'

const emit = defineEmits<{ (e: 'close'): void }>()

const ctx = inject(X6_CTX_KEY) as X6Context
const qInput = ref<HTMLInputElement | null>(null)

const query = ref('')
const replaceText = ref('')
const caseSensitive = ref(false)
const wholeWord = ref(false)
const matches = ref<Array<{ id: string; kind: 'node' | 'edge' }>>([])
const currentIndex = ref(0)

function graph() {
  return ctx.graph.value
}

/** 读取单元格可见文字 */
function getLabel(cell: any): string {
  if (cell.isEdge?.()) {
    return String(cell.prop('labels/0/attrs/label/text') ?? cell.getData()?.label ?? '')
  }
  return String(cell.attr('label/text') ?? cell.getData()?.label ?? '')
}

/** 写入单元格文字 */
function setLabel(cell: any, text: string) {
  const data = cell.getData() || {}
  if (cell.isEdge?.()) {
    cell.setLabels(
      text
        ? [{ position: 0.5, attrs: { label: { text, fill: '#475569', fontSize: 12, fontFamily: 'system-ui, sans-serif' } } }]
        : [],
    )
    cell.setData({ ...data, label: text })
  } else {
    cell.attr('label/text', text)
    cell.setData({ ...data, label: text })
  }
}

/** 单条匹配判定（区分大小写 / 全词） */
function testMatch(label: string, q: string): boolean {
  const l = caseSensitive.value ? label : label.toLowerCase()
  const s = caseSensitive.value ? q : q.toLowerCase()
  if (wholeWord.value) {
    // 按「非单词字符 / 非 CJK」切词后做整词比对，CJK 与拉丁都适用
    const tokens = l.split(/[^\w一-鿿]+/).filter(Boolean)
    return tokens.includes(s)
  }
  return l.includes(s)
}

function recompute() {
  const g = graph()
  if (!g) {
    matches.value = []
    return
  }
  const q = query.value
  if (!q) {
    matches.value = []
    currentIndex.value = 0
    return
  }
  const result: Array<{ id: string; kind: 'node' | 'edge' }> = []
  g.getCells().forEach((cell: any) => {
    const label = getLabel(cell)
    if (label && testMatch(label, q)) {
      result.push({ id: cell.id, kind: cell.isEdge?.() ? 'edge' : 'node' })
    }
  })
  matches.value = result
  currentIndex.value = 0
  if (result.length) flashCurrent()
}

/** 高亮当前匹配：选中 + 居中 + 临时粉色描边（disableHistory 防污染撤销栈） */
function flashCurrent() {
  const g = graph()
  if (!g || !matches.value.length) return
  const m = matches.value[Math.min(currentIndex.value, matches.value.length - 1)]
  const cell = g.getCellById(m.id)
  if (!cell) return
  g.disableHistory()
  g.select(cell as any)
  ;(g as any).scrollToCell?.(cell)
  const isEdge = cell.isEdge?.()
  const attr = isEdge ? 'line/stroke' : 'body/stroke'
  const prev: any = cell.attr(attr)
  cell.attr(attr, '#FF5C93')
  setTimeout(() => {
    cell.attr(attr, prev)
    g.enableHistory()
  }, 800)
}

function onQueryInput() {
  recompute()
}

function goto(i: number) {
  if (!matches.value.length) return
  const n = matches.value.length
  currentIndex.value = ((i % n) + n) % n
  flashCurrent()
}
function next() {
  goto(currentIndex.value + 1)
}
function prev() {
  goto(currentIndex.value - 1)
}

function replaceOne() {
  const g = graph()
  if (!g || !matches.value.length) return
  const m = matches.value[Math.min(currentIndex.value, matches.value.length - 1)]
  const cell = g.getCellById(m.id)
  if (!cell) return
  g.batchUpdate('find-replace', () => setLabel(cell, replaceText.value))
  recompute()
}

function replaceAll() {
  const g = graph()
  if (!g || !matches.value.length) return
  const withText = replaceText.value
  g.batchUpdate('find-replace-all', () => {
    matches.value.forEach((m) => {
      const cell = g.getCellById(m.id)
      if (cell) setLabel(cell, withText)
    })
  })
  recompute()
}

onMounted(async () => {
  await nextTick()
  qInput.value?.focus()
})
</script>

<style scoped>
.fr-panel {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 18;
  width: min(560px, 92%);
  background: var(--kb-card, #fff);
  border: 1px solid var(--kb-border, #e2e8f0);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fr-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.fr-input {
  flex: 1 1 160px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--kb-border, #cbd5e1);
  border-radius: 6px;
  font-size: 13px;
  background: var(--kb-background, #fff);
  color: var(--kb-foreground, #0f172a);
}
.fr-input-sm {
  flex: 1 1 120px;
}
.fr-count {
  font-size: 12px;
  color: var(--kb-muted-foreground, #64748b);
  white-space: nowrap;
  min-width: 48px;
  text-align: center;
}
.fr-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--kb-foreground, #0f172a);
}
.fr-sep {
  width: 1px;
  height: 18px;
  background: var(--kb-border, #e2e8f0);
}
</style>
