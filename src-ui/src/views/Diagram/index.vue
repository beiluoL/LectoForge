<template>
  <div class="lf-root">
    <DiagramToolbar @export-png="onExportPng" @fit="onFit" />
    <div class="lf-body">
      <DiagramLibrary />
      <div ref="centerEl" class="lf-center">
        <DiagramCanvas ref="canvasRef" />
      </div>
      <DiagramProperties />
    </div>
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
import { onMounted, ref } from 'vue';

import { useDiagramStore } from '@/store/diagram-store';
import DiagramCanvas from './components/DiagramCanvas.vue';
import DiagramLibrary from './components/DiagramLibrary.vue';
import DiagramProperties from './components/DiagramProperties.vue';
import DiagramToolbar from './components/DiagramToolbar.vue';

const store = useDiagramStore();
const centerEl = ref<HTMLElement | null>(null);
const canvasRef = ref<InstanceType<typeof DiagramCanvas> | null>(null);

function onExportPng() {
  if (centerEl.value) void store.exportToPNG(centerEl.value);
}
function onFit() {
  canvasRef.value?.fitNow();
}

onMounted(async () => {
  await store.loadList();
  if (store.diagrams.length) {
    await store.loadDiagram(store.diagrams[0].id);
  } else {
    await store.createNew();
  }
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
