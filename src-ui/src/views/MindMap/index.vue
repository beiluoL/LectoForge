<template>
  <div class="mm-page">
    <!-- ===== 顶部工具栏 ===== -->
    <header class="mm-topbar">
      <span class="mm-topbar-title">
        <Icon name="git-branch" size="md" style="color: var(--kb-primary);" /> 思维导图
      </span>

      <input
        v-model="mapState.title"
        class="mm-title-input"
        placeholder="未命名导图"
        :disabled="!mapState.activeMapId"
        title="点击修改标题"
      />

      <span class="mm-save-state" :class="`is-${saveState.tone}`">
        <Icon :name="saveState.icon" size="xs" :class="mapState.saveStatus === 'saving' ? 'animate-spin' : ''" />
        {{ saveState.text }}
      </span>

      <span class="flex-1" />

      <!-- 视图切换 -->
      <div class="mm-seg" role="tablist">
        <button
          v-for="v in VIEWS"
          :key="v.mode"
          type="button"
          role="tab"
          class="mm-seg-item"
          :class="{ 'is-active': mapState.viewMode === v.mode }"
          :aria-selected="mapState.viewMode === v.mode"
          @click="setViewMode(v.mode)"
        >
          <Icon :name="v.icon" size="xs" />
          <span>{{ v.label }}</span>
        </button>
      </div>

      <button
        v-if="mapState.viewMode === 'outline'"
        type="button"
        class="kb-btn kb-btn-sm"
        :class="{ 'is-on': splitView }"
        title="大纲与导图并排显示"
        @click="splitView = !splitView"
      >
        <Icon name="layout" size="xs" /> 分屏
      </button>

      <span class="mm-bar-sep" />

      <button type="button" class="kb-btn kb-btn-sm" title="新建导图" @click="onCreate">
        <Icon name="plus" size="xs" /> 新建
      </button>
      <button
        type="button"
        class="kb-btn kb-btn-sm"
        :disabled="!mapState.dirty"
        title="立即保存（⌘S）"
        @click="flushSave"
      >
        <Icon name="save" size="xs" /> 保存
      </button>
      <button type="button" class="kb-btn kb-btn-sm kb-btn-primary" @click="aiOpen = true">
        <Icon name="ai-sparkle" size="xs" /> AI 生成
      </button>
    </header>

    <!-- ===== 主体 ===== -->
    <div class="mm-shell">
      <!-- 左侧：导图列表 -->
      <aside class="mm-side" :class="{ 'is-collapsed': sideCollapsed }">
        <div class="mm-side-head">
          <span v-if="!sideCollapsed">我的导图（{{ mapState.mindMaps.length }}）</span>
          <button
            type="button"
            class="mm-icon-btn"
            :title="sideCollapsed ? '展开列表' : '收起列表'"
            @click="sideCollapsed = !sideCollapsed"
          >
            <Icon :name="sideCollapsed ? 'chevron-right' : 'chevron-left'" size="sm" />
          </button>
        </div>

        <ul v-if="!sideCollapsed" class="mm-side-list">
          <li
            v-for="m in mapState.mindMaps"
            :key="m.id"
            class="mm-side-item"
            :class="{ 'is-active': m.id === mapState.activeMapId }"
            @click="openMap(m.id)"
          >
            <Icon name="list-tree" size="xs" class="mm-side-icon" />
            <span class="mm-side-name" :title="m.title">{{ m.title }}</span>
            <span class="mm-side-meta">{{ m.nodeCount }}</span>
            <button type="button" class="mm-side-del" title="删除" @click.stop="onDelete(m)">
              <Icon name="trash-2" size="xs" />
            </button>
          </li>
          <li v-if="!mapState.mindMaps.length && !mapState.loadingList" class="mm-side-empty">
            还没有导图，点右上角「新建」
          </li>
        </ul>
      </aside>

      <!-- 右侧：三视图 -->
      <main class="mm-main" :class="{ 'is-split': isSplit }">
        <template v-if="mapState.viewMode === 'outline'">
          <OutlineEditor />
          <MindmapRenderer v-if="splitView" class="mm-split-right" />
        </template>
        <MindmapRenderer v-else-if="mapState.viewMode === 'mindmap'" />
        <FlowchartEditor v-else />
      </main>
    </div>

    <AIGenerator v-if="aiOpen" @close="aiOpen = false" />
  </div>
</template>

<script setup lang="ts">
/**
 * 思维导图主页面
 *
 * 一份文档（outlineData + flowchartData）三种看法：
 * - outline   极简大纲笔记，唯一的结构编辑入口（可开分屏，右侧实时投影成导图）
 * - mindmap   markmap 渲染的只读导图，缩放/拖拽/折叠
 * - flowchart vue-flow 画布，独立的图形数据
 *
 * 所有状态在 useMindMapStore 单例里，本页只做布局与命令派发。
 * 保存策略：store 内 deep watch 防抖自动落盘；⌘S、切换文档、离开路由时强制冲刷一次。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

import Icon from '@/components/ui/Icon.vue'
import { confirmDialog } from '@/utils/toast'

import AIGenerator from './components/AIGenerator.vue'
import FlowchartEditor from './components/FlowchartEditor.vue'
import MindmapRenderer from './components/MindmapRenderer.vue'
import OutlineEditor from './components/OutlineEditor.vue'
import './mind-map.css'
import {
  bootstrap,
  createMap,
  flushSave,
  mapState,
  openMap,
  removeMap,
  setViewMode,
  type MindMapMeta,
  type ViewMode,
} from './useMindMapStore'

const VIEWS: { mode: ViewMode; label: string; icon: string }[] = [
  { mode: 'outline', label: '大纲', icon: 'list-tree' },
  { mode: 'mindmap', label: '导图', icon: 'git-branch' },
  { mode: 'flowchart', label: '流程图', icon: 'share-2' },
]

const aiOpen = ref(false)
const splitView = ref(false)
const sideCollapsed = ref(false)

const isSplit = computed(() => mapState.viewMode === 'outline' && splitView.value)

/** 保存状态的三态展示，避免用户不确定改动有没有落盘 */
const saveState = computed(() => {
  if (mapState.saveStatus === 'saving') return { text: '保存中…', icon: 'loader', tone: 'busy' }
  if (mapState.saveStatus === 'error') return { text: mapState.saveMessage || '保存失败', icon: 'alert-circle', tone: 'error' }
  if (mapState.dirty) return { text: '未保存', icon: 'edit-2', tone: 'dirty' }
  if (mapState.saveStatus === 'saved') return { text: '已保存', icon: 'check', tone: 'ok' }
  return { text: '已同步', icon: 'check', tone: 'idle' }
})

async function onCreate() {
  await createMap(`未命名导图 ${new Date().toLocaleDateString('zh-CN')}`)
}

async function onDelete(m: MindMapMeta) {
  const ok = await confirmDialog(`确定删除《${m.title}》吗？此操作不可撤销。`)
  if (ok) await removeMap(m.id)
}

/** ⌘S / Ctrl+S 立即保存：桌面端用户的肌肉记忆，必须接住，否则会触发浏览器保存网页 */
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void flushSave()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void bootstrap()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  void flushSave()
})

onBeforeRouteLeave(async () => {
  await flushSave()
})
</script>
