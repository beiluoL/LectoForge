<template>
  <div class="space-y-4 animate-fade-in">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 class="kb-h1 mb-1 flex items-center gap-2" style="color: var(--kb-foreground);">
          <Icon name="wand-2" :size="24" style="color: var(--kb-primary);" /> {{ isNew ? '写费曼故事' : '编辑故事' }}
        </h1>
        <p class="kb-body" style="color: var(--kb-muted-foreground);">以教代学：用一个故事把知识讲给外行听。</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="kb-btn" @click="router.push('/workbench/story')"><Icon name="chevron-left" :size="16" /> 返回</button>
        <button class="kb-btn ai-btn" :disabled="aiLoading" @click="runAiClarity">
          <Icon :name="aiLoading ? 'loader' : 'ai-sparkle'" :size="16" :class="aiLoading ? 'ai-spin' : ''" />
          {{ aiLoading ? '评分中…' : 'AI 评分' }}
        </button>
        <button class="kb-btn ai-btn" :disabled="aiDraftLoading" @click="runAiDraft">
          <Icon :name="aiDraftLoading ? 'loader' : 'ai-sparkle'" :size="16" :class="aiDraftLoading ? 'ai-spin' : ''" />
          {{ aiDraftLoading ? '起草中…' : 'AI 起草初稿' }}
        </button>
        <button class="kb-btn" @click="save('DRAFT')"><Icon name="save" :size="16" /> 存草稿</button>
        <button class="kb-btn kb-btn-primary" @click="save('DONE')"><Icon name="check-circle" :size="16" /> 完成</button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- 编辑区 -->
      <div class="space-y-3">
        <div>
          <label class="kb-label">标题 *</label>
          <input v-model="form.title" class="kb-input" placeholder="故事标题" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="kb-label">假想听众</label>
            <select v-model="form.audience" class="kb-input">
              <option value="CHILD">小孩</option>
              <option value="NEWBIE">初学者</option>
              <option value="PEER">同行</option>
              <option value="INTERVIEWER">面试官</option>
            </select>
          </div>
          <div>
            <label class="kb-label">自评讲清程度 {{ form.clarityScore }}%</label>
            <input type="range" min="0" max="100" step="5" v-model.number="form.clarityScore" style="accent-color: var(--kb-primary); width: 100%;" />
          </div>
        </div>
        <div>
          <label class="kb-label">核心类比 / 隐喻</label>
          <input v-model="form.metaphor" class="kb-input" placeholder="如：把「索引」比作「书的目录」" />
        </div>
        <div>
          <label class="kb-label">故事正文（Markdown）</label>
          <textarea v-model="form.content" class="kb-input" rows="12" placeholder="从前有一个…用故事讲清这个概念…"></textarea>
        </div>
        <div>
          <label class="kb-label">讲述卡点（费曼法核心：卡壳处即知识漏洞）</label>
          <textarea v-model="form.gapNote" class="kb-input" rows="3" placeholder="哪里没讲清楚？回去补学…"></textarea>
        </div>
      </div>

      <!-- 预览区 + AI 评分结果（右列，不影响左侧编辑区原有布局） -->
      <div class="space-y-3">
        <!-- AI 未配置提示：只在用户主动触发过一次后出现，不打扰默认流程 -->
        <div v-if="aiHintVisible" class="ai-hint">
          <Icon name="info" :size="14" />
          <span>
            尚未配置 AI 服务，
            <router-link to="/settings">前往 AI 设置</router-link>
            填入 API Key 后即可使用清晰度评分。
          </span>
        </div>

        <section v-if="ai" class="ai-panel">
          <div class="ai-panel-head">
            <h3 class="ai-panel-title">
              <Icon name="ai-sparkle" :size="16" class="ai-icon" /> AI 清晰度评分
            </h3>
            <div class="ai-panel-actions">
              <button class="kb-btn kb-btn-sm" title="关闭结果" @click="ai = null">
                <Icon name="x" :size="14" />
              </button>
            </div>
          </div>

          <div class="ai-score-row">
            <span class="ai-score">{{ ai.clarityScore }}</span>
            <span class="ai-score-unit">/ 100</span>
            <span class="ai-score-compare">当前自评 {{ form.clarityScore }}</span>
          </div>
          <div class="ai-score-bar"><i :style="{ width: ai.clarityScore + '%' }"></i></div>

          <div v-if="ai.gapNote">
            <p class="ai-subtitle">知识缺口</p>
            <p class="ai-feedback">{{ ai.gapNote }}</p>
          </div>

          <div v-if="ai.vagueParts.length">
            <p class="ai-subtitle">讲得含糊的地方</p>
            <ul class="ai-list is-danger">
              <li v-for="(v, i) in ai.vagueParts" :key="'v' + i">{{ v }}</li>
            </ul>
          </div>

          <div v-if="ai.suggestions.length">
            <p class="ai-subtitle">改进建议</p>
            <ul class="ai-list">
              <li v-for="(s, i) in ai.suggestions" :key="'s' + i">{{ s }}</li>
            </ul>
          </div>

          <div class="flex items-center justify-between gap-2 flex-wrap">
            <span class="ai-meta">{{ ai.model }} · {{ ai.latencyMs }}ms</span>
            <button class="kb-btn kb-btn-sm ai-btn" @click="adoptAi">
              <Icon name="check" :size="14" /> 采纳评分与卡点
            </button>
          </div>
        </section>

        <div class="rounded-xl border p-4" style="background: var(--kb-card); border-color: var(--kb-border);">
          <h3 class="kb-h4 mb-3 flex items-center gap-1.5" style="color: var(--kb-foreground);">
            <Icon name="eye" :size="16" /> 故事预览
          </h3>
          <h4 class="kb-h3 mb-2" style="color: var(--kb-foreground);">{{ form.title || '（未命名故事）' }}</h4>
          <p v-if="form.metaphor" class="text-[12px] mb-3 flex items-center gap-1" style="color: var(--kb-primary);">
            <Icon name="lightbulb" :size="14" /> 隐喻：{{ form.metaphor }}
          </p>
          <p class="kb-body whitespace-pre-wrap mb-3" style="color: var(--kb-foreground);">{{ form.content || '（正文预览）' }}</p>
          <div v-if="form.gapNote" class="rounded-lg p-3" style="background: color-mix(in srgb, var(--kb-warning) 10%, transparent);">
            <p class="text-[12px] font-semibold mb-1" style="color: var(--kb-warning);">
              <Icon name="alert-circle" :size="14" /> 知识卡点
            </p>
            <p class="text-[12px]" style="color: var(--kb-warning);">{{ form.gapNote }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import { notify, getApiError } from '@/utils/toast'
import { getStory, createStory, updateStory, getNote } from '@/api/workbench'
import { scoreStoryClarity, draftStoryFromNote, type StoryClarityResult } from '@/api/ai'
import type { WbStoryPayload } from '@/api/types'
import './ai-shared.css'

const route = useRoute()
const router = useRouter()
const id = String(route.params.id || 'new')
const isNew = id === 'new'

const form = reactive<WbStoryPayload>({
  title: '',
  captureId: undefined,
  noteId: undefined,
  categoryId: undefined,
  audience: 'CHILD',
  metaphor: '',
  content: '',
  gapNote: '',
  status: 'DRAFT',
  clarityScore: 0,
})

onMounted(async () => {
  if (route.query.noteId) form.noteId = Number(route.query.noteId)
  if (route.query.title && isNew) form.title = String(route.query.title)
  if (!isNew) {
    try {
      const s = await getStory(Number(id))
      Object.assign(form, {
        title: s.title,
        captureId: s.captureId,
        noteId: s.noteId,
        categoryId: s.categoryId,
        audience: s.audience || 'CHILD',
        metaphor: s.metaphor || '',
        content: s.content || '',
        gapNote: s.gapNote || '',
        status: s.status || 'DRAFT',
        clarityScore: s.clarityScore || 0,
      })
    } catch (e) {
      notify(getApiError(e, '加载失败'), 'error')
    }
  }
})

// ===== P1-E1：AI 清晰度评分 =====
// 只算不存：AI 结果先展示在右侧面板，用户点「采纳」才写入表单，
// 最终仍由原有的 save() 走 PUT /stories/:id 落库，故事编辑的原有流程完全不变。
const ai = ref<StoryClarityResult | null>(null)
const aiLoading = ref(false)
const aiDraftLoading = ref(false)
const aiHintVisible = ref(false)

async function runAiClarity() {
  const content = (form.content || '').trim()
  if (content.length < 20) {
    notify('先把故事讲到 20 字以上，AI 才评得准', 'warning')
    return
  }
  aiLoading.value = true
  aiHintVisible.value = false
  try {
    ai.value = await scoreStoryClarity({
      title: form.title,
      audience: form.audience,
      metaphor: form.metaphor,
      content,
    })
  } catch (e) {
    const msg = getApiError(e, 'AI 评分失败')
    // 未配置/未启用时给出引导条，而不是只弹一个错误
    if (msg.includes('AI 设置') || msg.includes('未配置') || msg.includes('已关闭')) {
      aiHintVisible.value = true
    }
    notify(msg, 'error')
  } finally {
    aiLoading.value = false
  }
}

/** 采纳 AI 结果：填入自评分与卡点，仍需用户手动保存 */
function adoptAi() {
  if (!ai.value) return
  form.clarityScore = ai.value.clarityScore
  if (ai.value.gapNote) {
    form.gapNote = form.gapNote?.trim()
      ? `${form.gapNote.trim()}\n${ai.value.gapNote}`
      : ai.value.gapNote
  }
  notify('已填入评分与卡点，记得保存', 'success')
}

/**
 * E3：根据标题/关联笔记为指定听众起草费曼故事初稿 + 比喻。
 * 只填充 content/metaphor，最终仍由 save() 落库，故事编辑原有流程不变。
 */
async function runAiDraft() {
  if (!form.title?.trim() && !form.noteId) {
    notify('先填写标题或关联笔记，AI 才有素材', 'warning')
    return
  }
  aiDraftLoading.value = true
  aiHintVisible.value = false
  try {
    let noteColumn = ''
    if (form.noteId) {
      try {
        const n = await getNote(form.noteId)
        noteColumn = (n.noteColumn || '').replace(/<[^>]*>/g, ' ')
      } catch { /* 取不到笔记就只用标题 */ }
    }
    const res = await draftStoryFromNote({ title: form.title, noteColumn, audience: form.audience })
    if (res.content) form.content = res.content
    if (res.metaphor) form.metaphor = res.metaphor
    notify('已生成故事初稿，记得保存', 'success')
  } catch (e) {
    const msg = getApiError(e, 'AI 起草失败')
    if (msg.includes('AI 设置') || msg.includes('未配置') || msg.includes('已关闭')) aiHintVisible.value = true
    notify(msg, 'error')
  } finally {
    aiDraftLoading.value = false
  }
}

async function save(status: string) {
  if (!form.title?.trim()) {
    notify('标题不能为空', 'warning')
    return
  }
  form.status = status
  try {
    if (isNew) {
      await createStory({ ...form })
    } else {
      await updateStory(Number(id), { ...form })
    }
    notify(status === 'DONE' ? '故事已完成' : '已保存草稿', 'success')
    router.push('/workbench/story')
  } catch (e) {
    notify(getApiError(e, '保存失败'), 'error')
  }
}
</script>
