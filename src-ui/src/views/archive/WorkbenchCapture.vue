<template>
  <div class="wb-page animate-fade-in" :style="{ '--mc': themeColor }">
    <!-- ============ Module Hero ============ -->
    <section class="wb-hero">
      <div class="wb-hero-bg" aria-hidden="true">
        <span class="wb-blob"></span>
        <span class="wb-grid"></span>
      </div>
      <div class="wb-hero-inner">
        <div class="wb-hero-head">
          <div class="wb-hero-text">
            <span class="wb-eyebrow">
              <span class="wb-eyebrow-dot"></span>
              Step 01 · 输入 · Capture
            </span>
            <h1 class="wb-title">
              <Icon name="inbox" :size="28" class="wb-title-icon" />
              知识输入 · 收集箱
            </h1>
            <p class="wb-subtitle">
              快速捕获灵感、摘录与网页剪藏，<strong>先积累，再沉淀</strong>。
              整理后流入笔记与复习，构成闭环的第一步。
            </p>
          </div>
          <button class="kb-btn kb-btn-primary wb-cta" @click="openCreate">
            <Icon name="plus" :size="16" /> 新建条目
          </button>
        </div>

        <!-- 闭环导航条 -->
        <nav class="wb-loop-nav" aria-label="学习闭环">
          <router-link v-for="s in loopSteps" :key="s.key" :to="s.path" class="wb-loop-step" :class="{ 'is-current': s.key === 'input' }">
            <span class="wb-loop-num">{{ s.num }}</span>
            <span class="wb-loop-name">{{ s.name }}</span>
          </router-link>
        </nav>
      </div>
    </section>

    <!-- ============ Filter Bar ============ -->
    <section class="wb-filter">
      <div class="wb-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          class="wb-tab"
          :class="{ 'is-active': activeStatus === tab.value }"
          @click="activeStatus = tab.value; load()"
        >
          {{ tab.label }}
          <span v-if="tab.value === 'INBOX'" class="wb-tab-badge">{{ inboxCount }}</span>
        </button>
      </div>
      <div class="wb-filter-tools">
        <select v-model="activeCategory" class="kb-input kb-select-sm" @change="load">
          <option :value="undefined">全部分类</option>
          <option v-for="c in flatCategories" :key="c.id" :value="c.id">{{ '　'.repeat(c.depth ?? 0) }}{{ c.name }}</option>
        </select>
        <div class="wb-search">
          <Icon name="search" :size="14" class="wb-search-icon" />
          <input v-model="keyword" class="kb-input wb-search-input" placeholder="搜索标题…" @input="load" />
        </div>
      </div>
    </section>

    <!-- ============ List ============ -->
    <div v-if="aiHintVisible" class="ai-hint cap-ai-hint">
      <Icon name="info" :size="14" />
      <span>尚未配置 AI 服务，无法使用智能整理。</span>
      <router-link to="/settings/ai">前往 AI 设置</router-link>
    </div>
    <section class="wb-list">
      <div v-if="loading" class="wb-card-grid">
        <div v-for="n in 4" :key="n" class="wb-card wb-skeleton">
          <div class="wb-skel-line" style="width: 70%; height: 16px;"></div>
          <div class="wb-skel-line" style="width: 95%; height: 12px; margin-top: 10px;"></div>
          <div class="wb-skel-line" style="width: 60%; height: 12px;"></div>
        </div>
      </div>

      <div v-else-if="list.length === 0" class="wb-empty">
        <div class="wb-empty-icon"><Icon name="inbox" :size="40" /></div>
        <h3 class="wb-empty-title">收集箱还是空的</h3>
        <p class="wb-empty-desc">从一条灵感开始，让知识真正流动起来。</p>
        <button class="kb-btn kb-btn-primary" @click="openCreate">
          <Icon name="plus" :size="14" /> 新建第一条
        </button>
      </div>

      <div v-else class="wb-card-grid">
        <article
          v-for="item in list"
          :key="item.id"
          class="wb-card"
        >
          <div class="wb-card-head">
            <span class="wb-card-status" :style="statusStyle(item.status)">
              <span class="wb-status-dot"></span>{{ statusLabel(item.status) }}
            </span>
            <button class="wb-icon-btn" :class="{ 'is-on': item.starred }" title="标星" @click="toggleStar(item)">
              <Icon name="star" :size="16" />
            </button>
          </div>

          <h3 class="wb-card-title">{{ item.title }}</h3>
          <p class="wb-card-body">{{ item.content || '（无正文）' }}</p>

          <div class="wb-card-meta">
            <span v-if="categoryName(item.categoryId)" class="wb-chip wb-chip-blue">
              <Icon name="folder" :size="12" />{{ categoryName(item.categoryId) }}
            </span>
            <span class="wb-chip wb-chip-muted">
              <Icon name="link" :size="12" />{{ sourceLabel(item.sourceType) }}
            </span>
            <span v-if="item.tags" class="wb-chip wb-chip-muted">
              <Icon name="hash" :size="12" />{{ item.tags }}
            </span>
          </div>

          <div class="wb-card-foot">
            <button class="wb-mini-btn wb-mini-primary" title="转为笔记" @click="toNote(item)">
              <Icon name="notebook-pen" :size="14" /> 转笔记
            </button>
            <button
              class="wb-mini-btn ai-mini"
              :disabled="aiBusy(item.id)"
              title="AI 提炼要点"
              @click="runAiSummarize(item)"
            >
              <Icon :name="aiSummarizing === item.id ? 'loader' : 'ai-sparkle'" :size="14" :class="{ 'ai-spin': aiSummarizing === item.id }" />
              提炼
            </button>
            <button
              class="wb-mini-btn ai-mini"
              :disabled="aiBusy(item.id)"
              title="AI 标签与分类"
              @click="runAiTags(item)"
            >
              <Icon :name="aiTagging === item.id ? 'loader' : 'ai-sparkle'" :size="14" :class="{ 'ai-spin': aiTagging === item.id }" />
              标签
            </button>
            <button
              class="wb-mini-btn ai-mini"
              :disabled="aiBusy(item.id)"
              title="AI 起草笔记"
              @click="runAiDraftNote(item)"
            >
              <Icon :name="aiDrafting === item.id ? 'loader' : 'ai-sparkle'" :size="14" :class="{ 'ai-spin': aiDrafting === item.id }" />
              起草笔记
            </button>
            <button class="wb-mini-btn" title="归档" @click="setStatus(item, 'ARCHIVED')">
              <Icon name="archive" :size="14" /> 归档
            </button>
            <button class="wb-mini-btn" title="编辑" @click="openEdit(item)">
              <Icon name="edit-2" :size="14" />
            </button>
            <button class="wb-mini-btn wb-mini-danger" title="删除" @click="remove(item)">
              <Icon name="trash-2" :size="14" />
            </button>
          </div>

          <!-- AI 提炼结果面板（A1） -->
          <div v-if="summaries[item.id]" class="ai-panel cap-ai-panel">
            <div class="ai-panel-head">
              <span class="ai-panel-title"><Icon name="ai-sparkle" :size="14" /> AI 提炼要点</span>
            </div>
            <p v-if="summaries[item.id].oneLine" class="cap-ai-oneline">{{ summaries[item.id].oneLine }}</p>
            <ul v-if="summaries[item.id].bullets.length" class="ai-list">
              <li v-for="(b, i) in summaries[item.id].bullets" :key="i">{{ b }}</li>
            </ul>
          </div>

          <!-- AI 标签/分类结果面板（A2） -->
          <div v-if="tagSuggs[item.id]" class="ai-panel cap-ai-panel">
            <div class="ai-panel-head">
              <span class="ai-panel-title"><Icon name="ai-sparkle" :size="14" /> AI 标签建议</span>
            </div>
            <div class="cap-ai-tags">
              <button
                v-for="(t, i) in tagSuggs[item.id].tags"
                :key="i"
                class="cap-ai-tag"
                :title="`点击应用到该条目`"
                @click="applyTag(item, t)"
              >+ {{ t }}</button>
            </div>
            <button
              v-if="tagSuggs[item.id].suggestedCategoryId"
              class="cap-ai-cat"
              @click="applyCategory(item, tagSuggs[item.id].suggestedCategoryId!)"
            >
              建议分类：{{ tagSuggs[item.id].suggestedCategoryName }} →
            </button>
            <p v-else-if="tagSuggs[item.id].tags.length" class="cap-ai-cat-none">暂无明显可归类的分类</p>
          </div>
        </article>
      </div>
    </section>

    <!-- ============ Drawer ============ -->
    <div v-if="showDrawer" class="wb-drawer-mask" @click.self="showDrawer = false">
      <div class="wb-drawer">
        <header class="wb-drawer-head">
          <div>
            <span class="wb-eyebrow wb-eyebrow-sm">Capture</span>
            <h2 class="wb-drawer-title">{{ editingId ? '编辑条目' : '新建收集箱条目' }}</h2>
          </div>
          <button class="wb-icon-btn" @click="showDrawer = false"><Icon name="x" :size="18" /></button>
        </header>
        <div class="wb-drawer-body">
          <div class="wb-field">
            <label class="wb-label">标题 <span class="wb-req">*</span></label>
            <input v-model="form.title" class="kb-input" placeholder="一句话摘要" />
          </div>
          <div class="wb-field">
            <label class="wb-label">正文（Markdown）</label>
            <textarea v-model="form.content" class="kb-input" rows="6" placeholder="粘贴或记录内容…"></textarea>
          </div>
          <div class="wb-field-row">
            <div class="wb-field">
              <label class="wb-label">来源</label>
              <select v-model="form.sourceType" class="kb-input">
                <option value="MANUAL">手记</option>
                <option value="DOC">文档</option>
                <option value="WEB">网页</option>
                <option value="AI">AI 生成</option>
                <option value="IMPORT">导入</option>
              </select>
            </div>
            <div class="wb-field">
              <label class="wb-label">知识库分类</label>
              <select v-model="form.categoryId" class="kb-input">
                <option :value="undefined">未归类</option>
                <option v-for="c in flatCategories" :key="c.id" :value="c.id">{{ '　'.repeat(c.depth ?? 0) }}{{ c.name }}</option>
              </select>
            </div>
          </div>
          <div class="wb-field">
            <label class="wb-label">标签（逗号分隔）</label>
            <input v-model="form.tags" class="kb-input" placeholder="算法, 英语" />
          </div>
          <div class="wb-field">
            <label class="wb-label">来源链接</label>
            <input v-model="form.sourceUrl" class="kb-input" placeholder="https://…" />
          </div>

          <AiAssociatePanel v-if="editingId" entity-type="capture" :entity-id="editingId" variant="flush" />
        </div>
        <footer class="wb-drawer-foot">
          <button class="kb-btn" @click="showDrawer = false">取消</button>
          <button class="kb-btn kb-btn-primary" @click="save">
            <Icon name="check" :size="14" /> 保存
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import AiAssociatePanel from '@/components/AiAssociatePanel.vue'
import { notify, confirmDialog, getApiError } from '@/utils/toast'
import '../workbench-shared.css'
import '../ai-shared.css'
import {
  listCaptures,
  createCapture,
  updateCapture,
  deleteCapture,
  setCaptureStatus,
  toggleCaptureStar,
  getCategoryTree,
  createNote,
} from '@/api/workbench'
import { summarizeCapture, suggestTags, draftNoteFromCapture } from '@/api/ai'
import type { WbCapture, WbCapturePayload, CategoryVO } from '@/api/types'

const router = useRouter()
const themeColor = '#3B6FE0'

const list = ref<WbCapture[]>([])
const loading = ref(true)
const activeStatus = ref<string>('')
const activeCategory = ref<number | undefined>(undefined)
const keyword = ref('')
const categories = ref<CategoryVO[]>([])
const flatCategories = ref<CategoryVO[]>([])
const categoryMap = ref<Map<number, string>>(new Map())

const inboxCount = computed(() => list.value.filter((i) => i.status === 'INBOX').length)

const loopSteps = [
  { key: 'input', num: '01', name: '输入', path: '/workbench/capture' },
  { key: 'organize', num: '02', name: '整理', path: '/workbench/notes' },
  { key: 'review', num: '03', name: '复习', path: '/workbench/review' },
  { key: 'output', num: '04', name: '输出', path: '/workbench/story' },
]

function flatten(nodes: CategoryVO[], depth = 0): CategoryVO[] {
  const out: CategoryVO[] = []
  for (const n of nodes) {
    out.push({ ...n, depth })
    if (n.children && n.children.length) out.push(...flatten(n.children, depth + 1))
  }
  return out
}
function categoryName(id?: number) {
  return id ? categoryMap.value.get(id) || '' : ''
}
const tabs = [
  { label: '全部', value: '' },
  { label: '待整理', value: 'INBOX' },
  { label: '已整理', value: 'PROCESSED' },
  { label: '已归档', value: 'ARCHIVED' },
]

const showDrawer = ref(false)
const editingId = ref<number | null>(null)
const form = reactive<WbCapturePayload>({ title: '', content: '', sourceType: 'MANUAL', tags: '', sourceUrl: '', categoryId: undefined })

async function load() {
  loading.value = true
  try {
    list.value = await listCaptures({
      status: activeStatus.value || undefined,
      categoryId: activeCategory.value,
      keyword: keyword.value || undefined,
    })
  } catch (e) {
    notify(getApiError(e, '加载失败'), 'error')
  } finally {
    loading.value = false
  }
}

async function loadCategories() {
  try {
    categories.value = await getCategoryTree()
    flatCategories.value = flatten(categories.value)
    const map = new Map<number, string>()
    flatCategories.value.forEach((c) => map.set(c.id, c.name))
    categoryMap.value = map
  } catch {
    /* 分类下拉为增强项，失败不影响主流程 */
  }
}

function openCreate() {
  editingId.value = null
  Object.assign(form, { title: '', content: '', sourceType: 'MANUAL', tags: '', sourceUrl: '', categoryId: undefined })
  showDrawer.value = true
}
function openEdit(item: WbCapture) {
  editingId.value = item.id
  Object.assign(form, {
    title: item.title,
    content: item.content || '',
    sourceType: item.sourceType || 'MANUAL',
    tags: item.tags || '',
    sourceUrl: item.sourceUrl || '',
    categoryId: item.categoryId,
  })
  showDrawer.value = true
}
async function save() {
  if (!form.title?.trim()) {
    notify('标题不能为空', 'warning')
    return
  }
  try {
    if (editingId.value) {
      await updateCapture(editingId.value, { ...form })
      notify('已更新', 'success')
    } else {
      await createCapture({ ...form })
      notify('已添加', 'success')
    }
    showDrawer.value = false
    load()
  } catch (e) {
    notify(getApiError(e, '保存失败'), 'error')
  }
}
async function remove(item: WbCapture) {
  const ok = await confirmDialog('确认删除该收集箱条目？')
  if (!ok) return
  try {
    await deleteCapture(item.id)
    notify('已删除', 'success')
    load()
  } catch (e) {
    notify(getApiError(e, '删除失败'), 'error')
  }
}
async function setStatus(item: WbCapture, status: string) {
  try {
    await setCaptureStatus(item.id, status)
    notify('已归档', 'success')
    load()
  } catch (e) {
    notify(getApiError(e, '操作失败'), 'error')
  }
}
async function toggleStar(item: WbCapture) {
  try {
    await toggleCaptureStar(item.id)
    load()
  } catch (e) {
    notify(getApiError(e, '操作失败'), 'error')
  }
}
function toNote(item: WbCapture) {
  router.push({ path: '/workbench/notes', query: { captureId: String(item.id), title: item.title } })
}

// ===== AI 智能整理（A1 提炼 / A2 标签分类 / A3 起草笔记）：结果仅展示，采纳才落库 =====
const aiSummarizing = ref<number | null>(null)
const aiTagging = ref<number | null>(null)
const aiDrafting = ref<number | null>(null)
const aiHintVisible = ref(false)
const summaries = ref<Record<number, { bullets: string[]; oneLine: string }>>({})
const tagSuggs = ref<Record<number, { tags: string[]; suggestedCategoryId: number | null; suggestedCategoryName: string }>>({})

function aiBusy(id: number) {
  return aiSummarizing.value === id || aiTagging.value === id
}

async function runAiSummarize(item: WbCapture) {
  if (aiBusy(item.id)) return
  aiSummarizing.value = item.id
  aiHintVisible.value = false
  try {
    const res = await summarizeCapture({ title: item.title, content: item.content || '' })
    summaries.value[item.id] = { bullets: res.bullets, oneLine: res.oneLine }
    notify('已提炼要点', 'success')
  } catch (e) {
    const msg = getApiError(e, 'AI 提炼失败')
    if (msg.includes('AI 设置') || msg.includes('未配置') || msg.includes('已关闭')) aiHintVisible.value = true
    notify(msg, 'error')
  } finally {
    aiSummarizing.value = null
  }
}

async function runAiTags(item: WbCapture) {
  if (aiBusy(item.id)) return
  aiTagging.value = item.id
  aiHintVisible.value = false
  try {
    const res = await suggestTags({ title: item.title, content: item.content || '' })
    tagSuggs.value[item.id] = {
      tags: res.tags,
      suggestedCategoryId: res.suggestedCategoryId,
      suggestedCategoryName: res.suggestedCategoryName,
    }
    notify('已生成标签建议', 'success')
  } catch (e) {
    const msg = getApiError(e, 'AI 标签失败')
    if (msg.includes('AI 设置') || msg.includes('未配置') || msg.includes('已关闭')) aiHintVisible.value = true
    notify(msg, 'error')
  } finally {
    aiTagging.value = null
  }
}

async function applyTag(item: WbCapture, tag: string) {
  const existing = (item.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  if (existing.includes(tag)) {
    notify('标签已存在', 'info')
    return
  }
  const merged = [...existing, tag].join(',')
  try {
    await updateCapture(item.id, { tags: merged })
    notify('已添加标签', 'success')
    load()
  } catch (e) {
    notify(getApiError(e, '应用失败'), 'error')
  }
}

async function applyCategory(item: WbCapture, catId: number) {
  try {
    await updateCapture(item.id, { categoryId: catId })
    notify('已应用分类', 'success')
    load()
  } catch (e) {
    notify(getApiError(e, '应用失败'), 'error')
  }
}

async function runAiDraftNote(item: WbCapture) {
  if (aiBusy(item.id)) return
  aiDrafting.value = item.id
  aiHintVisible.value = false
  try {
    const res = await draftNoteFromCapture({ title: item.title, content: item.content || '' })
    await createNote({
      title: res.title || item.title,
      noteColumn: res.noteColumn,
      cueColumn: res.cueColumn,
      summaryColumn: res.summaryColumn,
      captureId: item.id,
      categoryId: item.categoryId,
      tags: item.tags || '',
      mastery: 0,
    })
    notify('已根据收集箱起草笔记', 'success')
    load()
  } catch (e) {
    const msg = getApiError(e, 'AI 起草失败')
    if (msg.includes('AI 设置') || msg.includes('未配置') || msg.includes('已关闭')) aiHintVisible.value = true
    notify(msg, 'error')
  } finally {
    aiDrafting.value = null
  }
}

function statusLabel(s?: string) {
  return { INBOX: '待整理', PROCESSED: '已整理', ARCHIVED: '已归档' }[s || ''] || s || ''
}
function statusStyle(s?: string) {
  const map: Record<string, string> = {
    INBOX: 'var(--kb-warning)',
    PROCESSED: 'var(--kb-primary)',
    ARCHIVED: 'var(--kb-muted-foreground)',
  }
  const c = map[s || ''] || 'var(--kb-muted-foreground)'
  return { '--sc': c, color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }
}
function sourceLabel(s?: string) {
  return { MANUAL: '手记', DOC: '文档', WEB: '网页', AI: 'AI', IMPORT: '导入' }[s || ''] || s || ''
}

onMounted(() => {
  load()
  loadCategories()
})
</script>

<style scoped>
/* ===== Page-specific ===== */
.wb-card-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}
.wb-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  transition: all 0.18s ease;
}
.wb-card:hover {
  border-color: color-mix(in srgb, var(--mc) 35%, var(--kb-border));
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-2px);
}
.wb-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.wb-card-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
.wb-status-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--sc);
}
.wb-card-title {
  font-family: var(--font-serif);
  font-size: var(--kb-fs-body-lg);
  font-weight: 700;
  color: var(--kb-foreground);
  line-height: 1.4;
  margin: 0;
}
.wb-card-body {
  font-size: 13px;
  line-height: 1.65;
  color: var(--kb-muted-foreground);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wb-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.wb-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: var(--kb-radius-sm);
  font-size: var(--kb-fs-xs);
  font-weight: 500;
}
.wb-chip-blue { background: color-mix(in srgb, var(--kb-primary) 10%, transparent); color: var(--kb-primary); }
.wb-chip-muted { background: var(--kb-muted); color: var(--kb-muted-foreground); }
.wb-card-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px dashed var(--kb-border);
}
.wb-mini-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border-radius: var(--kb-radius-sm);
  background: transparent;
  color: var(--kb-muted-foreground);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}
.wb-mini-btn:hover { background: var(--kb-muted); color: var(--kb-foreground); }
.wb-mini-btn:active { transform: translateY(1px); }
.wb-mini-primary { color: var(--kb-primary); }
.wb-mini-primary:hover { background: color-mix(in srgb, var(--kb-primary) 10%, transparent); color: var(--kb-primary); }
.wb-mini-danger:hover { background: color-mix(in srgb, var(--kb-destructive) 10%, transparent); color: var(--kb-destructive); }
.wb-icon-btn.is-on svg { fill: var(--kb-warning); color: var(--kb-warning); }

/* ===== AI 智能整理面板（A1/A2） ===== */
.cap-ai-hint { margin-bottom: 12px; }
.cap-ai-panel { margin-top: 10px; }
.cap-ai-oneline {
  font-size: 12px;
  color: var(--kb-foreground);
  margin: 6px 0;
  line-height: 1.5;
}
.cap-ai-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.cap-ai-tag {
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px dashed var(--kb-highlight);
  color: var(--kb-highlight);
  background: transparent;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.cap-ai-tag:hover { background: color-mix(in srgb, var(--kb-highlight) 12%, transparent); }
.cap-ai-cat {
  margin-top: 8px;
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  color: var(--kb-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}
.cap-ai-cat:hover { text-decoration: underline; }
.cap-ai-cat-none { margin-top: 6px; font-size: 11px; color: var(--kb-muted-foreground); }
.ai-mini { color: var(--kb-highlight); }
.ai-mini:hover { background: color-mix(in srgb, var(--kb-highlight) 10%, transparent); color: var(--kb-highlight); }

@media (max-width: 768px) {
  .wb-card-grid { grid-template-columns: 1fr; }
}
</style>
