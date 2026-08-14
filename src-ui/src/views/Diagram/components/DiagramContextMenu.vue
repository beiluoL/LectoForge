<template>
  <Teleport to="body">
    <Transition name="lf-menu">
      <div v-if="modelValue" class="lf-context-wrap">
        <!-- 透明遮罩：覆盖全屏，左键/右键点击空白处即关闭菜单（保证“点击空白处关闭”） -->
        <div class="lf-context-backdrop" @click="close" @contextmenu.prevent="close" />
        <div
          ref="menuEl"
          class="lf-context-menu"
          :style="{ left: `${x}px`, top: `${y}px` }"
        >
        <!-- 画布空白 -->
        <template v-if="payload?.kind === 'pane'">
          <p class="lf-context-title">在此处添加</p>
          <div class="lf-context-grid">
            <button v-for="s in shapeButtons" :key="s.type" type="button" class="lf-context-grid-item" v-tip="s.label" @click="addShape(s.type)">
              <span class="lf-context-shape-dot" :style="{ background: s.isFill ? brush.fill : 'transparent', borderColor: brush.stroke }" />
              <span class="lf-context-grid-label">{{ s.label }}</span>
            </button>
          </div>
          <div class="lf-context-divider" />
          <button type="button" class="lf-context-item" @click="fitView">
            <Icon name="maximize" size="xs" /> <span class="lf-context-label">适应屏幕</span>
          </button>
          <button type="button" class="lf-context-item" @click="autoLayout">
            <Icon name="layout" size="xs" /> <span class="lf-context-label">自动布局</span>
          </button>
        </template>

        <!-- 节点 -->
        <template v-if="payload?.kind === 'node'">
          <p class="lf-context-title">节点操作</p>
          <button type="button" class="lf-context-item" @click="editText">
            <Icon name="pencil" size="xs" /> <span class="lf-context-label">编辑文字</span>
            <span class="lf-context-shortcut">⏎</span>
          </button>
          <button type="button" class="lf-context-item" @click="copyNode">
            <Icon name="copy" size="xs" /> <span class="lf-context-label">复制</span>
            <span class="lf-context-shortcut">⌘C</span>
          </button>
          <div class="lf-context-divider" />
          <button type="button" class="lf-context-item is-danger" @click="deleteSelected">
            <Icon name="trash-2" size="xs" /> <span class="lf-context-label">删除</span>
            <span class="lf-context-shortcut">Del</span>
          </button>
        </template>

        <!-- 边 -->
        <template v-if="payload?.kind === 'edge'">
          <p class="lf-context-title">连线操作</p>
          <button type="button" class="lf-context-item" @click="editEdgeText">
            <Icon name="pencil" size="xs" /> <span class="lf-context-label">编辑文字</span>
            <span class="lf-context-shortcut">⏎</span>
          </button>
          <button type="button" class="lf-context-item" @click="copyEdge">
            <Icon name="copy" size="xs" /> <span class="lf-context-label">复制</span>
            <span class="lf-context-shortcut">⌘C</span>
          </button>
          <button type="button" class="lf-context-item" @click="fitView">
            <Icon name="maximize" size="xs" /> <span class="lf-context-label">适应屏幕</span>
          </button>
          <div class="lf-context-divider" />
          <button type="button" class="lf-context-item is-danger" @click="deleteSelected">
            <Icon name="trash-2" size="xs" /> <span class="lf-context-label">删除</span>
            <span class="lf-context-shortcut">Del</span>
          </button>
        </template>
      </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 流程图右键上下文菜单。
 * 支持画布空白 / 节点 / 边三种场景，菜单位置由调用方传入的 payload.event 决定。
 */
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';

import Icon from '@/components/ui/Icon.vue';
import { useDiagramStore } from '@/store/diagram-store';
import { SHAPES } from '../shapeDefs';
import type { CanvasContextMenuPayload } from './DiagramCanvas.vue';

const props = defineProps<{
  modelValue: boolean;
  payload: CanvasContextMenuPayload | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'fit'): void;
}>();

const store = useDiagramStore();
const { brush } = storeToRefs(store);

const menuEl = ref<HTMLElement | null>(null);
const pos = reactive({ x: 0, y: 0 });

const x = computed(() => Math.max(8, Math.min(pos.x, window.innerWidth - 190)));
const y = computed(() => Math.max(8, Math.min(pos.y, window.innerHeight - 280)));

const shapeButtons = computed(() =>
  SHAPES.map((s) => ({
    type: s.type,
    label: s.label,
    isFill: s.render !== 'uml' && s.render !== 'note',
  })),
);

watch(
  () => props.modelValue,
  async (open) => {
    if (!open || !props.payload) return;
    const ev = props.payload.event;
    pos.x = ev.clientX;
    pos.y = ev.clientY;
    await nextTick();
    const rect = menuEl.value?.getBoundingClientRect();
    if (rect) {
      if (pos.x + rect.width > window.innerWidth) pos.x -= rect.width;
      if (pos.y + rect.height > window.innerHeight) pos.y -= rect.height;
    }
  },
);

function close() {
  emit('update:modelValue', false);
}

function addShape(type: string) {
  if (!props.payload) return;
  store.addNode(type as any, props.payload.flowPos);
  close();
}

function copyNode() {
  const id = props.payload?.nodeId;
  if (!id) return;
  store.setSelected([id], []);
  store.copyToClipboard();
  store.pasteFromClipboard();
  close();
}

function copyEdge() {
  const id = props.payload?.edgeId;
  if (!id) return;
  store.setSelected([], [id]);
  store.copyToClipboard();
  store.pasteFromClipboard();
  close();
}

function editText() {
  const id = props.payload?.nodeId;
  if (!id) return;
  store.setSelection(id, null);
  window.dispatchEvent(new CustomEvent('diagram:edit-node', { detail: { id } }));
  close();
}

function editEdgeText() {
  const id = props.payload?.edgeId;
  if (!id) return;
  store.setSelection(null, id);
  window.dispatchEvent(new CustomEvent('diagram:edit-edge', { detail: { id } }));
  close();
}

function deleteSelected() {
  const ids: string[] = [];
  if (props.payload?.nodeId) ids.push(props.payload.nodeId);
  if (props.payload?.edgeId) ids.push(props.payload.edgeId);
  if (ids.length) store.deleteElements(ids);
  close();
}

function fitView() {
  emit('fit');
  close();
}

function autoLayout() {
  store.autoLayout();
  emit('fit');
  close();
}
</script>

<style scoped>
.lf-context-wrap {
  position: fixed;
  inset: 0;
  z-index: 100;
  pointer-events: none;
}
.lf-context-backdrop {
  position: absolute;
  inset: 0;
  pointer-events: auto;
}
.lf-context-menu {
  position: fixed;
  z-index: 100;
  pointer-events: auto;
  min-width: 184px;
  padding: 6px 0;
  background: var(--kb-popover, #fff);
  border: 1px solid var(--kb-border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
  font-size: 13px;
  color: var(--kb-foreground);
}
:global(.dark) .lf-context-menu {
  background: var(--kb-card, #1f1f1f);
}
.lf-context-title {
  margin: 0;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--kb-muted-foreground);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.lf-context-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 0 10px 6px;
}
.lf-context-grid-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 2px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--kb-foreground);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.lf-context-grid-item:hover {
  background: var(--kb-muted, #f1f5f9);
  border-color: var(--kb-border);
}
.lf-context-shape-dot {
  width: 22px;
  height: 16px;
  border: 1.5px solid var(--kb-border);
  border-radius: 3px;
}
.lf-context-grid-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.lf-context-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  border: none;
  background: transparent;
  color: var(--kb-foreground);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}
.lf-context-label {
  flex: 1;
  white-space: nowrap;
}
.lf-context-shortcut {
  margin-left: 16px;
  font-size: 11px;
  color: var(--kb-muted-foreground);
  letter-spacing: 0.3px;
}
.lf-context-item:hover {
  background: var(--kb-muted, #f1f5f9);
}
.lf-context-item.is-danger {
  color: var(--kb-destructive, #dc2626);
}
.lf-context-item.is-danger .lf-context-shortcut {
  color: color-mix(in srgb, var(--kb-destructive) 70%, var(--kb-muted-foreground));
}
.lf-context-item.is-danger:hover {
  background: color-mix(in srgb, var(--kb-destructive) 10%, transparent);
}
.lf-context-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--kb-border);
}
.lf-menu-enter-active,
.lf-menu-leave-active {
  transition: opacity 0.12s, transform 0.12s;
}
.lf-menu-enter-from,
.lf-menu-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
