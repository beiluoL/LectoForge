<template>
  <!-- --note-row-h 由 script 的 ROW_HEIGHT 单向下发，保证虚拟滚动的行高与 CSS 永不漂移 -->
  <div class="wb-page animate-fade-in" :style="{ '--mc': themeColor, '--note-row-h': `${ROW_HEIGHT}px` }">
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

    <!-- ============ 标签聚合 & 智慧筛选 ============ -->
    <div class="notes-filterbar">
      <div class="notes-tags">
        <span class="notes-tags-label">
          <Icon name="tags" :size="13" /> 标签
        </span>
        <div class="notes-tagcloud">
          <button
            v-for="t in noteStore.topTags(24)"
            :key="t.name"
            class="note-tag-chip"
            :class="{ 'is-active': noteStore.activeTag === t.name }"
            :title="`${t.name} · ${t.count} 则`"
            @click="noteStore.selectTag(t.name)"
          >
            #{{ t.name }}<i>{{ t.count }}</i>
          </button>
          <span v-if="noteStore.tagsLoading" class="notes-tags-hint">加载中…</span>
          <span v-else-if="!noteStore.tags.length" class="notes-tags-hint">暂无标签</span>
        </div>
      </div>

      <div class="notes-smart">
        <button
          class="notes-smart-btn"
          :class="{ 'is-active': noteStore.smartFilter === 'lowMastery' }"
          title="只看掌握度不高于 30% 的薄弱笔记"
          @click="noteStore.setSmartFilter('lowMastery')"
        >
          <Icon name="trending-down" :size="13" /> 掌握度≤30%
        </button>
        <button
          class="notes-smart-btn"
          :class="{ 'is-active': noteStore.smartFilter === 'noSummary' }"
          title="只看还没写总结栏的半成品笔记"
          @click="noteStore.setSmartFilter('noSummary')"
        >
          <Icon name="file-question" :size="13" /> 未写总结
        </button>
        <button
          v-if="noteStore.hasActiveFilter"
          class="notes-clear-btn"
          title="清空关键词、标签与智慧筛选"
          @click="clearFilters"
        >
          <Icon name="filter-x" :size="13" /> 清除筛选
        </button>
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
      <!--
        性能：遍历预计算好的 noteCards（见 script 内 NoteCardVm 注释），
        模板里不再出现任何函数调用；v-memo 作为第二道防线——只要这几个标量没变，
        Vue 会整块跳过该卡片的 diff，切换视图/搜索时不产生无谓的 patch。
      -->
      <article
        v-for="c in noteCards"
        :key="c.id"
        v-memo="[c.title, c.preview, c.srs, c.mastery, c.tags.length]"
        class="note-card"
        :class="{ 'is-due': c.srs === 'due' }"
        tabindex="0"
        @click="open(c.raw)"
        @keydown.enter="open(c.raw)"
      >
        <!-- 到期徽章：右上角，只有真正落在复习队列里才出现 -->
        <span v-if="c.srs === 'due'" class="note-badge note-badge-due">需复习 🔥</span>
        <span v-else-if="c.srs === 'new'" class="note-badge note-badge-new">待首复习</span>

        <h3 class="note-card-title">{{ c.title }}</h3>
        <p class="note-card-preview">{{ c.preview }}</p>

        <!-- 掌握度进度条 -->
        <div class="note-mastery">
          <div class="note-mastery-head">
            <span class="note-mastery-label">掌握度</span>
            <span class="note-mastery-num" :style="{ color: c.masteryColor }">{{ c.mastery }}%</span>
          </div>
          <div class="note-mastery-track">
            <span class="note-mastery-fill" :style="{ width: `${c.mastery}%`, background: c.masteryColor }"></span>
          </div>
        </div>

        <div class="note-card-foot">
          <div class="note-card-tags">
            <span v-for="t in c.tags" :key="t" class="note-chip">#{{ t }}</span>
            <span v-if="!c.tags.length" class="note-card-time">{{ c.hint }}</span>
          </div>
          <div class="note-card-actions" @click.stop>
            <button class="wb-icon-btn" title="转为复习卡" @click="toReview(c.raw)"><Icon name="repeat" :size="14" /></button>
            <button class="wb-icon-btn" title="转为故事" @click="toStory(c.raw)"><Icon name="wand-2" :size="14" /></button>
            <button class="wb-icon-btn note-danger-btn" title="删除" @click="remove(c.raw)"><Icon name="trash-2" :size="14" /></button>
          </div>
        </div>
      </article>
    </div>

    <!-- ============ 紧凑列表视图 ============ -->
    <template v-else>
      <!--
        虚拟滚动分支：筛选后总数 > 120 时启用。列表自带固定高度滚动容器，
        只渲染可视区内的行，offset 分页追加的条目不会让 DOM 无限膨胀。
        容器与内层撑高由 useVirtualList 的 containerProps / wrapperProps 注入。
      -->
      <div v-if="virtualized" v-bind="containerProps" class="notes-list notes-list--virtual">
        <div v-bind="wrapperProps">
          <NoteRow
            v-for="row in virtualRows"
            :key="row.data.id"
            :card="row.data"
            @open="open"
            @to-review="toReview"
            @to-story="toStory"
            @remove="remove"
          />
        </div>
      </div>
      <!--
        普通分支：总数较少时保持整页滚动 + 原生 v-for，避免嵌套滚动条的交互代价。
        行模板与虚拟分支完全一致（共用 NoteRow），仅数据源不同，杜绝复制漂移。
      -->
      <div v-else class="notes-list">
        <NoteRow
          v-for="c in noteCards"
          :key="c.id"
          :card="c"
          @open="open"
          @to-review="toReview"
          @to-story="toStory"
          @remove="remove"
        />
      </div>
    </template>

    <!-- 底部加载状态条：grid / list 共用，随滚动追加实时反馈 -->
    <div v-if="noteStore.total > 0 && !noteStore.loading" class="notes-foot">
      <span v-if="noteStore.loadingMore" class="notes-foot-loading">
        <Icon name="loader-circle" :size="13" class="notes-foot-spin" /> 加载中…
      </span>
      <span v-else-if="!noteStore.hasMore" class="notes-foot-end">已经到底啦 · 共 {{ noteStore.total }} 则</span>
      <span v-else class="notes-foot-more">向下滚动加载更多</span>
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
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDebounceFn, useInfiniteScroll, useVirtualList } from '@vueuse/core'
import Icon from '@/components/ui/Icon.vue'
import { notify, confirmDialog, getApiError } from '@/utils/toast'
import './workbench-shared.css'
import { useNoteStore, getNoteSrsState, daysUntilDue, parseTags } from '@/store/note-store'
import type { WbNote } from '@/api/types'
import NoteRow, { type NoteCardVm } from '@/components/NoteRow.vue'

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

/**
 * 列表项视图模型（NoteCardVm）已抽到 components/NoteRow.vue 顶部导出，
 * 列表与行组件共用同一份类型，避免两边各自声明后字段漂移。
 *
 * 为什么把派生函数预计算成静态字段：Vue 模板里的 `{{ preview(n) }}` / `srsOf(n)` 属于
 * 「渲染期函数调用」，不参与缓存——组件内**任何**响应式依赖变化（切视图模式、改关键词、
 * hover 态）都会让整棵列表重新求值。原网格卡片每张要调 8 次函数（srsOf×2、tagsOf×2、
 * masteryColor×2、preview、srsHint），其中 preview() 还要对全文跑三轮正则；200 条笔记 =
 * 单次重渲染 1600 次函数调用 + 600 次全文正则，这正是长列表卡顿的根因。
 * 改为 computed 后，这些计算只在 `noteStore.notes` **引用真正变化**时执行一次。
 */
const noteCards = computed<NoteCardVm[]>(() =>
  noteStore.notes.map((n) => {
    const srs = srsOf(n)
    const mastery = n.mastery || 0
    return {
      raw: n,
      id: n.id,
      title: n.title,
      preview: preview(n),
      tags: tagsOf(n),
      srs,
      hint: srsHint(n),
      mastery,
      masteryColor: masteryColor(mastery),
    }
  }),
)

/* ======================================================================
 * 滚动加载 + 虚拟滚动
 * ====================================================================== */

/**
 * 紧凑行的固定高度（px），含上下 padding 与下边框。
 *
 * 推导：标题 13px×1.5 ≈ 19.5 + 间距 2 + 摘要 11px×1.5 ≈ 16.5 = 38，
 * 加上下 padding 11×2 = 22 与 1px 下边框，合计 61。
 * 行内所有文本都是 nowrap + ellipsis，不会换行，所以定高是安全的。
 *
 * ⚠️ 这个数字必须与实际渲染高度完全一致，否则虚拟滚动的位移计算会累积偏差、
 * 表现为「滚动时行与行错位跳动」。因此这里让 **JS 成为唯一真源**：
 * 数值通过根元素的 `--note-row-h` 下发给 CSS，CSS 不再自己写死高度。
 */
const ROW_HEIGHT = 61

/**
 * 启用虚拟滚动的门槛。低于此值时保持普通 v-for + 页面滚动，
 * 因为虚拟滚动要求列表自带固定高度的滚动容器，会引入嵌套滚动条——
 * 几十条数据时那点性能收益不值得换来这个交互代价。
 *
 * 判定依据取「筛选后的总数」而非「已加载条数」：后者会在用户滚到第 4 页时
 * 突然翻越阈值，导致滚动模式在半途切换、视口位置瞬移。
 */
const VIRTUAL_THRESHOLD = 120

const virtualized = computed(
  () => noteStore.viewMode === 'list' && noteStore.total > VIRTUAL_THRESHOLD,
)

const {
  list: virtualRows,
  containerProps,
  wrapperProps,
} = useVirtualList(noteCards, { itemHeight: ROW_HEIGHT, overscan: 6 })

async function onLoadMore() {
  try {
    await noteStore.loadMore()
  } catch (e) {
    notify(getApiError(e, '加载更多失败'), 'error')
  }
}

/**
 * 两种滚动容器各挂一套加载器，用 canLoadMore 互斥：
 * - 非虚拟模式下整页滚动，观察 window；
 * - 虚拟模式下列表自带滚动容器，观察它自己。
 *
 * 用 useInfiniteScroll 而不是手写 IntersectionObserver，是因为它在回调完成后会
 * nextTick 自复检，能处理「加载完一页仍填不满视口」的情况；朴素的哨兵观察器
 * 在这种场景下不会二次触发（交叉状态没变化），加载就静默停住了。
 */
const canPageLoad = () => !virtualized.value && noteStore.hasMore && !noteStore.loading
const canVirtualLoad = () => virtualized.value && noteStore.hasMore && !noteStore.loading

useInfiniteScroll(() => window, onLoadMore, { distance: 260, canLoadMore: canPageLoad })
useInfiniteScroll(containerProps.ref, onLoadMore, { distance: 260, canLoadMore: canVirtualLoad })

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

/**
 * 清空筛选：store 会重置内部 keyword/activeTag/smartFilter 并重拉列表，
 * 但模板输入框绑定的是本地 keyword ref，所以这里手动把它同步回空，避免「已清空却还显示旧词」。
 */
async function clearFilters() {
  await noteStore.clearFilters()
  keyword.value = ''
}

// 列表与标签云各自独立加载：列表是进入即看，标签云是聚合统计，失败互不影响
onMounted(() => {
  reload()
  noteStore.fetchTags()
})
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
  width: 32px;
  height: 32px;
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

/* ===== 标签聚合 & 智慧筛选 ===== */
.notes-filterbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border-radius: var(--kb-radius-md);
  background: color-mix(in srgb, var(--kb-card) 70%, transparent);
  border: 1px solid var(--kb-border);
}
.notes-tags {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  flex: 1 1 auto;
}
.notes-tags-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding-top: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--kb-muted-foreground);
  white-space: nowrap;
}
.notes-tagcloud {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  min-width: 0;
}
.note-tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
  color: var(--kb-foreground);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.note-tag-chip:hover {
  border-color: var(--mc);
  color: var(--mc);
}
.note-tag-chip.is-active {
  border-color: var(--mc);
  background: color-mix(in srgb, var(--mc) 14%, transparent);
  color: var(--mc);
}
.note-tag-chip i {
  font-style: normal;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  color: var(--kb-muted-foreground);
}
.note-tag-chip.is-active i {
  color: var(--mc);
}
.notes-tags-hint {
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.notes-smart {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: none;
  flex-wrap: wrap;
}
.notes-smart-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: var(--kb-radius-sm);
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
  color: var(--kb-foreground);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.notes-smart-btn:hover {
  border-color: var(--mc);
  color: var(--mc);
}
.notes-smart-btn.is-active {
  border-color: var(--mc);
  background: color-mix(in srgb, var(--mc) 14%, transparent);
  color: var(--mc);
}
.notes-clear-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: var(--kb-radius-sm);
  border: 1px dashed var(--kb-border);
  background: transparent;
  color: var(--kb-muted-foreground);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.notes-clear-btn:hover {
  color: var(--kb-destructive);
  border-color: color-mix(in srgb, var(--kb-destructive) 50%, var(--kb-border));
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
  /* 渐进增强：离开视口的卡片跳过渲染，千条网格也不卡；
     contain-intrinsic-size 给浏览器一个估算高度，避免滚动条抖动 */
  content-visibility: auto;
  contain-intrinsic-size: auto 232px;
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

/* ===== 紧凑列表 ===== */
/* 基础容器（普通 / 虚拟两分支共用）：卡片外观 + 圆角裁切 */
.notes-list {
  display: flex;
  flex-direction: column;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}
/*
 * 虚拟滚动容器：必须自身成为带固定高度的滚动视口，useVirtualList 才生效。
 * 否则列表随页面流动、没有内部滚动，虚拟位移永远触发不了。
 * 高度取视口扣掉 Hero + 工具栏 + 页脚的剩余空间，并在窄屏收一点。
 */
.notes-list--virtual {
  height: calc(100vh - 360px);
  overflow-y: auto;
}

/* ===== 底部加载状态条 ===== */
.notes-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 14px;
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.notes-foot-loading {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--mc);
}
.notes-foot-spin {
  animation: notes-foot-spin 0.9s linear infinite;
}
@keyframes notes-foot-spin {
  to { transform: rotate(360deg); }
}
.notes-foot-end {
  letter-spacing: 0.02em;
}

/* ===== 响应式 ===== */
@media (max-width: 900px) {
  .notes-stats {
    gap: 14px;
  }
}
@media (max-width: 640px) {
  .notes-list--virtual {
    height: calc(100vh - 420px);
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
  .notes-filterbar {
    flex-direction: column;
  }
  .notes-smart {
    width: 100%;
  }
  .note-card-actions {
    opacity: 1;
  }
}
</style>
