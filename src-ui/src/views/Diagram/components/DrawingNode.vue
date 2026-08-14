<template>
  <div class="lf-drawing" :class="{ 'is-selected': selected }" :style="{ width: `${w}px`, height: `${h}px` }">
    <svg class="lf-drawing-svg" :width="w" :height="h" :viewBox="`0 0 ${w} ${h}`">
      <path
        :d="path"
        :stroke="pathColor"
        :stroke-width="strokeWidth"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </div>
</template>

<script setup lang="ts">
/**
 * 自由画笔节点（nodeTypes 注册为 'drawing'）。
 *
 * 数据：data.path 是相对坐标（以节点左上角为原点的 SVG path d 字符串），
 * data.points 是同一组点的 JSON（[{x,y}]），用于算出节点尺寸与拖拽时整体跟随。
 * 坐标相对化（而非绝对画布坐标）是为了让节点被拖动时路径与容器一起移动。
 */
import { computed } from 'vue';

const props = defineProps<{ id: string; data?: any; selected?: boolean; type?: string }>();

const path = computed(() => String(props.data?.path || ''));
const pathColor = computed(() => String(props.data?.pathColor || '#475569'));
const strokeWidth = computed(() => Number(props.data?.strokeWidth) || 2);

const box = computed(() => {
  try {
    const pts = JSON.parse(props.data?.points || '[]') as { x: number; y: number }[];
    if (Array.isArray(pts) && pts.length) {
      const xs = pts.map((p) => Number(p.x) || 0);
      const ys = pts.map((p) => Number(p.y) || 0);
      return {
        w: Math.max(2, Math.ceil(Math.max(...xs))),
        h: Math.max(2, Math.ceil(Math.max(...ys))),
      };
    }
  } catch {
    /* 损坏数据回退默认尺寸 */
  }
  return { w: 60, h: 40 };
});

const w = computed(() => box.value.w);
const h = computed(() => box.value.h);
</script>

<style scoped>
.lf-drawing {
  position: relative;
  box-sizing: border-box;
}
.lf-drawing-svg {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}
.lf-drawing.is-selected {
  outline: 2px solid var(--kb-primary, #3b6fe0);
  outline-offset: 2px;
  border-radius: 2px;
}
</style>
