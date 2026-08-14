<template>
  <!-- AI 助手主容器：左侧会话管理栏 + 右侧对话区，整体 Flex 铺满父级。 -->
  <div class="lf-assistant">
    <AiSidebar v-if="!collapsed" @collapse="collapsed = true" />
    <button v-else type="button" class="lf-expand" title="展开会话列表" @click="collapsed = false">
      <Icon name="panel-left" size="sm" />
    </button>
    <AiChatView />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

import Icon from '@/components/ui/Icon.vue';
import AiSidebar from './components/AiSidebar.vue';
import AiChatView from './components/AiChatView.vue';
import { useAiAssistantStore } from '@/store/ai-assistant-store';

const store = useAiAssistantStore();
const collapsed = ref(false);

onMounted(async () => {
  await store.fetchConversations();
  // 自动打开最近一次会话（后端已按置顶+更新时间排序，[0] 即最新）
  if (!store.currentConversationId && store.conversations.length) {
    await store.selectConversation(store.conversations[0].id);
  }
});
</script>

<style scoped>
.lf-assistant {
  display: flex;
  height: 100%;
  min-height: 0;
  background: var(--kb-background);
}
.lf-expand {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 100%;
  color: var(--kb-muted-foreground);
  background: var(--kb-card);
  border: none;
  border-right: 1px solid var(--kb-border);
  cursor: pointer;
}
.lf-expand:hover {
  color: var(--kb-primary);
  background: var(--kb-muted);
}
</style>
