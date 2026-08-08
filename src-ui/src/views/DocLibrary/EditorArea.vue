<template>
  <section class="dl-col-center" aria-label="Markdown 编辑器">
    <!-- 顶部工具栏 -->
    <div class="dl-editor-toolbar">
      <span class="dl-doc-title">
        <Icon name="file-text" size="sm" style="color: var(--kb-primary);" />
        <span>{{ docState.activeNoteName || '未打开文件' }}</span>
      </span>

      <span
        v-if="docState.activeNoteId"
        class="dl-save-pill"
        :class="savePill.cls"
        :title="docState.saveMessage || undefined"
      >
        <Icon :name="savePill.icon" size="xs" :class="docState.saveStatus === 'saving' ? 'animate-spin' : ''" />
        {{ savePill.text }}
      </span>

      <span class="flex-1"></span>

      <!-- 视图模式：编辑 / 分栏 / 预览 -->
      <div class="dl-segmented" role="group" aria-label="视图模式">
        <button
          v-for="opt in MODES"
          :key="opt.value"
          type="button"
          class="dl-segment"
          :class="{ 'is-on': mode === opt.value }"
          :title="opt.label"
          :aria-pressed="mode === opt.value"
          @click="mode = opt.value"
        >
          <Icon :name="opt.icon" size="sm" />
          <span class="dl-segment-text">{{ opt.label }}</span>
        </button>
      </div>

      <span class="dl-toolbar-divider"></span>

      <button
        type="button"
        class="dl-icon-btn"
        :class="{ 'is-on': tocVisible }"
        title="显示 / 隐藏大纲"
        :aria-pressed="tocVisible"
        @click="emit('toggle-toc')"
      >
        <Icon name="list-tree" size="sm" />
      </button>
      <button
        type="button"
        class="dl-icon-btn"
        title="立即保存（⌘S）"
        :disabled="!docState.activeNoteId || docState.saveStatus === 'saving'"
        @click="flushSave()"
      >
        <Icon name="save" size="sm" />
      </button>
    </div>

    <!-- 主体 -->
    <div v-if="docState.activeNoteId" class="dl-editor-body">
      <div v-show="mode !== 'preview'" class="dl-source" :class="{ 'is-full': mode === 'source' }">
        <textarea
          ref="textareaRef"
          v-model="content"
          class="dl-textarea dl-scroll"
          spellcheck="false"
          placeholder="开始用 Markdown 记录…"
          aria-label="Markdown 源码"
          @keydown.tab.prevent="insertTab"
        ></textarea>
      </div>

      <div
        v-show="mode !== 'source'"
        ref="previewRef"
        class="dl-preview dl-scroll"
        :class="{ 'is-full': mode === 'preview' }"
        @click="onPreviewClick"
        @scroll.passive="onPreviewScroll"
      >
        <div class="dl-md" v-html="renderedHtml"></div>
      </div>
    </div>

    <!-- 未打开文件 -->
    <div v-else class="dl-editor-body">
      <div class="dl-empty">
        <span class="dl-empty-icon"><Icon name="file-text" size="2xl" /></span>
        <p class="dl-empty-title">还没有打开任何笔记</p>
        <p class="dl-empty-desc">从左侧目录树选择一个 Markdown 文件，或新建一篇笔记开始记录。</p>
      </div>
    </div>

    <!-- 底部状态栏 -->
    <div class="dl-statusbar">
      <span v-if="docState.activeNoteId">{{ stats.lines }} 行 · {{ stats.chars }} 字符 · {{ stats.words }} 词</span>
      <span v-else>就绪</span>
      <span class="flex-1"></span>
      <span v-if="docState.activeNoteId" class="dl-status-path" :title="docState.activeNoteId">
        {{ docState.activeNoteId }}
      </span>
    </div>
  </section>
</template>

<script setup lang="ts">
// 中栏：双栏 Markdown 编辑器。
// 左半为 textarea 源码区，右半为 markdown-it 实时预览；正文与全局 store 双向绑定，
// 自动保存由 store 里的 watch + 600ms 防抖统一负责，本组件不重复实现保存逻辑。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import Icon from '@/components/ui/Icon.vue'
import { notify } from '@/utils/toast'

import { assetUrl, renderMarkdown, slugify } from '@/lib/markdown'
import { docState, flushSave, openNote, resolveVaultRef } from './useDocStore'
import { findAsset, getNoteContent } from '@/api/library'

const props = defineProps<{ tocVisible: boolean }>()
const emit = defineEmits<{
  (e: 'toggle-toc'): void
  (e: 'active-anchor', anchorId: string): void
}>()

type ViewMode = 'source' | 'split' | 'preview'

const MODES: Array<{ value: ViewMode; label: string; icon: string }> = [
  { value: 'source', label: '编辑', icon: 'pen-line' },
  { value: 'split', label: '分栏', icon: 'layout' },
  { value: 'preview', label: '预览', icon: 'eye' },
]

const mode = ref<ViewMode>('split')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const previewRef = ref<HTMLElement | null>(null)

/** 正文双向绑定到全局 store（store 的 watch 负责防抖落盘） */
const content = computed({
  get: () => docState.currentContent,
  set: (val: string) => {
    docState.currentContent = val
  },
})

// ===== 预览渲染 =====

/* 渲染结果放在 ref 而非 computed：大文档里 markdown-it + highlight.js 逐键重算会掉帧，
 * 这里用 80ms 微防抖，肉眼仍是「实时」，但把连续输入合并成一次渲染。 */
const renderedHtml = ref('')
let renderTimer: number | null = null

watch(
  () => docState.currentContent,
  (val) => {
    if (renderTimer !== null) window.clearTimeout(renderTimer)
    renderTimer = window.setTimeout(() => {
      renderedHtml.value = renderMarkdown(val, { noteId: docState.activeNoteId })
      // 内容变了，重算一次当前标题，避免大纲高亮停留在旧位置；并水合嵌入块
      nextTick(() => {
        hydrateEmbeds()
        onPreviewScroll()
      })
    }, 80)
  },
  { immediate: true },
)

// 切换文件时立即重绘，不走防抖，避免看到上一篇的残影
watch(
  () => docState.activeNoteId,
  () => {
    if (renderTimer !== null) window.clearTimeout(renderTimer)
    renderedHtml.value = renderMarkdown(docState.currentContent, { noteId: docState.activeNoteId })
    nextTick(() => {
      previewRef.value?.scrollTo({ top: 0 })
      hydrateEmbeds()
      onPreviewScroll()
    })
  },
)

// ===== 状态展示 =====

const savePill = computed(() => {
  switch (docState.saveStatus) {
    case 'saving':
      return { cls: 'is-saving', icon: 'refresh-cw', text: '保存中…' }
    case 'error':
      return { cls: 'is-error', icon: 'alert-circle', text: '保存失败' }
    case 'saved':
      return docState.dirty
        ? { cls: 'is-dirty', icon: 'edit-2', text: '未保存' }
        : { cls: 'is-saved', icon: 'check', text: '已保存到磁盘' }
    default:
      return docState.dirty
        ? { cls: 'is-dirty', icon: 'edit-2', text: '未保存' }
        : { cls: '', icon: 'hard-drive', text: '本地文件' }
  }
})

const stats = computed(() => {
  const text = docState.currentContent
  return {
    lines: text ? text.split('\n').length : 0,
    chars: text.length,
    // 中文按字计、西文按空格切分，粗略但够用
    words: (text.match(/[\u4e00-\u9fa5]|[A-Za-z0-9_'-]+/g) ?? []).length,
  }
})

// ===== 编辑增强 =====

/** Tab 插入两个空格而不是跳走焦点（写嵌套列表时必须） */
function insertTab(e: KeyboardEvent) {
  const el = e.target as HTMLTextAreaElement
  const { selectionStart: start, selectionEnd: end } = el
  const next = `${content.value.slice(0, start)}  ${content.value.slice(end)}`
  content.value = next
  nextTick(() => {
    el.selectionStart = start + 2
    el.selectionEnd = start + 2
  })
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void flushSave()
  }
}

// ===== 预览区交互 =====

/** 供父组件（大纲点击）调用：平滑滚动到指定锚点 */
function scrollToAnchor(anchorId: string) {
  if (mode.value === 'source') mode.value = 'split'
  nextTick(() => {
    const root = previewRef.value
    if (!root) return
    const el = root.querySelector<HTMLElement>(`#${CSS.escape(anchorId)}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    emit('active-anchor', anchorId)
  })
}

let scrollRaf = 0
/** 滚动时回报「当前所在标题」，让右侧大纲高亮跟随 */
function onPreviewScroll() {
  if (scrollRaf) return
  scrollRaf = window.requestAnimationFrame(() => {
    scrollRaf = 0
    const root = previewRef.value
    if (!root) return
    const headings = Array.from(root.querySelectorAll<HTMLElement>('.dl-md-heading'))
    if (!headings.length) {
      emit('active-anchor', '')
      return
    }
    const rootTop = root.getBoundingClientRect().top
    let current = headings[0].id
    for (const h of headings) {
      // 阈值 28px：标题刚滚过容器顶部就算「进入」该章节
      if (h.getBoundingClientRect().top - rootTop <= 28) current = h.id
      else break
    }
    emit('active-anchor', current)
  })
}

/** 把相对链接按当前文件所在目录折算成库内 id */
function resolveRelative(baseId: string, href: string): string {
  const dir = baseId.includes('/') ? baseId.slice(0, baseId.lastIndexOf('/')) : ''
  const parts = dir ? dir.split('/') : []
  for (const seg of decodeURIComponent(href).split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

// ===================== 嵌入块水合 + 双链点击导航 =====================

/** 转义用于塞进 innerHTML 的纯文本 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 从 Markdown 中抽取某个标题（含）到下一个同级或更高级标题（不含）之间的片段 */
function extractSection(content: string, heading: string): string {
  const lines = content.split('\n')
  const target = heading.trim().toLowerCase()
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/)
    if (m && m[2].trim().toLowerCase() === target) {
      start = i
      level = m[1].length
      break
    }
  }
  if (start < 0) return content // 没找到该标题则回退为整篇
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^(#{1,6})\s+/)
    if (m && m[1].length <= level) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

/** 正在拉取中的嵌入块 key（防重复请求 / 防回环） */
const fetching = new Set<string>()

/**
 * 把预览里的 ![[笔记]] 嵌入块异步水合：拉取目标内容、按标题切片、嵌套渲染。
 * 同时把 ![[图片]] 这类只给了文件名的图片，经后端按文件名检索纠正成正确资源 URL。
 * depth 限制嵌套嵌入的递归层数，避免文档间互相嵌入造成死循环。
 */
async function hydrateEmbeds(depth = 0): Promise<void> {
  const root = previewRef.value
  if (!root) return

  // 1) 笔记嵌入块
  const embeds = Array.from(root.querySelectorAll<HTMLElement>('.dl-embed:not([data-hydrated])'))
  for (const el of embeds) {
    el.setAttribute('data-hydrated', '1')
    const name = el.dataset.embedName || ''
    const heading = el.dataset.heading || ''
    const bestId = el.dataset.embedId || ''
    const id = resolveVaultRef(name, docState.activeNoteId) || bestId || ''
    const body = el.querySelector<HTMLElement>('.dl-embed-body')
    const openBtn = el.querySelector<HTMLButtonElement>('.dl-embed-open')
    if (!id) {
      if (body) body.innerHTML = `<span class="dl-embed-missing">未找到笔记「${escapeHtml(name)}」</span>`
      if (openBtn) openBtn.remove()
      continue
    }
    if (openBtn) openBtn.dataset.id = id
    const key = `${id}#${heading}`
    if (fetching.has(key)) continue
    fetching.add(key)
    try {
      const note = await getNoteContent(id)
      let sub = note.content
      if (heading) sub = extractSection(sub, heading)
      if (body) body.innerHTML = renderMarkdown(sub, { noteId: id })
      if (depth < 2) await hydrateEmbeds(depth + 1)
    } catch {
      if (body) body.innerHTML = `<span class="dl-embed-missing">无法加载笔记「${escapeHtml(name)}」</span>`
    } finally {
      fetching.delete(key)
    }
  }

  // 2) 只给了文件名的嵌入图片：经后端按文件名检索纠正 src
  const imgs = Array.from(
    root.querySelectorAll<HTMLImageElement>('img.dl-embed-img[data-asset-name]'),
  )
  for (const img of imgs) {
    if (img.dataset.resolved === '1') continue
    img.dataset.resolved = '1'
    try {
      const { path: rel } = await findAsset(img.dataset.assetName || '')
      if (rel) img.src = assetUrl(rel)
    } catch {
      /* 检索失败保持原 src（已是按当前目录的最佳猜测） */
    }
  }
}

/** 打开双链目标笔记，并在指定标题处滚动定位 */
async function openAndScroll(id: string, heading: string): Promise<void> {
  await openNote(id)
  // openNote 会触发正文 watch（80ms 防抖）重绘；这里直接同步重绘，确保标题锚点立即可用
  renderedHtml.value = renderMarkdown(docState.currentContent, { noteId: id })
  await nextTick()
  await nextTick()
  if (heading) scrollToAnchor(slugify(heading))
  await nextTick()
  hydrateEmbeds()
}

function onPreviewClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (!target) return

  // 1) 代码块复制按钮
  const copyBtn = target.closest<HTMLElement>('[data-dl-copy]')
  if (copyBtn) {
    const code = copyBtn.closest('.code-block-wrapper')?.querySelector('code')?.textContent ?? ''
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        copyBtn.classList.add('copied')
        const label = copyBtn.querySelector('.copy-label')
        if (label) label.textContent = '已复制'
        window.setTimeout(() => {
          copyBtn.classList.remove('copied')
          if (label) label.textContent = '复制'
        }, 1600)
      })
      .catch(() => notify('复制失败，请手动选择代码', 'error'))
    return
  }

  // 2) 嵌入块的「打开原笔记」按钮
  const openBtn = target.closest<HTMLButtonElement>('.dl-embed-open')
  if (openBtn) {
    e.preventDefault()
    const id = openBtn.dataset.id
    if (id) void openAndScroll(id, '').catch((err) => console.error('[double-link] 打开嵌入块失败', err))
    return
  }

  // 3) 双链 [[笔记]]：点击跳转到对应笔记（及其标题）
  const wl = target.closest<HTMLAnchorElement>('a[data-wikilink-name]')
  if (wl) {
    e.preventDefault()
    const name = wl.dataset.wikilinkName || ''
    const heading = wl.dataset.heading || ''
    const id = resolveVaultRef(name, docState.activeNoteId) || wl.dataset.wikilinkId || ''
    if (id) void openAndScroll(id, heading).catch((err) => console.error('[double-link] 跳转失败', err))
    else notify(`未找到笔记：${name}`, 'info')
    return
  }

  // 4) 通用链接：默认跳转会把整个 SPA 导航走，一律拦下来自行处理
  const link = target.closest<HTMLAnchorElement>('a[href]')
  if (!link) return
  const href = link.getAttribute('href') ?? ''
  e.preventDefault()

  if (href.startsWith('#')) {
    scrollToAnchor(decodeURIComponent(href.slice(1)))
    return
  }
  if (/^https?:\/\//i.test(href)) {
    window.open(href, '_blank', 'noopener')
    return
  }
  if (/\.(md|markdown|mdx)$/i.test(href)) {
    // 库内笔记互链：直接在当前编辑器中打开
    void openNote(resolveRelative(docState.activeNoteId, href))
    return
  }
  notify(`暂不支持打开该链接：${href}`, 'info')
}

defineExpose({ scrollToAnchor })

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (renderTimer !== null) window.clearTimeout(renderTimer)
  if (scrollRaf) window.cancelAnimationFrame(scrollRaf)
})

// props.tocVisible 只用于按钮的按下态展示，这里显式引用避免 lint 误判为未使用
void props
</script>

<style scoped>
.dl-segmented {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--kb-radius-sm);
  background: var(--kb-muted);
}
.dl-segment {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--kb-muted-foreground);
  font-size: var(--kb-fs-caption);
  font-weight: 500;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.dl-segment:hover {
  color: var(--kb-foreground);
}
.dl-segment:focus-visible {
  outline: none;
  box-shadow: var(--kb-focus-ring);
}
.dl-segment.is-on {
  background: var(--kb-card);
  color: var(--kb-primary);
  box-shadow: var(--shadow-sm);
}
/* 窄窗口只留图标，避免工具栏换行 */
@media (max-width: 1100px) {
  .dl-segment-text {
    display: none;
  }
}

.dl-status-path {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 55%;
  direction: rtl;
  text-align: right;
}
</style>
