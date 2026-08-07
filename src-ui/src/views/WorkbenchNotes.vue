<template>
  <div class="wb-page animate-fade-in" :style="{ '--mc': themeColor }">
    <!-- ============ Hero ============ -->
    <header class="wb-hero">
      <div class="wb-hero-bg">
        <span class="wb-blob"></span>
        <span class="wb-grid"></span>
      </div>
      <div class="wb-hero-inner">
        <div class="wb-hero-head">
          <div class="wb-hero-text">
            <span class="wb-eyebrow">
              <span class="wb-eyebrow-dot"></span>
              Cornell Notes
            </span>
            <h1 class="wb-title">
              <Icon name="notebook-pen" :size="26" class="wb-title-icon" />
              知识整理 · 康奈尔笔记
            </h1>
            <p class="wb-subtitle">
              线索栏自测、笔记栏记录、总结栏复述，<strong>主动回忆</strong>胜过被动阅读。
            </p>
          </div>
          <div class="notes-cta">
            <button class="kb-btn wb-cta note-quick-btn" @click="noteStore.openQuickCreate()">
              <Icon name="zap" :size="15" /> 极速新建
              <kbd class="note-kbd">⌘/Ctrl ⇧ F</kbd>
            </button>
            <button class="kb-btn kb-btn-primary wb-cta" @click="router.push('/workbench/notes/new')">
              <Icon name="plus" :size="16" /> 新建笔记
            </button>
          </div>
        </div>

        <!-- 概览：总量 / 待复习 / 平均掌握度 -->
        <div class="notes-stats">
          <div class="notes-stat">
            <span class="notes-stat-num">{{ noteStore.total }}</span>
            <span class="notes-stat-label">笔记总数</span>
          </div>
          <span class="notes-stat-sep"></span>
          <div class="notes-stat" :class="{ 'is-alert': noteStore.dueCount > 0 }">
            <span class="notes-stat-num">{{ noteStore.dueCount }}</span>
            <span class="notes-stat-label">需复习</span>
          </div>
          <span class="notes-stat-sep"></span>
          <div class="notes-stat">
            <span class="notes-stat-num">{{ noteStore.newCount }}</span>
            <span class="notes-stat-label">待首复习</span>
          </div>
          <span class="notes-stat-sep"></span>
          <div class="notes-stat">
            <span class="notes-stat-num">{{ noteStore.avgMastery }}<i>%</i></span>
            <span class="notes-stat-label">平均掌握度</span>
          </div>
        </div>
      </div>
    </header>

    <!-- ============ 工具栏：搜索 + 视图切换 ============ -->
    <div class="notes-toolbar">
      <div class="wb-search">
        <Icon name="search" :size="15" class="wb-search-icon" />
        <input
          v-model="keyword"
          class="kb-input wb-search-input"
          placeholder="搜索标题 / 内容…"
          @input="onSearchInput"
          @keydown.enter="reload"
        />
        <button v-if="keyword" class="notes-search-clear" title="清空" @click="clearKeyword">
          <Icon name="x" :size="13" />
        </button>
      </div>

      <div class="wb-filter-tools">
        <span class="notes-count">共 {{ noteStore.total }} 则</span>
        <!-- 视图模式：偏好走 store 持久化，下次进来仍是用户选的那种 -->
        <div class="notes-viewswitch" role="group" aria-label="视图模式">
          <button
            class="notes-view-btn"
            :class="{ 'is-active': noteStore.viewMode === 'grid' }"
            :aria-pressed="noteStore.viewMode === 'grid'"
            title="网格卡片"
            @click="noteStore.setViewMode('grid')"
          >
            <Icon name="layout-grid" :size="14" />
          </button>
          <button
            class="notes-view-btn"
            :class="{ 'is-active': noteStore.viewMode === 'list' }"
            :aria-pressed="noteStore.viewMode === 'list'"
            title="紧凑列表"
            @click="noteStore.setViewMode('list')"
          >
            <Icon name="list" :size="14" />
          </button>
        </div>
      </div>
    </div>

    <!-- ============ 骨架屏 ============ -->
    <div v-if="noteStore.loading" class="notes-grid">
      <div v-for="n in 6" :key="n" class="note-card note-card-skel">
        <div class="wb-skeleton">
          <span class="wb-skel-line" style="height: 16px; width: 62%;"></span>
          <span class="wb-skel-line" style="height: 12px; width: 92%; margin-top: 10px;"></span>
          <span class="wb-skel-line" style="height: 12px; width: 74%;"></span>
          <span class="wb-skel-line" style="height: 8px; width: 100%; margin-top: 16px;"></span>
        </div>
      </div>
    </div>

    <!-- ============ 空态 ============ -->
    <div v-else-if="!noteStore.notes.length" class="wb-empty">
      <div class="wb-empty-icon"><Icon name="notebook-pen" :size="30" /></div>
      <h3 class="wb-empty-title">{{ keyword ? '没有匹配的笔记' : '还没有康奈尔笔记' }}</h3>
      <p class="wb-empty-desc">
        {{ keyword ? '换个关键词试试，或清空搜索查看全部。' : '把读过、听过的内容整理成三栏，才真正变成你的知识。' }}
      </p>
      <button v-if="keyword" class="kb-btn" @click="clearKeyword">
        <Icon name="x" :size="14" /> 清空搜索
      </button>
      <button v-else class="kb-btn kb-btn-primary" @click="router.push('/workbench/notes/new')">
        <Icon name="plus" :size="14" /> 立即创建
      </button>
    </div>

    <!-- ============ 网格卡片视图 ============ -->
    <div v-else-if="noteStore.viewMode === 'grid'" class="notes-grid">
      <article
        v-for="n in noteStore.notes"
        :key="n.id"
        class="note-card"
        :class="{ 'is-due': srsOf(n) === 'due' }"
        tabindex="0"
        @click="open(n)"
        @keydown.enter="open(n)"
      >
        <!-- 到期徽章：右上角，只有真正落在复习队列里才出现 -->
        <span v-if="srsOf(n) === 'due'" class="note-badge note-badge-due">需复习 🔥</span>
        <span v-else-if="srsOf(n) === 'new'" class="note-badge note-badge-new">待首复习</span>

        <h3 class="note-card-title">{{ n.title }}</h3>
        <p class="note-card-preview">{{ preview(n) }}</p>

        <!-- 掌握度进度条 -->
        <div class="note-mastery">
          <div class="note-mastery-head">
            <span class="note-mastery-label">掌握度</span>
            <span class="note-mastery-num" :style="{ color: masteryColor(n.mastery) }">{{ n.mastery || 0 }}%</span>
          </div>
          <div class="note-mastery-track">
            <span
              class="note-mastery-fill"
              :style="{ width: `${n.mastery || 0}%`, background: masteryColor(n.mastery) }"
            ></span>
          </div>
        </div>

        <div class="note-card-foot">
          <div class="note-card-tags">
            <span v-for="t in tagsOf(n)" :key="t" class="note-chip">#{{ t }}</span>
            <span v-if="!tagsOf(n).length" class="note-card-time">{{ srsHint(n) }}</span>
          </div>
          <div class="note-card-actions" @click.stop>
            <button class="wb-icon-btn" title="转为复习卡" @click="toReview(n)"><Icon name="repeat" :size="14" /></button>
            <button class="wb-icon-btn" title="转为故事" @click="toStory(n)"><Icon name="wand-2" :size="14" /></button>
            <button class="wb-icon-btn note-danger-btn" title="删除" @click="remove(n)"><Icon name="trash-2" :size="14" /></button>
          </div>
        </div>
      </article>
    </div>

    <!-- ============ 紧凑列表视图 ============ -->
    <div v-else class="notes-list">
      <div
        v-for="n in noteStore.notes"
        :key="n.id"
        class="note-row"
        :class="{ 'is-due': srsOf(n) === 'due' }"
        tabindex="0"
        @click="open(n)"
        @keydown.enter="open(n)"
      >
        <span class="note-row-dot" :style="{ background: masteryColor(n.mastery) }"></span>
        <div class="note-row-main">
          <div class="note-row-titleline">
            <span class="note-row-title">{{ n.title }}</span>
            <span v-if="srsOf(n) === 'due'" class="note-badge note-badge-due note-badge-sm">需复习 🔥</span>
            <span v-else-if="srsOf(n) === 'new'" class="note-badge note-badge-new note-badge-sm">待首复习</span>
          </div>
          <p class="note-row-preview">{{ preview(n) }}</p>
        </div>

        <div class="note-row-mastery">
          <div class="note-mastery-track">
            <span
              class="note-mastery-fill"
              :style="{ width: `${n.mastery || 0}%`, background: masteryColor(n.mastery) }"
            ></span>
          </div>
          <span class="note-mastery-num" :style="{ color: masteryColor(n.mastery) }">{{ n.mastery || 0 }}%</span>
        </div>

        <span class="note-row-hint">{{ srsHint(n) }}</span>

        <div class="note-card-actions" @click.stop>
          <button class="wb-icon-btn" title="转为复习卡" @click="toReview(n)"><Icon name="repeat" :size="14" /></button>
          <button class="wb-icon-btn" title="转为故事" @click="toStory(n)"><Icon name="wand-2" :size="14" /></button>
          <button class="wb-icon-btn note-danger-btn" title="删除" @click="remove(n)"><Icon name="trash-2" :size="14" /></button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 康奈尔笔记列表页。
 *
 * 两种视图共用同一份数据与动作，只是密度不同：
 * - grid：卡片，适合浏览与挑选，信息量大（掌握度条 + 标签 + 到期徽章）；
 * - list：紧凑行，适合已有几十上百则时快速定位。
 * 视图偏好与三栏拖拽比例一起收在 useNoteStore 里持久化。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDebounceFn } from '@vueuse/core'
import Icon from '@/components/ui/Icon.vue'
import { notify, confirmDialog, getApiError } from '@/utils/toast'
import './workbench-shared.css'
import { useNoteStore, getNoteSrsState, daysUntilDue, parseTags } from '@/store/noteStore'
import type { WbNote } from '@/api/types'

const router = useRouter()
const noteStore = useNoteStore()
const themeColor = '#8B5CF6'

const keyword = ref(noteStore.keyword)

async function reload() {
  try {
    noteStore.keyword = keyword.value
    await noteStore.fetchNotes()
  } catch (e) {
    notify(getApiError(e, '加载失败'), 'error')
  }
}

/** 输入即搜：500ms 防抖，与命令面板同一节奏 */
const onSearchInput = useDebounceFn(reload, 500)

function clearKeyword() {
  keyword.value = ''
  reload()
}

function open(n: WbNote) {
  router.push(`/workbench/notes/${n.id}`)
}

/** 正文可能是富文本，预览要去标签并压缩空白，否则会漏出一串 <div> */
function preview(n: WbNote): string {
  const raw = n.summaryColumn?.trim() || n.noteColumn || n.cueColumn || ''
  const text = raw.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  return text || '（未填写内容）'
}

function tagsOf(n: WbNote): string[] {
  return parseTags(n.tags).slice(0, 3)
}

const srsOf = getNoteSrsState

/** 右下角的排程提示：到期讲「逾期」，未到期讲「N 天后」 */
function srsHint(n: WbNote): string {
  const state = getNoteSrsState(n)
  if (state === 'new') return '尚未复习'
  if (state === 'due') return '今天该复习了'
  return `${daysUntilDue(n.dueDate)} 天后复习`
}

function masteryColor(v?: number): string {
  const m = v || 0
  if (m >= 80) return 'var(--kb-accent)'
  if (m >= 50) return 'var(--kb-warning)'
  return 'var(--kb-destructive)'
}

async function remove(n: WbNote) {
  const ok = await confirmDialog(`确认删除笔记「${n.title}」？删除后无法恢复。`)
  if (!ok) return
  try {
    await noteStore.removeNote(n.id)
    notify('已删除', 'success')
  } catch (e) {
    notify(getApiError(e, '删除失败'), 'error')
  }
}

function toReview(n: WbNote) {
  router.push({
    path: '/workbench/review',
    query: { noteId: String(n.id), front: n.cueColumn || n.title, back: n.summaryColumn || n.noteColumn },
  })
}

function toStory(n: WbNote) {
  router.push({ path: '/workbench/story/new', query: { noteId: String(n.id), title: n.title } })
}

onMounted(reload)
</script>

<style scoped>
/* ===== Hero 扩展 ===== */
.notes-cta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.note-quick-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  color: var(--kb-foreground);
}
.note-quick-btn:hover {
  border-color: var(--mc);
  color: var(--mc);
}
.note-kbd {
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--kb-border);
  background: var(--kb-background);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--kb-muted-foreground);
}

.notes-stats {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-radius: var(--kb-radius-md);
  background: color-mix(in srgb, var(--kb-card) 82%, transparent);
  border: 1px solid var(--kb-border);
}
.notes-stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.notes-stat-num {
  font-family: var(--font-mono);
  font-size: 20px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--kb-foreground);
}
.notes-stat-num i {
  font-style: normal;
  font-size: 13px;
  font-weight: 600;
  color: var(--kb-muted-foreground);
}
.notes-stat.is-alert .notes-stat-num {
  color: var(--kb-destructive);
}
.notes-stat-label {
  font-size: 11px;
  color: var(--kb-muted-foreground);
}
.notes-stat-sep {
  width: 1px;
  height: 26px;
  background: var(--kb-border);
}

/* ===== 工具栏 ===== */
.notes-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.notes-search-clear {
  position: absolute;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
  cursor: pointer;
}
.notes-search-clear:hover {
  color: var(--kb-foreground);
}
.notes-count {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.notes-viewswitch {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--kb-radius-sm);
  background: var(--kb-muted);
  border: 1px solid var(--kb-border);
}
.notes-view-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 26px;
  border: none;
  border-radius: calc(var(--kb-radius-sm) - 1px);
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.notes-view-btn:hover {
  color: var(--kb-foreground);
}
.notes-view-btn.is-active {
  background: var(--kb-card);
  color: var(--mc);
  box-shadow: var(--shadow-sm);
}

/* ===== 网格卡片 ===== */
.notes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.note-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-card);
  cursor: pointer;
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
}
.note-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--mc) 45%, var(--kb-border));
  box-shadow: var(--shadow-card-hover);
}
.note-card:focus-visible {
  outline: 2px solid var(--mc);
  outline-offset: 2px;
}
.note-card.is-due {
  border-color: color-mix(in srgb, var(--kb-destructive) 35%, var(--kb-border));
}
.note-card-skel {
  cursor: default;
  min-height: 158px;
}
.note-card-skel:hover {
  transform: none;
  border-color: var(--kb-border);
  box-shadow: var(--shadow-card);
}

.note-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
}
.note-badge-due {
  background: color-mix(in srgb, var(--kb-destructive) 14%, transparent);
  color: var(--kb-destructive);
}
.note-badge-new {
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
}
.note-badge-sm {
  position: static;
  font-size: 10px;
  padding: 1px 7px;
}

.note-card-title {
  margin: 0;
  padding-right: 76px;
  font-family: var(--font-serif);
  font-size: var(--kb-fs-body-lg);
  font-weight: 700;
  line-height: 1.4;
  color: var(--kb-foreground);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.note-card-preview {
  margin: 0;
  font-size: var(--kb-fs-body-sm);
  line-height: 1.6;
  color: var(--kb-muted-foreground);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ===== 掌握度进度条 ===== */
.note-mastery {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: auto;
}
.note-mastery-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.note-mastery-label {
  font-size: 11px;
  color: var(--kb-muted-foreground);
}
.note-mastery-num {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
}
.note-mastery-track {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: var(--kb-muted);
  overflow: hidden;
}
.note-mastery-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s ease;
}

.note-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--kb-border);
}
.note-card-tags {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  min-width: 0;
}
.note-chip {
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--mc) 10%, transparent);
  color: var(--mc);
  font-size: 11px;
  font-weight: 600;
}
.note-card-time {
  font-size: 11px;
  color: var(--kb-muted-foreground);
}
.note-card-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.note-card:hover .note-card-actions,
.note-card:focus-within .note-card-actions,
.note-row:hover .note-card-actions,
.note-row:focus-within .note-card-actions {
  opacity: 1;
}
.note-danger-btn:hover {
  color: var(--kb-destructive);
}

/* ===== 紧凑列表 ===== */
.notes-list {
  display: flex;
  flex-direction: column;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}
.note-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--kb-border);
  cursor: pointer;
  transition: background 0.15s ease;
}
.note-row:last-child {
  border-bottom: none;
}
.note-row:hover {
  background: color-mix(in srgb, var(--mc) 4%, transparent);
}
.note-row:focus-visible {
  outline: 2px solid var(--mc);
  outline-offset: -2px;
}
.note-row.is-due {
  box-shadow: inset 3px 0 0 var(--kb-destructive);
}
.note-row-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.note-row-main {
  flex: 1 1 auto;
  min-width: 0;
}
.note-row-titleline {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.note-row-title {
  font-size: var(--kb-fs-body-sm);
  font-weight: 600;
  color: var(--kb-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.note-row-preview {
  margin: 2px 0 0;
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.note-row-mastery {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  width: 130px;
}
.note-row-mastery .note-mastery-track {
  flex: 1 1 auto;
}
.note-row-hint {
  flex: none;
  width: 96px;
  text-align: right;
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
}

/* ===== 响应式 ===== */
@media (max-width: 900px) {
  .note-row-mastery,
  .note-row-hint {
    display: none;
  }
  .notes-stats {
    gap: 14px;
  }
}
@media (max-width: 640px) {
  .notes-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .wb-search-input {
    max-width: none !important;
    width: 100%;
  }
  .wb-search {
    display: flex;
  }
  .note-card-actions {
    opacity: 1;
  }
}
</style>
