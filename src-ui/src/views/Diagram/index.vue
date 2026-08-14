<template>
  <div class="lf-root">
    <DiagramToolbar @export-png="onExportPng" @fit="onFit" @auto-layout="onAutoLayout" />
    <div class="lf-body">
      <DiagramLibrary />
      <div ref="centerEl" class="lf-center">
        <DiagramCanvas ref="canvasRef" @context-menu="onContextMenu" @fit="onFit" />
      </div>
      <DiagramProperties />
    </div>
    <DiagramBottomBar />
    <DiagramContextMenu v-model="menuOpen" :payload="menuPayload" @fit="onFit" />
  </div>
</template>

<script setup lang="ts">
/**
 * 绘图工具 / 流程图 入口（三栏式）。
 * - 顶层顶栏：DiagramToolbar（图文件切换 + 文件操作 + 排版 + 图层）；
 * - 左：DiagramLibrary（图形库，拖拽 / 点击添加）；
 * - 中：DiagramCanvas（vue-flow 画布）；
 * - 右：DiagramProperties（选中节点 / 连线属性）。
 *
 * 进入页面：先拉列表，自动打开「最近编辑」的图；若还没有任何图，则新建一个空白图。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';

import { useDiagramStore } from '@/store/diagram-store';
import DiagramCanvas, { type CanvasContextMenuPayload } from './components/DiagramCanvas.vue';
import DiagramContextMenu from './components/DiagramContextMenu.vue';
import DiagramLibrary from './components/DiagramLibrary.vue';
import DiagramProperties from './components/DiagramProperties.vue';
import DiagramToolbar from './components/DiagramToolbar.vue';
import DiagramBottomBar from './components/DiagramBottomBar.vue';

const store = useDiagramStore();
const centerEl = ref<HTMLElement | null>(null);
const canvasRef = ref<InstanceType<typeof DiagramCanvas> | null>(null);

const menuOpen = ref(false);
const menuPayload = ref<CanvasContextMenuPayload | null>(null);

/** 切换页面后重新适应视口（节点/边已随 store 切换刷新） */
watch(
  () => store.currentPageId,
  () => onFit(),
);

function onContextMenu(payload: CanvasContextMenuPayload) {
  menuPayload.value = payload;
  menuOpen.value = true;
}

function onExportPng() {
  canvasRef.value?.exportPng();
}
function onFit() {
  canvasRef.value?.fitNow();
}
function onAutoLayout() {
  store.autoLayout();
  onFit();
}

const flushSave = () => store.saveDiagram({ immediate: true });

function isInputTarget(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    target.isContentEditable ||
    target.closest('.lf-node-label.lf-editing') !== null
  );
}

function onKeydown(e: KeyboardEvent) {
  if (store.isEditing || isInputTarget(e)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const key = e.key.toLowerCase();
  if (key === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  } else if (key === 'y') {
    e.preventDefault();
    store.redo();
  } else if (key === 's') {
    e.preventDefault();
    void flushSave();
  } else if (key === 'c') {
    e.preventDefault();
    store.copyToClipboard();
  } else if (key === 'v') {
    e.preventDefault();
    store.pasteFromClipboard();
  }
}

function onBeforeUnload() {
  void flushSave();
}

onBeforeRouteLeave(async () => {
  await flushSave();
});

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('beforeunload', onBeforeUnload);
  await store.loadList();
  if (store.diagrams.length) {
    await store.loadDiagram(store.diagrams[0].id);
  } else {
    await store.createNew();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('beforeunload', onBeforeUnload);
  void flushSave();
});
</script>

<style scoped>
.lf-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}
.lf-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.lf-center {
  flex: 1;
  min-width: 0;
  position: relative;
  background: var(--kb-background, #fff);
}
</style>
