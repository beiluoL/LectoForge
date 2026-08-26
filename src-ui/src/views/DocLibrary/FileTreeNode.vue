<template>
  <div class="dl-tree-node">
    <div
      class="dl-node-row"
      :class="{ 'is-active': isActive, 'is-drop': isDragTarget }"
      role="treeitem"
      :aria-expanded="isFolder ? isOpen : undefined"
      :aria-selected="isActive"
      :title="node.name"
      tabindex="0"
      draggable="true"
      @dragstart="onDragStart"
      @dragend="onDragEnd"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent.stop="onDrop"
      @click="ctx.select(node)"
      @keydown.enter.prevent="ctx.select(node)"
      @keydown.space.prevent="ctx.select(node)"
      @contextmenu.prevent.stop="ctx.openMenu($event, node)"
    >
      <span class="dl-node-caret" :class="{ 'is-open': isFolder && isOpen, 'is-leaf': !isFolder }">
        <Icon v-if="isFolder" name="chevron-right" size="sm" />
      </span>

      <span class="dl-node-icon" :class="{ 'is-folder': isFolder }">
        <Icon :name="iconName" size="sm" />
      </span>

      <span class="dl-node-name">{{ node.name }}</span>

      <span class="dl-node-actions">
        <button
          v-if="isFolder"
          type="button"
          class="dl-icon-btn"
          title="在此文件夹新建笔记"
          @click.stop="ctx.quickNewNote(node.id)"
        >
          <Icon name="file-plus" size="xs" />
        </button>
        <button
          type="button"
          class="dl-icon-btn"
          title="更多操作"
          @click.stop="ctx.openMenu($event, node)"
        >
          <Icon name="more-horizontal" size="xs" />
        </button>
      </span>
    </div>

    <!-- 递归渲染子节点：SFC 可用文件名自引用，无需额外注册 -->
    <div v-if="isFolder && isOpen" class="dl-tree-children" role="group">
      <p v-if="loadingKids" class="dl-empty-sm">
        <Icon name="loader" size="xs" class="animate-spin" />
        加载中…
      </p>
      <template v-else-if="node.children && node.children.length">
        <FileTreeNode v-for="child in node.children" :key="child.id" :node="child" />
      </template>
      <p v-else class="dl-empty-sm">空文件夹</p>
    </div>
  </div>
</template>

<script setup lang="ts">
// 文件树的递归节点。自身不持有状态，展开态与选中态都读全局 store，
// 交互回调通过 inject 拿容器提供的函数，避免逐层 emit 透传。
import { computed, inject, ref } from 'vue'

import type { LibTreeNode } from '@/api/library'
import Icon from '@/components/ui/Icon.vue'

import { TREE_CTX, type TreeContext } from './treeContext'
import { docState } from './useDocStore'

const props = defineProps<{ node: LibTreeNode }>()

const ctx = inject(TREE_CTX) as TreeContext

const isFolder = computed(() => props.node.type === 'folder')
const isOpen = computed(() => docState.expanded.has(props.node.id))
const loadingKids = computed(() => docState.loadingFolders.has(props.node.id))
const isActive = computed(() => props.node.type === 'file' && docState.activeNoteId === props.node.id)
/** 拖拽悬停目标高亮（仅文件夹） */
const isDragTarget = ref(false)

const iconName = computed(() => {
  if (!isFolder.value) return 'file-text'
  return isOpen.value ? 'folder-open' : 'folder'
})

function onDragStart(e: DragEvent) {
  ctx.dragNode.value = props.node
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', props.node.id)
  }
}
function onDragEnd() {
  ctx.dragNode.value = null
  isDragTarget.value = false
}
function onDragOver() {
  if (!isFolder.value) return
  const dragging = ctx.dragNode.value
  if (dragging && dragging.id !== props.node.id) isDragTarget.value = true
}
function onDragLeave() {
  isDragTarget.value = false
}
function onDrop() {
  isDragTarget.value = false
  const dragging = ctx.dragNode.value
  ctx.dragNode.value = null
  if (!isFolder.value || !dragging || dragging.id === props.node.id) return
  ctx.moveNode(dragging, props.node.id)
}
</script>
