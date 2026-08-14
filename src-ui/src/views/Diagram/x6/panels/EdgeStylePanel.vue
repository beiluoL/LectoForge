<template>
  <div class="x6-panel" v-if="sel.hasEdge.value">
    <h4 class="x6-panel-title">样式 · 连线</h4>

    <section class="x6-field">
      <label class="x6-field-row">
        <span class="kb-label">线型</span>
        <select class="kb-input" :value="lineType" @change="(e) => setLineType((e.target as HTMLSelectElement).value as any)">
          <option value="smoothstep">平滑折线</option>
          <option value="bezier">曲线</option>
          <option value="straight">直线</option>
        </select>
      </label>
      <label class="x6-field-row">
        <span class="kb-label">线宽 {{ lineWidth }}</span>
        <input type="range" min="0.5" max="6" step="0.5" :value="lineWidth" @change="(e) => setLineWidth(Number((e.target as HTMLInputElement).value))" />
      </label>
      <label class="x6-field-row">
        <span class="kb-label">虚线</span>
        <input type="checkbox" :checked="dashed" @change="(e) => setDashed((e.target as HTMLInputElement).checked)" />
      </label>
      <label class="x6-field-row" v-if="dashed">
        <span class="kb-label">虚线样式</span>
        <input class="kb-input" type="text" :value="dashPattern" @change="(e) => setDashPattern((e.target as HTMLInputElement).value)" placeholder="6 4" />
      </label>
      <label class="x6-field-row">
        <span class="kb-label">线色</span>
        <input type="color" :value="color" @input="(e) => setColor((e.target as HTMLInputElement).value)" />
      </label>
    </section>

    <section class="x6-field">
      <label class="x6-field-row">
        <span class="kb-label">起点箭头</span>
        <select class="kb-input" :value="startArrow" @change="(e) => setArrow('start', (e.target as HTMLSelectElement).value as any)">
          <option v-for="a in ARROWS" :key="'s' + a" :value="a">{{ arrowLabel(a) }}</option>
        </select>
      </label>
      <label class="x6-field-row">
        <span class="kb-label">终点箭头</span>
        <select class="kb-input" :value="endArrow" @change="(e) => setArrow('end', (e.target as HTMLSelectElement).value as any)">
          <option v-for="a in ARROWS" :key="'e' + a" :value="a">{{ arrowLabel(a) }}</option>
        </select>
      </label>
    </section>

    <section class="x6-field">
      <label class="x6-field-row">
        <span class="kb-label">标签位置 {{ labelPos }}%</span>
        <input type="range" min="0" max="100" step="1" :value="labelPos" @change="(e) => setLabelPos(Number((e.target as HTMLInputElement).value))" />
      </label>
      <label class="x6-field-row">
        <span class="kb-label">标签文字</span>
        <input class="kb-input" type="text" :value="labelText" @change="(e) => setLabelText((e.target as HTMLInputElement).value)" />
      </label>
    </section>
  </div>
  <div class="x6-panel-empty" v-else>选中一条连线以编辑样式</div>
</template>

<script setup lang="ts">
/**
 * X6 方案 B「样式 · 连线」面板（P1-T4.4）：线型 / 线宽 / 虚线 / 起终点箭头 / 线色 / 标签位置。
 * 每个控件值变化用 graph.batchUpdate 包一层 → 仅 1 条 history。
 */
import { computed, inject, ref } from 'vue'
import { X6_CTX_KEY, type X6Context } from '../context'
import { useSelection } from '../useSelection'
import { edgeConnectorRouter, buildEdgeMarker } from '../edgeFactory'
import type { ArrowStyle } from '../types'
import type { EdgeLineType } from '../../types'

const ctx = inject(X6_CTX_KEY) as X6Context
const sel = useSelection(ctx.graph)

const ARROWS: ArrowStyle[] = ['none', 'block', 'classic', 'diamond', 'circle', 'async']
function arrowLabel(a: ArrowStyle): string {
  return { none: '无', block: '实心三角', classic: '经典', diamond: '菱形', circle: '圆点', async: '异步' }[a]
}

function firstEdge(): any {
  return sel.selectedEdges.value[0] as any
}
function applyToEdges(fn: (e: any) => void) {
  const g = ctx.graph.value
  if (!g || !sel.selectedEdges.value.length) return
  g.batchUpdate('edge-style', () => sel.selectedEdges.value.forEach((c) => fn(c)))
}

const lineType = computed<EdgeLineType>(() => (firstEdge()?.getData()?.lineType as EdgeLineType) || 'smoothstep')
const lineWidth = computed(() => Number(firstEdge()?.attr('line/strokeWidth') || 1.6))
const dashed = computed(() => !!firstEdge()?.attr('line/strokeDasharray'))
const dashPattern = ref('6 4')
const color = computed(() => (firstEdge()?.attr('line/stroke') as string) || '#475569')
const startArrow = computed<ArrowStyle>(() => arrowFromMarker(firstEdge()?.attr('line/sourceMarker')))
const endArrow = computed<ArrowStyle>(() => arrowFromMarker(firstEdge()?.attr('line/targetMarker')))
const labelPos = computed(() => Math.round((Number(firstEdge()?.prop('labels/0/position')) || 0.5) * 100))
const labelText = ref('')

function arrowFromMarker(m: unknown): ArrowStyle {
  if (!m) return 'none'
  if (typeof m === 'object' && (m as any).name) return (m as any).name as ArrowStyle
  return 'block'
}

function setLineType(t: EdgeLineType) {
  applyToEdges((e) => {
    const { connector, router } = edgeConnectorRouter(t)
    e.setConnector(connector)
    e.setRouter(router)
    const data = e.getData() || {}
    e.setData({ ...data, lineType: t })
  })
}
function setLineWidth(v: number) {
  applyToEdges((e) => e.attr('line/strokeWidth', v))
}
function setDashed(on: boolean) {
  applyToEdges((e) => e.attr('line/strokeDasharray', on ? dashPattern.value : undefined))
}
function setDashPattern(p: string) {
  dashPattern.value = p
  if (dashed.value) applyToEdges((e) => e.attr('line/strokeDasharray', p))
}
function setColor(c: string) {
  applyToEdges((e) => e.attr('line/stroke', c))
}
function setArrow(side: 'start' | 'end', style: ArrowStyle) {
  applyToEdges((e) => {
    const marker = buildEdgeMarker(style, color.value)
    e.attr(side === 'start' ? 'line/sourceMarker' : 'line/targetMarker', marker)
  })
}
function setLabelPos(p: number) {
  applyToEdges((e) => e.prop('labels/0/position', p / 100))
}
function setLabelText(text: string) {
  applyToEdges((e) => {
    const labels = e.getLabels?.() || []
    if (!labels.length) {
      e.appendLabel({ attrs: { label: { text, fill: color.value, fontSize: 12 } } })
    } else {
      e.setLabels([{ ...labels[0], attrs: { label: { text, fill: color.value, fontSize: 12 } } }])
    }
  })
}
</script>

<style scoped>
.x6-panel {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.x6-panel-empty {
  padding: 24px 12px;
  font-size: 12px;
  color: var(--kb-muted-foreground, #64748b);
  text-align: center;
}
.x6-panel-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
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
  flex: 1;
}
</style>
