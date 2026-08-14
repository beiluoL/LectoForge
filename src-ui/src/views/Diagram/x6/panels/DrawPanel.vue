<template>
  <div class="x6-panel">
    <h4 class="x6-panel-title">绘图</h4>

    <!-- 网格 -->
    <section class="x6-field">
      <label class="x6-field-row">
        <span class="kb-label">显示网格</span>
        <input type="checkbox" v-model="gridOn" @change="applyGrid" />
      </label>
      <label class="x6-field-row">
        <span class="kb-label">网格颜色</span>
        <input type="color" :value="gridColor" :disabled="!gridOn" @input="(e) => { gridColor = (e.target as HTMLInputElement).value; applyGrid() }" />
      </label>
      <label class="x6-field-row">
        <span class="kb-label">网格尺寸</span>
        <select class="kb-input" :value="gridSize" :disabled="!gridOn" @change="(e) => { gridSize = Number((e.target as HTMLSelectElement).value); applyGrid() }">
          <option :value="8">8 px</option>
          <option :value="16">16 px</option>
          <option :value="24">24 px</option>
        </select>
      </label>
    </section>

    <!-- 页面 -->
    <section class="x6-field">
      <label class="x6-field-row">
        <span class="kb-label">显示页面边框</span>
        <input type="checkbox" v-model="pageOn" @change="applyPage" />
      </label>
      <label class="x6-field-row">
        <span class="kb-label">页面尺寸</span>
        <select class="kb-input" :value="pageSize" :disabled="!pageOn" @change="(e) => { pageSize = (e.target as HTMLSelectElement).value; applyPage() }">
          <option v-for="(v, k) in PAGE_SIZES" :key="k" :value="k">{{ k }}</option>
        </select>
      </label>
      <div class="x6-field-row">
        <span class="kb-label">方向</span>
        <label class="x6-radio"><input type="radio" value="portrait" v-model="orientation" :disabled="!pageOn" @change="applyPage" /> 竖向</label>
        <label class="x6-radio"><input type="radio" value="landscape" v-model="orientation" :disabled="!pageOn" @change="applyPage" /> 横向</label>
      </div>
    </section>

    <!-- 背景 -->
    <section class="x6-field">
      <label class="x6-field-row">
        <span class="kb-label">画布背景</span>
        <input type="color" :value="bgColor" @input="(e) => { bgColor = (e.target as HTMLInputElement).value; ctx.canvasBg.value = bgColor }" />
      </label>
    </section>

    <!-- 连接 / 参考线 -->
    <section class="x6-field">
      <label class="x6-field-row">
        <span class="kb-label">显示连接点</span>
        <input type="checkbox" v-model="portsOn" @change="applyPorts" />
      </label>
      <label class="x6-field-row">
        <span class="kb-label">参考线吸附</span>
        <input type="checkbox" v-model="snaplineOn" @change="applySnapline" />
      </label>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * X6 方案 B「绘图」标签页（P1-T4.2）：网格 / 页面 / 背景 / 连接点 / 参考线等全局画布设置。
 * 所有设置直接作用于 graph，不碰 Pinia。
 */
import { inject, ref } from 'vue'
import { X6_CTX_KEY, type X6Context } from '../context'

const ctx = inject(X6_CTX_KEY) as X6Context

// 页面尺寸（px @ 96dpi）
const PAGE_SIZES: Record<string, { w: number; h: number }> = {
  A3: { w: 1123, h: 1587 },
  A4: { w: 794, h: 1123 },
  A5: { w: 559, h: 794 },
  A6: { w: 420, h: 559 },
  '16:9': { w: 1280, h: 720 },
  '16:10': { w: 1280, h: 800 },
  '4:3': { w: 1024, h: 768 },
  Letter: { w: 816, h: 1056 },
  Legal: { w: 816, h: 1344 },
  Tabloid: { w: 1056, h: 1632 },
}

const gridOn = ref(true)
const gridColor = ref('#e2e8f0')
const gridSize = ref(8)
const pageOn = ref(false)
const pageSize = ref('A4')
const orientation = ref<'portrait' | 'landscape'>('portrait')
const bgColor = ref('#f8fafc')
const portsOn = ref(true)
const snaplineOn = ref(true)

function applyGrid() {
  const g = ctx.graph.value
  if (!g) return
  if (gridOn.value) {
    g.drawGrid({ type: 'mesh', args: { color: gridColor.value, thickness: 1 } })
    g.showGrid()
  } else {
    g.hideGrid()
  }
}

function removePageNode() {
  const g = ctx.graph.value
  if (!g) return
  g.getNodes()
    .filter((n: any) => n.getData()?.isPage)
    .forEach((n: any) => g.removeNode(n))
}

function applyPage() {
  const g = ctx.graph.value
  if (!g) return
  removePageNode()
  if (!pageOn.value) return
  const base = PAGE_SIZES[pageSize.value] || PAGE_SIZES.A4
  const w = orientation.value === 'landscape' ? base.h : base.w
  const h = orientation.value === 'landscape' ? base.w : base.h
  const page = g.addNode({
    shape: 'diagram-page',
    x: 0,
    y: 0,
    width: w,
    height: h,
    zIndex: -1,
    attrs: { body: { fill: '#FFFFFF', stroke: '#cbd5e1', strokeWidth: 1 } },
    data: { isPage: true },
  })
  page.setData({ isPage: true })
  g.cleanSelection()
}

function applyPorts() {
  const g = ctx.graph.value
  if (!g) return
  g.getNodes().forEach((n: any) => {
    n.getPorts().forEach((p: any) => n.setPortProp(p.id, 'attrs/circle/magnet', portsOn.value))
  })
}

function applySnapline() {
  const g = ctx.graph.value as any
  if (!g) return
  if (snaplineOn.value) g.enableSnapline?.()
  else g.disableSnapline?.()
}
</script>

<style scoped>
.x6-panel {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.x6-panel-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  color: var(--kb-foreground, #0f172a);
}
.x6-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--kb-border, #e2e8f0);
}
.x6-field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.x6-field-row .kb-input {
  height: 28px;
}
.x6-radio {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
</style>
