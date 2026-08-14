<template>
  <div class="lf-toolbar">
    <!-- 图文件切换 -->
    <div class="lf-tools">
      <select class="kb-select kb-select-sm" :value="currentDiagramId ?? ''" @change="onSwitch" title="切换流程图">
        <option value="" disabled>选择流程图…</option>
        <option v-for="d in diagrams" :key="d.id" :value="d.id">{{ d.name }}</option>
      </select>
      <button class="kb-btn kb-btn-icon" title="删除此流程图" :disabled="!currentDiagramId" @click="onDelete">
        <Icon name="trash-2" size="sm" />
      </button>
    </div>

    <span class="lf-sep" />

    <!-- 文件操作 -->
    <div class="lf-tools">
      <button class="kb-btn kb-btn-sm" title="新建流程图" @click="onNew">
        <Icon name="file-plus" size="xs" /> 新建
      </button>
      <button class="kb-btn kb-btn-sm" title="立即保存" :disabled="isSaving" @click="onSave">
        <Icon name="save" size="xs" /> {{ isSaving ? '保存中' : dirty ? '保存*' : '保存' }}
      </button>
      <button class="kb-btn kb-btn-sm" title="导出 PNG" @click="emit('export-png')">
        <Icon name="image" size="xs" /> PNG
      </button>
      <button class="kb-btn kb-btn-sm" title="导出 SVG" @click="store.exportToSVG()">
        <Icon name="file-image" size="xs" /> SVG
      </button>
    </div>

    <span class="lf-sep" />

    <!-- 连线样式（全局） -->
    <div class="lf-tools">
      <label class="lf-field">
        <span class="lf-field-label">连线</span>
        <select v-model="edgeLineType" class="kb-select kb-select-sm">
          <option value="smoothstep">折线</option>
          <option value="bezier">曲线</option>
          <option value="straight">直线</option>
        </select>
      </label>
    </div>

    <span class="lf-sep" />

    <!-- 排版：文本色 / 填充色 / 描边色（应用到选中节点，同时作为新节点的默认笔刷） -->
    <div class="lf-tools">
      <label class="lf-color" title="文本色">
        <span class="lf-color-dot" :style="{ background: selectedNode?.data?.textColor || brush.textColor }">A</span>
        <input type="color" :value="selectedNode?.data?.textColor || brush.textColor" @input="onColor('textColor', $event)" />
      </label>
      <label class="lf-color" title="填充色">
        <span class="lf-color-dot" :style="{ background: selectedNode?.data?.fill || brush.fill }">▣</span>
        <input type="color" :value="selectedNode?.data?.fill || brush.fill" @input="onColor('fill', $event)" />
      </label>
      <label class="lf-color" title="描边色">
        <span class="lf-color-dot" :style="{ background: selectedNode?.data?.stroke || brush.stroke }">◯</span>
        <input type="color" :value="selectedNode?.data?.stroke || brush.stroke" @input="onColor('stroke', $event)" />
      </label>
    </div>

    <span class="lf-sep" />

    <!-- 图层：撤销 / 重做 / 删除 / 适应屏幕 -->
    <div class="lf-tools">
      <button class="kb-btn kb-btn-icon" title="撤销" :disabled="!canUndo" @click="store.undo()">
        <Icon name="undo-2" size="sm" />
      </button>
      <button class="kb-btn kb-btn-icon" title="重做" :disabled="!canRedo" @click="store.redo()">
        <Icon name="redo-2" size="sm" />
      </button>
      <button class="kb-btn kb-btn-icon" title="删除选中" :disabled="!hasSelection" @click="store.removeSelected()">
        <Icon name="trash-2" size="sm" />
      </button>
      <button class="kb-btn kb-btn-icon" title="适应屏幕" @click="emit('fit')">
        <Icon name="maximize" size="sm" />
      </button>
    </div>

    <span class="lf-spacer" />

    <!-- 文件名 -->
    <input
      class="lf-name-input"
      :value="currentName"
      spellcheck="false"
      @change="onRename"
      title="流程图名称"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 顶栏工具栏。
 * - 文件：新建 / 保存（立即） / 导出 PNG（需画布 DOM，交给父组件 export-png 事件） / 导出 SVG；
 * - 连线样式：全局 edgeLineType（新连线与编辑时切换生效）；
 * - 排版：文本色 / 填充色 / 描边色，应用到当前选中节点，同时写入 brush 作为新节点默认；
 * - 图层：撤销 / 重做 / 删除选中 / 适应屏幕。
 */
import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import Icon from '@/components/ui/Icon.vue';
import { useDiagramStore } from '@/store/diagram-store';

const emit = defineEmits<{ (e: 'export-png'): void; (e: 'fit'): void }>();

const store = useDiagramStore();
const { currentName, edgeLineType, brush, selectedNode, canUndo, canRedo, isSaving, dirty, diagrams, currentDiagramId } =
  storeToRefs(store);

const hasSelection = computed(() => !!(selectedNode.value || store.selectedEdge));

async function onSwitch(e: Event) {
  const id = Number((e.target as HTMLSelectElement).value);
  if (!id) return;
  // 切换前先落盘当前图，避免 <2s 内的未保存改动丢失
  if (currentDiagramId.value != null) await store.saveDiagram({ immediate: true });
  await store.loadDiagram(id);
}
function onDelete() {
  if (!currentDiagramId.value) return;
  if (!window.confirm('确定删除当前流程图？此操作不可撤销。')) return;
  void store.remove(currentDiagramId.value);
}
function onNew() {
  void store.createNew();
}
function onSave() {
  void store.saveDiagram({ immediate: true });
}
function onRename(e: Event) {
  store.rename((e.target as HTMLInputElement).value);
}
function onColor(field: 'textColor' | 'fill' | 'stroke', e: Event) {
  const value = (e.target as HTMLInputElement).value;
  brush.value[field] = value;
  const id = selectedNode.value?.id;
  if (id) store.patchNode(id, { [field]: value });
}
</script>

<style scoped>
.lf-toolbar {
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--kb-border);
  background: var(--kb-background, #fff);
  box-sizing: border-box;
  overflow-x: auto;
}
.lf-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}
.lf-sep {
  width: 1px;
  height: 22px;
  background: var(--kb-border);
  flex-shrink: 0;
}
.lf-spacer {
  flex: 1;
}
.lf-field {
  display: flex;
  align-items: center;
  gap: 4px;
}
.lf-field-label {
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.lf-color {
  position: relative;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--kb-border);
  border-radius: 6px;
  cursor: pointer;
  overflow: hidden;
}
.lf-color-dot {
  font-size: 13px;
  line-height: 1;
  color: #fff;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}
.lf-color input[type='color'] {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  border: none;
  padding: 0;
}
.lf-name-input {
  width: 180px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--kb-border);
  border-radius: 6px;
  background: var(--kb-background, #fff);
  color: var(--kb-foreground);
  font-size: 13px;
  flex-shrink: 0;
}
</style>
