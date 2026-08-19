<template>
  <div class="x6-pages">
    <div class="x6-pages-scroll">
      <div
        v-for="(p, i) in pages"
        :key="p.id"
        class="x6-page-tab"
        :class="{ 'is-active': p.id === currentPageId, 'is-dragging': dragIndex === i }"
        draggable="true"
        v-tip="p.name"
        @click="onSwitch(p.id)"
        @dragstart="onDragStart(i, $event)"
        @dragover.prevent="onDragOver(i)"
        @drop.prevent="onDrop(i)"
        @dragend="dragIndex = -1"
      >
        <input
          v-if="editingId === p.id"
          class="x6-page-input"
          :value="p.name"
          spellcheck="false"
          @click.stop
          @change="onRename(p.id, $event)"
          @blur="editingId = null"
          @keydown.enter="editingId = null"
        />
        <span v-else class="x6-page-name" @dblclick.stop="startRename(p.id)">{{ p.name }}</span>
        <span class="x6-page-count">{{ cellCount(p) }}</span>
        <button
          v-if="pages.length > 1"
          class="x6-page-del"
          v-tip="'删除此页'"
          @click.stop="onDelete(p.id)"
        >
          <Icon name="x" size="xs" />
        </button>
      </div>

      <button class="x6-page-add" v-tip="'新增页面'" @click="onAdd">
        <Icon name="plus" size="xs" /> 页
      </button>
    </div>

    <span class="x6-page-save" v-if="saving">保存中…</span>
    <span class="x6-page-save" v-else-if="lastSavedAt">已存 {{ lastSavedAt }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * X6 底部多页管理栏。
 * - 点击页签切换；双击页签名重命名；
 * - 删除需多页且二次确认（告知不可恢复）；
 * - 拖拽页签重排页面顺序（HTML5 draggable）。
 */
import { ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { confirmDialog } from '@/utils/toast'
import type { DiagramPageData } from './usePages'

const props = defineProps<{
  pages: DiagramPageData[]
  currentPageId: string
  saving?: boolean
  lastSavedAt?: string
}>()

const emit = defineEmits<{
  (e: 'switch', id: string): void
  (e: 'add'): void
  (e: 'delete', id: string): void
  (e: 'rename', id: string, name: string): void
  (e: 'move', from: number, to: number): void
}>()

const editingId = ref<string | null>(null)
const dragIndex = ref(-1)

function cellCount(p: DiagramPageData) {
  const cells = p.data?.cells || []
  return cells.length
}

function onSwitch(id: string) {
  if (id === props.currentPageId) return
  emit('switch', id)
}
function onAdd() {
  emit('add')
}
function startRename(id: string) {
  editingId.value = id
}
function onRename(id: string, e: Event) {
  const val = (e.target as HTMLInputElement).value.trim()
  if (val) emit('rename', id, val)
  editingId.value = null
}
async function onDelete(id: string) {
  const name = props.pages.find((p) => p.id === id)?.name || '该页面'
  const ok = await confirmDialog(
    `确定删除「${name}」？页面中的所有图形与连线将被永久移除，此操作不可恢复。`,
  )
  if (ok) emit('delete', id)
}
function onDragStart(i: number, e: DragEvent) {
  dragIndex.value = i
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragOver(i: number) {
  if (dragIndex.value >= 0 && dragIndex.value !== i) {
    dragIndex.value = i
  }
}
function onDrop(i: number) {
  if (dragIndex.value >= 0 && dragIndex.value !== i) {
    emit('move', dragIndex.value, i)
  }
  dragIndex.value = -1
}
</script>

<style scoped>
.x6-pages {
  flex-shrink: 0;
  height: 38px;
  display: flex;
  align-items: center;
  border-top: 1px solid var(--kb-border);
  background: var(--kb-background, #fff);
  padding: 0 8px;
  box-sizing: border-box;
  gap: 8px;
}
:global([data-theme='dark']) .x6-pages {
  background: var(--kb-card, #1f1f1f);
}
.x6-pages-scroll {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  flex: 1 1 auto;
  min-width: 0;
}
.x6-page-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 160px;
  padding: 4px 8px;
  border: 1px solid var(--kb-border);
  border-radius: 6px;
  background: var(--kb-muted, #f8fafc);
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
  transition: background 0.12s, border-color 0.12s;
}
:global([data-theme='dark']) .x6-page-tab {
  background: #2a2a2a;
}
.x6-page-tab.is-active {
  border-color: var(--kb-primary, #3b6fe0);
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
}
.x6-page-tab.is-dragging {
  opacity: 0.5;
}
.x6-page-name {
  font-size: 12px;
  color: var(--kb-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.x6-page-input {
  width: 110px;
  font-size: 12px;
  border: 1px solid var(--kb-primary, #3b6fe0);
  border-radius: 4px;
  padding: 1px 4px;
  background: var(--kb-background, #fff);
  color: var(--kb-foreground);
  outline: none;
}
.x6-page-count {
  font-size: 11px;
  color: var(--kb-muted-foreground);
  background: color-mix(in srgb, var(--kb-muted-foreground) 14%, transparent);
  border-radius: 8px;
  padding: 0 6px;
  flex-shrink: 0;
}
.x6-page-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}
.x6-page-del:hover {
  color: var(--kb-destructive, #dc2626);
  background: color-mix(in srgb, var(--kb-destructive) 12%, transparent);
}
.x6-page-add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px dashed var(--kb-border);
  border-radius: 6px;
  background: transparent;
  color: var(--kb-foreground);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color 0.12s, color 0.12s;
}
.x6-page-add:hover {
  border-color: var(--kb-primary, #3b6fe0);
  color: var(--kb-primary, #3b6fe0);
}
.x6-page-save {
  font-size: 11px;
  color: var(--kb-muted-foreground);
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
