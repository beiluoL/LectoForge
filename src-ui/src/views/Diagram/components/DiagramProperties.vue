<template>
  <aside class="lf-props">
    <template v-if="node">
      <p class="lf-props-title">节点属性</p>

      <div class="lf-row">
        <label>X</label>
        <input type="number" class="kb-input" :value="round(node.position?.x)" @change="setNode('x', $event)" />
        <label>Y</label>
        <input type="number" class="kb-input" :value="round(node.position?.y)" @change="setNode('y', $event)" />
      </div>
      <div class="lf-row">
        <label>宽</label>
        <input type="number" class="kb-input" :value="round(node.data?.width)" @change="setNode('width', $event)" />
        <label>高</label>
        <input type="number" class="kb-input" :value="round(node.data?.height)" @change="setNode('height', $event)" />
      </div>

      <label class="lf-block-label">文本</label>
      <textarea class="kb-input lf-textarea" rows="2" :value="node.data?.label" @change="setNode('label', $event)" />

      <label class="lf-block-label">填充色</label>
      <input
        type="color"
        class="lf-color-input"
        :value="node.data?.fill || '#FFFFFF'"
        @input="setNodeColor('fill', $event, false)"
        @change="setNodeColor('fill', $event, true)"
      />

      <label class="lf-block-label">边框色</label>
      <input
        type="color"
        class="lf-color-input"
        :value="node.data?.stroke || '#475569'"
        @input="setNodeColor('stroke', $event, false)"
        @change="setNodeColor('stroke', $event, true)"
      />

      <label class="lf-block-label">文字色</label>
      <input
        type="color"
        class="lf-color-input"
        :value="node.data?.textColor || '#0F172A'"
        @input="setNodeColor('textColor', $event, false)"
        @change="setNodeColor('textColor', $event, true)"
      />
    </template>

    <template v-else-if="edge">
      <p class="lf-props-title">连线属性</p>

      <label class="lf-block-label">文本</label>
      <input type="text" class="kb-input" :value="edge.label || ''" @change="setEdge('label', $event)" />

      <label class="lf-block-label">线宽</label>
      <input type="number" min="0.5" step="0.5" class="kb-input" :value="edge.data?.lineWidth || 1.6" @change="setEdge('lineWidth', $event)" />

      <label class="lf-check">
        <input type="checkbox" :checked="edge.data?.dashed ?? false" @change="setEdgeFlag('dashed', $event)" />
        虚线
      </label>
      <label class="lf-check">
        <input type="checkbox" :checked="edge.data?.arrow ?? true" @change="setEdgeFlag('arrow', $event)" />
        箭头
      </label>

      <label class="lf-block-label">线色</label>
      <input
        type="color"
        class="lf-color-input"
        :value="edge.data?.color || '#475569'"
        @input="setEdgeColor('color', $event, false)"
        @change="setEdgeColor('color', $event, true)"
      />
    </template>

    <p v-else class="lf-props-empty">选中一个节点或连线<br />即可在此编辑属性</p>
  </aside>
</template>

<script setup lang="ts">
/**
 * 右栏属性面板：根据当前选中元素联动显示。
 * - 节点：X / Y / 宽 / 高 / 文本 / 填充色 / 边框色 / 文字色；
 * - 连线：文本 / 线宽 / 虚线 / 箭头 / 线色。
 * 颜色输入拖动时实时预览但不写入历史，松手 @change 时只落一条历史。
 * 所有改动经 store.patchNode / patchEdge 落库（含撤销快照 + 防抖保存）。
 */
import { storeToRefs } from 'pinia';

import { useDiagramStore } from '@/store/diagram-store';

const store = useDiagramStore();
const { selectedNode: node, selectedEdge: edge } = storeToRefs(store);

function round(v: unknown): number {
  return Math.round(Number(v) || 0);
}
function setNode(field: string, e: Event) {
  if (!node.value) return;
  const val = (e.target as HTMLInputElement | HTMLTextAreaElement).value;
  store.patchNode(node.value.id, { [field]: field === 'label' ? val : Number(val) });
}
function setNodeColor(field: string, e: Event, history: boolean) {
  if (!node.value) return;
  const val = (e.target as HTMLInputElement).value;
  store.patchNode(node.value.id, { [field]: val }, { history });
}
function setEdge(field: string, e: Event) {
  if (!edge.value) return;
  const val = (e.target as HTMLInputElement).value;
  store.patchEdge(edge.value.id, { [field]: field === 'color' || field === 'label' ? val : Number(val) });
}
function setEdgeColor(field: string, e: Event, history: boolean) {
  if (!edge.value) return;
  const val = (e.target as HTMLInputElement).value;
  store.patchEdge(edge.value.id, { [field]: val }, { history });
}
function setEdgeFlag(field: 'dashed' | 'arrow', e: Event) {
  if (!edge.value) return;
  store.patchEdge(edge.value.id, { [field]: (e.target as HTMLInputElement).checked });
}
</script>

<style scoped>
.lf-props {
  width: 280px;
  flex-shrink: 0;
  height: 100%;
  overflow-y: auto;
  background: var(--kb-muted, #f8fafc);
  border-left: 1px solid var(--kb-border);
  padding: 14px;
  box-sizing: border-box;
}
:global(.dark) .lf-props {
  background: var(--kb-card, #1f1f1f);
}
.lf-props-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 12px;
  color: var(--kb-foreground);
}
.lf-row {
  display: grid;
  grid-template-columns: 18px 1fr 18px 1fr;
  gap: 6px;
  align-items: center;
  margin-bottom: 10px;
}
.lf-row label {
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.lf-block-label {
  display: block;
  font-size: 12px;
  color: var(--kb-muted-foreground);
  margin: 10px 0 4px;
}
.lf-textarea {
  resize: vertical;
}
.lf-color-input {
  width: 100%;
  height: 32px;
  border: 1px solid var(--kb-border);
  border-radius: 6px;
  background: none;
  cursor: pointer;
  padding: 2px;
}
.lf-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--kb-foreground);
  margin-top: 10px;
  cursor: pointer;
}
.lf-props-empty {
  font-size: 12px;
  color: var(--kb-muted-foreground);
  text-align: center;
  margin-top: 40px;
  line-height: 1.6;
}
</style>
