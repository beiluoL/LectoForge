<template>
  <div class="lf-x6-test-node">{{ label }}</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

// @antv/x6-vue-shape 渲染组件时传入 { node, graph } 两个 prop，
// 节点业务数据通过 node.getData() 读取（非直接拆成 props）。
const props = defineProps<{ node?: any; graph?: any }>()

const label = computed(() => {
  const data = props.node?.getData?.()
  return (data && data.text) || 'hello-x6'
})
</script>

<style scoped>
.lf-x6-test-node {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: #e11d48;
  font-weight: 600;
  font-size: 13px;
  user-select: none;
}
</style>
