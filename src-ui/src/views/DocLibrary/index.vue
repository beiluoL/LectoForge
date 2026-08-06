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
  </div>
</template>

<script setup lang="ts">
// 文档库页面外壳：左（文件树） / 中（编辑器） / 右（大纲）三栏。
//
// 组件间协作方式：
// - 文件与正文数据走 useDocStore 单例，三栏都直接读同一份 reactive 状态，不做 props 层层透传；
// - 只有「大纲点击 → 预览区滚动」这一条跨栏交互需要 DOM，故由本组件用 ref 调 EditorArea 暴露的方法；
// - 反向的「滚动 → 当前标题」由 EditorArea 以事件回报，本组件转成 activeAnchor 下发给 TOC。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

import Icon from '@/components/ui/Icon.vue'

import './doc-library.css'
import EditorArea from './EditorArea.vue'
import FileTree from './FileTree.vue'
import TOC from './TOC.vue'
import WorkspacePicker from './WorkspacePicker.vue'
import { chooseWorkspace, docState, flushSave, loadWorkspace, toggleLeft, treeStats } from './useDocStore'

/** 大纲显隐偏好本地留存，下次进页面保持上次的选择 */
const TOC_PREF_KEY = 'kb.docLibrary.tocVisible'

const editorRef = ref<InstanceType<typeof EditorArea> | null>(null)
const tocVisible = ref(localStorage.getItem(TOC_PREF_KEY) !== '0')
const activeAnchor = ref('')
const pickerOpen = ref(false)

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

onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
  void loadWorkspace()
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
