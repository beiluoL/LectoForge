<template>
  <div class="space-y-4 animate-fade-in">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 class="kb-h1 mb-1 flex items-center gap-2" style="color: var(--kb-foreground);">
          <Icon name="ai-sparkle" :size="24" style="color: var(--kb-highlight);" /> AI 学习洞察
        </h1>
        <p class="kb-body" style="color: var(--kb-muted-foreground);">
          把你的学习数据讲成人话：周报看趋势，诊断看薄弱。全部基于本地只读统计，不改动任何记录。
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button class="kb-btn" @click="router.back()">
          <Icon name="chevron-left" :size="16" /> 返回
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- G1：学习周报 -->
      <section class="ai-card">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h2 class="ai-card-title">
            <Icon name="bar-chart-3" :size="18" style="color: var(--kb-primary);" /> 学习周报 / 洞察
          </h2>
          <button class="kb-btn ai-btn" :disabled="reportLoading" @click="runReport">
            <Icon :name="reportLoading ? 'loader' : 'ai-sparkle'" :size="14" :class="reportLoading ? 'ai-spin' : ''" />
            {{ reportLoading ? '生成中…' : '生成周报' }}
          </button>
        </div>
        <p class="ai-card-desc">聚合概览与近 30 天遗忘曲线，由 AI 总结趋势并给可执行建议。</p>

        <div v-if="aiHintVisible" class="ai-hint">
          <Icon name="info" :size="14" />
          <span>尚未配置 AI 服务，<router-link to="/settings/ai">前往 AI 设置</router-link> 后即可使用。</span>
        </div>

        <div v-if="report" class="ai-panel">
          <div class="ai-panel-head">
            <span class="ai-panel-title"><Icon name="ai-sparkle" :size="14" /> 本周洞察</span>
            <span class="ai-meta">{{ report.model }} · {{ report.latencyMs }}ms</span>
          </div>
          <p v-if="report.summary" class="insight-summary">{{ report.summary }}</p>
          <div v-if="report.highlights.length">
            <p class="ai-subtitle">数据观察</p>
            <ul class="ai-list">
              <li v-for="(h, i) in report.highlights" :key="'h' + i">{{ h }}</li>
            </ul>
          </div>
          <div v-if="report.suggestions.length">
            <p class="ai-subtitle">改进建议</p>
            <ul class="ai-list">
              <li v-for="(s, i) in report.suggestions" :key="'s' + i">{{ s }}</li>
            </ul>
          </div>
        </div>
      </section>

      <!-- C2：薄弱点诊断 -->
      <section class="ai-card">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h2 class="ai-card-title">
            <Icon name="target" :size="18" style="color: var(--kb-primary);" /> 薄弱点诊断
          </h2>
          <button class="kb-btn ai-btn" :disabled="weakLoading" @click="runDiagnose">
            <Icon :name="weakLoading ? 'loader' : 'ai-sparkle'" :size="14" :class="weakLoading ? 'ai-spin' : ''" />
            {{ weakLoading ? '诊断中…' : '开始诊断' }}
          </button>
        </div>
        <p class="ai-card-desc">读取近 60 天答错/遗忘的复习记录，归纳你常在哪类知识上翻车。</p>

        <div v-if="aiHintVisible" class="ai-hint">
          <Icon name="info" :size="14" />
          <span>尚未配置 AI 服务，<router-link to="/settings/ai">前往 AI 设置</router-link> 后即可使用。</span>
        </div>

        <div v-if="weak" class="ai-panel">
          <div class="ai-panel-head">
            <span class="ai-panel-title"><Icon name="ai-sparkle" :size="14" /> 诊断结果</span>
            <span class="ai-meta">{{ weak.model }} · {{ weak.latencyMs }}ms</span>
          </div>
          <p v-if="weak.summary" class="insight-summary">{{ weak.summary }}</p>
          <div v-if="weak.weakTopics.length">
            <p class="ai-subtitle">薄弱主题</p>
            <div class="insight-tags">
              <span v-for="(t, i) in weak.weakTopics" :key="'t' + i" class="insight-tag">{{ t }}</span>
            </div>
          </div>
          <div v-if="weak.suggestions.length">
            <p class="ai-subtitle">补救建议</p>
            <ul class="ai-list">
              <li v-for="(s, i) in weak.suggestions" :key="'s' + i">{{ s }}</li>
            </ul>
          </div>
        </div>
      </section>

      <!-- G2：智能复习推荐 -->
      <section class="ai-card">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h2 class="ai-card-title">
            <Icon name="list-ordered" :size="18" style="color: var(--kb-primary);" /> 智能复习推荐
          </h2>
          <button class="kb-btn ai-btn" :disabled="recLoading" @click="runRecommend">
            <Icon :name="recLoading ? 'loader' : 'ai-sparkle'" :size="14" :class="recLoading ? 'ai-spin' : ''" />
            {{ recLoading ? '分析中…' : '生成推荐' }}
          </button>
        </div>
        <p class="ai-card-desc">综合排程到期、易度因子与近 60 天遗忘记录，给出优先复习项与方式。</p>

        <div v-if="aiHintVisible" class="ai-hint">
          <Icon name="info" :size="14" />
          <span>尚未配置 AI 服务，<router-link to="/settings/ai">前往 AI 设置</router-link> 后即可使用。</span>
        </div>

        <div v-if="rec" class="ai-panel">
          <div class="ai-panel-head">
            <span class="ai-panel-title"><Icon name="ai-sparkle" :size="14" /> 复习建议</span>
            <span class="ai-meta">{{ rec.model }} · {{ rec.latencyMs }}ms</span>
          </div>
          <p v-if="rec.summary" class="insight-summary">{{ rec.summary }}</p>
          <div v-if="rec.priorities.length">
            <p class="ai-subtitle">优先复习</p>
            <ul class="rec-list">
              <li v-for="(p, i) in rec.priorities" :key="'p' + i">
                <p class="rec-front">{{ p.front }}</p>
                <p class="rec-reason">{{ p.reason }}</p>
                <span class="rec-method">{{ p.method }}</span>
              </li>
            </ul>
          </div>
          <div v-if="rec.suggestions.length">
            <p class="ai-subtitle">通用建议</p>
            <ul class="ai-list">
              <li v-for="(s, i) in rec.suggestions" :key="'rs' + i">{{ s }}</li>
            </ul>
          </div>
        </div>
      </section>

      <!-- G3：内容关联 / 学习路径 -->
      <section class="ai-card">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h2 class="ai-card-title">
            <Icon name="compass" :size="18" style="color: var(--kb-primary);" /> 内容关联 / 学习路径
          </h2>
          <button class="kb-btn ai-btn" :disabled="syncLoading" @click="runSync">
            <Icon :name="syncLoading ? 'loader' : 'refresh-cw'" :size="14" :class="syncLoading ? 'ai-spin' : ''" />
            {{ syncLoading ? '索引中…' : '重建向量索引' }}
          </button>
        </div>
        <p class="ai-card-desc">用本地向量把相似笔记、收集箱与故事串成学习路径，数据不出本机。</p>

        <div v-if="aiHintVisible" class="ai-hint">
          <Icon name="info" :size="14" />
          <span>尚未配置 AI 服务，<router-link to="/settings/ai">前往 AI 设置</router-link> 后即可使用。</span>
        </div>

        <div v-if="syncResult" class="ai-panel ai-panel-inline">
          <span class="ai-meta">已索引 {{ syncResult.total }} 条 · 本次新增 {{ syncResult.synced }} · 跳过 {{ syncResult.skipped }}</span>
        </div>

        <div class="assoc-box">
          <textarea v-model="assocText" class="assoc-input" rows="2" placeholder="输入一个概念或粘贴一段笔记，查找相关内容（例如：什么是闭包？）"></textarea>
          <button class="kb-btn ai-btn" :disabled="assocLoading" @click="runAssociate">
            <Icon :name="assocLoading ? 'loader' : 'link'" :size="14" :class="assocLoading ? 'ai-spin' : ''" />
            {{ assocLoading ? '检索中…' : '查找关联' }}
          </button>
        </div>

        <div v-if="assocResult" class="ai-panel">
          <div class="ai-panel-head">
            <span class="ai-panel-title"><Icon name="link" :size="14" /> 关联结果</span>
            <span class="ai-meta">{{ assocResult.model }} · {{ assocResult.latencyMs }}ms</span>
          </div>
          <ul class="assoc-list">
            <li v-for="(it, i) in assocResult.items" :key="'a' + i">
              <router-link :to="it.route" class="assoc-link">
                <span class="assoc-title">{{ it.title }}</span>
                <span class="assoc-type">{{ typeLabel(it.entityType) }}</span>
                <span class="assoc-score">{{ Math.round(it.score * 100) }}%</span>
              </router-link>
              <p v-if="it.snippet" class="assoc-snippet">{{ it.snippet }}</p>
            </li>
          </ul>
          <p v-if="!assocResult.items.length" class="ai-empty">没有找到相似内容，先点上方「重建向量索引」试试。</p>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import { notify, getApiError } from '@/utils/toast'
import {
  generateInsightReport,
  diagnoseWeakness,
  recommendReview,
  syncEmbeddings,
  associateContent,
  type InsightReportResult,
  type WeaknessResult,
  type ReviewRecommendResult,
  type SyncEmbeddingsResult,
  type AssociateResult,
} from '@/api/ai'
import './ai-shared.css'

const router = useRouter()
const reportLoading = ref(false)
const weakLoading = ref(false)
const recLoading = ref(false)
const syncLoading = ref(false)
const assocLoading = ref(false)
const aiHintVisible = ref(false)
const report = ref<InsightReportResult | null>(null)
const weak = ref<WeaknessResult | null>(null)
const rec = ref<ReviewRecommendResult | null>(null)
const syncResult = ref<SyncEmbeddingsResult | null>(null)
const assocText = ref('')
const assocResult = ref<AssociateResult | null>(null)

function handleError(e: unknown, loading: Ref<boolean>) {
  loading.value = false
  const msg = getApiError(e, 'AI 调用失败')
  if (msg.includes('AI 设置') || msg.includes('未配置') || msg.includes('已关闭')) aiHintVisible.value = true
  notify(msg, 'error')
}

function typeLabel(t: string): string {
  if (t === 'capture') return '收集箱'
  if (t === 'note') return '笔记'
  if (t === 'story') return '故事'
  return t
}

async function runReport() {
  reportLoading.value = true
  aiHintVisible.value = false
  try {
    report.value = await generateInsightReport({ days: 30 })
    notify('周报已生成', 'success')
  } catch (e) {
    handleError(e, reportLoading)
  }
}

async function runDiagnose() {
  weakLoading.value = true
  aiHintVisible.value = false
  try {
    weak.value = await diagnoseWeakness({ days: 60 })
    notify('诊断完成', 'success')
  } catch (e) {
    handleError(e, weakLoading)
  }
}

async function runRecommend() {
  recLoading.value = true
  aiHintVisible.value = false
  try {
    rec.value = await recommendReview({ limit: 20 })
    notify('推荐已生成', 'success')
  } catch (e) {
    handleError(e, recLoading)
  }
}

async function runSync() {
  syncLoading.value = true
  aiHintVisible.value = false
  try {
    syncResult.value = await syncEmbeddings({ force: false })
    notify(`索引完成：本次新增 ${syncResult.value.synced} 条`, 'success')
  } catch (e) {
    handleError(e, syncLoading)
  }
}

async function runAssociate() {
  const text = assocText.value.trim()
  if (!text) {
    notify('请先输入要查找的概念或笔记片段', 'warning')
    return
  }
  assocLoading.value = true
  aiHintVisible.value = false
  try {
    assocResult.value = await associateContent({ text, limit: 8 })
    notify('关联检索完成', 'success')
  } catch (e) {
    handleError(e, assocLoading)
  }
}
</script>

<style scoped>
.insight-summary {
  font-size: 14px;
  line-height: 1.7;
  color: var(--kb-foreground);
  margin: 4px 0 8px;
  padding: 10px 12px;
  border-radius: var(--kb-radius-sm);
  background: color-mix(in srgb, var(--kb-highlight) 8%, transparent);
}
.insight-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.insight-tag {
  padding: 3px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--kb-highlight) 12%, transparent);
  color: var(--kb-highlight);
  font-size: 12px;
  font-weight: 600;
}

/* ===== G2：优先复习清单 ===== */
.rec-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.rec-list li {
  padding-left: 12px;
  border-left: 3px solid var(--kb-highlight-border);
}
.rec-front {
  margin: 0 0 3px;
  font-size: 14px;
  font-weight: 700;
  color: var(--kb-foreground);
}
.rec-reason {
  margin: 0 0 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--kb-muted-foreground);
}
.rec-method {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--kb-highlight) 12%, transparent);
  color: var(--kb-highlight);
  font-size: 11px;
  font-weight: 600;
}

/* ===== G3：内容关联 / 向量索引 ===== */
.ai-panel-inline {
  padding: var(--kb-space-2) var(--kb-space-3);
  gap: 0;
}
.assoc-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.assoc-input {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: var(--kb-foreground);
  padding: var(--kb-space-2) var(--kb-space-3);
  border-radius: var(--kb-radius-sm);
  border: 1px solid var(--kb-border);
  background: var(--kb-background);
}
.assoc-input:focus {
  outline: none;
  border-color: var(--kb-highlight);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--kb-highlight) 22%, transparent);
}
</style>
