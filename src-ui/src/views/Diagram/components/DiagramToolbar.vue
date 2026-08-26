<template>
  <div class="lf-toolbar">
    <!-- 图文件切换 -->
    <div class="lf-tools">
      <select class="kb-select kb-select-sm" :value="currentDiagramId ?? ''" @change="onSwitch" v-tip="'切换流程图'">
        <option value="" disabled>选择流程图…</option>
        <option v-for="d in diagrams" :key="d.id" :value="d.id">{{ d.name }}</option>
      </select>
      <button class="kb-btn kb-btn-sm kb-btn-icon" v-tip="'删除此流程图'" :disabled="!currentDiagramId" @click="onDelete">
        <Icon name="trash-2" size="sm" />
      </button>
    </div>

    <span class="lf-sep" />

    <!-- 文件操作 -->
    <div class="lf-tools">
      <button class="kb-btn kb-btn-sm" v-tip="'新建流程图'" @click="onNew">
        <Icon name="file-plus" size="sm" /> 新建
      </button>
      <button class="kb-btn kb-btn-sm" v-tip="'立即保存'" :disabled="isSaving" @click="onSave">
        <Icon name="save" size="sm" /> {{ isSaving ? '保存中' : dirty ? '保存*' : '保存' }}
      </button>
      <button class="kb-btn kb-btn-sm" v-tip="'导出 PNG'" @click="emit('export-png')">
        <Icon name="image" size="sm" /> PNG
      </button>
      <button class="kb-btn kb-btn-sm" v-tip="'导出 SVG'" @click="store.exportToSVG()">
        <Icon name="file-image" size="sm" /> SVG
      </button>
      <button class="kb-btn kb-btn-sm lf-tpl-btn" v-tip="'模板库'" @click="emit('open-template')">
        <Icon name="layout-template" size="sm" /> 模板
      </button>
    </div>

    <span class="lf-sep" />

    <!-- AI 生成 / 自由画笔 -->
    <div class="lf-tools">
      <button class="kb-btn kb-btn-sm lf-ai-btn" :disabled="!currentDiagramId" @click="emit('ai-generate')" v-tip="'AI 生成流程图'">
        <Icon name="sparkles" size="xs" /> AI 生成
      </button>
      <button class="kb-btn kb-btn-sm" :class="{ 'is-active': penMode }" @click="togglePen" v-tip="'自由画笔'">
        <Icon name="pencil" size="xs" /> 画笔
      </button>
      <template v-if="penMode">
        <input type="color" class="lf-pen-color" :value="penBrush.color" v-tip="'画笔颜色'" @input="onPenColor($event, false)" @change="onPenColor($event, true)" />
        <input type="number" min="1" max="24" class="lf-pen-width" :value="penBrush.width" v-tip="'画笔线宽'" @change="onPenWidth" />
      </template>
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

    <!-- 批量对齐 / 分布（需选中 ≥2 节点） -->
    <div class="lf-tools lf-align">
      <button class="kb-btn kb-btn-sm" :disabled="selectedNodeIds.length < 2" @click="showAlign = !showAlign" v-tip="'对齐与分布'">
        对齐
      </button>
      <div v-if="showAlign" class="lf-align-menu" @mouseleave="showAlign = false">
        <p class="lf-align-title">对齐</p>
        <button type="button" class="lf-align-item" :disabled="selectedNodeIds.length < 2" @click="doAlign('left')">左对齐</button>
        <button type="button" class="lf-align-item" :disabled="selectedNodeIds.length < 2" @click="doAlign('right')">右对齐</button>
        <button type="button" class="lf-align-item" :disabled="selectedNodeIds.length < 2" @click="doAlign('top')">顶对齐</button>
        <button type="button" class="lf-align-item" :disabled="selectedNodeIds.length < 2" @click="doAlign('bottom')">底对齐</button>
        <button type="button" class="lf-align-item" :disabled="selectedNodeIds.length < 2" @click="doAlign('hcenter')">水平居中</button>
        <button type="button" class="lf-align-item" :disabled="selectedNodeIds.length < 2" @click="doAlign('vcenter')">垂直居中</button>
        <p class="lf-align-title">分布</p>
        <button type="button" class="lf-align-item" :disabled="selectedNodeIds.length < 3" @click="doDistribute('hdistribute')">水平等距</button>
        <button type="button" class="lf-align-item" :disabled="selectedNodeIds.length < 3" @click="doDistribute('vdistribute')">垂直等距</button>
      </div>
    </div>

    <span class="lf-sep" />

    <!-- 排版：文本色 / 填充色 / 描边色（应用到选中节点，同时作为新节点的默认笔刷） -->
    <div class="lf-tools">
      <label class="lf-color" v-tip="'文本色'">
        <span class="lf-color-dot" :style="{ background: selectedNode?.data?.textColor || brush.textColor }">A</span>
        <input
          type="color"
          :value="selectedNode?.data?.textColor || brush.textColor"
          @input="onColor('textColor', $event, false)"
          @change="onColor('textColor', $event, true)"
        />
      </label>
      <label class="lf-color" v-tip="'填充色'">
        <span class="lf-color-dot" :style="{ background: selectedNode?.data?.fill || brush.fill }">▣</span>
        <input
          type="color"
          :value="selectedNode?.data?.fill || brush.fill"
          @input="onColor('fill', $event, false)"
          @change="onColor('fill', $event, true)"
        />
      </label>
      <label class="lf-color" v-tip="'描边色'">
        <span class="lf-color-dot" :style="{ background: selectedNode?.data?.stroke || brush.stroke }">◯</span>
        <input
          type="color"
          :value="selectedNode?.data?.stroke || brush.stroke"
          @input="onColor('stroke', $event, false)"
          @change="onColor('stroke', $event, true)"
        />
      </label>
    </div>

    <span class="lf-sep" />

    <!-- 图层：撤销 / 重做 / 复制 / 删除 / 适应屏幕 / 自动布局 -->
    <div class="lf-tools">
      <button class="kb-btn kb-btn-icon" v-tip="'撤销'" :disabled="!canUndo" @click="store.undo()">
        <Icon name="undo-2" size="sm" />
      </button>
      <button class="kb-btn kb-btn-icon" v-tip="'重做'" :disabled="!canRedo" @click="store.redo()">
        <Icon name="redo-2" size="sm" />
      </button>
      <button class="kb-btn kb-btn-icon" v-tip="'复制选中'" :disabled="!hasSelection" @click="store.copyToClipboard()">
        <Icon name="copy" size="sm" />
      </button>
      <button class="kb-btn kb-btn-icon" v-tip="'删除选中'" :disabled="!hasSelection" @click="store.removeSelected()">
        <Icon name="trash-2" size="sm" />
      </button>
      <button class="kb-btn kb-btn-icon" v-tip="'适应屏幕'" @click="emit('fit')">
        <Icon name="maximize" size="sm" />
      </button>
      <button class="kb-btn kb-btn-icon" v-tip="'自动布局'" :disabled="!nodeCount" @click="emit('auto-layout')">
        <Icon name="layout" size="sm" />
      </button>
    </div>

    <span class="lf-spacer" />

    <!-- 文件名 -->
    <input
      class="lf-name-input"
      :value="currentName"
      spellcheck="false"
      @change="onRename"
      v-tip="'流程图名称'"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 顶栏工具栏。
 * - 文件：新建 / 保存（立即） / 导出 PNG（需画布 DOM，交给父组件 export-png 事件） / 导出 SVG；
 * - 连线样式：全局 edgeLineType（新连线与编辑时切换生效）；
 * - 排版：文本色 / 填充色 / 描边色，应用到当前选中节点，同时写入 brush 作为新节点默认；
 * - 图层：撤销 / 重做 / 复制 / 删除选中 / 适应屏幕 / 自动布局。
 */
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';

import Icon from '@/components/ui/Icon.vue';
import { useDiagramStore } from '@/store/diagram-store';
import { confirmDialog } from '@/utils/toast';

const emit = defineEmits<{ (e: 'export-png'): void; (e: 'fit'): void; (e: 'auto-layout'): void; (e: 'ai-generate'): void; (e: 'open-template'): void }>();

const store = useDiagramStore();
const { currentName, edgeLineType, brush, selectedNode, canUndo, canRedo, isSaving, dirty, diagrams, currentDiagramId, nodeCount, hasSelection, selectedNodeIds, penMode, penBrush } =
  storeToRefs(store);

function togglePen() {
  store.setPenMode(!penMode.value);
}
function onPenColor(e: Event, history: boolean) {
  const v = (e.target as HTMLInputElement).value;
  penBrush.value.color = v;
  // penBrush 不是落库对象，无需历史；history 形参保留以对齐其他颜色输入签名
  void history;
}
function onPenWidth(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  penBrush.value.width = Math.min(24, Math.max(1, v || 3));
}

const showAlign = ref(false);
function doAlign(mode: 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter') {
  store.alignNodes(mode);
  showAlign.value = false;
}
function doDistribute(mode: 'hdistribute' | 'vdistribute') {
  store.distributeNodes(mode);
  showAlign.value = false;
}

async function onSwitch(e: Event) {
  const id = Number((e.target as HTMLSelectElement).value);
  if (!id) return;
  // 切换前先落盘当前图，避免 <2s 内的未保存改动丢失
  if (currentDiagramId.value != null) await store.saveDiagram({ immediate: true });
  await store.loadDiagram(id);
}
async function onDelete() {
  if (!currentDiagramId.value) return;
  if (await confirmDialog('确定删除当前流程图？此操作不可撤销。')) {
    void store.remove(currentDiagramId.value);
  }
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
function onColor(field: 'textColor' | 'fill' | 'stroke', e: Event, history: boolean) {
  const value = (e.target as HTMLInputElement).value;
  brush.value[field] = value;
  const id = selectedNode.value?.id;
  if (id) store.patchNode(id, { [field]: value }, { history });
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
  background: var(--kb-background);
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
  background: var(--kb-background);
  color: var(--kb-foreground);
  font-size: 13px;
  flex-shrink: 0;
}
.lf-align {
  position: relative;
}
.lf-align-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 30;
  min-width: 116px;
  padding: 6px;
  background: var(--kb-popover);
  border: 1px solid var(--kb-border);
  border-radius: 8px;
  box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0, 0, 0, 0.1));
}
:root[data-theme='dark'] .lf-align-menu {
  background: var(--kb-card);
}
.lf-align-title {
  margin: 2px 4px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--kb-muted-foreground);
}
.lf-align-item {
  display: block;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--kb-foreground);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.lf-align-item:hover:not(:disabled) {
  background: var(--kb-muted);
}
.lf-align-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.lf-pen-color {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--kb-border);
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
.lf-pen-width {
  width: 52px;
  height: 28px;
  padding: 0 6px;
  border: 1px solid var(--kb-border);
  border-radius: 6px;
  background: var(--kb-background);
  color: var(--kb-foreground);
  font-size: 12px;
}
.lf-ai-btn {
  color: var(--kb-primary);
}
.lf-tpl-btn {
  color: var(--kb-foreground);
}
.kb-btn.is-active {
  background: var(--kb-primary);
  color: #fff;
  border-color: var(--kb-primary);
}
</style>
