<template>
  <div
    class="lf-node"
    :class="{ 'is-selected': selected }"
    :style="{ width: `${w}px`, height: `${h}px` }"
  >
    <NodeResizer
      v-if="!editing"
      :is-visible="selected"
      :min-width="60"
      :min-height="36"
      :line-style="{ stroke: 'var(--kb-primary)' }"
      :handle-style="{ fill: 'var(--kb-primary)' }"
      @resize="onResize"
      @resize-end="onResizeEnd"
    />

    <!-- 形状描边（真实像素坐标，避免拉伸导致描边不均） -->
    <svg class="lf-node-shape" :width="w" :height="h" :viewBox="`0 0 ${w} ${h}`">
      <template v-if="spec.tag === 'rect'">
        <rect
          x="0.75"
          y="0.75"
          :width="w - 1.5"
          :height="h - 1.5"
          :rx="spec.rx"
          :fill="fill"
          :stroke="stroke"
          stroke-width="1.5"
        />
      </template>
      <ellipse
        v-else-if="spec.tag === 'ellipse'"
        :cx="w / 2"
        :cy="h / 2"
        :rx="w / 2 - 0.75"
        :ry="h / 2 - 0.75"
        :fill="fill"
        :stroke="stroke"
        stroke-width="1.5"
      />
      <polygon
        v-else-if="spec.tag === 'polygon'"
        :points="spec.points"
        :fill="fill"
        :stroke="stroke"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      <template v-else>
        <rect
          x="0.75"
          y="0.75"
          :width="w - 1.5"
          :height="h - 1.5"
          :rx="2"
          :fill="fill"
          :stroke="stroke"
          stroke-width="1.5"
        />
        <rect x="0.75" y="0.75" :width="w - 1.5" :height="headerH" :rx="2" :fill="stroke" />
      </template>
    </svg>

    <!-- 文字（双击编辑；编辑态禁止冒泡以不触发节点拖拽） -->
    <div
      v-if="!editing"
      class="lf-node-label"
      :class="{ 'lf-uml-label': isUml }"
      :style="{ color: textColor, whiteSpace: 'pre-line' }"
      @dblclick="startEdit"
    >{{ label }}</div>
    <div
      v-else
      ref="editorEl"
      class="lf-node-label lf-editing"
      :class="{ 'lf-uml-label': isUml }"
      :style="{ color: textColor }"
      contenteditable="plaintext-only"
      spellcheck="false"
      @mousedown.stop
      @keydown.stop="onKeydown"
      @blur="commit"
    />

    <!-- 四向连接点（Loose 模式下均为 source，任意两点可连） -->
    <Handle type="source" :position="Position.Top" class="lf-handle" />
    <Handle type="source" :position="Position.Right" class="lf-handle" />
    <Handle type="source" :position="Position.Bottom" class="lf-handle" />
    <Handle type="source" :position="Position.Left" class="lf-handle" />
  </div>
</template>

<script setup lang="ts">
/**
 * 自定义节点（nodeTypes 注册）。
 *
 * 关键约定（与后端 / 落库一致）：
 * - 业务与视觉数据统一在 props.data 下（label / fill / stroke / textColor / width / height），
 *   绝不放 Node 顶层；
 * - 形状外形按 props.type → buildShape 算出 SVG 路径，覆盖矩形 / 椭圆 / 菱形 / 六边形 /
 *   便签 / UML / 圆角 / 胶囊，避免引入一整套 SVG 资源；
 * - 双击进入 contenteditable 改文字，失焦 / Enter 落库（store.patchNode），
 *   编辑态 @mousedown.stop 阻止 vue-flow 把「选字」当成「拖节点」。
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import { NodeResizer } from '@vue-flow/node-resizer';

import '@vue-flow/node-resizer/dist/style.css';

import { useDiagramStore } from '@/store/diagram-store';
import { buildShape, shapeOf } from '../shapeDefs';

const props = defineProps<{ id: string; data?: any; selected?: boolean; type?: string }>();

const store = useDiagramStore();

const editing = ref(false);
const editorEl = ref<HTMLElement | null>(null);

const def = computed(() => shapeOf(props.type));
const w = computed(() => Number(props.data?.width) || def.value.defaultWidth);
const h = computed(() => Number(props.data?.height) || def.value.defaultHeight);
const fill = computed(() => String(props.data?.fill || '#FFFFFF'));
const stroke = computed(() => String(props.data?.stroke || '#475569'));
const textColor = computed(() => String(props.data?.textColor || '#0F172A'));
const label = computed(() => String(props.data?.label ?? ''));
const isUml = computed(() => def.value.render === 'uml');
const headerH = 24;

const spec = computed(() => buildShape(def.value.render, w.value, h.value));

function startEdit() {
  editing.value = true;
  store.setEditing(true);
  nextTick(() => {
    const el = editorEl.value;
    if (!el) return;
    el.innerText = label.value;
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
  if (!el) {
    editing.value = false;
    store.setEditing(false);
    return;
  }
  const text = el.innerText.replace(/ /g, ' ').replace(/[\r\n]+/g, '\n').trim();
  editing.value = false;
  store.setEditing(false);
  if (text !== label.value) store.patchNode(props.id, { label: text });
}

function onKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    (e.target as HTMLElement).blur();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    editing.value = false;
    store.setEditing(false);
  }
}

function onResize({ params }: { params: { width: number; height: number } }) {
  store.patchNode(props.id, { width: Math.round(params.width), height: Math.round(params.height) }, { history: false });
}

function onResizeEnd({ params }: { params: { width: number; height: number } }) {
  store.patchNode(props.id, { width: Math.round(params.width), height: Math.round(params.height) }, { history: true });
}

function onEditNodeEvent(e: Event) {
  const custom = e as CustomEvent;
  if (custom.detail?.id === props.id && !editing.value) {
    startEdit();
  }
}

onMounted(() => {
  window.addEventListener('diagram:edit-node', onEditNodeEvent);
});
onUnmounted(() => {
  window.removeEventListener('diagram:edit-node', onEditNodeEvent);
});
</script>

<style scoped>
.lf-node {
  position: relative;
  box-sizing: border-box;
}
.lf-node-shape {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
.lf-node-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 6px 10px;
  font-size: 13px;
  line-height: 1.3;
  word-break: break-word;
  overflow: hidden;
  cursor: default;
  user-select: none;
}
.lf-uml-label {
  padding-top: 28px;
}
.lf-editing {
  cursor: text;
  user-select: text;
  outline: none;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 4px;
}
.lf-node.is-selected .lf-node-shape :deep(rect),
.lf-node.is-selected .lf-node-shape :deep(ellipse),
.lf-node.is-selected .lf-node-shape :deep(polygon) {
  stroke-width: 2.5;
}
.lf-handle {
  width: 10px;
  height: 10px;
  background: #fff;
  border: 1.5px solid var(--kb-primary, #3b6fe0);
  opacity: 0;
  transition: opacity 0.15s ease, transform 0.12s ease, background 0.12s ease;
}
/* ProcessOn / draw.io 风格：连接点默认隐藏，悬停或选中节点时淡入，避免画布杂乱 */
.lf-node:hover .lf-handle,
.lf-node.is-selected .lf-handle {
  opacity: 1;
}
.lf-handle:hover {
  background: var(--kb-primary, #3b6fe0);
  transform: scale(1.25);
}
</style>
