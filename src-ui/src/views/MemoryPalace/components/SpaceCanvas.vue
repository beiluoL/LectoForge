<template>
  <div
    ref="canvasRef"
    class="relative w-full border overflow-hidden select-none mp-canvas"
    style="background: var(--kb-card); border-color: var(--kb-border); aspect-ratio: 4 / 3; border-radius: var(--kb-radius-lg);"
    @click.self="$emit('deselect')"
  >
    <!-- 主题背景提示 -->
    <div class="absolute top-3 left-3 flex items-center gap-1.5 text-[12px]" style="color: var(--kb-muted-foreground);">
      <Icon name="layout-grid" :size="'sm'" /> {{ themeLabel }} 场景
    </div>

    <div
      v-for="(l, i) in loci"
      :key="l.id"
      class="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing"
      :style="{ left: (l.posX || 50) + '%', top: (l.posY || 50) + '%', zIndex: selectedId === l.id ? 20 : 10 }"
      @mousedown="startDrag(l, $event)"
      @click.stop="$emit('select', l)"
    >
      <div
        class="w-9 h-9 rounded-full flex items-center justify-center shadow-sm border-2 transition-transform"
        :style="{
          background: selectedId === l.id ? 'var(--kb-primary)' : 'var(--kb-background)',
          borderColor: 'var(--kb-primary)',
          color: selectedId === l.id ? '#fff' : 'var(--kb-primary)',
          transform: selectedId === l.id ? 'scale(1.15)' : 'scale(1)',
        }"
      >
        <Icon :name="l.icon || 'map-pin'" :size="'lg'" />
      </div>
      <div
        class="absolute left-1/2 -translate-x-1/2 mt-1 px-2 py-0.5 rounded text-[11px] whitespace-nowrap"
        style="background: var(--kb-foreground); color: var(--kb-background);"
      >{{ i + 1 }}. {{ l.name }}</div>
    </div>

    <div v-if="loci.length === 0" class="absolute inset-0 flex items-center justify-center">
      <p class="kb-body-sm" style="color: var(--kb-muted-foreground);">点击「添加位点」开始布置空间</p>
    </div>
  </div>
  <p class="text-[12px] mt-2" style="color: var(--kb-muted-foreground);">
    提示：拖动点位调整位置，点击点位编辑。编号即记忆漫游顺序。
  </p>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import type { WbPalaceLoci } from '@/api/types'

defineProps<{
  loci: WbPalaceLoci[]
  selectedId: number | null
  themeLabel: string
}>()

const emit = defineEmits<{
  (e: 'select', loci: WbPalaceLoci): void
  (e: 'deselect'): void
  /** 拖拽过程中节流地同步坐标（父组件负责落库） */
  (e: 'position-change', lociId: number, x: number, y: number): void
}>()

const canvasRef = ref<HTMLElement | null>(null)
let dragState: { id: number; startX: number; startY: number; baseX: number; baseY: number } | null = null
let lastEmitTs = 0

function startDrag(l: WbPalaceLoci, ev: MouseEvent) {
  ev.preventDefault()
  const baseX = l.posX ?? 50
  const baseY = l.posY ?? 50
  dragState = { id: l.id, startX: ev.clientX, startY: ev.clientY, baseX, baseY }
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', endDrag)
}

function onDrag(ev: MouseEvent) {
  if (!dragState || !canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const dx = ((ev.clientX - dragState.startX) / rect.width) * 100
  const dy = ((ev.clientY - dragState.startY) / rect.height) * 100
  const nx = Math.min(98, Math.max(2, Math.round(dragState.baseX + dx)))
  const ny = Math.min(98, Math.max(2, Math.round(dragState.baseY + dy)))
  // 16ms 节流：mousemove 通常 ~16ms 一次，相当于每帧最多 emit 一次，Vue 响应式友好
  const now = Date.now()
  if (now - lastEmitTs >= 16) {
    emit('position-change', dragState.id, nx, ny)
    lastEmitTs = now
  }
}

function endDrag() {
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', endDrag)
  dragState = null
}
</script>

<style scoped>
.mp-canvas {
  /* 画布基础样式（沿用项目 --kb-* token，保持视觉一致） */
}
</style>