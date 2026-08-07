<template>
  <div class="wb-page animate-fade-in" :style="{ '--mc': themeColor }">
    <!-- ============ Sticky Top Bar ============ -->
    <header class="note-topbar">
      <div class="note-topbar-left">
        <button class="wb-icon-btn" title="返回列表" @click="goBack">
          <Icon name="chevron-left" :size="18" />
        </button>
        <div class="note-topbar-title">
          <span class="wb-eyebrow wb-eyebrow-sm">
            <span class="wb-eyebrow-dot"></span>
            Cornell Notes
          </span>
          <h1 class="note-page-title">{{ isNew ? '新建康奈尔笔记' : '编辑笔记' }}</h1>
        </div>
      </div>

      <div class="note-topbar-center">
        <span v-if="autoSaving" class="note-save-status note-save-saving">
          <Icon name="repeat" :size="14" class="animate-spin" /> 自动保存中…
        </span>
        <span v-else-if="lastSavedAt" class="note-save-status note-save-done">
          <Icon name="check" :size="14" /> 已自动保存 · {{ lastSavedAt }}
        </span>
        <span v-else-if="!isNew && noteLoaded" class="note-save-status note-save-done">
          <Icon name="check" :size="14" /> 已同步
        </span>
        <span v-else class="note-save-status note-save-idle">
          <Icon name="info" :size="14" /> {{ isNew ? '编辑后将自动保存' : '加载中…' }}
        </span>
      </div>

      <div class="note-topbar-right">
        <button class="kb-btn ai-btn note-export-btn" :disabled="aiGen" @click="runAiGenerate('cue')">
          <Icon :name="aiMode === 'cue' && aiGen ? 'loader' : 'ai-sparkle'" :size="14" :class="{ 'ai-spin': aiMode === 'cue' && aiGen }" />
          {{ aiMode === 'cue' && aiGen ? '生成中…' : 'AI 生成线索' }}
        </button>
        <button class="kb-btn ai-btn note-export-btn" :disabled="aiGen" @click="runAiGenerate('summary')">
          <Icon :name="aiMode === 'summary' && aiGen ? 'loader' : 'ai-sparkle'" :size="14" :class="{ 'ai-spin': aiMode === 'summary' && aiGen }" />
          {{ aiMode === 'summary' && aiGen ? '生成中…' : 'AI 生成总结' }}
        </button>
        <button class="kb-btn ai-btn note-export-btn" :disabled="aiGen || aiCardsGen" @click="runAiCards">
          <Icon :name="aiCardsGen ? 'loader' : 'ai-sparkle'" :size="14" :class="{ 'ai-spin': aiCardsGen }" />
          {{ aiCardsGen ? '生成中…' : 'AI 生成复习卡' }}
        </button>
        <button class="kb-btn note-quiz-btn note-export-btn" :disabled="quizGen" @click="runQuiz">
          <Icon :name="quizGen ? 'loader' : 'target'" :size="14" :class="{ 'ai-spin': quizGen }" />
          {{ quizGen ? '出题中…' : '生成自测题' }}
        </button>
        <button class="kb-btn wb-ghost-btn note-export-btn" :disabled="exporting" @click="exportImage">
          <Icon name="image" :size="14" /> 导出图片
        </button>
        <button class="kb-btn wb-ghost-btn note-export-btn" :disabled="exporting" @click="exportPDF">
          <Icon name="file-text" :size="14" /> 导出PDF
        </button>
      </div>
    </header>

    <!-- ============ Metadata Card ============ -->
    <section class="note-meta-card" ref="exportRoot">
      <div class="note-meta-grid">
        <div class="note-meta-title-field">
          <label class="wb-label">笔记标题 <span class="wb-req">*</span></label>
          <input
            v-model="form.title"
            class="kb-input note-title-input"
            placeholder="给这则笔记起个名字…"
            @blur="validateField('title')"
          />
          <span v-if="errors.title" class="note-err">{{ errors.title }}</span>
        </div>

        <div class="note-meta-field">
          <label class="wb-label">所属科目 / 分类</label>
          <select v-model="form.categoryId" class="kb-input">
            <option :value="undefined">未归类</option>
            <option v-for="c in flatCategories" :key="c.id" :value="c.id">{{ '　'.repeat(c.depth ?? 0) }}{{ c.name }}</option>
          </select>
        </div>

        <div class="note-meta-field">
          <label class="wb-label">关键词标签</label>
          <div class="note-tags-input">
            <Icon name="hash" :size="14" class="note-tags-icon" />
            <input
              v-model="tagInput"
              class="kb-input note-tags-field"
              placeholder="输入标签后回车"
              @keydown.enter.prevent="addTag"
              @keydown.delete="removeLastTag"
            />
          </div>
          <div v-if="tags.length" class="note-tags-list">
            <span v-for="(t, i) in tags" :key="i" class="note-tag-chip">
              {{ t }}
              <button class="note-tag-remove" @click="tags.splice(i, 1)"><Icon name="x" :size="12" /></button>
            </span>
          </div>
        </div>

        <div class="note-meta-field note-meta-mastery">
          <label class="wb-label">掌握度 <span class="note-mastery-val">{{ form.mastery }}%</span></label>
          <input type="range" min="0" max="100" step="5" v-model.number="form.mastery" class="note-mastery-slider" />
        </div>
      </div>

      <!-- ============ Cornell Three-Column Layout ============ -->
      <div v-if="aiHintVisible" class="ai-hint note-ai-hint">
        <Icon name="info" :size="14" />
        <span>尚未配置 AI 服务，无法生成线索/总结。</span>
        <router-link to="/settings/ai">前往 AI 设置</router-link>
      </div>
      <!--
        倒 T 形康奈尔版式：上排「线索 | 笔记」由竖分割线切分，下排「总结」由横分割线切分。
        两个比例来自 useNoteStore 并持久化，所以刷新/重进仍是用户自己调好的版式。
      -->
      <div
        ref="workspaceRef"
        class="cornell-workspace"
        :class="{ 'is-dragging': dragAxis !== null, 'is-exporting': exportMode }"
        :style="{ '--cue-w': noteStore.cuePercent, '--sum-h': noteStore.summaryPercent }"
      >
        <div ref="topRowRef" class="cornell-row">
          <!-- 线索栏 -->
          <div class="cornell-col cornell-cue">
            <div class="cornell-col-head">
              <Icon name="list-todo" :size="16" />
              <div>
                <h3 class="cornell-col-title">线索栏</h3>
                <p class="cornell-col-hint">关键问题 / 关键词，用于主动回忆自测</p>
              </div>
            </div>
            <textarea
              ref="cueRef"
              v-model="form.cueColumn"
              class="kb-input cornell-textarea cornell-cue-input"
              placeholder="例如：&#10;- 什么是 SM-2 算法？&#10;- 间隔重复的原理是什么？"
            ></textarea>
          </div>

          <!-- 竖分割线：拖拽调线索栏宽度，双击复位，方向键可微调（可访问性） -->
          <div
            class="cornell-splitter cornell-splitter-v"
            :class="{ 'is-active': dragAxis === 'x' }"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整线索栏宽度"
            :aria-valuenow="cueRatioPct"
            :aria-valuemin="CUE_MIN_PCT"
            :aria-valuemax="CUE_MAX_PCT"
            tabindex="0"
            title="拖拽调整线索栏宽度 · 双击复位"
            @mousedown.prevent="startDrag('x')"
            @dblclick="noteStore.resetLayout()"
            @keydown="onSplitterKey('x', $event)"
          >
            <span class="cornell-splitter-grip"></span>
          </div>

          <!-- 笔记栏（富文本） -->
          <div class="cornell-col cornell-note">
            <div class="cornell-col-head">
              <Icon name="pen-line" :size="16" />
              <div>
                <h3 class="cornell-col-title">笔记栏</h3>
                <p class="cornell-col-hint">课堂 / 阅读的主体内容，选中文字可快速转为线索</p>
              </div>
            </div>

            <!-- Rich Text Toolbar -->
            <div class="rte-toolbar">
              <button class="rte-btn" title="加粗 (Ctrl+B)" @mousedown.prevent="exec('bold')">
                <Icon name="bold" :size="14" />
              </button>
              <button class="rte-btn" title="斜体 (Ctrl+I)" @mousedown.prevent="exec('italic')">
                <Icon name="italic" :size="14" />
              </button>
              <button class="rte-btn" title="下划线" @mousedown.prevent="exec('underline')">
                <Icon name="underline" :size="14" />
              </button>
              <span class="rte-divider"></span>
              <button class="rte-btn" title="无序列表" @mousedown.prevent="exec('insertUnorderedList')">
                <Icon name="list" :size="14" />
              </button>
              <button class="rte-btn" title="有序列表" @mousedown.prevent="exec('insertOrderedList')">
                <Icon name="list-ordered" :size="14" />
              </button>
              <span class="rte-divider"></span>
              <button class="rte-btn rte-highlight" title="高亮" @mousedown.prevent="toggleHighlight">
                <span class="rte-hl-mark">H</span>
              </button>
              <button class="rte-btn" title="清除格式" @mousedown.prevent="exec('removeFormat')">
                <Icon name="x" :size="14" />
              </button>
            </div>

            <div
              ref="editorRef"
              class="cornell-editor"
              contenteditable="true"
              @input="onEditorInput"
              @blur="onEditorInput"
              @mouseup="onEditorMouseUp"
              @keyup="onEditorKeyUp"
              @scroll="hideSelBar"
            ></div>
          </div>
        </div>

        <!-- 横分割线：拖拽调总结栏高度 -->
        <div
          class="cornell-splitter cornell-splitter-h"
          :class="{ 'is-active': dragAxis === 'y' }"
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整总结栏高度"
          :aria-valuenow="summaryRatioPct"
          :aria-valuemin="SUM_MIN_PCT"
          :aria-valuemax="SUM_MAX_PCT"
          tabindex="0"
          title="拖拽调整总结栏高度 · 双击复位"
          @mousedown.prevent="startDrag('y')"
          @dblclick="noteStore.resetLayout()"
          @keydown="onSplitterKey('y', $event)"
        >
          <span class="cornell-splitter-grip"></span>
        </div>

        <!-- 总结栏 -->
        <div class="cornell-col cornell-summary">
          <div class="cornell-col-head">
            <Icon name="check-check" :size="16" />
            <div>
              <h3 class="cornell-col-title">总结栏</h3>
              <p class="cornell-col-hint">用自己的话一句话概括</p>
            </div>
          </div>
          <textarea
            ref="summaryRef"
            v-model="form.summaryColumn"
            class="kb-input cornell-textarea cornell-summary-input"
            placeholder="一句话讲清这个概念…"
          ></textarea>
        </div>
      </div>

      <!-- AI 生成的复习卡（B4）：确认后逐张走 POST /reviews，SM-2 排程不受影响 -->
      <div v-if="flashcards && flashcards.length" class="ai-panel note-cards-panel">
        <div class="ai-panel-head">
          <span class="ai-panel-title"><Icon name="ai-sparkle" :size="14" /> AI 生成的复习卡（{{ flashcards.length }} 张）</span>
          <button class="kb-btn kb-btn-primary note-cards-adopt" :disabled="aiCardsCreating" @click="createCards">
            <Icon :name="aiCardsCreating ? 'loader' : 'check'" :size="14" :class="{ 'ai-spin': aiCardsCreating }" />
            {{ aiCardsCreating ? '创建中…' : '采纳并创建' }}
          </button>
        </div>
        <ul class="cap-card-list">
          <li v-for="(c, i) in flashcards" :key="i">
            <span class="cap-card-q">Q：{{ c.front }}</span>
            <span class="cap-card-a">A：{{ c.back }}</span>
          </li>
        </ul>
      </div>

      <!-- AI 自测题：已由服务端直接入库并置为立即到期，这里只做结果回显 -->
      <div v-if="quizItems.length" class="ai-panel note-quiz-panel">
        <div class="ai-panel-head">
          <span class="ai-panel-title">
            <Icon name="target" :size="14" /> AI 自测题（{{ quizItems.length }} 道 · 已进入复习队列）
          </span>
          <div class="note-quiz-actions">
            <button class="kb-btn wb-ghost-btn note-cards-adopt" @click="quizItems = []">
              <Icon name="x" :size="14" /> 收起
            </button>
            <button class="kb-btn kb-btn-primary note-cards-adopt" @click="router.push('/workbench/review')">
              <Icon name="arrow-right" :size="14" /> 前往复习
            </button>
          </div>
        </div>
        <ol class="note-quiz-list">
          <li v-for="(q, i) in quizItems" :key="i" class="note-quiz-item">
            <p class="note-quiz-q">
              <span class="note-quiz-type" :class="q.type === 'choice' ? 'is-choice' : 'is-fill'">
                {{ q.type === 'choice' ? '单选' : '填空' }}
              </span>
              {{ i + 1 }}. {{ q.question }}
            </p>
            <ul v-if="q.options.length" class="note-quiz-options">
              <li
                v-for="(o, oi) in q.options"
                :key="oi"
                :class="{ 'is-answer': CHOICE_LETTERS[oi] === q.answer }"
              >
                <b>{{ CHOICE_LETTERS[oi] }}.</b> {{ o }}
              </li>
            </ul>
            <p class="note-quiz-answer">
              <b>答案：</b>{{ q.answer }}<span v-if="q.explain"> · {{ q.explain }}</span>
            </p>
          </li>
        </ol>
      </div>
    </section>

    <!-- ============ AI 内容关联（G3） ============ -->
    <AiAssociatePanel v-if="!isNew && noteId" entity-type="note" :entity-id="noteId" />

    <!-- ============ Bottom Action Bar ============ -->
    <footer class="note-action-bar">
      <div class="note-action-left">
        <span v-if="errors._form" class="note-err note-err-form">
          <Icon name="alert-circle" :size="14" /> {{ errors._form }}
        </span>
      </div>
      <div class="note-action-right">
        <button class="kb-btn note-draft-btn" :disabled="saving" @click="saveDraft">
          <Icon name="save" :size="14" /> 保存草稿
        </button>
        <button class="kb-btn kb-btn-primary note-publish-btn" :disabled="saving" @click="publish">
          <Icon name="send" :size="14" /> 完成并发布
        </button>
      </div>
    </footer>

    <!--
      划词悬浮工具栏：teleport 到 body，避开 .cornell-col 的 overflow:hidden 裁剪与层叠上下文。
      按钮全部 @mousedown.prevent，保证点击时不抢焦点、选区不丢。
    -->
    <Teleport to="body">
      <transition name="sel-bar">
        <div
          v-if="selBar.visible"
          ref="selBarRef"
          class="note-sel-bar"
          :style="{ '--mc': themeColor, left: `${selBar.x}px`, top: `${selBar.y}px` }"
          @mousedown.prevent
        >
          <button class="note-sel-btn" title="加粗" @click="applySelection('bold')">
            <Icon name="bold" :size="15" />
          </button>
          <button class="note-sel-btn" title="高亮" @click="applySelection('highlight')">
            <Icon name="highlighter" :size="15" />
          </button>
          <span class="note-sel-divider"></span>
          <button class="note-sel-btn note-sel-cue" title="把选中文字加到线索栏" @click="applySelection('cue')">
            <Icon name="pencil" :size="15" />
            <span>转为线索</span>
          </button>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { onClickOutside } from '@vueuse/core'
import Icon from '@/components/ui/Icon.vue'
import AiAssociatePanel from '@/components/AiAssociatePanel.vue'
import { notify, confirmDialog, getApiError } from '@/utils/toast'
import './workbench-shared.css'
import './ai-shared.css'
import { getNote, createNote, updateNote, getCategoryTree, createReview } from '@/api/workbench'
import {
  generateNoteColumns,
  generateFlashcards,
  generateNoteQuiz,
  type Flashcard,
  type QuizItem,
} from '@/api/ai'
import type { WbNotePayload, CategoryVO } from '@/api/types'
import {
  useNoteStore,
  parseTags,
  CUE_RATIO_MIN,
  CUE_RATIO_MAX,
  SUMMARY_RATIO_MIN,
  SUMMARY_RATIO_MAX,
} from '@/store/noteStore'

const route = useRoute()
const router = useRouter()
const themeColor = '#8B5CF6'
const noteStore = useNoteStore()

const noteId = ref<number | null>(route.params.id && route.params.id !== 'new' ? Number(route.params.id) : null)
const isNew = computed(() => noteId.value === null)
const noteLoaded = ref(false)

const editorRef = ref<HTMLElement | null>(null)
const exportRoot = ref<HTMLElement | null>(null)
const workspaceRef = ref<HTMLElement | null>(null)
const topRowRef = ref<HTMLElement | null>(null)
const cueRef = ref<HTMLTextAreaElement | null>(null)
const summaryRef = ref<HTMLTextAreaElement | null>(null)
const exporting = ref(false)
const exportMode = ref(false)
const saving = ref(false)
const autoSaving = ref(false)
const lastSavedAt = ref('')
const loaded = ref(false)
/** 组件已卸载：防止 2.5s 防抖定时器在离开页面后仍打出一次保存请求 */
let disposed = false
/** 有未落盘的改动（自动保存/离开前强制保存的唯一依据） */
const dirty = ref(false)

// ===== AI 生成线索栏/总结栏（B1/B2）：仅填充，不覆盖用户已有内容 =====
const aiGen = ref(false)
const aiMode = ref<'cue' | 'summary'>('cue')
const aiHintVisible = ref(false)
// ===== AI 批量生成复习卡（B4）：先生成预览，用户采纳后才逐张建卡 =====
const aiCardsGen = ref(false)
const aiCardsCreating = ref(false)
const flashcards = ref<Flashcard[] | null>(null)
// ===== AI 自测题：服务端直接入库到 wb_review_card 并置为立即到期，这里只回显 =====
const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
const quizGen = ref(false)
const quizItems = ref<QuizItem[]>([])

// ===== 三栏拖拽：比例存 store（已持久化），组件只负责换算与事件 =====
const dragAxis = ref<'x' | 'y' | null>(null)
const cueRatioPct = computed(() => Math.round(noteStore.layout.cueRatio * 100))
const summaryRatioPct = computed(() => Math.round(noteStore.layout.summaryRatio * 100))

// ===== 划词悬浮工具栏 =====
const selBarRef = ref<HTMLElement | null>(null)
const selBar = reactive({ visible: false, x: 0, y: 0, text: '' })

const flatCategories = ref<CategoryVO[]>([])
const tagInput = ref('')
const tags = ref<string[]>([])

const form = reactive<WbNotePayload>({
  title: '',
  captureId: undefined,
  categoryId: undefined,
  cueColumn: '',
  noteColumn: '',
  summaryColumn: '',
  tags: '',
  mastery: 0,
})

const errors = reactive<{ title?: string; _form?: string }>({})

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null

function flatten(nodes: CategoryVO[], depth = 0): CategoryVO[] {
  const out: CategoryVO[] = []
  for (const n of nodes) {
    out.push({ ...n, depth })
    if (n.children && n.children.length) out.push(...flatten(n.children, depth + 1))
  }
  return out
}

async function loadCategories() {
  try {
    const tree = await getCategoryTree()
    flatCategories.value = flatten(tree)
  } catch { /* 分类为可选项 */ }
}

async function loadNote() {
  if (isNew.value) {
    if (route.query.captureId) form.captureId = Number(route.query.captureId)
    if (route.query.title) form.title = String(route.query.title)
    noteLoaded.value = true
    await nextTick()
    initEditor()
    loaded.value = true
    return
  }
  try {
    const note = await getNote(noteId.value!)
    Object.assign(form, {
      title: note.title,
      captureId: note.captureId,
      categoryId: note.categoryId,
      cueColumn: note.cueColumn || '',
      noteColumn: note.noteColumn || '',
      summaryColumn: note.summaryColumn || '',
      tags: note.tags || '',
      mastery: note.mastery || 0,
    })
    // 兼容两种历史格式（收集箱沉淀写 JSON 数组、编辑页写逗号分隔），统一读成数组后回写为逗号分隔
    tags.value = parseTags(form.tags)
    form.tags = tags.value.join(',')
    noteLoaded.value = true
    await nextTick()
    initEditor()
    loaded.value = true
  } catch (e) {
    notify(getApiError(e, '加载笔记失败'), 'error')
  }
}

function initEditor() {
  if (editorRef.value) {
    editorRef.value.innerHTML = form.noteColumn || ''
  }
}

function onEditorInput() {
  if (editorRef.value) {
    form.noteColumn = editorRef.value.innerHTML
  }
}

function exec(command: string) {
  editorRef.value?.focus()
  document.execCommand(command, false)
  onEditorInput()
}

function toggleHighlight() {
  editorRef.value?.focus()
  const sel = window.getSelection()
  if (sel && sel.toString()) {
    document.execCommand('hiliteColor', false, 'rgba(245, 158, 11, 0.35)')
    onEditorInput()
  } else {
    notify('请先选中要高亮的文字', 'info')
  }
}

/* ==================== 三栏比例拖拽 ==================== */

/** 分割线自身尺寸：换算比例时要扣掉，否则鼠标会与分割线逐渐错位 */
const SPLITTER_SIZE = 8

const CUE_MIN_PCT = Math.round(CUE_RATIO_MIN * 100)
const CUE_MAX_PCT = Math.round(CUE_RATIO_MAX * 100)
const SUM_MIN_PCT = Math.round(SUMMARY_RATIO_MIN * 100)
const SUM_MAX_PCT = Math.round(SUMMARY_RATIO_MAX * 100)

function onDragMove(e: MouseEvent) {
  if (dragAxis.value === 'x') {
    const rect = topRowRef.value?.getBoundingClientRect()
    if (!rect || rect.width <= SPLITTER_SIZE) return
    noteStore.setCueRatio((e.clientX - rect.left) / (rect.width - SPLITTER_SIZE))
  } else if (dragAxis.value === 'y') {
    const rect = workspaceRef.value?.getBoundingClientRect()
    if (!rect || rect.height <= SPLITTER_SIZE) return
    noteStore.setSummaryRatio((rect.bottom - e.clientY) / (rect.height - SPLITTER_SIZE))
  }
}

function stopDrag() {
  dragAxis.value = null
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', stopDrag)
  document.body.classList.remove('kb-resizing-col', 'kb-resizing-row')
}

/** 原生 mousedown → window mousemove/mouseup，不引第三方拖拽库 */
function startDrag(axis: 'x' | 'y') {
  dragAxis.value = axis
  hideSelBar()
  document.body.classList.add(axis === 'x' ? 'kb-resizing-col' : 'kb-resizing-row')
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', stopDrag)
}

/** 分割线聚焦后用方向键微调（Shift 加速、Home 复位），保证键盘可达 */
function onSplitterKey(axis: 'x' | 'y', e: KeyboardEvent) {
  const step = e.shiftKey ? 0.05 : 0.01
  if (e.key === 'Home') {
    e.preventDefault()
    noteStore.resetLayout()
    return
  }
  if (axis === 'x') {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      noteStore.setCueRatio(noteStore.layout.cueRatio - step)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      noteStore.setCueRatio(noteStore.layout.cueRatio + step)
    }
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    noteStore.setSummaryRatio(noteStore.layout.summaryRatio + step)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    noteStore.setSummaryRatio(noteStore.layout.summaryRatio - step)
  }
}

/* ==================== 划词悬浮工具栏 ==================== */

function hideSelBar() {
  selBar.visible = false
  selBar.text = ''
}

/** 读当前选区，算出工具栏应停靠的视口坐标（工具栏是 fixed + translate(-50%,-100%)） */
function refreshSelBar() {
  const sel = window.getSelection()
  const editor = editorRef.value
  if (!sel || !editor || sel.rangeCount === 0 || sel.isCollapsed) {
    hideSelBar()
    return
  }
  const text = sel.toString().trim()
  if (!text) {
    hideSelBar()
    return
  }
  const range = sel.getRangeAt(0)
  // 选区必须完整落在笔记栏内，避免在别处划词也弹工具栏
  if (!editor.contains(range.commonAncestorContainer)) {
    hideSelBar()
    return
  }
  const rect = range.getBoundingClientRect()
  if (!rect.width && !rect.height) {
    hideSelBar()
    return
  }
  const halfBar = 108
  selBar.x = Math.min(window.innerWidth - halfBar, Math.max(halfBar, rect.left + rect.width / 2))
  selBar.y = Math.max(56, rect.top - 10)
  selBar.text = text
  selBar.visible = true
}

/** 等浏览器把选区落定再读（WebKit 在 mouseup 同帧拿到的仍是旧选区） */
function onEditorMouseUp() {
  setTimeout(refreshSelBar, 0)
}

function onEditorKeyUp(e: KeyboardEvent) {
  if (e.shiftKey && e.key.startsWith('Arrow')) refreshSelBar()
  else if (!e.ctrlKey && !e.metaKey) hideSelBar()
}

/** 追加一条线索：自动补 "- " 前缀并按整行去重 */
function appendCue(text: string): boolean {
  const line = `- ${text.replace(/\s+/g, ' ').trim()}`
  const cur = (form.cueColumn || '').trimEnd()
  if (cur.split('\n').some((l) => l.trim() === line)) return false
  form.cueColumn = cur ? `${cur}\n${line}` : line
  return true
}

async function applySelection(action: 'bold' | 'highlight' | 'cue') {
  if (action === 'cue') {
    const text = selBar.text
    hideSelBar()
    if (!text) return
    if (!appendCue(text)) {
      notify('该线索已存在', 'info')
      return
    }
    // 「划词转线索」是即抓即走的动作，立刻落盘，不等 2.5s 防抖
    autoSaving.value = true
    const ok = await doSave(true)
    autoSaving.value = false
    notify(ok ? '已加入线索栏并保存' : '已加入线索栏，填写标题后自动保存', ok ? 'success' : 'info')
    return
  }
  editorRef.value?.focus()
  if (action === 'bold') document.execCommand('bold', false)
  else document.execCommand('hiliteColor', false, 'rgba(245, 158, 11, 0.35)')
  onEditorInput()
  // 格式化后选区仍在，刷新一次位置（加粗会让行高/位置轻微变化）
  setTimeout(refreshSelBar, 0)
}

onClickOutside(selBarRef, () => hideSelBar())

/* ==================== AI 自测题 ==================== */

/**
 * 生成自测题并直连复习系统。
 * 与「AI 生成复习卡」的区别：这里 autoSave=true，服务端出题后直接写入 wb_review_card
 * 且 next_review_time 置为当前时间，无需二次确认，题目立刻可在复习模块作答。
 */
async function runQuiz() {
  const noteText = (form.noteColumn || '').replace(/<[^>]*>/g, '').trim()
  if (noteText.length < 30) {
    notify('笔记正文太短（至少 30 字），先把笔记栏写充实一点', 'warning')
    return
  }
  // 题目要回链 noteId，新笔记先落一次盘拿到 id
  if (isNew.value) {
    if (!form.title.trim()) {
      errors.title = '标题不能为空'
      notify('请先填写标题，再生成自测题', 'warning')
      return
    }
    if (!(await doSave(true))) {
      notify('笔记保存失败，请先手动保存后再生成', 'error')
      return
    }
  }
  quizGen.value = true
  try {
    const res = await generateNoteQuiz({
      title: form.title,
      noteColumn: form.noteColumn || '',
      noteId: noteId.value ?? undefined,
      categoryId: form.categoryId,
      autoSave: true,
    })
    quizItems.value = res.quiz
    notify(`已生成 ${res.created || res.quiz.length} 道题，请前往 [复习] 模块作答！`, 'success')
  } catch (e) {
    const msg = getApiError(e, 'AI 出题失败')
    if (msg.includes('AI 设置') || msg.includes('未配置') || msg.includes('已关闭')) aiHintVisible.value = true
    notify(msg, 'error')
  } finally {
    quizGen.value = false
  }
}

function addTag() {
  const t = tagInput.value.trim()
  if (t && !tags.value.includes(t)) {
    tags.value.push(t)
    syncTags()
  }
  tagInput.value = ''
}
function removeLastTag() {
  if (tagInput.value === '' && tags.value.length) {
    tags.value.pop()
    syncTags()
  }
}
function syncTags() {
  form.tags = tags.value.join(',')
}

function validateField(field: string) {
  if (field === 'title') {
    errors.title = form.title.trim() ? '' : '标题不能为空'
  }
}

function validateAll(forPublish: boolean): boolean {
  errors._form = ''
  errors.title = ''
  if (!form.title.trim()) {
    errors.title = '标题不能为空'
  }
  if (forPublish) {
    const missing: string[] = []
    if (!form.title.trim()) missing.push('标题')
    if (!form.cueColumn?.trim() && !form.noteColumn?.trim()) missing.push('笔记内容')
    if (!form.summaryColumn?.trim()) missing.push('总结')
    if (missing.length) {
      errors._form = `发布前请补全：${missing.join('、')}`
    }
  }
  return !errors.title && !errors._form
}

/** 保存串行队列：并发的自动保存 / 手动保存排队执行，避免新笔记被创建两次 */
let saveChain: Promise<boolean> = Promise.resolve(true)

function doSave(silent = false): Promise<boolean> {
  saveChain = saveChain.catch(() => false).then(() => runSave(silent))
  return saveChain
}

async function runSave(silent: boolean): Promise<boolean> {
  if (!form.title.trim()) {
    if (!silent) errors.title = '标题不能为空'
    return false
  }
  // 快照当前表单：await 期间用户可能继续输入，落盘内容与 dirty 判定要基于同一份数据
  const snapshot: WbNotePayload = { ...form }
  try {
    if (isNew.value) {
      const newId = await createNote(snapshot)
      noteId.value = newId
      if (!silent) notify('已保存', 'success')
    } else {
      await updateNote(noteId.value!, snapshot)
      if (!silent) notify('已保存', 'success')
    }
    lastSavedAt.value = formatTime(new Date())
    dirty.value = false
    return true
  } catch (e) {
    if (!silent) notify(getApiError(e, '保存失败'), 'error')
    return false
  }
}

async function saveDraft() {
  if (!validateAll(false)) {
    notify('请填写标题', 'warning')
    return
  }
  saving.value = true
  await doSave(false)
  saving.value = false
}

async function publish() {
  if (!validateAll(true)) {
    notify(errors._form || '请补全必填项', 'warning')
    return
  }
  saving.value = true
  const ok = await doSave(false)
  saving.value = false
  if (ok) {
    notify('笔记已发布！', 'success')
    router.push('/workbench/notes')
  }
}

/**
 * 批量生成间隔重复卡片（B4）：先调 AI 生成一组 Q/A 预览，
 * 用户「采纳并创建」后才逐张走 POST /reviews，绝不自动落库、不影响 SM-2 排程。
 */
async function runAiCards() {
  const noteText = (form.noteColumn || '').replace(/<[^>]*>/g, '').trim()
  if (noteText.length < 30) {
    notify('笔记正文太短（至少 30 字），先把笔记栏写充实一点', 'warning')
    return
  }
  aiCardsGen.value = true
  try {
    const res = await generateFlashcards({ title: form.title, noteColumn: form.noteColumn || '' })
    flashcards.value = res.cards
    notify(`已生成 ${res.cards.length} 张复习卡，确认后创建`, 'success')
  } catch (e) {
    const msg = getApiError(e, 'AI 生成失败')
    if (msg.includes('AI 设置') || msg.includes('未配置') || msg.includes('已关闭')) aiHintVisible.value = true
    notify(msg, 'error')
  } finally {
    aiCardsGen.value = false
  }
}

async function createCards() {
  if (!flashcards.value || !flashcards.value.length) return
  aiCardsCreating.value = true
  try {
    let n = 0
    for (const c of flashcards.value) {
      await createReview({
        front: c.front,
        back: c.back,
        noteId: noteId.value ?? undefined,
        categoryId: form.categoryId,
      })
      n += 1
    }
    notify(`已创建 ${n} 张复习卡，已加入 SM-2 排程`, 'success')
    flashcards.value = null
  } catch (e) {
    notify(getApiError(e, '创建失败'), 'error')
  } finally {
    aiCardsCreating.value = false
  }
}

/**
 * 返回列表。正常情况下由路由守卫兜底强制保存，
 * 只有「有内容但没标题」这种存不下去的场景才需要拦一下用户。
 */
async function goBack() {
  const hasContent = !!(
    (form.noteColumn || '').replace(/<[^>]*>/g, '').trim()
    || (form.cueColumn || '').trim()
    || (form.summaryColumn || '').trim()
  )
  if (dirty.value && !form.title.trim() && hasContent) {
    const ok = await confirmDialog('尚未填写标题，内容无法保存。确认放弃并离开？')
    if (!ok) return
    dirty.value = false
  }
  router.push('/workbench/notes')
}

/**
 * 康奈尔笔记 AI 生成（B1 线索 / B2 总结）：
 * - mode='cue'    只生成问题式线索列，填入线索栏（空白直填，已有则追加）；
 * - mode='summary'只生成总结区，填入总结栏（同上）。
 * 绝不覆盖用户已有内容；未配置 AI 时降级为提示引导，不阻断任何主流程。
 */
async function runAiGenerate(mode: 'cue' | 'summary') {
  aiMode.value = mode
  const noteText = (form.noteColumn || '').replace(/<[^>]*>/g, '').trim()
  if (noteText.length < 30) {
    notify('笔记正文太短（至少 30 字），先把笔记栏写充实一点', 'warning')
    return
  }
  aiGen.value = true
  aiHintVisible.value = false
  try {
    const res = await generateNoteColumns({
      title: form.title,
      noteColumn: form.noteColumn || '',
      mode,
    })
    if (mode === 'cue') {
      const cue = form.cueColumn || ''
      if (!cue.trim()) {
        form.cueColumn = res.cueColumn
      } else if (res.cueColumn.trim()) {
        form.cueColumn = `${cue.trimEnd()}\n${res.cueColumn}`
      }
      notify('已生成线索栏，记得保存', 'success')
    } else {
      const summary = form.summaryColumn || ''
      if (!summary.trim()) {
        form.summaryColumn = res.summaryColumn
      } else if (res.summaryColumn.trim()) {
        form.summaryColumn = `${summary.trimEnd()}\n${res.summaryColumn}`
      }
      notify('已生成总结栏，记得保存', 'success')
    }
  } catch (e) {
    const msg = getApiError(e, 'AI 生成失败')
    if (msg.includes('AI 设置') || msg.includes('未配置') || msg.includes('已关闭')) {
      aiHintVisible.value = true
    }
    notify(msg, 'error')
  } finally {
    aiGen.value = false
  }
}

function formatTime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 导出前临时把三栏摊平。
 * 工作区现在是固定高度 + 内部滚动，直接截图只会拿到可视区那一屏；
 * 这里加 .is-exporting 解除高度约束，并把三个面板撑到 scrollHeight，截完立刻还原。
 */
async function withExportLayout<T>(fn: () => Promise<T>): Promise<T> {
  exportMode.value = true
  await nextTick()
  const panes: HTMLElement[] = [cueRef.value, summaryRef.value, editorRef.value].filter(
    (el): el is HTMLElement => !!el,
  )
  const prev = panes.map((el) => el.style.height)
  panes.forEach((el) => {
    el.style.height = `${el.scrollHeight + 4}px`
  })
  await nextTick()
  try {
    return await fn()
  } finally {
    panes.forEach((el, i) => {
      el.style.height = prev[i]
    })
    exportMode.value = false
  }
}

async function exportImage() {
  if (!exportRoot.value) return
  exporting.value = true
  try {
    const html2canvas = (await import('html2canvas')).default
    const canvas = await withExportLayout(() =>
      html2canvas(exportRoot.value!, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
      }),
    )
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${form.title || '康奈尔笔记'}.png`
      a.click()
      URL.revokeObjectURL(url)
      notify('已导出图片', 'success')
    })
  } catch (e) {
    notify(getApiError(e, '导出图片失败'), 'error')
  } finally {
    exporting.value = false
  }
}

async function exportPDF() {
  if (!exportRoot.value) return
  exporting.value = true
  try {
    const [html2canvasMod, jspdfMod] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ])
    const html2canvas = html2canvasMod.default
    const jsPDF = jspdfMod.default
    const canvas = await withExportLayout(() =>
      html2canvas(exportRoot.value!, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
      }),
    )
    const imgData = canvas.toDataURL('image/png')
    const imgW = canvas.width
    const imgH = canvas.height
    const pdfW = 595
    const pdfH = 842
    const margin = 28
    const availW = pdfW - margin * 2
    const availH = pdfH - margin * 2
    const ratio = Math.min(availW / imgW, availH / imgH)
    const w = imgW * ratio
    const h = imgH * ratio
    const pdf = new jsPDF('p', 'pt', 'a4')
    let remaining = h
    let position = margin
    let srcY = 0
    if (h <= availH) {
      pdf.addImage(imgData, 'PNG', margin, margin, w, h)
    } else {
      while (remaining > 0) {
        const pageH = Math.min(availH, remaining)
        const pageCanvas = document.createElement('canvas')
        pageCanvas.width = canvas.width
        pageCanvas.height = (pageH / ratio) * (canvas.width / w) * imgW / canvas.width * canvas.width / (imgW / canvas.width)
        const ctx = pageCanvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
        const srcH = (pageH / ratio)
        ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, pageCanvas.width, pageCanvas.height)
        pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', margin, position, w, pageH)
        remaining -= availH
        srcY += srcH
        if (remaining > 0) {
          pdf.addPage()
          position = margin
        }
      }
    }
    pdf.save(`${form.title || '康奈尔笔记'}.pdf`)
    notify('已导出 PDF', 'success')
  } catch (e) {
    notify(getApiError(e, '导出 PDF 失败'), 'error')
  } finally {
    exporting.value = false
  }
}

watch(
  () => ({ ...form, tags: tags.value.join(',') }),
  () => {
    if (!loaded.value) return
    dirty.value = true
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(async () => {
      autoSaveTimer = null
      // 组件已卸载就别再打请求了（旧实现会在离开页面后仍触发一次 doSave）
      if (disposed) return
      autoSaving.value = true
      await doSave(true)
      if (!disposed) autoSaving.value = false
    }, 2500)
  },
  { deep: true }
)

/** 离开路由前把防抖里没落盘的改动强制刷一次，避免「改完就走」丢内容 */
onBeforeRouteLeave(async () => {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
  if (dirty.value && form.title.trim()) {
    autoSaving.value = true
    await doSave(true)
    autoSaving.value = false
  }
  return true
})

/** 关闭窗口 / 刷新时的最后一道提醒（浏览器只允许弹默认文案） */
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!dirty.value) return
  e.preventDefault()
  e.returnValue = ''
}

onMounted(() => {
  loadCategories()
  loadNote()
  window.addEventListener('scroll', hideSelBar, true)
  window.addEventListener('resize', hideSelBar)
  window.addEventListener('beforeunload', onBeforeUnload)
})

onUnmounted(() => {
  disposed = true
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
  stopDrag()
  window.removeEventListener('scroll', hideSelBar, true)
  window.removeEventListener('resize', hideSelBar)
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<style scoped>
.wb-page { gap: 16px; }

/* ===== Sticky Top Bar ===== */
.note-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-card);
  flex-wrap: wrap;
}
.note-topbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.note-topbar-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.note-page-title {
  font-family: var(--font-serif);
  font-size: 18px;
  font-weight: 700;
  color: var(--kb-foreground);
  margin: 0;
  white-space: nowrap;
}
.note-topbar-center {
  flex: 1;
  display: flex;
  justify-content: center;
  min-width: 200px;
}
.note-save-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
}
.note-save-saving {
  background: color-mix(in srgb, var(--mc) 10%, transparent);
  color: var(--mc);
}
.note-save-done {
  background: color-mix(in srgb, var(--kb-accent) 10%, transparent);
  color: var(--kb-accent);
}
.note-save-idle {
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
}
.note-topbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.note-export-btn {
  font-size: 12px;
  padding: 6px 12px;
}
.wb-ghost-btn {
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  color: var(--kb-foreground);
}
.wb-ghost-btn:hover:not(:disabled) {
  border-color: var(--mc);
  color: var(--mc);
}
.wb-ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ===== Metadata Card ===== */
.note-meta-card {
  padding: 20px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-card);
}
.note-meta-grid {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--kb-border);
}
.note-meta-title-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  grid-column: span 1;
}
.note-meta-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.note-title-input {
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 600;
}
.note-tags-input {
  position: relative;
  display: flex;
  align-items: center;
}
.note-tags-icon {
  position: absolute;
  left: 10px;
  color: var(--kb-muted-foreground);
  pointer-events: none;
}
.note-tags-field {
  padding-left: 28px !important;
}
.note-tags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 2px;
}
.note-tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--mc) 12%, transparent);
  color: var(--mc);
  font-size: 11px;
  font-weight: 600;
}
.note-tag-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
  padding: 0;
}
.note-tag-remove:hover { opacity: 1; }
.note-meta-mastery {
  justify-content: space-between;
}
.note-mastery-val {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--mc);
}
.note-mastery-slider {
  accent-color: var(--mc);
  margin-top: 4px;
}
.note-err {
  font-size: 12px;
  color: var(--kb-destructive);
  font-weight: 500;
}

/* ===== Cornell Three-Column ===== */
.note-ai-hint {
  margin-bottom: 14px;
}
.note-cards-panel { margin-top: 16px; }
.note-cards-adopt { font-size: 12px; padding: 5px 12px; }
.cap-card-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cap-card-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--kb-radius-sm);
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
  font-size: 13px;
  line-height: 1.5;
}
.cap-card-q { color: var(--kb-foreground); font-weight: 600; }
.cap-card-a { color: var(--kb-muted-foreground); }
/* ===== 可拖拽工作区（倒 T 形：上排 线索|笔记，下排 总结） ===== */
.cornell-workspace {
  display: flex;
  flex-direction: column;
  height: clamp(460px, 62vh, 820px);
  min-height: 0;
}
.cornell-row {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}
.cornell-cue {
  width: var(--cue-w, 26%);
  flex: 0 0 auto;
  min-width: 0;
}
.cornell-note {
  flex: 1 1 auto;
  min-width: 0;
}
.cornell-summary {
  height: var(--sum-h, 22%);
  flex: 0 0 auto;
  min-height: 0;
}
/* 拖拽中禁用面板内的指针事件，避免鼠标掠过 textarea 时选中文本 */
.cornell-workspace.is-dragging .cornell-col {
  pointer-events: none;
  user-select: none;
}

/* 分割线：默认极简，hover/拖拽时亮出主题色握把 */
.cornell-splitter {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: 0;
  transition: background 0.15s ease;
}
.cornell-splitter-v {
  width: 8px;
  cursor: col-resize;
}
.cornell-splitter-h {
  height: 8px;
  cursor: row-resize;
}
.cornell-splitter-grip {
  display: block;
  border-radius: 999px;
  background: var(--kb-border);
  transition: background 0.15s ease, transform 0.15s ease;
}
.cornell-splitter-v .cornell-splitter-grip {
  width: 2px;
  height: 34px;
}
.cornell-splitter-h .cornell-splitter-grip {
  width: 34px;
  height: 2px;
}
.cornell-splitter:hover .cornell-splitter-grip,
.cornell-splitter:focus-visible .cornell-splitter-grip,
.cornell-splitter.is-active .cornell-splitter-grip {
  background: var(--mc);
}
.cornell-splitter-v:hover .cornell-splitter-grip,
.cornell-splitter-v.is-active .cornell-splitter-grip {
  transform: scaleX(2);
}
.cornell-splitter-h:hover .cornell-splitter-grip,
.cornell-splitter-h.is-active .cornell-splitter-grip {
  transform: scaleY(2);
}
.cornell-splitter:hover,
.cornell-splitter.is-active {
  background: color-mix(in srgb, var(--mc) 8%, transparent);
}
.cornell-splitter:focus-visible {
  outline: 2px solid var(--mc);
  outline-offset: -2px;
  border-radius: var(--kb-radius-sm);
}

.cornell-col {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-radius: var(--kb-radius-md);
  border: 1px solid var(--kb-border);
  overflow: hidden;
}
.cornell-cue { border-top: 3px solid var(--kb-warning); }
.cornell-note { border-top: 3px solid var(--mc); }
.cornell-summary { border-top: 3px solid var(--kb-accent); }

.cornell-col-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px 8px;
  color: var(--kb-foreground);
}
.cornell-cue .cornell-col-head { color: var(--kb-warning); }
.cornell-summary .cornell-col-head { color: var(--kb-accent); }
.cornell-col-title {
  font-family: var(--font-serif);
  font-size: var(--kb-fs-body-lg);
  font-weight: 700;
  color: inherit;
  margin: 0;
}
.cornell-col-hint {
  font-size: 11px;
  color: var(--kb-muted-foreground);
  margin: 2px 0 0;
  line-height: 1.4;
}
.cornell-textarea {
  flex: 1 1 auto;
  min-height: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  /* 高度已由分割线控制，禁掉原生 resize 免得与拖拽比例打架 */
  resize: none;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.7;
}
.cornell-cue-input {
  background: color-mix(in srgb, var(--kb-warning) 2%, transparent);
}
.cornell-summary-input {
  background: color-mix(in srgb, var(--kb-accent) 2%, transparent);
}

/* ===== Rich Text Editor ===== */
.rte-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 10px;
  border-top: 1px solid var(--kb-border);
  border-bottom: 1px solid var(--kb-border);
  background: var(--kb-background);
  flex-wrap: wrap;
}
.rte-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--kb-radius-sm);
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: all 0.15s ease;
}
.rte-btn:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}
.rte-btn:active {
  background: color-mix(in srgb, var(--mc) 20%, transparent);
  color: var(--mc);
}
.rte-divider {
  width: 1px;
  height: 18px;
  background: var(--kb-border);
  margin: 0 4px;
}
.rte-highlight {
  width: 30px;
  font-weight: 700;
}
.rte-hl-mark {
  font-size: 13px;
  font-weight: 900;
  background: color-mix(in srgb, var(--kb-warning) 35%, transparent);
  padding: 0 4px;
  border-radius: 3px;
  color: #92400E;
}
.cornell-editor {
  flex: 1 1 auto;
  min-height: 0;
  padding: 14px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--kb-foreground);
  outline: none;
  overflow-y: auto;
}
.cornell-editor:empty::before {
  content: '详细记录知识点…支持加粗、斜体、列表、高亮';
  color: var(--kb-muted-foreground);
  opacity: 0.6;
}
.cornell-editor :deep(strong) { font-weight: 700; }
.cornell-editor :deep(em) { font-style: italic; }
.cornell-editor :deep(u) { text-decoration: underline; }
.cornell-editor :deep(ul) {
  list-style: disc;
  padding-left: 22px;
  margin: 6px 0;
}
.cornell-editor :deep(ol) {
  list-style: decimal;
  padding-left: 22px;
  margin: 6px 0;
}
.cornell-editor :deep(li) { margin: 3px 0; }
.cornell-editor :deep([style*="background-color"]) {
  border-radius: 2px;
  padding: 0 2px;
}

/* ===== 导出态：解除高度约束，让三栏摊平后再截图 ===== */
.cornell-workspace.is-exporting {
  height: auto;
}
.cornell-workspace.is-exporting .cornell-summary {
  height: auto;
}
.cornell-workspace.is-exporting .cornell-textarea,
.cornell-workspace.is-exporting .cornell-editor {
  overflow: hidden;
}
.cornell-workspace.is-exporting .cornell-splitter {
  visibility: hidden;
}

/* ===== 划词悬浮工具栏 ===== */
.note-sel-bar {
  position: fixed;
  z-index: 60;
  transform: translate(-50%, -100%);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-lg);
}
.note-sel-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: var(--kb-radius-sm);
  background: transparent;
  color: var(--kb-muted-foreground);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.note-sel-btn:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}
.note-sel-btn:active {
  background: color-mix(in srgb, var(--mc) 18%, transparent);
  color: var(--mc);
}
.note-sel-cue {
  color: var(--mc);
}
.note-sel-cue:hover {
  background: color-mix(in srgb, var(--mc) 12%, transparent);
  color: var(--mc);
}
.note-sel-divider {
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background: var(--kb-border);
}
.sel-bar-enter-active,
.sel-bar-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.sel-bar-enter-from,
.sel-bar-leave-to {
  opacity: 0;
  transform: translate(-50%, calc(-100% + 4px));
}

/* ===== AI 自测题 ===== */
.note-quiz-btn {
  background: color-mix(in srgb, var(--kb-warning) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--kb-warning) 32%, transparent);
  color: var(--kb-warning);
}
.note-quiz-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--kb-warning) 20%, transparent);
}
.note-quiz-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.note-quiz-panel {
  margin-top: 16px;
}
.note-quiz-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.note-quiz-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.note-quiz-item {
  padding: 10px 12px;
  border-radius: var(--kb-radius-sm);
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
}
.note-quiz-q {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.6;
  color: var(--kb-foreground);
}
.note-quiz-type {
  flex: none;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}
.note-quiz-type.is-choice {
  background: color-mix(in srgb, var(--mc) 14%, transparent);
  color: var(--mc);
}
.note-quiz-type.is-fill {
  background: color-mix(in srgb, var(--kb-accent) 14%, transparent);
  color: var(--kb-accent);
}
.note-quiz-options {
  list-style: none;
  margin: 6px 0 0;
  padding: 0 0 0 4px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 14px;
}
.note-quiz-options li {
  font-size: 13px;
  line-height: 1.6;
  color: var(--kb-muted-foreground);
}
.note-quiz-options li.is-answer {
  color: var(--kb-accent);
  font-weight: 600;
}
.note-quiz-answer {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--kb-muted-foreground);
}
.note-quiz-answer b {
  color: var(--kb-accent);
}

/* ===== Bottom Action Bar ===== */
.note-action-bar {
  position: sticky;
  bottom: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-card);
}
.note-action-left {
  flex: 1;
  display: flex;
  align-items: center;
}
.note-err-form {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.note-action-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.note-draft-btn {
  padding: 8px 18px;
  font-size: 14px;
}
.note-publish-btn {
  padding: 8px 22px;
  font-size: 14px;
}
.note-draft-btn:disabled, .note-publish-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ===== Responsive ===== */
@media (max-width: 1024px) {
  .note-meta-grid {
    grid-template-columns: 1fr 1fr;
  }
  .note-meta-title-field { grid-column: span 2; }
  /* 窄屏放弃拖拽版式，改为纵向堆叠，避免线索栏被压到不可读 */
  .cornell-workspace {
    height: auto;
    gap: 12px;
  }
  .cornell-row {
    flex-direction: column;
    gap: 12px;
  }
  .cornell-cue,
  .cornell-summary {
    width: 100%;
    height: auto;
  }
  .cornell-col { min-height: 220px; }
  .cornell-textarea,
  .cornell-editor { min-height: 180px; }
  .cornell-splitter { display: none; }
  .note-quiz-options { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
  .note-topbar { flex-direction: column; align-items: stretch; }
  .note-topbar-center { justify-content: flex-start; }
  .note-topbar-right { justify-content: flex-end; }
  .note-meta-grid { grid-template-columns: 1fr; }
  .note-meta-title-field { grid-column: span 1; }
  .note-action-bar { flex-direction: column; align-items: stretch; }
  .note-action-right { justify-content: flex-end; }
}
</style>

<style>
/* 拖拽期间锁定全局光标与选区：鼠标移出分割线也不会闪回默认箭头 */
body.kb-resizing-col,
body.kb-resizing-col * {
  cursor: col-resize !important;
  user-select: none !important;
}
body.kb-resizing-row,
body.kb-resizing-row * {
  cursor: row-resize !important;
  user-select: none !important;
}
</style>
