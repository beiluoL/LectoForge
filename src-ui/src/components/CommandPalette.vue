<template>
  <!-- 全局命令面板：挂到 body，脱离任何布局容器，保证任意页面按下 Cmd/Ctrl+K 都能弹出 -->
  <Teleport to="body">
    <Transition name="cmdk">
      <div v-if="isOpen" class="cmdk-overlay" @click.self="store.closePalette()">
        <div class="cmdk-card" role="dialog" aria-modal="true" aria-label="全局搜索">
          <!-- 顶部：搜索图标 + 输入框（自动聚焦）+ ESC 提示 -->
          <div class="cmdk-input-row">
            <Icon name="search" :size="18" class="cmdk-input-ic" />
            <input
              ref="inputRef"
              v-model="query"
              class="cmdk-input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="搜索收集箱、笔记、故事…"
              @input="onInput"
              @keydown="onKeydown"
            />
            <kbd class="cmdk-kbd">ESC</kbd>
          </div>

          <!-- 结果区 -->
          <div class="cmdk-list" ref="listRef">
            <!-- 加载中：骨架屏 -->
            <template v-if="loading">
              <div v-for="n in 3" :key="n" class="cmdk-row cmdk-skeleton-row" aria-hidden="true">
                <div class="cmdk-sk-ic"></div>
                <div class="cmdk-sk-lines">
                  <div class="cmdk-sk-line" style="width: 42%"></div>
                  <div class="cmdk-sk-line" style="width: 68%"></div>
                </div>
              </div>
            </template>

            <!-- 空态：未输入时给提示，有输入但无结果给「暂无结果」 -->
            <template v-else-if="results.length === 0">
              <div class="cmdk-empty">
                {{ query.trim() ? '暂无结果' : '输入关键词，搜索 收集箱 / 笔记 / 故事' }}
              </div>
            </template>

            <!-- 结果列表 -->
            <template v-else>
              <button
                v-for="(item, i) in results"
                :key="item.type + '-' + item.id"
                type="button"
                class="cmdk-row"
                :class="{ 'is-active': i === selectedIndex }"
                @mousemove="selectedIndex = i"
                @click="go(item)"
              >
                <span class="cmdk-row-ic">
                  <Icon :name="TYPE_META[item.type].icon" :size="16" />
                </span>
                <span class="cmdk-row-body">
                  <span class="cmdk-row-title">{{ item.title }}</span>
                  <span v-if="item.content" class="cmdk-row-content">{{ item.content }}</span>
                </span>
                <span class="cmdk-row-tag">{{ TYPE_META[item.type].label }}</span>
              </button>
            </template>
          </div>

          <!-- 底部：键盘操作提示 -->
          <div class="cmdk-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
            <span><kbd>↵</kbd> 打开</span>
            <span><kbd>esc</kbd> 关闭</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useDebounceFn } from '@vueuse/core';
import Icon from '@/components/ui/Icon.vue';
import { useSearchStore } from '@/store/search-store';
import { ENTITY_TYPE_META } from '@/constants/entity';
import type { SearchResult, SearchType } from '@/api/search';

const router = useRouter();
const store = useSearchStore();
const { isOpen, query, results, loading } = storeToRefs(store);

/**
 * 类型 → 图标 + 中文标签（图标走项目统一的 lucide 包装器 Icon.vue）。
 * 表本身收敛在 `@/constants/entity`，与 AI 关联面板、AI 洞察页共用同一份中文标签。
 * 这里保留 `Record<SearchType, …>` 标注当哨兵：搜索类型联合体将来新增成员而常量表
 * 没跟上时，编译期就会报错，而不是运行时渲染出 undefined。
 */
const TYPE_META: Record<SearchType, { icon: string; label: string }> = ENTITY_TYPE_META;

const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const selectedIndex = ref(0);

// 输入防抖 500ms 触发搜索（@vueuse/core）
const debouncedSearch = useDebounceFn((q: string) => {
  void store.performSearch(q);
}, 500);

function onInput() {
  debouncedSearch(query.value);
}

// 打开时自动聚焦输入框，并重置选中项
watch(
  () => store.isOpen,
  (open) => {
    if (open) {
      selectedIndex.value = 0;
      nextTick(() => inputRef.value?.focus());
    }
  },
);

// 结果变化（含搜索返回）重置选中项并滚动到顶部
watch(
  () => store.results,
  () => {
    selectedIndex.value = 0;
    nextTick(() => listRef.value?.scrollTo({ top: 0 }));
  },
);

// 选中项变化：滚动到可视区
watch(selectedIndex, () => {
  nextTick(() =>
    listRef.value?.querySelector('.cmdk-row.is-active')?.scrollIntoView({ block: 'nearest' }),
  );
});

/** 键盘导航：↑/↓ 切换选中行（循环），Enter 跳转 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (results.value.length) selectedIndex.value = (selectedIndex.value + 1) % results.value.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (results.value.length) selectedIndex.value = (selectedIndex.value - 1 + results.value.length) % results.value.length;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const item = results.value[selectedIndex.value];
    if (item) go(item);
  }
}

/** 跳转到目标页面并关闭面板 */
function go(item: SearchResult) {
  router.push(item.path);
  store.closePalette();
}
</script>

<style scoped>
/* 遮罩：半透明灰黑 + 毛玻璃；固定铺满，层级高于顶栏 */
.cmdk-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 14vh;
  background: rgba(15, 18, 24, 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
/* 主卡片：600px 宽，沿用 --kb-* 令牌以贴合整体设计语言（白/深色自适应） */
.cmdk-card {
  width: 600px;
  max-width: 92vw;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

/* 入场/出场：遮罩淡入淡出 + 卡片从 96% 缩放至 100%（模糊渐入效果） */
.cmdk-enter-active,
.cmdk-leave-active {
  transition: opacity 0.18s ease;
}
.cmdk-enter-active .cmdk-card,
.cmdk-leave-active .cmdk-card {
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}
.cmdk-enter-from,
.cmdk-leave-to {
  opacity: 0;
}
.cmdk-enter-from .cmdk-card,
.cmdk-leave-to .cmdk-card {
  transform: scale(0.96);
  opacity: 0;
}

/* 输入框行 */
.cmdk-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--kb-border);
}
.cmdk-input-ic {
  color: var(--kb-muted-foreground);
  flex-shrink: 0;
}
.cmdk-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--kb-foreground);
  font-size: 15px;
}
.cmdk-input::placeholder {
  color: var(--kb-muted-foreground);
}
.cmdk-kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid var(--kb-border);
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
}

/* 结果列表 */
.cmdk-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}
.cmdk-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border-radius: var(--kb-radius-md);
  border: none;
  background: transparent;
  color: var(--kb-foreground);
  cursor: pointer;
  transition: background 0.12s ease;
}
.cmdk-row.is-active {
  background: color-mix(in srgb, var(--kb-primary) 12%, var(--kb-card));
}
.cmdk-row-ic {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--kb-radius-sm);
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
  flex-shrink: 0;
}
.cmdk-row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cmdk-row-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cmdk-row-content {
  font-size: 12px;
  color: var(--kb-muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cmdk-row-tag {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
}

/* 空态 */
.cmdk-empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--kb-muted-foreground);
  font-size: 13px;
}

/* 骨架屏 */
.cmdk-skeleton-row {
  cursor: default;
}
.cmdk-sk-ic {
  width: 30px;
  height: 30px;
  border-radius: var(--kb-radius-sm);
  background: var(--kb-muted);
  flex-shrink: 0;
}
.cmdk-sk-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cmdk-sk-line {
  height: 10px;
  border-radius: 5px;
  background: var(--kb-muted);
}

/* 底部提示 */
.cmdk-foot {
  display: flex;
  gap: 16px;
  padding: 8px 16px;
  border-top: 1px solid var(--kb-border);
  font-size: 11px;
  color: var(--kb-muted-foreground);
}
.cmdk-foot kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 1px 5px;
  margin-right: 2px;
  border-radius: 4px;
  border: 1px solid var(--kb-border);
  background: var(--kb-muted);
}
</style>
