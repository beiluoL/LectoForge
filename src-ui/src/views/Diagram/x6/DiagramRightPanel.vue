<template>
  <aside class="x6-right">
    <div class="x6-right-tabs">
      <button class="x6-right-tab" :class="{ on: tab === 'style' }" @click="tab = 'style'">格式</button>
      <button class="x6-right-tab" :class="{ on: tab === 'layers' }" @click="tab = 'layers'">
        图层<span v-if="layersBadge" class="x6-right-badge">{{ layersBadge }}</span>
      </button>
      <button class="x6-right-tab" :class="{ on: tab === 'outline' }" @click="tab = 'outline'">大纲</button>
    </div>
    <div class="x6-right-body">
      <DiagramProperties v-if="tab === 'style'" />
      <DiagramLayersPanel v-else-if="tab === 'layers'" />
      <DiagramOutlinePanel v-else-if="tab === 'outline'" />
    </div>
  </aside>
</template>

<script setup lang="ts">
/**
 * 右侧面板容器（P2-T2）：三个 Tab —— 格式（属性）/ 图层（P2-T2.4）/ 大纲（P2-T2.5）。
 * 经 provide 注入的 graph 消费；子面板各自 only 消费、不持有 graph 实例。
 */
import { ref } from 'vue'
import DiagramProperties from './DiagramProperties.vue'
import DiagramLayersPanel from './DiagramLayersPanel.vue'
import DiagramOutlinePanel from './DiagramOutlinePanel.vue'

const tab = ref<'style' | 'layers' | 'outline'>('style')
// 占位：将来可从图层面板统计实际图层数；当前固定空（不强制 badge）
const layersBadge = ref('')
</script>

<style scoped>
.x6-right {
  width: 264px;
  flex-shrink: 0;
  border-left: 1px solid var(--kb-border, #e2e8f0);
  background: var(--kb-card, #fff);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.x6-right-tabs {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid var(--kb-border, #e2e8f0);
}
.x6-right-tab {
  flex: 1;
  height: 38px;
  border: none;
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  color: var(--kb-muted-foreground, #64748b);
  border-bottom: 2px solid transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.x6-right-tab.on {
  color: var(--kb-primary, #3b6fe0);
  border-bottom-color: var(--kb-primary, #3b6fe0);
  font-weight: 600;
}
.x6-right-badge {
  font-size: 10px;
  background: var(--kb-muted, #e2e8f0);
  color: var(--kb-foreground, #0f172a);
  border-radius: 8px;
  padding: 0 5px;
  line-height: 16px;
}
.x6-right-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
</style>
