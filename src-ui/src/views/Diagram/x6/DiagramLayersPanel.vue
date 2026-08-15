<template>
  <div class="x6-layers">
    <div class="x6-layers-head">
      <span>图层</span>
      <button class="x6-layers-add" title="新建图层" @click="addLayer">＋</button>
    </div>
    <ul class="x6-layers-list">
      <li v-for="(l, i) in layers" :key="l.id" class="x6-layers-item">
        <button class="x6-ly-eye" :class="{ off: !l.visible }" @click="toggleVisible(l)" :title="l.visible ? '隐藏' : '显示'">
          {{ l.visible ? '👁' : '🚫' }}
        </button>
        <button class="x6-ly-lock" :class="{ on: l.locked }" @click="toggleLock(l)" :title="l.locked ? '解锁' : '锁定'">
          {{ l.locked ? '🔒' : '🔓' }}
        </button>
        <span class="x6-ly-name" @dblclick="rename(l)" @click="assignSelected(l)">{{ l.name }}</span>
        <span class="x6-ly-ops">
          <button :disabled="i === 0" @click="move(i, -1)" title="上移">▲</button>
          <button :disabled="i === layers.length - 1" @click="move(i, 1)" title="下移">▼</button>
          <button v-if="l.id !== 'default'" @click="delLayer(l)" title="删除">✕</button>
        </span>
      </li>
    </ul>
    <p class="x6-layers-hint">单击图层名：把选中元素移入该层</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 图层面板（P2-T2.4）。每节点/边 data.layerId 归属图层；支持显隐 / 锁定 / 拖拽排序 / 新建 / 重命名 / 删除 / 指派选中。
 * 锁定时取消 body/line 的 pointerEvents 使其不可点选；排序时整层 zIndex 统一。
 */
import { ref, inject, onMounted, watch } from 'vue'
import { X6_CTX_KEY, type X6Context } from './context'

const ctx = inject(X6_CTX_KEY) as X6Context

interface Layer {
  id: string
  name: string
  visible: boolean
  locked: boolean
}

const layers = ref<Layer[]>([{ id: 'default', name: '默认图层', visible: true, locked: false }])
let seq = 1

function cellsOfLayer(id: string) {
  const g = ctx.graph.value
  if (!g) return []
  return g.getCells().filter((c: any) => (c.getData()?.layerId || 'default') === id)
}

function applyZ() {
  layers.value.forEach((l, i) => cellsOfLayer(l.id).forEach((c: any) => c.setZIndex(i)))
}

function toggleVisible(l: Layer) {
  l.visible = !l.visible
  cellsOfLayer(l.id).forEach((c: any) => c.setVisible(l.visible))
}

function toggleLock(l: Layer) {
  l.locked = !l.locked
  cellsOfLayer(l.id).forEach((c: any) => {
    const sel = c.isNode() ? 'body' : 'line'
    c.setAttr(`${sel}/pointerEvents`, l.locked ? 'none' : 'auto')
  })
}

function move(i: number, dir: number) {
  const j = i + dir
  if (j < 0 || j >= layers.value.length) return
  const arr = layers.value
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  layers.value = [...arr]
  applyZ()
}

function addLayer() {
  const name = window.prompt('图层名称')?.trim()
  if (!name) return
  layers.value = [...layers.value, { id: `layer-${seq++}`, name, visible: true, locked: false }]
}

function rename(l: Layer) {
  const name = window.prompt('图层名称', l.name)?.trim()
  if (name) l.name = name
}

function delLayer(l: Layer) {
  if (l.id === 'default') return
  cellsOfLayer(l.id).forEach((c: any) => c.setData({ ...(c.getData() || {}), layerId: 'default' }))
  layers.value = layers.value.filter((x) => x.id !== l.id)
}

function assignSelected(l: Layer) {
  const g = ctx.graph.value
  if (!g) return
  g.getSelectedCells().forEach((c: any) => c.setData({ ...(c.getData() || {}), layerId: l.id }))
  applyZ()
}

// 画布加载后按现有 data.layerId 还原图层（简单：仅保证 default 存在）
onMounted(() => applyZ())
watch(
  ctx.graph,
  (g) => {
    if (g) applyZ()
  },
  { immediate: true },
)
</script>

<style scoped>
.x6-layers {
  padding: 8px;
  font-size: 12px;
}
.x6-layers-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  margin-bottom: 6px;
}
.x6-layers-add {
  border: 1px solid var(--kb-border, #cbd5e1);
  border-radius: 6px;
  width: 24px;
  height: 22px;
  cursor: pointer;
}
.x6-layers-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.x6-layers-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 2px;
  border-radius: 6px;
}
.x6-layers-item:hover {
  background: var(--kb-background, #f1f5f9);
}
.x6-ly-eye,
.x6-ly-lock {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
}
.x6-ly-eye.off {
  opacity: 0.4;
}
.x6-ly-name {
  flex: 1;
  cursor: pointer;
  color: var(--kb-foreground, #0f172a);
}
.x6-ly-ops button {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--kb-muted-foreground, #64748b);
  font-size: 11px;
}
.x6-layers-hint {
  font-size: 11px;
  color: var(--kb-muted-foreground, #64748b);
  margin-top: 8px;
}
</style>
