<template>
  <div class="lf-pages">
    <div class="lf-pages-scroll">
      <div
        v-for="(p, i) in pages"
        :key="p.id"
        class="lf-page-tab"
        :class="{ 'is-active': p.id === currentPageId, 'is-dragging': dragIndex === i }"
        draggable="true"
        :title="p.name"
        @click="onSwitch(p.id)"
        @dragstart="onDragStart(i, $event)"
        @dragover.prevent="onDragOver(i)"
        @drop.prevent="onDrop(i)"
        @dragend="dragIndex = -1"
      >
        <input
          v-if="editingId === p.id"
          class="lf-page-input"
          :value="p.name"
          spellcheck="false"
          @click.stop
          @change="onRename(p.id, $event)"
          @blur="editingId = null"
          @keydown.enter="editingId = null"
        />
        <span v-else class="lf-page-name" @dblclick.stop="startRename(p.id)">{{ p.name }}</span>
        <span class="lf-page-count">{{ p.nodes.length }}</span>
        <button
          v-if="pages.length > 1"
          class="lf-page-del"
          title="删除此页"
          @click.stop="onDelete(p.id)"
        >
          <Icon name="x" size="xs" />
        </button>
      </div>

      <button class="lf-page-add" title="新增页面" @click="onAdd">
        <Icon name="plus" size="xs" /> 页面
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 底部多页管理栏（对标 ProcessOn / Excel 的 Sheet 栏）。
 * - 点击页签切换（store.setActivePage 会先把当前页同步回 pages 再加载目标页）；
 * - 双击页签名重命名；删除需多页且二次确认；
 * - 拖拽页签重排页面顺序（HTML5 draggable）。
 */
import { ref } from 'vue';
import { storeToRefs } from 'pinia';

import Icon from '@/components/ui/Icon.vue';
import { useDiagramStore } from '@/store/diagram-store';
import { confirmDialog } from '@/utils/toast';

const store = useDiagramStore();
const { pages, currentPageId } = storeToRefs(store);

const editingId = ref<string | null>(null);
const dragIndex = ref(-1);

function onSwitch(id: string) {
  if (id === currentPageId.value) return;
  void store.setActivePage(id);
}
function onAdd() {
  void store.addPage();
}
function startRename(id: string) {
  editingId.value = id;
}
function onRename(id: string, e: Event) {
  const val = (e.target as HTMLInputElement).value.trim();
  if (val) store.renamePage(id, val);
  editingId.value = null;
}
async function onDelete(id: string) {
  if (await confirmDialog('确定删除此页面？该页节点与连线将一并移除。')) {
    store.removePage(id);
  }
}
function onDragStart(i: number, e: DragEvent) {
  dragIndex.value = i;
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function onDragOver(i: number) {
  if (dragIndex.value >= 0 && dragIndex.value !== i) {
    // 实时预览：先把数组挪过去，drop 时再正式提交（避免抖动）
    dragIndex.value = i;
  }
}
function onDrop(i: number) {
  if (dragIndex.value >= 0 && dragIndex.value !== i) {
    store.movePage(dragIndex.value, i);
  }
  dragIndex.value = -1;
}
</script>

<style scoped>
.lf-pages {
  flex-shrink: 0;
  height: 38px;
  display: flex;
  align-items: center;
  border-top: 1px solid var(--kb-border);
  background: var(--kb-background, #fff);
  padding: 0 8px;
  box-sizing: border-box;
}
:global(.dark) .lf-pages {
  background: var(--kb-card, #1f1f1f);
}
.lf-pages-scroll {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  width: 100%;
}
.lf-page-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 160px;
  padding: 4px 8px;
  border: 1px solid var(--kb-border);
  border-radius: 6px;
  background: var(--kb-muted, #f8fafc);
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
}
:global(.dark) .lf-page-tab {
  background: #2a2a2a;
}
.lf-page-tab.is-active {
  border-color: var(--kb-primary, #3b6fe0);
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
}
.lf-page-tab.is-dragging {
  opacity: 0.5;
}
.lf-page-name {
  font-size: 12px;
  color: var(--kb-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lf-page-input {
  width: 110px;
  font-size: 12px;
  border: 1px solid var(--kb-primary, #3b6fe0);
  border-radius: 4px;
  padding: 1px 4px;
  background: var(--kb-background, #fff);
  color: var(--kb-foreground);
}
.lf-page-count {
  font-size: 11px;
  color: var(--kb-muted-foreground);
  background: color-mix(in srgb, var(--kb-muted-foreground) 14%, transparent);
  border-radius: 8px;
  padding: 0 6px;
  flex-shrink: 0;
}
.lf-page-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  flex-shrink: 0;
}
.lf-page-del:hover {
  color: var(--kb-destructive, #dc2626);
  background: color-mix(in srgb, var(--kb-destructive) 12%, transparent);
}
.lf-page-add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px dashed var(--kb-border);
  border-radius: 6px;
  background: transparent;
  color: var(--kb-foreground);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}
.lf-page-add:hover {
  border-color: var(--kb-primary, #3b6fe0);
  color: var(--kb-primary, #3b6fe0);
}
</style>
