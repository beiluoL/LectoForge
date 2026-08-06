<template>
  <div class="mm-mindmap">
    <div class="mm-canvas-bar">
      <span class="mm-canvas-title">
        <Icon name="git-branch" size="sm" style="color: var(--kb-primary);" />
        {{ mapState.title || '未命名导图' }}
      </span>
      <span class="mm-canvas-meta">{{ outlineStats.count }} 节点 · {{ outlineStats.maxDepth }} 层</span>
      <span class="flex-1" />

      <label class="mm-switch" :title="autoSync ? '大纲改动即时反映到导图' : '手动点击刷新才更新'">
        <input v-model="autoSync" type="checkbox" />
        <span>自动同步</span>
      </label>
      <button type="button" class="kb-btn kb-btn-sm" :disabled="autoSync" @click="render(true)">
        <Icon name="refresh-cw" size="xs" /> 刷新导图
      </button>

      <span class="mm-bar-sep" />
      <button type="button" class="mm-icon-btn" title="放大" @click="zoom(1.25)">
        <Icon name="zoom-in" size="sm" />
      </button>
      <button type="button" class="mm-icon-btn" title="缩小" @click="zoom(0.8)">
        <Icon name="zoom-out" size="sm" />
      </button>
      <button type="button" class="mm-icon-btn" title="适应画布" @click="fit">
        <Icon name="maximize" size="sm" />
      </button>
      <span class="mm-bar-sep" />
      <button type="button" class="mm-icon-btn" title="展开全部" @click="setExpandLevel(-1)">
        <Icon name="list-tree" size="sm" />
      </button>
      <button type="button" class="mm-icon-btn" title="只看前两层" @click="setExpandLevel(2)">
        <Icon name="layers" size="sm" />
      </button>
      <button type="button" class="mm-icon-btn" title="导出 SVG" @click="exportSvg">
        <Icon name="download" size="sm" />
      </button>
    </div>

    <div ref="wrapRef" class="mm-canvas">
      <svg ref="svgRef" class="mm-canvas-svg" />
      <p v-if="!outlineStats.count" class="mm-canvas-empty">
        大纲还是空的，先去「大纲」视图写几行
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * OutlineToMindmap：把 outlineData 渲染成 markmap SVG 导图
 *
 * 【数据转换链路】
 * outlineData(JSON 树) --outlineToMarkdown--> Markdown --Transformer.transform--> markmap 节点树 --setData--> SVG
 *
 * 中间为什么要绕一趟 Markdown？因为 markmap-lib 的 Transformer 顺带把节点文本按 Markdown 行内
 * 语法解析了，用户在大纲里写 **重点**、`代码`、[链接](url) 都能在导图里正确呈现。
 * 直接手工拼 IPureNode 虽然少一次解析，但会丢掉这份表现力。
 *
 * 【主题跟随】
 * 节点文字颜色不写死，而是通过 markmap 的 style 选项注入 CSS 变量（var(--kb-foreground)）。
 * SVG 是内联在文档里的，变量沿 :root 继承，深浅色切换时浏览器自动重算，不需要重建实例。
 * 连线用固定品牌色板按层取色——这是导图的视觉语义，不随主题变。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { Transformer } from 'markmap-lib'
import { Markmap } from 'markmap-view'

import Icon from '@/components/ui/Icon.vue'
import { notify } from '@/utils/toast'

import { mapState, outlineStats, outlineToMarkdown } from '../useMindMapStore'

const svgRef = ref<SVGSVGElement | null>(null)
const wrapRef = ref<HTMLElement | null>(null)
const autoSync = ref(true)

const transformer = new Transformer()
let mm: Markmap | null = null
/** 手动刷新模式下攒着的改动，切回自动同步时补渲染一次 */
let pendingDirty = false
let renderTimer: number | null = null

/** 连线配色：按深度循环取用，与项目各模块的品牌语义色同源 */
const LINK_PALETTE = ['#3B6FE0', '#FF6B35', '#10B981', '#8B5CF6', '#F59E0B', '#EC4899']

function buildOptions(initialExpandLevel = -1) {
  return {
    autoFit: false,
    duration: 240,
    initialExpandLevel,
    maxWidth: 260,
    spacingHorizontal: 72,
    spacingVertical: 10,
    paddingX: 14,
    nodeMinHeight: 18,
    color: (node: any) => LINK_PALETTE[(node?.state?.depth ?? 0) % LINK_PALETTE.length],
    // markmap 会把这段 CSS 注入到 SVG 内的 <style>，${id} 是它给本实例生成的作用域选择器
    style: (id: string) => `
      ${id} { font-family: var(--font-sans); }
      ${id} .markmap-foreign { font-size: 13px; line-height: 1.5; color: var(--kb-foreground); }
      ${id} .markmap-foreign code {
        padding: 1px 4px; border-radius: 4px;
        background: var(--kb-muted); font-family: var(--font-mono); font-size: 12px;
      }
      ${id} .markmap-foreign a { color: var(--kb-primary); }
      ${id} circle { cursor: pointer; }
    `,
  }
}

/** 渲染一次；fitView=true 时顺带把视图缩放到刚好装下整棵树 */
async function render(fitView = false, expandLevel?: number) {
  if (!mm) return
  const markdown = outlineToMarkdown()
  const { root } = transformer.transform(markdown)
  if (expandLevel !== undefined) mm.setOptions(buildOptions(expandLevel))
  await mm.setData(root)
  if (fitView) await mm.fit()
  pendingDirty = false
}

/** 防抖渲染：连续敲字时不必每个字符都重排整棵树 */
function scheduleRender() {
  if (renderTimer !== null) window.clearTimeout(renderTimer)
  renderTimer = window.setTimeout(() => {
    void render(false)
  }, 260)
}

function fit() {
  void mm?.fit()
}

function zoom(scale: number) {
  void mm?.rescale(scale)
}

function setExpandLevel(level: number) {
  void render(true, level)
}

/**
 * 导出 SVG：克隆一份并把 CSS 变量替换成当前主题下的实际色值。
 * 不替换的话，导出的文件脱离页面后变量无处解析，文字会变成黑色（深色主题下等于隐形）。
 */
function exportSvg() {
  const svg = svgRef.value
  if (!svg || !outlineStats.value.count) return
  const cs = getComputedStyle(document.documentElement)
  const clone = svg.cloneNode(true) as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  clone.setAttribute('width', String(Math.round(rect.width)))
  clone.setAttribute('height', String(Math.round(rect.height)))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  let markup = new XMLSerializer().serializeToString(clone)
  markup = markup.replace(/var\((--[a-z-]+)\)/g, (_m, name: string) => {
    const val = cs.getPropertyValue(name).trim()
    return val || 'currentColor'
  })
  const bg = cs.getPropertyValue('--kb-card').trim() || '#ffffff'
  markup = markup.replace('<svg', `<svg style="background:${bg}"`)

  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${mapState.title || '思维导图'}.svg`
  a.click()
  URL.revokeObjectURL(url)
  notify('已导出 SVG', 'success')
}

// 大纲/标题变化 → 重渲染（自动同步关闭时先记账）
watch(
  () => [mapState.outlineData, mapState.title],
  () => {
    if (!autoSync.value) {
      pendingDirty = true
      return
    }
    scheduleRender()
  },
  { deep: true },
)

watch(autoSync, (on) => {
  if (on && pendingDirty) void render(false)
})

onMounted(async () => {
  if (!svgRef.value) return
  mm = Markmap.create(svgRef.value, buildOptions())
  await render(true)
})

onBeforeUnmount(() => {
  if (renderTimer !== null) window.clearTimeout(renderTimer)
  mm?.destroy()
  mm = null
})

defineExpose({ fit, render })
</script>
