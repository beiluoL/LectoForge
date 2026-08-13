<template>
  <div class="dl-page">
    <!-- 顶部信息栏：当前库路径 / 统计 / 切换文件夹 -->
    <header class="dl-topbar">
      <span class="dl-topbar-title">
        <Icon name="library" size="md" style="color: var(--kb-primary);" />
        文档库
      </span>
      <span v-if="docState.ready" class="dl-topbar-path" :title="docState.rootDir">{{ docState.rootDir }}</span>
      <span class="flex-1"></span>
      <span v-if="docState.ready" class="dl-topbar-meta">
        {{ treeStats.folders }} 个文件夹 · {{ treeStats.files }} 篇笔记
      </span>
      <button
        v-if="docState.ready && docState.leftCollapsed"
        type="button"
        class="kb-btn kb-btn-sm"
        title="展开目录树"
        @click="toggleLeft()"
      >
        <Icon name="chevron-right" size="xs" />
        目录树
      </button>
      <button v-if="docState.ready" type="button" class="kb-btn kb-btn-sm" @click="pickerOpen = true">
        <Icon name="folder-open" size="xs" />
        切换文件夹
      </button>
      <button
        v-if="docState.ready"
        type="button"
        class="kb-btn kb-btn-sm"
        :class="{ 'is-on': todoOpen }"
        title="文档待办：提取库内未完成 TODO"
        @click="todoOpen = !todoOpen"
      >
        <Icon name="list-checks" size="xs" />
        待办
        <span v-if="todos.length" class="dl-todo-badge">{{ todos.length }}</span>
      </button>
    </header>

    <!-- 未选定工作区：引导页 -->
    <div v-if="!docState.ready" class="dl-shell">
      <div class="dl-onboard">
        <div v-if="docState.loadingWorkspace" class="dl-empty">
          <Icon name="refresh-cw" size="xl" class="animate-spin" style="color: var(--kb-muted-foreground);" />
          <p class="dl-empty-desc">正在读取工作区状态…</p>
        </div>

        <div v-else class="dl-empty">
          <span class="dl-empty-icon"><Icon name="folder-open" size="2xl" /></span>
          <p class="dl-empty-title">选择一个文件夹作为你的文档库</p>
          <p class="dl-empty-desc">
            选定后，该文件夹里的所有 Markdown 文件都会以目录树呈现，可直接编辑并自动保存。
            文件全程留在本机磁盘，不会被上传。
          </p>
          <div class="flex items-center gap-2">
            <button type="button" class="kb-btn kb-btn-primary" @click="pickerOpen = true">
              <Icon name="folder-open" size="sm" />
              打开本地文件夹
            </button>
            <button v-if="docState.defaultDir" type="button" class="kb-btn" @click="useDefaultDir">
              <Icon name="hard-drive" size="sm" />
              使用默认目录
            </button>
          </div>
          <p v-if="docState.defaultDir" class="dl-default-hint" :title="docState.defaultDir">
            默认目录：{{ docState.defaultDir }}
          </p>
        </div>
      </div>
    </div>

    <!-- 三栏工作台 -->
    <div v-else class="dl-shell" :class="{ 'is-collapsed': docState.leftCollapsed }">
      <FileTree />

      <EditorArea
        ref="editorRef"
        :toc-visible="tocVisible"
        @toggle-toc="toggleToc"
        @active-anchor="activeAnchor = $event"
      />

      <TOC v-if="tocVisible" :active-anchor="activeAnchor" @jump="onJump" />
    </div>

    <!-- 目录选择器 -->
    <WorkspacePicker
      v-if="pickerOpen"
      :initial-dir="docState.rootDir || docState.defaultDir"
      @close="pickerOpen = false"
      @confirm="onPickWorkspace"
    />

    <!-- 功能 A：文档库 TODO 悬浮面板 -->
    <transition name="dl-todo-slide">
      <section v-if="todoOpen && docState.ready" class="dl-todo-panel">
        <header class="dl-todo-head">
          <span class="dl-todo-title">
            <Icon name="list-checks" size="xs" />
            文档待办（{{ todos.length }}）
          </span>
          <span class="dl-todo-actions">
            <button type="button" class="dl-icon-btn" title="刷新" :disabled="todoLoading" @click="loadTodos">
              <Icon name="refresh-cw" size="xs" :class="todoLoading ? 'animate-spin' : ''" />
            </button>
            <button type="button" class="dl-icon-btn" title="关闭" @click="todoOpen = false">
              <Icon name="x" size="xs" />
            </button>
          </span>
        </header>
        <div class="dl-todo-body">
          <p v-if="todoLoading" class="dl-todo-empty">正在扫描库内 Markdown…</p>
          <p v-else-if="!todos.length" class="dl-todo-empty">
            没有发现未完成的待办（识别 <code>- [ ]</code> 与 <code>TODO:</code> 两种写法）
          </p>
          <ul v-else class="dl-todo-list">
            <li
              v-for="t in todos"
              :key="todoKey(t)"
              class="dl-todo-item"
              :class="{ 'is-leaving': leaving.has(todoKey(t)) }"
            >
              <div class="dl-todo-meta">
                <span class="dl-todo-file" :title="t.fileName">{{ t.fileName }}</span>
                <span class="dl-todo-line">L{{ t.lineNumber }}</span>
              </div>
              <p class="dl-todo-text">{{ t.taskContent }}</p>
              <button
                type="button"
                class="dl-todo-add"
                :disabled="adding.has(todoKey(t))"
                title="添加到任务清单"
                @click="addTodo(t)"
              >
                <Icon name="plus" size="xs" />
                添加
              </button>
            </li>
          </ul>
        </div>
      </section>
    </transition>
  </div>
</template>

<script setup lang="ts">
// 文档库页面外壳：左（文件树） / 中（编辑器） / 右（大纲）三栏。
//
// 组件间协作方式：
// - 文件与正文数据走 useDocStore 单例，三栏都直接读同一份 reactive 状态，不做 props 层层透传；
// - 只有「大纲点击 → 预览区滚动」这一条跨栏交互需要 DOM，故由本组件用 ref 调 EditorArea 暴露的方法；
// - 反向的「滚动 → 当前标题」由 EditorArea 以事件回报，本组件转成 activeAnchor 下发给 TOC。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'

import Icon from '@/components/ui/Icon.vue'
// Markdown 渲染排版与渲染器（@/lib/markdown.ts）配套，任何 v-html 出 .dl-md 的模块都要引它
import '@/lib/markdown.css'

import './doc-library.css'
import EditorArea from './EditorArea.vue'
import FileTree from './FileTree.vue'
import TOC from './TOC.vue'
import WorkspacePicker from './WorkspacePicker.vue'
import { chooseWorkspace, docState, expandAncestors, flushSave, loadWorkspace, openNote, toggleLeft, treeStats } from './useDocStore'
import { scanLibraryTodos, type LibraryTodoItem } from '@/api/library'
import { createTask } from '@/api/task'
import { notify, getApiError } from '@/utils/toast'

/** 大纲显隐偏好本地留存，下次进页面保持上次的选择 */
const TOC_PREF_KEY = 'kb.docLibrary.tocVisible'

/* ---------- 功能 A：文档库 TODO → 任务清单 ----------
 * 扫描库内 Markdown 里的未完成待办（`- [ ]` 与 `TODO:` 两种写法），
 * 浮层逐条展示，一键加入「今天」任务清单；加入后该条先播放划出动画再移除。 */
const todoOpen = ref(false)
const todos = ref<LibraryTodoItem[]>([])
const todoLoading = ref(false)
/** 正在划出 / 正在添加的条目 key，用于禁用按钮与播放离场动画 */
const leaving = ref(new Set<string>())
const adding = ref(new Set<string>())

function todoKey(t: LibraryTodoItem) {
  return `${t.filePath}#L${t.lineNumber}`
}

async function loadTodos() {
  todoLoading.value = true
  try {
    todos.value = await scanLibraryTodos()
  } catch (e) {
    notify(getApiError(e, '扫描待办失败'), 'error')
  } finally {
    todoLoading.value = false
  }
}

async function addTodo(t: LibraryTodoItem) {
  const k = todoKey(t)
  if (adding.value.has(k)) return
  adding.value = new Set(adding.value).add(k)
  try {
    await createTask({
      title: t.taskContent,
      status: 'today',
      notes: `source: 文档库/${t.fileName}`,
    })
    // 划出动画：先标记离场，1s 后从列表移除并清理集合
    leaving.value = new Set(leaving.value).add(k)
    notify('已成功添加到今天任务中', 'success')
    window.setTimeout(() => {
      todos.value = todos.value.filter((x) => todoKey(x) !== k)
      const next = new Set(leaving.value)
      next.delete(k)
      leaving.value = next
    }, 1000)
  } catch (e) {
    notify(getApiError(e, '添加到任务清单失败'), 'error')
  } finally {
    const next = new Set(adding.value)
    next.delete(k)
    adding.value = next
  }
}

/** 打开面板时自动拉一次，避免每次都要手动点刷新 */
watch(todoOpen, (open) => {
  if (open && !todos.value.length) void loadTodos()
})

const editorRef = ref<InstanceType<typeof EditorArea> | null>(null)
const tocVisible = ref(localStorage.getItem(TOC_PREF_KEY) !== '0')
const activeAnchor = ref('')
const pickerOpen = ref(false)
const route = useRoute()

function toggleToc() {
  tocVisible.value = !tocVisible.value
  localStorage.setItem(TOC_PREF_KEY, tocVisible.value ? '1' : '0')
}

function onJump(anchorId: string) {
  activeAnchor.value = anchorId
  editorRef.value?.scrollToAnchor(anchorId)
}

async function onPickWorkspace(payload: { path: string; create: boolean }) {
  const ok = await chooseWorkspace(payload.path, payload.create)
  if (ok) pickerOpen.value = false
}

async function useDefaultDir() {
  // 默认目录位于应用数据目录下，首次使用时通常还不存在，故允许后端创建
  await chooseWorkspace(docState.defaultDir, true)
}

/* 关窗 / 刷新时把防抖里还没落盘的编辑冲刷掉。
 * beforeunload 里只能发起请求、无法 await，但配合 keepalive 语义已能覆盖绝大多数场景，
 * 真正可靠的兜底是下面路由离开与组件卸载时的 await flushSave()。 */
function onBeforeUnload() {
  void flushSave()
}

onMounted(async () => {
  window.addEventListener('beforeunload', onBeforeUnload)
  await loadWorkspace()
  // 深链：知识库问答的来源胶囊以 /library?doc=<相对id> 跳转，进入后自动展开并打开该笔记
  const doc = route.query.doc
  if (typeof doc === 'string' && doc) {
    expandAncestors(doc)
    await openNote(doc)
  }
  // 深链：RAG 来源可能附带 ?highlight=L20-L25，进入后自动滚动并浅黄高亮对应行
  const hl = route.query.highlight
  if (typeof hl === 'string' && hl) {
    editorRef.value?.highlightAnchor(hl)
  }
})

onBeforeRouteLeave(async () => {
  await flushSave()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  void flushSave()
})
</script>

<style scoped>
/* 引导页在三栏外壳里占满整行 */
.dl-onboard {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
}
.dl-onboard > .dl-empty {
  flex: 1 1 auto;
}

.dl-default-hint {
  max-width: 420px;
  font-family: var(--font-mono);
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
