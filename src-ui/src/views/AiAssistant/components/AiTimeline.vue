<template>
  <!-- 悬浮对话大纲（DeepSeek 式时间线）：按钮展开后列出各消息前若干字摘要，点击滚动定位。 -->
  <div class="lf-timeline">
    <button type="button" class="lf-tl-btn" :class="{ on: open }" title="对话大纲" @click="open = !open">
      <Icon name="list" size="sm" />
      <span>大纲</span>
    </button>

    <div v-if="open" class="lf-tl-pop" @click.stop>
      <div class="lf-tl-head">对话大纲</div>
      <div class="lf-tl-list">
        <div v-if="!items.length" class="lf-tl-empty">暂无消息</div>
        <button
          v-for="(it, i) in items"
          :key="i"
          type="button"
          class="lf-tl-item"
          @click="onJump(i)"
        >
          <span class="lf-tl-role" :class="it.role">{{ it.role === 'user' ? '我' : 'AI' }}</span>
          <span class="lf-tl-text">{{ it.text }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import Icon from '@/components/ui/Icon.vue';
import type { ChatMessage } from '@/store/ai-assistant-store';

const props = defineProps<{ messages: ChatMessage[] }>();
const emit = defineEmits<{ (e: 'jump', index: number): void }>();

const open = ref(false);

// 仅展示有内容的消息；摘要取正文前 12 字（去换行）
const items = computed(() =>
  props.messages
    .map((m, i) => ({ i, role: m.role, text: (m.content || '').replace(/\s+/g, ' ').trim().slice(0, 12) || '（空）' }))
    .filter((x) => x.text !== '（空）'),
);

function onJump(index: number) {
  emit('jump', index);
  open.value = false;
}

// 点击外部关闭
function onDocClick(e: MouseEvent) {
  if (!open.value) return;
  const t = e.target as HTMLElement;
  if (!t.closest('.lf-timeline')) open.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>

<style scoped>
.lf-timeline {
  position: absolute;
  right: 20px;
  bottom: 92px;
  z-index: 30;
}
.lf-tl-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--kb-foreground);
  background: var(--kb-popover);
  border: 1px solid var(--kb-border);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.16);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.lf-tl-btn:hover,
.lf-tl-btn.on {
  color: var(--kb-primary);
  border-color: var(--kb-primary);
}
.lf-tl-pop {
  position: absolute;
  right: 0;
  bottom: 46px;
  width: 280px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: var(--kb-popover);
  border: 1px solid var(--kb-border);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}
.lf-tl-head {
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--kb-foreground);
  border-bottom: 1px solid var(--kb-border);
}
.lf-tl-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.lf-tl-empty {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.lf-tl-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px;
  border-radius: 8px;
  text-align: left;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--kb-foreground);
}
.lf-tl-item:hover {
  background: var(--kb-muted);
}
.lf-tl-role {
  flex-shrink: 0;
  width: 26px;
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 0;
  border-radius: 6px;
  color: var(--kb-primary-foreground);
  background: var(--kb-primary);
}
.lf-tl-role.user {
  color: var(--kb-foreground);
  background: var(--kb-muted);
}
.lf-tl-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
