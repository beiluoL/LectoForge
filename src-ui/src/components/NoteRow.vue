<script lang="ts">
/**
 * 列表行视图模型。与 WorkbenchNotes.vue 内的 noteCards computed 同源，
 * 抽成导出类型避免两处各自声明后字段漂移。
 */
export interface NoteCardVm {
  /** 原始对象：动作回调（打开/删除/转卡片）仍需要它 */
  raw: import('@/api/types').WbNote
  id: number
  title: string
  preview: string
  tags: string[]
  /** 'due' | 'new' | 其它，决定徽章与高亮 */
  srs: string
  hint: string
  mastery: number
  masteryColor: string
}
</script>

<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import type { WbNote } from '@/api/types'

const props = defineProps<{ card: NoteCardVm }>()

const emit = defineEmits<{
  open: [WbNote]
  toReview: [WbNote]
  toStory: [WbNote]
  remove: [WbNote]
}>()

function onOpen() {
  emit('open', props.card.raw)
}
function onReview() {
  emit('toReview', props.card.raw)
}
function onStory() {
  emit('toStory', props.card.raw)
}
function onRemove() {
  emit('remove', props.card.raw)
}
</script>

<template>
  <div
    class="note-row"
    :class="{ 'is-due': card.srs === 'due' }"
    tabindex="0"
    @click="onOpen"
    @keydown.enter="onOpen"
  >
    <span class="note-row-dot" :style="{ background: card.masteryColor }"></span>
    <div class="note-row-main">
      <div class="note-row-titleline">
        <span class="note-row-title">{{ card.title }}</span>
        <span v-if="card.srs === 'due'" class="note-badge note-badge-due note-badge-sm">需复习 🔥</span>
        <span v-else-if="card.srs === 'new'" class="note-badge note-badge-new note-badge-sm">待首复习</span>
      </div>
      <p class="note-row-preview">{{ card.preview }}</p>
    </div>

    <div class="note-row-mastery">
      <div class="note-mastery-track">
        <span class="note-mastery-fill" :style="{ width: `${card.mastery}%`, background: card.masteryColor }"></span>
      </div>
      <span class="note-mastery-num" :style="{ color: card.masteryColor }">{{ card.mastery }}%</span>
    </div>

    <span class="note-row-hint">{{ card.hint }}</span>

    <div class="note-card-actions" @click.stop>
      <button class="wb-icon-btn" title="转为复习卡" @click="onReview"><Icon name="repeat" :size="14" /></button>
      <button class="wb-icon-btn" title="转为故事" @click="onStory"><Icon name="wand-2" :size="14" /></button>
      <button class="wb-icon-btn note-danger-btn" title="删除" @click="onRemove"><Icon name="trash-2" :size="14" /></button>
    </div>
  </div>
</template>

<style scoped>
/* 紧凑行：固定高度由根元素 --note-row-h 单向下发，行内全部 nowrap + ellipsis，
   不换行，因此定高安全。虚拟滚动的位移计算依赖这个高度与 ROW_HEIGHT 完全一致。 */
.note-row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--note-row-h, 61px);
  padding: 0 14px;
  border-bottom: 1px solid var(--kb-border);
  cursor: pointer;
  transition: background 0.15s ease;
}
.note-row:last-child {
  border-bottom: none;
}
.note-row:hover {
  background: color-mix(in srgb, var(--mc) 4%, transparent);
}
.note-row:focus-visible {
  outline: 2px solid var(--mc);
  outline-offset: -2px;
}
.note-row.is-due {
  box-shadow: inset 3px 0 0 var(--kb-destructive);
}
.note-row-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.note-row-main {
  flex: 1 1 auto;
  min-width: 0;
}
.note-row-titleline {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.note-row-title {
  font-size: var(--kb-fs-body-sm);
  font-weight: 600;
  color: var(--kb-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.note-row-preview {
  margin: 2px 0 0;
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.note-row-mastery {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  width: 130px;
}
.note-row-mastery .note-mastery-track {
  flex: 1 1 auto;
}
.note-row-hint {
  flex: none;
  width: 96px;
  text-align: right;
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
}

/* 行内动作按钮的悬停揭示：行 hover / 键盘聚焦时淡入 */
.note-row:hover .note-card-actions,
.note-row:focus-within .note-card-actions {
  opacity: 1;
}

/* 窄屏：掌握度与提示占太大，隐藏以保标题行清爽 */
@media (max-width: 900px) {
  .note-row-mastery,
  .note-row-hint {
    display: none;
  }
}
</style>
