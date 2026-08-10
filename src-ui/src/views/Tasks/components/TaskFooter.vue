<template>
  <footer
    class="task-footer shrink-0 border-t px-6 py-3"
    :style="{ borderColor: 'var(--kb-border)', background: 'var(--kb-card)' }"
  >
    <div class="flex items-center gap-2">
      <Icon name="plus" size="sm" :style="{ color: 'var(--kb-muted-foreground)' }" />
      <input
        ref="input"
        v-model="draft"
        class="flex-1 bg-transparent outline-none text-sm placeholder:text-[var(--kb-muted-foreground)]"
        :placeholder="placeholder"
        :disabled="store.submitting"
        @keyup.enter="submit"
      />
      <button
        type="button"
        class="kb-btn kb-btn-primary kb-btn-sm"
        :disabled="!draft.trim() || store.submitting"
        @click="submit"
      >
        <span>添加</span>
      </button>
    </div>
  </footer>
</template>

<script setup lang="ts">
// 任务页底部常驻的新建栏：回车即新建。
// 不传 status / listId —— store.createTask 会按当前视图自动归位
// （在「今天」里建的任务就落在今天，无需再手动拖拽）。
import { computed, ref } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import { useTaskStore } from '@/store/task-store';

const store = useTaskStore();
const draft = ref('');
const input = ref<HTMLInputElement | null>(null);

const placeholder = computed(() => `在「${store.currentTitle}」中添加一个任务`);

function submit() {
  const title = draft.value.trim();
  if (!title || store.submitting) return;
  draft.value = '';
  store.createTask({ title });
}
</script>

<style scoped>
.task-footer:focus-within {
  /* 聚焦时给底部栏一点主色提示，呼应 macOS 输入框聚焦态 */
  box-shadow: inset 0 1px 0 0 color-mix(in srgb, var(--kb-primary) 30%, transparent);
}
</style>
