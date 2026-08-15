<template>
  <div class="x6-panel" v-if="sel.hasNode.value">
    <h4 class="x6-panel-title">样式 · 节点</h4>

    <!-- 富文本 -->
    <!-- 图片（仅图片节点，P2-T5.1） -->
    <section class="x6-field" v-if="isImageNode">
      <span class="kb-label">图片</span>
      <div class="x6-img-preview" v-if="imageUrl">
        <img :src="imageUrl" alt="预览" />
      </div>
      <p class="x6-img-empty" v-else>尚未设置图片</p>
      <div class="x6-img-actions">
        <button class="kb-btn kb-btn-sm" @click="imgInput?.click()">更换图片</button>
        <button class="kb-btn kb-btn-sm" v-if="imageUrl" @click="clearImage">清除</button>
      </div>
      <input ref="imgInput" type="file" accept="image/*" style="display: none" @change="onImgFile" />
    </section>

    <!-- 链接 / 提示（P2-T5.2） -->
    <LinkTooltipPanel kind="node" />

    <section class="x6-field">
      <span class="kb-label">文字</span>
      <div class="x6-richbar">
        <select class="kb-input" :value="fontFamily" @change="(e) => setLabel('fontFamily', (e.target as HTMLSelectElement).value)">
          <option value="system-ui, sans-serif">系统默认</option>
          <option value="'PingFang SC', sans-serif">苹方</option>
          <option value="'Microsoft YaHei', sans-serif">微软雅黑</option>
          <option value="serif">宋体</option>
          <option value="monospace">等宽</option>
        </select>
        <input class="kb-input x6-fs" type="number" :value="fontSize" min="8" max="72" @change="(e) => setLabel('fontSize', Number((e.target as HTMLInputElement).value))" />
        <button class="x6-rich-btn" :class="{ on: boldOn }" @click="toggleBold">B</button>
        <button class="x6-rich-btn" :class="{ on: italicOn }" @click="toggleItalic"><i>I</i></button>
        <button class="x6-rich-btn" :class="{ on: underlineOn }" @click="toggleUnderline"><u>U</u></button>
        <button class="x6-rich-btn" :class="{ on: align === 'left' }" @click="setAlign('left')">⬅</button>
        <button class="x6-rich-btn" :class="{ on: align === 'center' }" @click="setAlign('center')">⬌</button>
        <button class="x6-rich-btn" :class="{ on: align === 'right' }" @click="setAlign('right')">➡</button>
      </div>
      <label class="x6-field-row">
        <span class="kb-label">文字颜色</span>
        <input type="color" :value="textColor" @input="(e) => setLabel('fill', (e.target as HTMLInputElement).value)" />
      </label>
    </section>

    <!-- 填充 / 描边 -->
    <section class="x6-field">
      <label class="x6-field-row">
        <span class="kb-label">填充色</span>
        <input type="color" :value="fill" @input="(e) => setBody('fill', (e.target as HTMLInputElement).value)" />
      </label>
      <label class="x6-field-row">
        <span class="kb-label">描边色</span>
        <input type="color" :value="stroke" @input="(e) => setBody('stroke', (e.target as HTMLInputElement).value)" />
      </label>
      <label class="x6-field-row">
        <span class="kb-label">描边宽 {{ strokeWidth }}</span>
        <input type="range" min="0" max="8" step="0.5" :value="strokeWidth" @change="(e) => setBody('strokeWidth', Number((e.target as HTMLInputElement).value))" />
      </label>
      <label class="x6-field-row">
        <span class="kb-label">圆角 {{ radius }}</span>
        <input type="range" min="0" max="40" step="1" :value="radius" @change="(e) => setRadius(Number((e.target as HTMLInputElement).value))" />
      </label>
    </section>

    <!-- 旋转 / 阴影 -->
    <section class="x6-field">
      <label class="x6-field-row">
        <span class="kb-label">旋转 {{ rotation }}°</span>
        <input type="range" min="0" max="360" step="1" :value="rotation" @change="(e) => setRotation(Number((e.target as HTMLInputElement).value))" />
      </label>
      <label class="x6-field-row">
        <span class="kb-label">阴影</span>
        <input type="checkbox" v-model="shadowOn" @change="toggleShadow" />
      </label>
    </section>

    <!-- 渐变 -->
    <section class="x6-field">
      <span class="kb-label">渐变</span>
      <div class="x6-richbar">
        <select class="kb-input" v-model="gradientType" @change="applyGradient">
          <option value="none">无</option>
          <option value="linear">线性</option>
          <option value="radial">径向</option>
        </select>
        <input type="color" :value="gradientFrom" :disabled="gradientType === 'none'" @input="(e) => { gradientFrom = (e.target as HTMLInputElement).value; applyGradient() }" />
        <input type="color" :value="gradientTo" :disabled="gradientType === 'none'" @input="(e) => { gradientTo = (e.target as HTMLInputElement).value; applyGradient() }" />
      </div>
    </section>

    <!-- 草图风格（rough.js 接入延后，先存标志 + 圆角连线） -->
    <section class="x6-field">
      <label class="x6-field-row">
        <span class="kb-label">手绘风格</span>
        <input type="checkbox" v-model="sketchOn" @change="toggleSketch" />
      </label>
      <label class="x6-field-row" v-if="sketchOn">
        <span class="kb-label">粗糙度 {{ roughness }}</span>
        <input type="range" min="0" max="3" step="0.1" :value="roughness" :disabled="!sketchOn" @change="(e) => { roughness = Number((e.target as HTMLInputElement).value); toggleSketch() }" />
      </label>
      <button class="kb-btn kb-btn-sm" @click="resetNode">重置样式</button>
    </section>
  </div>
  <div class="x6-panel-empty" v-else>选中一个节点以编辑样式</div>
</template>

<script setup lang="ts">
/**
 * X6 方案 B「样式 · 节点」面板（P1-T4.3）：富文本 + 填充/描边/圆角/旋转/阴影/渐变/草图。
 * 每个控件值变化用 graph.batchUpdate 包一层 → 仅产生 1 条 history（滑块用 @change 提交）。
 */
import { computed, inject, ref } from 'vue'
import { X6_CTX_KEY, type X6Context } from '../context'
import { useSelection } from '../useSelection'
import { notify } from '@/utils/toast'
import LinkTooltipPanel from './LinkTooltipPanel.vue'

const ctx = inject(X6_CTX_KEY) as X6Context
const sel = useSelection(ctx.graph)

function firstNode(): any {
  return sel.selectedNodes.value[0] as any
}

// ===== 图片节点（P2-T5.1）：预览 / 更换 / 清除 =====
const imgInput = ref<HTMLInputElement | null>(null)
const isImageNode = computed(() => firstNode()?.shape === 'diagram-image')
const imageUrl = computed(() => (firstNode()?.getData()?.imageUrl as string) || '')

function onImgFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => setImage(reader.result as string)
  reader.onerror = () => notify('图片读取失败', 'error')
  reader.readAsDataURL(file)
}

function setImage(url: string) {
  applyToNodes((n) => {
    n.setData({ ...(n.getData() || {}), imageUrl: url })
    n.attr('image/xlink:href', url)
  })
}

function clearImage() {
  applyToNodes((n) => {
    const d = { ...(n.getData() || {}) }
    delete d.imageUrl
    n.setData(d)
    n.attr('image/xlink:href', '')
  })
}
function applyToNodes(fn: (n: any) => void) {
  const g = ctx.graph.value
  if (!g || !sel.selectedNodes.value.length) return
  g.batchUpdate('node-style', () => sel.selectedNodes.value.forEach((c) => fn(c)))
}

// ===== 派生当前值（仅取首个选中节点用于控件回显） =====
const fontFamily = computed(() => (firstNode()?.attr('label/fontFamily') as string) || 'system-ui, sans-serif')
const fontSize = computed(() => Number(firstNode()?.attr('label/fontSize') || 13))
const textColor = computed(() => (firstNode()?.attr('label/fill') as string) || '#0F172A')
const fill = computed(() => (firstNode()?.attr('body/fill') as string) || '#FFFFFF')
const stroke = computed(() => (firstNode()?.attr('body/stroke') as string) || '#475569')
const strokeWidth = computed(() => Number(firstNode()?.attr('body/strokeWidth') || 1.5))
const radius = computed(() => Number(firstNode()?.attr('body/rx') || 2))
const rotation = computed(() => Number(firstNode()?.rotation?.() || 0))
const boldOn = ref(false)
const italicOn = ref(false)
const underlineOn = ref(false)
const align = ref<'left' | 'center' | 'right'>('center')
const shadowOn = ref(false)
const gradientType = ref<'none' | 'linear' | 'radial'>('none')
const gradientFrom = ref('#3b6fe0')
const gradientTo = ref('#ec4899')
const sketchOn = ref(false)
const roughness = ref(1)

function setLabel(key: string, value: unknown) {
  applyToNodes((n) => n.attr(`label/${key}`, value))
}
function setBody(key: string, value: unknown) {
  applyToNodes((n) => n.attr(`body/${key}`, value))
}
function toggleBold() {
  boldOn.value = !boldOn.value
  setLabel('fontWeight', boldOn.value ? 'bold' : 'normal')
}
function toggleItalic() {
  italicOn.value = !italicOn.value
  setLabel('fontStyle', italicOn.value ? 'italic' : 'normal')
}
function toggleUnderline() {
  underlineOn.value = !underlineOn.value
  setLabel('textDecoration', underlineOn.value ? 'underline' : 'none')
}
function setAlign(a: 'left' | 'center' | 'right') {
  align.value = a
  applyToNodes((n) => {
    if (a === 'left') {
      n.attr('label/textAnchor', 'start')
      n.attr('label/refX', 8)
    } else if (a === 'right') {
      n.attr('label/textAnchor', 'end')
      n.attr('label/refX', '92%')
    } else {
      n.attr('label/textAnchor', 'middle')
      n.attr('label/refX', '50%')
    }
  })
}
function setRadius(v: number) {
  applyToNodes((n) => {
    n.attr('body/rx', v)
    n.attr('body/ry', v)
  })
}
function setRotation(v: number) {
  applyToNodes((n) => n.rotate(v, { absolute: true }))
}
function toggleShadow() {
  applyToNodes((n) =>
    n.attr(
      'body/filter',
      shadowOn.value ? { name: 'dropShadow', args: { dx: 2, dy: 2, blur: 6, color: '#00000033' } } : null,
    ),
  )
}
function applyGradient() {
  if (gradientType.value === 'none') {
    setBody('fill', fill.value)
    return
  }
  applyToNodes((n) =>
    n.attr('body/fill', {
      type: gradientType.value === 'radial' ? 'radialGradient' : 'linearGradient',
      stops: [
        { offset: '0%', color: gradientFrom.value },
        { offset: '100%', color: gradientTo.value },
      ],
      attrs: gradientType.value === 'radial' ? { cx: 0.5, cy: 0.5, r: 0.5 } : { x1: 0, y1: 0, x2: 1, y2: 0 },
    }),
  )
}
function toggleSketch() {
  applyToNodes((n) => {
    const data = n.getData() || {}
    n.setData({ ...data, sketch: sketchOn.value ? roughness.value : undefined })
    n.attr('body/strokeLinejoin', sketchOn.value ? 'round' : 'miter')
    n.attr('body/strokeLinecap', sketchOn.value ? 'round' : 'butt')
  })
}
function resetNode() {
  applyToNodes((n) => {
    n.attr('body/fill', '#FFFFFF')
    n.attr('body/stroke', '#475569')
    n.attr('body/strokeWidth', 1.5)
    n.attr('body/rx', 2)
    n.attr('body/ry', 2)
    n.attr('body/filter', null)
    n.attr('label/fontWeight', 'normal')
    n.attr('label/fontStyle', 'normal')
    n.attr('label/textDecoration', 'none')
    n.rotate(0, { absolute: true })
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
.x6-richbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.x6-richbar .kb-input {
  height: 28px;
}
.x6-fs {
  width: 56px;
}
.x6-rich-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--kb-border, #cbd5e1);
  border-radius: 6px;
  background: var(--kb-card, #fff);
  cursor: pointer;
  font-size: 13px;
}
.x6-rich-btn.on {
  border-color: var(--kb-primary, #3b6fe0);
  background: color-mix(in srgb, var(--kb-primary, #3b6fe0) 14%, transparent);
}
.x6-img-preview {
  width: 100%;
  max-height: 140px;
  border: 1px solid var(--kb-border, #e2e8f0);
  border-radius: 6px;
  overflow: hidden;
  background: var(--kb-muted, #f1f5f9);
  display: flex;
  align-items: center;
  justify-content: center;
}
.x6-img-preview img {
  max-width: 100%;
  max-height: 138px;
  object-fit: contain;
}
.x6-img-empty {
  font-size: 12px;
  color: var(--kb-muted-foreground, #64748b);
  margin: 0;
}
.x6-img-actions {
  display: flex;
  gap: 8px;
}
</style>
