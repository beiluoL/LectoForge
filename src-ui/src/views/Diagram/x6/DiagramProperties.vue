<template>
  <aside class="x6-props">
    <div class="x6-props-tabs">
      <button class="x6-props-tab" :class="{ on: tab === 'draw' }" @click="tab = 'draw'">绘图</button>
      <button class="x6-props-tab" :class="{ on: tab === 'style' }" @click="tab = 'style'">样式</button>
    </div>
    <div class="x6-props-body">
      <DrawPanel v-if="tab === 'draw'" />
      <template v-else>
        <NodeStylePanel />
        <EdgeStylePanel />
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
/**
 * X6 方案 B 右侧属性面板容器（P1-T4）：「绘图」全局设置 + 「样式」节点/连线面板。
 * 经 provide 注入的 graph 消费，本身不持有 graph 实例。
 */
import { ref } from 'vue'
import DrawPanel from './panels/DrawPanel.vue'
import NodeStylePanel from './panels/NodeStylePanel.vue'
import EdgeStylePanel from './panels/EdgeStylePanel.vue'

const tab = ref<'draw' | 'style'>('style')
</script>

<style scoped>
.x6-props {
  width: 264px;
  flex-shrink: 0;
  border-left: 1px solid var(--kb-border, #e2e8f0);
  background: var(--kb-card, #fff);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.x6-props-tabs {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid var(--kb-border, #e2e8f0);
}
.x6-props-tab {
  flex: 1;
  height: 38px;
  border: none;
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  color: var(--kb-muted-foreground, #64748b);
  border-bottom: 2px solid transparent;
}
.x6-props-tab.on {
  color: var(--kb-primary, #3b6fe0);
  border-bottom-color: var(--kb-primary, #3b6fe0);
  font-weight: 600;
}
.x6-props-body {
  flex: 1;
}
</style>
