<template>
  <!-- 题库管理：导入面经（Markdown / PDF）+ 从复习卡 / 笔记导入 + 列表展示。
       配色用 --kb-* token，Tailwind 仅布局；成功/失败复用全局 notify。 -->
  <div class="lf-page animate-fade-in">
    <div class="lf-backbar">
      <router-link to="/interview" class="kb-btn lf-back-btn">
        <Icon name="arrow-left" :size="'15px'" />
        返回面试
      </router-link>
      <span class="lf-bank-title">面试题库</span>
    </div>

    <!-- 导入：Markdown -->
    <section class="lf-card">
      <div class="lf-card-head">
        <Icon name="file-text" :size="'lg'" class="lf-card-icon" />
        <div>
          <h2 class="lf-card-title">粘贴面经（Markdown）</h2>
          <p class="lf-card-desc">把整理好的面试问答 Markdown 粘进来，系统会解析为题库条目。</p>
        </div>
      </div>
      <textarea
        v-model="markdown"
        class="kb-input lf-md"
        rows="6"
        placeholder="## 题目\n面试官：请介绍 TCP 三次握手\n参考答案：……"
        spellcheck="false"
      ></textarea>
      <div class="lf-actions">
        <button class="kb-btn kb-btn-primary" :disabled="busy || !markdown.trim()" @click="onImportMd">
          <Icon :name="busy ? 'loader' : 'file-plus'" :size="'15px'" :class="busy ? 'lf-spin' : ''" /> 导入 Markdown
        </button>
        <span v-if="mdResult" class="lf-test-result" :class="mdResult.ok ? 'is-ok' : 'is-fail'">
          {{ mdResult.text }}
        </span>
      </div>
    </section>

    <!-- 导入：PDF / 复习卡 / 笔记 -->
    <section class="lf-card">
      <div class="lf-card-head">
        <Icon name="folder-up" :size="'lg'" class="lf-card-icon" />
        <div>
          <h2 class="lf-card-title">批量导入</h2>
          <p class="lf-card-desc">从 PDF 文档或已有的复习卡 / 笔记一键汇入题库。</p>
        </div>
      </div>
      <div class="lf-actions">
        <button class="kb-btn" :disabled="busy" @click="onPickPdf">
          <Icon :name="busy ? 'loader' : 'file-up'" :size="'15px'" :class="busy ? 'lf-spin' : ''" /> 上传 PDF
        </button>
        <input ref="pdfInput" type="file" accept="application/pdf" class="lf-hidden" @change="onPdfChange" />
        <button class="kb-btn" :disabled="busy" @click="onImportReviewCards">
          <Icon name="layers" :size="'15px'" /> 从复习卡导入
        </button>
        <button class="kb-btn" :disabled="busy" @click="onImportNotes">
          <Icon name="notebook-pen" :size="'15px'" /> 从笔记导入
        </button>
      </div>
      <p v-if="bulkResult" class="lf-test-result" :class="bulkResult.ok ? 'is-ok' : 'is-fail'" style="margin-top:.6rem;">
        {{ bulkResult.text }}
      </p>
    </section>

    <!-- 列表 -->
    <section class="lf-card">
      <div class="lf-card-head">
        <Icon name="list" :size="'lg'" class="lf-card-icon" />
        <div>
          <h2 class="lf-card-title">题库（{{ items.length }}）</h2>
          <p class="lf-card-desc">全部面试题与参考答案，供模拟面试随机抽取。</p>
        </div>
        <button class="kb-btn kb-btn-sm" :disabled="busy" style="margin-left:auto;" @click="refresh">
          <Icon :name="busy ? 'loader' : 'refresh-cw'" :size="'sm'" :class="busy ? 'lf-spin' : ''" /> 刷新
        </button>
      </div>

      <div v-if="loading" class="lf-empty">加载中…</div>
      <div v-else-if="!items.length" class="lf-empty">题库为空，先从上方导入一些面经吧。</div>
      <ul v-else class="lf-bank-list">
        <li v-for="it in items" :key="it.id" class="lf-bank-item">
          <span class="lf-bank-q">{{ it.question }}</span>
          <span class="lf-bank-meta">
            <span v-if="it.sourceType" class="lf-tag">{{ sourceLabel(it.sourceType) }}</span>
            <span v-if="it.difficulty" class="lf-tag">{{ it.difficulty }}</span>
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
// 面试题库管理页（F）。仅前端；导入/查询均复用 api/interview.ts 封装，走现有 axios 助手。
import { onMounted, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { notify, getApiError } from '@/utils/toast'
import {
  importQaBankMarkdown,
  importQaBankPdf,
  importFromReviewCards,
  importFromNotes,
  listQaBanks,
  type QaBankItem,
} from '@/api/interview'

const markdown = ref('')
const items = ref<QaBankItem[]>([])
const loading = ref(false)
const busy = ref(false)
const pdfInput = ref<HTMLInputElement | null>(null)

const mdResult = ref<{ ok: boolean; text: string } | null>(null)
const bulkResult = ref<{ ok: boolean; text: string } | null>(null)

function sourceLabel(s: string): string {
  if (s === 'review_card') return '复习卡'
  if (s === 'note') return '笔记'
  return '导入'
}

async function refresh() {
  loading.value = true
  try {
    items.value = await listQaBanks()
  } catch (e) {
    notify(getApiError(e, '读取题库失败'), 'error')
  } finally {
    loading.value = false
  }
}

async function onImportMd() {
  if (busy.value || !markdown.value.trim()) return
  busy.value = true
  mdResult.value = null
  try {
    const r = await importQaBankMarkdown(markdown.value)
    const n = r.imported ?? r.count ?? 0
    mdResult.value = { ok: true, text: `已导入 ${n} 条` }
    markdown.value = ''
    notify(`已导入 ${n} 条面经`, 'success')
    await refresh()
  } catch (e) {
    mdResult.value = { ok: false, text: getApiError(e, '导入失败') }
  } finally {
    busy.value = false
  }
}

function onPickPdf() {
  pdfInput.value?.click()
}

async function onPdfChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  busy.value = true
  bulkResult.value = null
  try {
    const r = await importQaBankPdf(file, file.name)
    const n = r.imported ?? r.count ?? 0
    bulkResult.value = { ok: true, text: `PDF 已导入 ${n} 条` }
    notify(`PDF 已导入 ${n} 条`, 'success')
    await refresh()
  } catch (err) {
    bulkResult.value = { ok: false, text: getApiError(err, 'PDF 导入失败') }
  } finally {
    busy.value = false
    if (pdfInput.value) pdfInput.value.value = ''
  }
}

async function onImportReviewCards() {
  if (busy.value) return
  busy.value = true
  bulkResult.value = null
  try {
    const r = await importFromReviewCards()
    const n = r.imported ?? r.count ?? 0
    bulkResult.value = { ok: true, text: `从复习卡导入 ${n} 条` }
    notify(`从复习卡导入 ${n} 条`, 'success')
    await refresh()
  } catch (err) {
    bulkResult.value = { ok: false, text: getApiError(err, '导入失败') }
  } finally {
    busy.value = false
  }
}

async function onImportNotes() {
  if (busy.value) return
  busy.value = true
  bulkResult.value = null
  try {
    const r = await importFromNotes()
    const n = r.imported ?? r.count ?? 0
    bulkResult.value = { ok: true, text: `从笔记导入 ${n} 条` }
    notify(`从笔记导入 ${n} 条`, 'success')
    await refresh()
  } catch (err) {
    bulkResult.value = { ok: false, text: getApiError(err, '导入失败') }
  } finally {
    busy.value = false
  }
}

onMounted(refresh)
</script>

<style scoped>
/* 本页沿用设置页同款 .lf-* 视觉（与 --kb-* token 一致）；因 scoped 样式不跨组件，这里本地定义一份基础块 */
.lf-page { max-width: 56rem; margin: 0 auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; }
.lf-backbar {
  display: flex;
  align-items: center;
  margin: -1.5rem -1.5rem 0;
  padding: .625rem 1.5rem;
  border-bottom: 1px solid var(--kb-border);
  background: color-mix(in srgb, var(--kb-background) 82%, transparent);
}
.lf-back-btn { display: inline-flex; align-items: center; gap: .375rem; font-weight: 600; }
.lf-back-btn:hover { color: var(--kb-primary); border-color: var(--kb-primary); }

.lf-card {
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-lg);
  padding: 1.25rem 1.375rem;
  box-shadow: var(--shadow-card, 0 1px 2px rgba(0,0,0,.04));
}
.lf-card-head { display: flex; align-items: flex-start; gap: .625rem; margin-bottom: .75rem; }
.lf-card-icon { color: var(--kb-primary); margin-top: 2px; flex-shrink: 0; }
.lf-card-title { font-size: var(--kb-fs-h4); font-weight: 600; color: var(--kb-foreground); margin: 0; }
.lf-card-desc { font-size: var(--kb-fs-body-sm); color: var(--kb-muted-foreground); margin: .125rem 0 0; line-height: 1.5; }

.lf-actions { display: flex; align-items: center; gap: .625rem; margin-top: .75rem; flex-wrap: wrap; }
.lf-test-result { display: inline-flex; align-items: center; gap: .35rem; font-size: var(--kb-fs-caption); }
.lf-test-result.is-ok { color: var(--kb-accent); }
.lf-test-result.is-fail { color: var(--kb-destructive); }

.lf-bank-title {
  margin-left: 1rem;
  font-weight: 600;
  color: var(--kb-foreground);
}
.lf-md { width: 100%; resize: vertical; font-family: var(--font-mono); font-size: var(--kb-fs-body-sm); }
.lf-hidden { display: none; }
.lf-empty { color: var(--kb-muted-foreground); font-size: var(--kb-fs-body-sm); padding: .5rem 0; }
.lf-bank-list { list-style: none; margin: .5rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; max-height: 22rem; overflow-y: auto; }
.lf-bank-item {
  display: flex;
  align-items: center;
  gap: .75rem;
  padding: .55rem .75rem;
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
}
.lf-bank-q { flex: 1; min-width: 0; font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); }
.lf-bank-meta { display: inline-flex; gap: .35rem; flex-shrink: 0; }
.lf-tag {
  font-size: var(--kb-fs-caption);
  padding: .1rem .45rem;
  border-radius: 999px;
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
  white-space: nowrap;
}
.lf-spin { animation: lf-rotate .9s linear infinite; }
@keyframes lf-rotate { to { transform: rotate(360deg); } }
</style>
