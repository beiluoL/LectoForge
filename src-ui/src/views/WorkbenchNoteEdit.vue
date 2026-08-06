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
      <div class="cornell-grid">
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
            v-model="form.cueColumn"
            class="kb-input cornell-textarea cornell-cue-input"
            placeholder="例如：&#10;- 什么是 SM-2 算法？&#10;- 间隔重复的原理是什么？"
            rows="12"
          ></textarea>
        </div>

        <!-- 笔记栏（富文本） -->
        <div class="cornell-col cornell-note">
          <div class="cornell-col-head">
            <Icon name="pen-line" :size="16" />
            <div>
              <h3 class="cornell-col-title">笔记栏</h3>
              <p class="cornell-col-hint">课堂 / 阅读的主体内容，支持富文本</p>
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
          ></div>
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
            v-model="form.summaryColumn"
            class="kb-input cornell-textarea cornell-summary-input"
            placeholder="一句话讲清这个概念…"
            rows="12"
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
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import AiAssociatePanel from '@/components/AiAssociatePanel.vue'
import { notify, confirmDialog, getApiError } from '@/utils/toast'
import './workbench-shared.css'
import './ai-shared.css'
import { getNote, createNote, updateNote, getCategoryTree, createReview } from '@/api/workbench'
import { generateNoteColumns, generateFlashcards, type Flashcard } from '@/api/ai'
import type { WbNotePayload, CategoryVO } from '@/api/types'

const route = useRoute()
const router = useRouter()
const themeColor = '#8B5CF6'

const noteId = ref<number | null>(route.params.id && route.params.id !== 'new' ? Number(route.params.id) : null)
const isNew = computed(() => noteId.value === null)
const noteLoaded = ref(false)

const editorRef = ref<HTMLElement | null>(null)
const exportRoot = ref<HTMLElement | null>(null)
const exporting = ref(false)
const saving = ref(false)
const autoSaving = ref(false)
const lastSavedAt = ref('')
const loaded = ref(false)

// ===== AI 生成线索栏/总结栏（B1/B2）：仅填充，不覆盖用户已有内容 =====
const aiGen = ref(false)
const aiMode = ref<'cue' | 'summary'>('cue')
const aiHintVisible = ref(false)
// ===== AI 批量生成复习卡（B4）：先生成预览，用户采纳后才逐张建卡 =====
const aiCardsGen = ref(false)
const aiCardsCreating = ref(false)
const flashcards = ref<Flashcard[] | null>(null)

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
    if (form.tags) tags.value = form.tags.split(',').map((t) => t.trim()).filter(Boolean)
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

async function doSave(silent = false): Promise<boolean> {
  if (!form.title.trim()) {
    if (!silent) errors.title = '标题不能为空'
    return false
  }
  try {
    if (isNew.value) {
      const newId = await createNote({ ...form })
      noteId.value = newId
      if (!silent) notify('已保存', 'success')
    } else {
      await updateNote(noteId.value!, { ...form })
      if (!silent) notify('已保存', 'success')
    }
    lastSavedAt.value = formatTime(new Date())
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

function goBack() {
  if (form.title.trim() || form.noteColumn?.trim()) {
    confirmDialog('有未保存的内容，确认离开？').then((ok) => {
      if (ok) router.push('/workbench/notes')
    })
  } else {
    router.push('/workbench/notes')
  }
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

async function exportImage() {
  if (!exportRoot.value) return
  exporting.value = true
  try {
    const html2canvas = (await import('html2canvas')).default
    const canvas = await html2canvas(exportRoot.value, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
    })
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
    const canvas = await html2canvas(exportRoot.value, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
    })
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
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(async () => {
      autoSaving.value = true
      await doSave(true)
      autoSaving.value = false
    }, 2500)
  },
  { deep: true }
)

onMounted(() => {
  loadCategories()
  loadNote()
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
.cornell-grid {
  display: grid;
  grid-template-columns: 3fr 6fr 3fr;
  gap: 14px;
}
.cornell-col {
  display: flex;
  flex-direction: column;
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
  flex: 1;
  min-height: 280px;
  border: none;
  border-radius: 0;
  background: transparent;
  resize: vertical;
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
  flex: 1;
  min-height: 280px;
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
  .cornell-grid {
    grid-template-columns: 1fr;
  }
  .cornell-col { min-height: auto; }
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
