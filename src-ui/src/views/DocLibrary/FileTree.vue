<template>
  <aside class="dl-col-left" aria-label="文件目录树">
    <!-- 顶部工具栏：新建笔记 / 新建文件夹 / 刷新 -->
    <div class="dl-pane-head">
      <span class="dl-pane-title">
        <Icon name="folder-tree" size="sm" />
        文档库
      </span>
      <span class="flex-1"></span>
      <button type="button" class="dl-icon-btn" title="新建笔记" @click="onNewNote('')">
        <Icon name="file-plus" size="sm" />
      </button>
      <button type="button" class="dl-icon-btn" title="新建文件夹" @click="onNewFolder('')">
        <Icon name="folder-plus" size="sm" />
      </button>
      <button
        type="button"
        class="dl-icon-btn"
        title="刷新文件树"
        :disabled="docState.loadingTree"
        @click="refreshTree()"
      >
        <Icon name="refresh-cw" size="sm" :class="docState.loadingTree ? 'animate-spin' : ''" />
      </button>
      <button
        type="button"
        class="dl-icon-btn"
        title="收起目录树"
        aria-label="收起目录树"
        @click="toggleLeft()"
      >
        <Icon name="chevron-left" size="sm" />
      </button>
    </div>

    <!-- 过滤框 -->
    <div class="px-2 pt-2">
      <div class="dl-filter">
        <Icon name="search" size="xs" />
        <input
          v-model="keyword"
          type="search"
          class="dl-filter-input"
          placeholder="按名称筛选"
          aria-label="按名称筛选笔记"
        />
        <button v-if="keyword" type="button" class="dl-icon-btn" title="清空" @click="keyword = ''">
          <Icon name="x" size="xs" />
        </button>
      </div>
    </div>

    <!-- 树主体 -->
    <div class="dl-scroll" @contextmenu.prevent="openMenu($event, null)">
      <div v-if="docState.loadingTree && !docState.fileTree.length" class="pt-2">
        <div v-for="i in 6" :key="i" class="dl-skel" :style="{ width: `${55 + ((i * 13) % 35)}%` }"></div>
      </div>

      <!-- 搜索模式：结果来自后端全库扫描，不依赖已展开树 -->
      <template v-else-if="keyword.trim()">
        <p v-if="docState.searching" class="dl-empty-sm">搜索中…</p>
        <p v-else-if="!docState.searchResults.length" class="dl-empty-sm">没有匹配「{{ keyword }}」的笔记</p>
        <div v-else class="dl-search-list">
          <button
            v-for="hit in docState.searchResults"
            :key="hit.id"
            type="button"
            class="dl-search-item"
            :title="hit.id"
            @click="openSearchHit(hit)"
          >
            <Icon name="file-text" size="xs" class="dl-search-ic" />
            <span class="dl-search-name">{{ hit.name }}</span>
            <span class="dl-search-path">{{ parentLabel(hit.parentId) }}</span>
          </button>
        </div>
      </template>

      <!-- 浏览模式：懒加载树（展开文件夹才拉子项） -->
      <div v-else-if="docState.fileTree.length" class="dl-tree" role="tree">
        <FileTreeNode v-for="node in docState.fileTree" :key="node.id" :node="node" />
      </div>

      <div v-else class="dl-empty-sm">
        <p>这个文档库还是空的</p>
        <button type="button" class="kb-btn kb-btn-sm kb-btn-primary mt-3" @click="onNewNote('')">
          <Icon name="plus" size="xs" />
          新建第一篇笔记
        </button>
      </div>
    </div>

    <!-- 上下文菜单 -->
    <div
      v-if="menu.open"
      class="dl-menu"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      role="menu"
      @click.stop
    >
      <p class="dl-menu-label">{{ menu.node ? menu.node.name : '文档库根目录' }}</p>
      <template v-if="!menu.node || menu.node.type === 'folder'">
        <button type="button" class="dl-menu-item" @click="runMenu(() => onNewNote(menu.node?.id ?? ''))">
          <Icon name="file-plus" size="sm" /> 新建笔记
        </button>
        <button type="button" class="dl-menu-item" @click="runMenu(() => onNewFolder(menu.node?.id ?? ''))">
          <Icon name="folder-plus" size="sm" /> 新建文件夹
        </button>
      </template>
      <button
        v-if="menu.node"
        type="button"
        class="dl-menu-item"
        @click="runMenu(() => onRename(menu.node as LibTreeNode))"
      >
        <Icon name="pencil" size="sm" /> 重命名
      </button>
      <button
        v-if="menu.node"
        type="button"
        class="dl-menu-item is-danger"
        @click="runMenu(() => onDelete(menu.node as LibTreeNode))"
      >
        <Icon name="trash-2" size="sm" /> 删除
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
// 左栏：文件目录树面板。
// 负责工具栏、名称筛选、上下文菜单等「容器级」职责，
// 单个节点的渲染与递归交给 FileTreeNode.vue。
import { onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue'

import type { LibSearchHit, LibTreeNode } from '@/api/library'
import Icon from '@/components/ui/Icon.vue'
import { confirmDialog, promptDialog } from '@/utils/toast'

import FileTreeNode from './FileTreeNode.vue'
import { TREE_CTX } from './treeContext'
import {
  docState,
  newFolder,
  newNote,
  openNote,
  refreshTree,
  removeNode,
  renameNode,
  searchInLibrary,
  toggleFolder,
  toggleLeft,
} from './useDocStore'

const keyword = ref('')
let searchTimer: number | null = null

/** 搜索框输入：防抖后走后端全库检索（大库下不依赖内存中的部分树） */
watch(keyword, (val) => {
  const q = val.trim()
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
    searchTimer = null
  }
  if (!q) {
    docState.searchResults = []
    docState.searching = false
    return
  }
  docState.searching = true
  searchTimer = window.setTimeout(() => {
    void searchInLibrary(q)
  }, 250)
})

/** 把父目录 id 转成可读路径（根目录显示「文档库根目录」） */
function parentLabel(parentId: string): string {
  return parentId ? parentId : '文档库根目录'
}

function openSearchHit(hit: LibSearchHit) {
  closeMenu()
  void openNote(hit.id)
}

// ===== 节点交互（通过 provide 下发给任意深度的递归节点）=====

function select(node: LibTreeNode) {
  closeMenu()
  if (node.type === 'folder') void toggleFolder(node.id)
  else void openNote(node.id)
}

async function onNewNote(parentDir: string) {
  const name = await promptDialog(
    parentDir ? `在「${parentDir}」中新建笔记` : '在文档库根目录新建笔记',
    { placeholder: '文件名（可不写 .md 后缀）', defaultValue: '未命名笔记' },
  )
  if (name === null) return
  await newNote(parentDir, name)
}

async function onNewFolder(parentDir: string) {
  const name = await promptDialog(
    parentDir ? `在「${parentDir}」中新建文件夹` : '在文档库根目录新建文件夹',
    { placeholder: '文件夹名称', defaultValue: '新建文件夹' },
  )
  if (name === null) return
  await newFolder(parentDir, name)
}

async function onRename(node: LibTreeNode) {
  const base = node.type === 'file' ? node.name.replace(/\.(md|markdown|mdx)$/i, '') : node.name
  const name = await promptDialog(`重命名「${node.name}」`, {
    placeholder: '新名称',
    defaultValue: base,
  })
  if (name === null || name === base) return
  await renameNode(node, name)
}

async function onDelete(node: LibTreeNode) {
  const hasChildren = node.type === 'folder' && (node.children?.length ?? 0) > 0
  const message = hasChildren
    ? `「${node.name}」内还有 ${node.children?.length} 项内容，删除后会连同其中所有笔记一起从磁盘移除，且无法撤销。确定删除吗？`
    : `确定要从磁盘删除「${node.name}」吗？此操作无法撤销。`
  const ok = await confirmDialog(message)
  if (!ok) return
  await removeNode(node, hasChildren)
}

// ===== 上下文菜单 =====

const menu = reactive({ open: false, x: 0, y: 0, node: null as LibTreeNode | null })

function openMenu(event: MouseEvent, node: LibTreeNode | null) {
  // 贴边时向内收，避免菜单被窗口裁掉
  const width = 168
  const height = node ? 190 : 150
  menu.x = Math.min(event.clientX, window.innerWidth - width - 8)
  menu.y = Math.min(event.clientY, window.innerHeight - height - 8)
  menu.node = node
  menu.open = true
}

function closeMenu() {
  menu.open = false
  menu.node = null
}

/** 菜单项统一先关菜单再执行，避免弹窗与菜单叠在一起 */
function runMenu(action: () => void | Promise<void>) {
  const fn = action
  closeMenu()
  void fn()
}

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeMenu()
}

onMounted(() => {
  window.addEventListener('click', closeMenu)
  window.addEventListener('resize', closeMenu)
  window.addEventListener('keydown', onGlobalKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('click', closeMenu)
  window.removeEventListener('resize', closeMenu)
  window.removeEventListener('keydown', onGlobalKeydown)
})

provide(TREE_CTX, {
  select,
  openMenu,
  quickNewNote: (parentDir: string) => {
    closeMenu()
    void onNewNote(parentDir)
  },
})
</script>

<style scoped>
.dl-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-sm);
  background: var(--kb-card);
  color: var(--kb-muted-foreground);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.dl-filter:focus-within {
  border-color: var(--kb-primary);
  box-shadow: var(--kb-focus-ring);
}
.dl-filter-input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--kb-foreground);
  font-size: var(--kb-fs-caption);
}
.dl-filter-input::placeholder {
  color: var(--kb-muted-foreground);
}
/* 去掉 Safari 对 type=search 的原生清除按钮，统一用自绘的 x */
.dl-filter-input::-webkit-search-decoration,
.dl-filter-input::-webkit-search-cancel-button {
  -webkit-appearance: none;
  appearance: none;
}

.dl-menu {
  position: fixed;
  z-index: 90;
  min-width: 168px;
  padding: 5px;
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-md);
  background: var(--kb-popover);
  box-shadow: var(--shadow-lg);
}
.dl-menu-label {
  padding: 5px 9px 7px;
  margin-bottom: 3px;
  border-bottom: 1px solid var(--kb-border);
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dl-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: var(--kb-radius-sm);
  background: transparent;
  color: var(--kb-foreground);
  font-size: var(--kb-fs-body-sm);
  text-align: left;
  cursor: pointer;
}
.dl-menu-item:hover {
  background: var(--kb-muted);
}
.dl-menu-item:focus-visible {
  outline: none;
  box-shadow: var(--kb-focus-ring);
}
.dl-menu-item.is-danger {
  color: var(--kb-destructive);
}
.dl-menu-item.is-danger:hover {
  background: color-mix(in srgb, var(--kb-destructive) 10%, transparent);
}
</style>
