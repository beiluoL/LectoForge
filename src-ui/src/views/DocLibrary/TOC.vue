<template>
  <aside class="dl-col-right" aria-label="文档大纲">
    <div class="dl-pane-head">
      <span class="dl-pane-title">
        <Icon name="list-tree" size="sm" />
        大纲
      </span>
      <span class="flex-1"></span>
      <span v-if="!isEmpty" class="dl-toc-count">{{ toc.length }}</span>
    </div>

    <nav class="dl-scroll" aria-label="标题导航">
      <!-- 没打开文件 / 文档里没有标题，都属于正常状态，给一句轻提示而不是留白 -->
      <p v-if="!docState.activeNoteId" class="dl-empty-sm">打开一篇笔记后<br />这里会列出它的标题结构</p>

      <p v-else-if="isEmpty" class="dl-empty-sm">
        本文还没有标题<br />
        用 <code class="dl-kbd"># 标题</code> 试试
      </p>

      <div v-else class="dl-toc">
        <button
          v-for="item in toc"
          :key="item.anchorId"
          type="button"
          class="dl-toc-item"
          :class="{ 'is-current': item.anchorId === activeAnchor }"
          :data-level="item.level"
          :style="{ paddingLeft: `${8 + (item.level - minLevel) * 12}px` }"
          :title="item.title"
          @click="emit('jump', item.anchorId)"
        >
          {{ item.title }}
        </button>
      </div>
    </nav>
  </aside>
</template>

<script setup lang="ts">
// 右栏：文档大纲（TOC）。
// 纯展示组件——大纲数据全部由 useTOC 从当前 Markdown 正文实时算出，
// 点击只负责把 anchorId 冒泡给父组件，滚动动作由持有预览区 DOM 的 EditorArea 执行。
import Icon from '@/components/ui/Icon.vue'

import { docState } from './useDocStore'
import { useTOC } from './useTOC'

defineProps<{
  /** 当前视口所在标题的锚点 id，用于高亮 */
  activeAnchor: string
}>()

const emit = defineEmits<{
  (e: 'jump', anchorId: string): void
}>()

/* 传 getter 而不是 ref：docState 是 reactive 对象，
 * docState.currentContent 直接取值会丢响应性。 */
const { toc, minLevel, isEmpty } = useTOC(() => docState.currentContent)
</script>

<style scoped>
.dl-toc-count {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
  font-size: var(--kb-fs-xs);
  font-family: var(--font-mono);
}

.dl-kbd {
  padding: 1px 5px;
  border-radius: var(--kb-radius-sm);
  background: var(--kb-muted);
  color: var(--kb-foreground);
  font-family: var(--font-mono);
  font-size: 11px;
}
</style>
