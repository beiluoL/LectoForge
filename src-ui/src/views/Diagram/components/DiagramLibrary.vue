<template>
  <aside
    class="lf-library"
    :class="{ 'is-collapsed': collapsed }"
    :style="{ width: (collapsed ? RAIL_W : width) + 'px' }"
  >
    <!-- 收起态：仅留一条竖条 + 展开入口 -->
    <template v-if="collapsed">
      <button class="lf-lib-rail-btn" v-tip="'展开图形库'" @click="collapsed = false">
        <Icon name="chevron-right" size="sm" />
      </button>
    </template>

    <template v-else>
      <div class="lf-library-head">
        <p class="lf-library-title">图形库</p>
        <button class="lf-lib-collapse" v-tip="'收起图形库'" @click="collapsed = true">
          <Icon name="chevron-left" size="sm" />
        </button>
      </div>
      <p class="lf-library-tip">拖到画布，或点击加到中心</p>

      <div v-for="grp in groups" :key="grp.key" class="lf-group">
        <button
          type="button"
          class="lf-group-head"
          v-tip="expanded[grp.key] ? '折叠分组' : '展开分组'"
          @click="toggleGroup(grp.key)"
        >
          <Icon :name="expanded[grp.key] ? 'chevron-down' : 'chevron-right'" size="xs" />
          <span class="lf-group-label">{{ grp.label }}</span>
        </button>
        <div v-show="expanded[grp.key]" class="lf-group-grid">
          <button
            v-for="s in grp.items"
            :key="s.type"
            type="button"
            class="lf-shape-item"
            v-tip="`拖入画布，或点击添加：${s.label}`"
            @pointerdown="onShapePointerDown(s.type, s.label, $event)"
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

      <!-- 右缘分隔条：左右拖拽调整宽度（最小/最大限制） -->
      <div class="lf-lib-resizer" v-tip="'拖动调整图形库宽度'" @pointerdown.prevent="startResize" />
    </template>
  </aside>
</template>

<script setup lang="ts">
/**
 * 左栏图形库。
 * - 拖拽：dragstart 写入 dataTransfer('application/diagram-shape', type)，由 DiagramCanvas 的
 *   @drop 读取并用 screenToFlowCoordinate 换算落点（已含 viewport 偏移，落点准确）；
 * - 点击：调 store.queueAddAtCenter，由 Canvas watch 在视图中心生成；
 * - 分组折叠 / 展开：每个分组标题可点击切换；
 * - 收起 / 展开：标题栏 « 收起为竖条（仅留展开入口），» 重新展开；
 * - 宽度调节：右缘分隔条 pointer 拖拽，限定 [MIN_W, MAX_W]；向左拖到阈值以下自动收起。
 */
import { computed, reactive, ref } from 'vue';

import Icon from '@/components/ui/Icon.vue';
import { useDiagramStore } from '@/store/diagram-store';
import { buildShape, SHAPES, type ShapeDef } from '../shapeDefs';

const emit = defineEmits<{
  (e: 'shape-drag-start', payload: { type: string; label: string; x: number; y: number }): void;
  (e: 'shape-drag-move', payload: { x: number; y: number }): void;
  (e: 'shape-drag-end', payload: { type: string; label: string; x: number; y: number }): void;
}>();

const store = useDiagramStore();

const pw = 56;
const ph = 36;

const MIN_W = 180;
const MAX_W = 360;
const RAIL_W = 28;
// 拖拽宽度小于该值即判定为「向左收起」
const COLLAPSE_THRESHOLD = 150;

const width = ref(240);
const collapsed = ref(false);
const expanded = reactive<Record<string, boolean>>({
  basic: true,
  flow: true,
  uml: true,
});

const groups = computed(() => {
  const map: Record<string, { key: string; label: string; items: (ShapeDef & { spec: ReturnType<typeof buildShape> })[] }> = {
    basic: { key: 'basic', label: '基础形状', items: [] },
    flow: { key: 'flow', label: '流程图', items: [] },
    uml: { key: 'uml', label: 'UML', items: [] },
  };
  for (const s of SHAPES) map[s.category].items.push({ ...s, spec: buildShape(s.render, pw, ph) });
  return Object.values(map);
});

function toggleGroup(key: string) {
  expanded[key] = !expanded[key];
}

// ===================== 指针拖拽（替代 HTML5 DnD：WKWebView / 部分 WebView 的
// HTML5 拖放 API 不可靠，拖到画布常“没反应”。改用 pointer 事件自管拖拽流程）=====================
// 按下图形 → 移动超过阈值即开始拖拽（浮动预览跟随指针）→ 松开：
//   · 落在画布内 → 由 index.vue 在落点创建节点；
//   · 未超阈值（视为点击）→ 由 store 在视图中心添加。
let dragPending: { type: string; label: string; x: number; y: number } | null = null;
let dragMoved = false;
const DRAG_THRESHOLD = 5;

function onShapePointerDown(type: string, label: string, e: PointerEvent) {
  dragPending = { type, label, x: e.clientX, y: e.clientY };
  dragMoved = false;
  window.addEventListener('pointermove', onShapePointerMove);
  window.addEventListener('pointerup', onShapePointerUp);
}

function onShapePointerMove(e: PointerEvent) {
  if (!dragPending) return;
  if (!dragMoved) {
    const dx = e.clientX - dragPending.x;
    const dy = e.clientY - dragPending.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragMoved = true;
      emit('shape-drag-start', { ...dragPending, x: e.clientX, y: e.clientY });
    }
  }
  if (dragMoved) emit('shape-drag-move', { x: e.clientX, y: e.clientY });
}

function onShapePointerUp(e: PointerEvent) {
  window.removeEventListener('pointermove', onShapePointerMove);
  window.removeEventListener('pointerup', onShapePointerUp);
  if (!dragPending) return;
  if (dragMoved) {
    emit('shape-drag-end', { ...dragPending, x: e.clientX, y: e.clientY });
  } else {
    store.queueAddAtCenter(dragPending.type);
  }
  dragPending = null;
}

// ===================== 分隔条拖拽调宽 =====================
let resizing = false;
let startX = 0;
let startW = 0;

function startResize(e: PointerEvent) {
  resizing = true;
  startX = e.clientX;
  startW = width.value;
  window.addEventListener('pointermove', onResizeMove);
  window.addEventListener('pointerup', stopResize);
}

function onResizeMove(e: PointerEvent) {
  if (!resizing) return;
  const next = Math.min(MAX_W, Math.max(MIN_W, startW + (e.clientX - startX)));
  if (next < COLLAPSE_THRESHOLD) {
    collapsed.value = true;
    stopResize();
    return;
  }
  width.value = next;
}

function stopResize() {
  resizing = false;
  window.removeEventListener('pointermove', onResizeMove);
  window.removeEventListener('pointerup', stopResize);
}
</script>

<style scoped>
.lf-library {
  position: relative;
  flex-shrink: 0;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--kb-muted);
  border-right: 1px solid var(--kb-border);
  padding: 12px;
  box-sizing: border-box;
}
:root[data-theme='dark'] .lf-library {
  background: var(--kb-card);
}
/* 收起态：竖条，居中显示展开入口 */
.lf-library.is-collapsed {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
  cursor: default;
}
.lf-lib-rail-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 32px;
  border: 1px solid var(--kb-border);
  border-radius: 6px;
  background: var(--kb-background);
  color: var(--kb-muted-foreground);
  cursor: pointer;
}
.lf-lib-rail-btn:hover {
  color: var(--kb-primary);
  border-color: var(--kb-primary);
}
.lf-library-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.lf-library-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  color: var(--kb-foreground);
}
.lf-lib-collapse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
}
.lf-lib-collapse:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}
.lf-library-tip {
  font-size: 11px;
  color: var(--kb-muted-foreground);
  margin: 2px 0 12px;
}
.lf-group {
  margin-bottom: 16px;
}
.lf-group-head {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 4px 8px;
  margin: 0 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  text-align: left;
}
.lf-group-head:hover {
  background: var(--kb-muted);
}
.lf-group-label {
  font-size: 12px;
  font-weight: 600;
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
  background: var(--kb-background);
  cursor: grab;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.lf-shape-item:hover {
  border-color: var(--kb-primary);
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
/* 右缘分隔条：拖拽调宽 */
.lf-lib-resizer {
  position: absolute;
  top: 0;
  right: 0;
  width: 5px;
  height: 100%;
  cursor: col-resize;
  z-index: 5;
}
.lf-lib-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  right: 2px;
  width: 1px;
  height: 100%;
  background: transparent;
  transition: background 0.12s;
}
.lf-lib-resizer:hover::after {
  background: var(--kb-primary);
}
</style>
