<template>
  <aside class="lf-library">
    <p class="lf-library-title">图形库</p>
    <p class="lf-library-tip">拖到画布，或点击加到中心</p>

    <div v-for="grp in groups" :key="grp.key" class="lf-group">
      <p class="lf-group-title">{{ grp.label }}</p>
      <div class="lf-group-grid">
        <button
          v-for="s in grp.items"
          :key="s.type"
          type="button"
          class="lf-shape-item"
          draggable="true"
          :title="`拖入画布，或点击添加：${s.label}`"
          @dragstart="onDragStart(s.type, $event)"
          @click="onClick(s.type)"
        >
          <svg class="lf-shape-preview" :viewBox="`0 0 ${pw} ${ph}`" width="56" height="36">
            <template v-if="s.spec.tag === 'rect'">
              <rect x="1" y="1" :width="pw - 2" :height="ph - 2" :rx="s.spec.rx" fill="#fff" stroke="var(--kb-border)" stroke-width="1.5" />
            </template>
            <ellipse
              v-else-if="s.spec.tag === 'ellipse'"
              :cx="pw / 2" :cy="ph / 2" :rx="pw / 2 - 1" :ry="ph / 2 - 1"
              fill="#fff" stroke="var(--kb-border)" stroke-width="1.5"
            />
            <polygon
              v-else-if="s.spec.tag === 'polygon'"
              :points="s.spec.points"
              fill="#fff" stroke="var(--kb-border)" stroke-width="1.5" stroke-linejoin="round"
            />
            <template v-else>
              <rect x="1" y="1" :width="pw - 2" :height="ph - 2" rx="2" fill="#fff" stroke="var(--kb-border)" stroke-width="1.5" />
              <rect x="1" y="1" :width="pw - 2" :height="10" rx="2" fill="var(--kb-border)" />
            </template>
          </svg>
          <span class="lf-shape-name">{{ s.label }}</span>
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
/**
 * 左栏图形库。
 * - 拖拽：dragstart 写入 dataTransfer('application/diagram-shape', type)，由 DiagramCanvas 的
 *   @drop 读取并用 screenToFlowCoordinate 换算落点（已含 viewport 偏移，落点准确）；
 * - 点击：调 store.queueAddAtCenter，由 Canvas watch 在视图中心生成。
 */
import { computed } from 'vue';

import { useDiagramStore } from '@/store/diagram-store';
import { buildShape, SHAPES, type ShapeDef } from '../shapeDefs';

const store = useDiagramStore();

const pw = 56;
const ph = 36;

const groups = computed(() => {
  const map: Record<string, { key: string; label: string; items: (ShapeDef & { spec: ReturnType<typeof buildShape> })[] }> = {
    basic: { key: 'basic', label: '基础形状', items: [] },
    flow: { key: 'flow', label: '流程图', items: [] },
    uml: { key: 'uml', label: 'UML', items: [] },
  };
  for (const s of SHAPES) map[s.category].items.push({ ...s, spec: buildShape(s.render, pw, ph) });
  return Object.values(map);
});

function onDragStart(type: string, e: DragEvent) {
  e.dataTransfer?.setData('application/diagram-shape', type);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}

function onClick(type: string) {
  store.queueAddAtCenter(type);
}
</script>

<style scoped>
.lf-library {
  width: 240px;
  flex-shrink: 0;
  height: 100%;
  overflow-y: auto;
  background: var(--kb-muted, #f8fafc);
  border-right: 1px solid var(--kb-border);
  padding: 12px;
  box-sizing: border-box;
}
:global(.dark) .lf-library {
  background: var(--kb-card, #1f1f1f);
}
.lf-library-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  color: var(--kb-foreground);
}
.lf-library-tip {
  font-size: 11px;
  color: var(--kb-muted-foreground);
  margin: 2px 0 10px;
}
.lf-group {
  margin-bottom: 14px;
}
.lf-group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--kb-muted-foreground);
  margin: 0 0 8px;
}
.lf-group-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.lf-shape-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border: 1px solid var(--kb-border);
  border-radius: 8px;
  background: var(--kb-background, #fff);
  cursor: grab;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.lf-shape-item:hover {
  border-color: var(--kb-primary, #3b6fe0);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}
.lf-shape-item:active {
  cursor: grabbing;
}
.lf-shape-preview {
  display: block;
}
.lf-shape-name {
  font-size: 11px;
  color: var(--kb-foreground);
  text-align: center;
}
</style>
