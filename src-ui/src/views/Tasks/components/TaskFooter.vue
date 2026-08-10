<template>
  <!-- 底部内联新建栏：透明底色，悬停/聚焦时背景浮出，左侧 + 图标仅 hover/聚焦显现；
       不含独立按钮，回车即新建。mt-auto / shrink-0 由 TaskView 注入，钉在视图最底部。 -->
  <footer
    class="task-footer group mx-3 mb-3 flex shrink-0 cursor-text items-center gap-3 rounded-xl px-4 py-2.5 backdrop-blur-md"
    @click="focusInput"
  >
    <Icon
      name="plus"
      size="xs"
      class="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      :style="{ color: 'var(--kb-muted-foreground)' }"
    />
    <input
      ref="input"
      v-model="draft"
      class="flex-1 border-0 bg-transparent p-0 text-[length:var(--kb-fs-body-sm)] text-[var(--kb-foreground)] outline-none placeholder:text-[var(--kb-muted-foreground)]"
      :placeholder="placeholder"
      :disabled="store.submitting"
      @keyup.enter="submit"
    />
  </footer>
</template>

<script setup lang="ts">
// 任务页底部常驻的新建栏：回车即新建。
// 不传 status / listId —— store.createTask 会按当前视图自动归位
// （在「今天」里建的任务就落在今天，无需再手动拖拽）。
// 视觉重构为透明内联输入（去掉原蓝色「添加」按钮），逻辑与 store 绑定不变。
import { computed, ref } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import { useTaskStore } from '@/store/task-store';

const store = useTaskStore();
const draft = ref('');
const input = ref<HTMLInputElement | null>(null);

const placeholder = computed(() => `在「${store.currentTitle}」中添加一个任务`);

function focusInput() {
  input.value?.focus();
}

function submit() {
  const title = draft.value.trim();
  if (!title || store.submitting) return;
  draft.value = '';
  store.createTask({ title });
}
</script>

<style scoped>
/* 「半透明便签纸」：静息时 70% 的 --kb-background 浮在 --kb-card 之上，
   与背景融合、边框透明；聚焦时升起为实色 card + 主色描边 + 轻微投影。
   ⚠️ 不能用 bg-white/70：父级 .task-view 本身就是 --kb-card(#FFFFFF)，
   白叠白合成后完全不可见；改用 --kb-background 才有可读的层次差。
   ⚠️ 也不用 dark: 变体：本项目 Tailwind 走 media 策略、主题却挂在
   [data-theme]，dark: 不跟随应用内主题切换。token 天然跟随。 */
.task-footer {
  background: color-mix(in srgb, var(--kb-background) 70%, transparent);
  border: 1px solid transparent;
  transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}
.task-footer:hover {
  background: color-mix(in srgb, var(--kb-background) 90%, transparent);
}
.task-footer:focus-within {
  background: var(--kb-card);
  border-color: var(--kb-primary);
  box-shadow: 0 2px 10px rgb(0 0 0 / 6%);
}
</style>
