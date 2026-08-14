<template>
  <div class="x6-playground">
    <div class="bar">
      <span class="title">X6 Playground（方案 B 验证用，非正式编辑器）</span>
      <button class="kb-btn" @click="addRect">+ 矩形</button>
      <button class="kb-btn" @click="addVueNode">+ Vue 节点</button>
      <button class="kb-btn" @click="undo">撤销</button>
      <button class="kb-btn" @click="redo">重做</button>
      <span class="hint">graphReady: {{ graphReady }}</span>
    </div>
    <div class="canvas-wrap">
      <div ref="containerRef" class="canvas"></div>
      <div ref="minimapRef" class="minimap"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useGraph } from './useGraph'

const containerRef = ref<HTMLElement | null>(null)
const minimapRef = ref<HTMLElement | null>(null)
const { graph, graphReady } = useGraph({ containerRef, minimapContainerRef: minimapRef })

function addRect() {
  graph.value?.addNode({
    shape: 'rect',
    x: 80 + Math.random() * 120,
    y: 80 + Math.random() * 120,
    width: 120,
    height: 50,
    label: 'X6 矩形',
    attrs: { body: { fill: '#f6ffed', stroke: '#52c41a', strokeWidth: 1.5 } },
  })
}

function addVueNode() {
  graph.value?.addNode({
    shape: 'test-vue-node',
    x: 300,
    y: 140,
    width: 140,
    height: 44,
    data: { text: 'Vue 节点 ✅' },
  })
}

function undo() {
  if (graph.value?.canUndo()) graph.value.undo()
}

function redo() {
  if (graph.value?.canRedo()) graph.value.redo()
}
</script>

<style scoped>
.x6-playground {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}
.bar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--kb-border, #e5e7eb);
}
.title {
  font-weight: 600;
  margin-right: 8px;
}
.hint {
  margin-left: auto;
  color: #6b7280;
  font-size: 12px;
}
.canvas-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
}
.canvas {
  position: absolute;
  inset: 0;
}
.minimap {
  position: absolute;
  right: 12px;
  bottom: 12px;
  width: 200px;
  height: 140px;
  border: 1px solid var(--kb-border, #e5e7eb);
  background: #fff;
  z-index: 5;
}
</style>
