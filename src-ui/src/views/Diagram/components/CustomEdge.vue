<template>
  <BaseEdge :path="path" :style="edgeStyle" :marker-end="props.markerEnd" :interaction-width="24" />

  <EdgeLabelRenderer>
    <div
      class="lf-edge-label"
      :class="{ 'is-selected': isSelected, 'is-editing': editing, 'is-empty': !label }"
      :style="{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }"
      @pointerdown.stop
      @click.stop="onClickBadge"
      @dblclick.stop="startEdit"
    >
      <template v-if="!editing">
        <span class="lf-edge-label-text">{{ label || '＋' }}</span>
        <div v-if="isSelected" class="lf-edge-actions">
          <button type="button" class="lf-edge-btn" v-tip="'编辑文字'" @click.stop="startEdit">
            <Icon name="pencil" size="xs" />
          </button>
          <button type="button" class="lf-edge-btn is-danger" v-tip="'删除连线'" @click.stop="del">
            <Icon name="trash-2" size="xs" />
          </button>
        </div>
      </template>
      <div
        v-else
        ref="editorEl"
        class="lf-edge-label-edit"
        contenteditable="plaintext-only"
        spellcheck="false"
        @keydown.stop="onKeydown"
        @blur="commit"
      />
    </div>
  </EdgeLabelRenderer>
</template>

<script setup lang="ts">
/**
 * 自定义连线（edgeTypes 注册）。
 *
 * 关键约定（与节点一致）：
 * - 连线的视觉样式（线型 / 线宽 / 虚线 / 箭头 / 线色 / 文本）统一在 props.data 下；
 *   这里直接按 data 计算 path / style / markerEnd，无需 DiagramCanvas 额外装饰，
 *   也避免「深监听 edges 反复赋值 style 触发无限循环」；
 * - 三种线型由 data.lineType 决定：smoothstep（折线）/ bezier（曲线）/ straight（直线）；
 * - 中心标签徽标：双击内联改字、选中时出现「编辑 / 删除」快捷按钮；
 *   没有标签时显示淡淡的「＋」，悬停 / 选中才显现，减少视觉噪音；
 * - 命中区加宽到 24px，点击细线更容易选中（对标 ProcessOn / draw.io）。
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
} from '@vue-flow/core';

import Icon from '@/components/ui/Icon.vue';
import { useDiagramStore } from '@/store/diagram-store';

const props = defineProps<{
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  data?: any;
  label?: string | null;
  selected?: boolean;
  /** VueFlow 已把 edge.markerEnd（对象配置）解析成 marker url 字符串后传入 */
  markerEnd?: any;
}>();

const store = useDiagramStore();

const editing = ref(false);
const editorEl = ref<HTMLElement | null>(null);

const lineType = computed(() => String(props.data?.lineType || 'smoothstep'));

const pathData = computed(() => {
  const opts = {
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  };
  if (lineType.value === 'bezier') return getBezierPath(opts);
  if (lineType.value === 'straight') return getStraightPath(opts);
  return getSmoothStepPath({ ...opts, borderRadius: 8 });
});

const path = computed(() => String(pathData.value[0]));
const labelX = computed(() => Number(pathData.value[1]));
const labelY = computed(() => Number(pathData.value[2]));

const label = computed(() => String((props.label ?? props.data?.label ?? '') ?? ''));

const isSelected = computed(() => Boolean(props.selected) || store.selection.edgeId === props.id);

const color = computed(() => String(props.data?.color || '#475569'));
const lineWidth = computed(() => Number(props.data?.lineWidth || 1.6));
const dashed = computed(() => Boolean(props.data?.dashed));
const arrow = computed(() => props.data?.arrow !== false);

const edgeStyle = computed<Record<string, unknown>>(() => ({
  stroke: color.value,
  strokeWidth: isSelected.value ? lineWidth.value + 1 : lineWidth.value,
  ...(dashed.value ? { strokeDasharray: '6 4' } : {}),
}));

function onClickBadge() {
  store.setSelection(null, props.id);
}

function startEdit() {
  editing.value = true;
  store.setEditing(true);
  nextTick(() => {
    const el = editorEl.value;
    if (!el) return;
    el.textContent = label.value;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });
}

function commit() {
  const el = editorEl.value;
  const text = (el?.textContent ?? '').replace(/\s+$/g, '');
  editing.value = false;
  store.setEditing(false);
  if (text !== label.value) store.patchEdge(props.id, { label: text });
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    (e.target as HTMLElement).blur();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    editing.value = false;
    store.setEditing(false);
    if (editorEl.value) editorEl.value.textContent = label.value;
  }
}

function del() {
  store.deleteElements([props.id]);
}

function onEditEdgeEvent(e: Event) {
  const ev = e as CustomEvent;
  if (ev.detail?.id === props.id && !editing.value) startEdit();
}

onMounted(() => window.addEventListener('diagram:edit-edge', onEditEdgeEvent));
onUnmounted(() => window.removeEventListener('diagram:edit-edge', onEditEdgeEvent));
</script>

<style scoped>
.lf-edge-label {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--kb-popover);
  border: 1px solid transparent;
  font-size: 12px;
  color: var(--kb-foreground);
  pointer-events: all;
  cursor: pointer;
  user-select: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  transition: border-color 0.12s, box-shadow 0.12s;
}
.lf-edge-label.is-selected {
  border-color: var(--kb-primary);
}
.lf-edge-label.is-empty .lf-edge-label-text {
  opacity: 0;
}
.lf-edge-label.is-empty:hover .lf-edge-label-text,
.lf-edge-label.is-empty.is-selected .lf-edge-label-text {
  opacity: 1;
}
.lf-edge-label-text {
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lf-edge-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.lf-edge-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: var(--kb-muted);
  color: var(--kb-foreground);
  cursor: pointer;
}
.lf-edge-btn:hover {
  background: color-mix(in srgb, var(--kb-primary) 16%, transparent);
}
.lf-edge-btn.is-danger {
  color: var(--kb-destructive);
}
.lf-edge-btn.is-danger:hover {
  background: color-mix(in srgb, var(--kb-destructive) 12%, transparent);
}
.lf-edge-label-edit {
  outline: none;
  min-width: 40px;
  text-align: center;
  cursor: text;
  user-select: text;
  white-space: nowrap;
}
</style>
