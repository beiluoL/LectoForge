<template>
  <li class="out-item">
    <div class="out-row" :class="{ 'is-struct': item.kind === 'struct', 'is-active': activeId === item.id }" @click="$emit('pick', item)">
      <span class="out-ico">{{ iconOf(item) }}</span>
      <span class="out-label" :title="item.label">{{ item.label }}</span>
      <span class="out-shape">{{ item.shape }}</span>
    </div>
    <ul v-if="item.children && item.children.length" class="out-children">
      <DiagramOutlineTreeItem
        v-for="c in item.children"
        :key="c.id"
        :item="c"
        :active-id="activeId"
        @pick="$emit('pick', $event)"
      />
    </ul>
  </li>
</template>

<script setup lang="ts">
// 递归大纲树项（P2-T2.5）。组件以文件名自引用递归渲染，无需额外注册。
import type { OutlineItem } from './outlineTypes'

defineProps<{ item: OutlineItem; activeId?: string }>()
defineEmits<{ (e: 'pick', item: OutlineItem): void }>()

function iconOf(item: OutlineItem): string {
  if (item.kind === 'edge') return '↔'
  if (item.shape === 'container') return '▢'
  if (item.shape === 'swimlane') return '▤'
  if (item.shape === 'group') return '⊞'
  if (item.shape === 'class' || item.shape === 'interface') return '🅒'
  return '●'
}
</script>

<style scoped>
.out-item {
  list-style: none;
}
.out-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--kb-foreground, #0f172a);
}
.out-row:hover {
  background: var(--kb-background, #f1f5f9);
}
.out-row.is-active {
  background: color-mix(in srgb, var(--kb-primary, #3b6fe0) 14%, transparent);
}
.out-row.is-struct {
  font-weight: 600;
}
.out-ico {
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}
.out-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.out-shape {
  font-size: 10px;
  color: var(--kb-muted-foreground, #64748b);
  flex-shrink: 0;
}
.out-children {
  margin: 0;
  padding-left: 14px;
  border-left: 1px dashed var(--kb-border, #cbd5e1);
  margin-left: 8px;
}
</style>
