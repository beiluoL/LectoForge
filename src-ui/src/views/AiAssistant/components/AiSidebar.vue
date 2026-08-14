<template>
  <!-- 会话管理侧边栏：搜索 + 列表 + 更多菜单（重命名/置顶/分享/删除）+ 折叠。
       配色全部走 --kb-* token（明暗同源），不写死颜色。 -->
  <aside class="lf-sidebar">
    <!-- 顶部：标题 + 折叠按钮 -->
    <header class="lf-side-head">
      <span class="lf-side-title">对话</span>
      <button type="button" class="lf-icon-btn" title="收起" @click="$emit('collapse')">
        <Icon name="panel-left-close" size="sm" />
      </button>
    </header>

    <!-- 新建对话 -->
    <button type="button" class="lf-new" @click="store.createNew()">
      <Icon name="plus" size="sm" />
      <span>新对话</span>
    </button>

    <!-- 搜索 -->
    <div class="lf-search">
      <Icon name="search" size="sm" />
      <input
        v-model="searchLocal"
        type="text"
        class="lf-search-input"
        placeholder="搜索对话…"
        @input="onSearchInput"
      />
    </div>

    <!-- 会话列表 -->
    <div class="lf-list">
      <div v-if="!store.conversations.length" class="lf-empty">还没有对话，点「新对话」开始吧</div>

      <div
        v-for="c in store.conversations"
        :key="c.id"
        class="lf-item"
        :class="{ active: store.currentConversationId === c.id }"
        @click="onSelect(c.id)"
      >
        <!-- 重命名就地编辑 -->
        <input
          v-if="renamingId === c.id"
          ref="renameInput"
          v-model="renameDraft"
          class="lf-item-rename"
          @click.stop
          @keyup.enter="commitRename(c.id)"
          @keyup.esc="cancelRename"
          @blur="commitRename(c.id)"
        />
        <template v-else>
          <Icon v-if="c.pinned" name="pin" size="sm" class="lf-pin" />
          <span class="lf-item-title">{{ c.title }}</span>
        </template>

        <!-- 更多菜单按钮 -->
        <button
          v-if="renamingId !== c.id"
          type="button"
          class="lf-more"
          :data-menu="c.id"
          title="更多"
          @click.stop="toggleMenu(c.id)"
        >
          <Icon name="more-horizontal" size="sm" />
        </button>

        <!-- 更多菜单气泡 -->
        <div v-if="openMenuId === c.id" class="lf-menu" :data-menu="c.id" @click.stop>
          <button type="button" @click="startRename(c.id)">
            <Icon name="pencil" size="sm" /> 重命名
          </button>
          <button type="button" @click="onTogglePin(c)">
            <Icon :name="c.pinned ? 'pin-off' : 'pin'" size="sm" />
            {{ c.pinned ? '取消置顶' : '置顶' }}
          </button>
          <button type="button" @click="onShare(c.id)">
            <Icon name="share-2" size="sm" /> 分享
          </button>
          <button type="button" class="danger" @click="onDelete(c)">
            <Icon name="trash-2" size="sm" /> 删除
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

import Icon from '@/components/ui/Icon.vue';
import { useAiAssistantStore } from '@/store/ai-assistant-store';
import { getMessages } from '@/api/aiAssistant';
import { notify } from '@/utils/toast';

const emit = defineEmits<{ (e: 'collapse'): void }>();
const store = useAiAssistantStore();

const searchLocal = ref('');
const openMenuId = ref<number | null>(null);
const renamingId = ref<number | null>(null);
const renameDraft = ref('');
const renameInput = ref<HTMLInputElement | null>(null);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => store.setSearch(searchLocal.value), 250);
}

function onSelect(id: number) {
  if (renamingId.value != null) return;
  void store.selectConversation(id);
}

function toggleMenu(id: number) {
  openMenuId.value = openMenuId.value === id ? null : id;
}

// 点击菜单外部关闭（功能等价于 @vueuse/core 的 onClickOutside，但无需新增依赖）
function onDocClick(e: MouseEvent) {
  if (openMenuId.value == null) return;
  const t = e.target as HTMLElement;
  if (!t.closest('[data-menu]')) openMenuId.value = null;
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

function startRename(id: number) {
  const c = store.conversations.find((x) => x.id === id);
  renameDraft.value = c?.title || '';
  renamingId.value = id;
  openMenuId.value = null;
  nextTick(() => renameInput.value?.focus());
}
function commitRename(id: number) {
  if (renamingId.value !== id) return;
  const draft = renameDraft.value.trim();
  renamingId.value = null;
  if (draft) void store.renameConversation(id, draft);
}
function cancelRename() {
  renamingId.value = null;
}

async function onTogglePin(c: { id: number; pinned: number }) {
  openMenuId.value = null;
  await store.togglePin(c.id, c.pinned ? 0 : 1);
}

async function onDelete(c: { id: number; title: string }) {
  openMenuId.value = null;
  if (!window.confirm(`确定删除对话「${c.title}」？该对话下的所有消息将一并删除。`)) return;
  await store.removeConversation(c.id);
  notify('对话已删除', 'success');
}

/** 分享：把整段对话导出为纯文本复制到剪贴板（离线优先，不依赖后端分享端点） */
async function onShare(id: number) {
  openMenuId.value = null;
  try {
    const msgs = await getMessages(id);
    const text = msgs
      .map((m) => `${m.role === 'user' ? '我' : 'AI'}：${m.content}`)
      .join('\n\n');
    await navigator.clipboard.writeText(text);
    notify('对话已复制到剪贴板', 'success');
  } catch {
    notify('复制失败，请稍后重试', 'error');
  }
}
</script>

<style scoped>
.lf-sidebar {
  width: 260px;
  flex-shrink: 0;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--kb-border);
  background: var(--kb-card);
  color: var(--kb-card-foreground);
}

.lf-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 8px;
}
.lf-side-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--kb-foreground);
}
.lf-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--kb-muted-foreground);
  background: transparent;
  border: none;
  cursor: pointer;
}
.lf-icon-btn:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}

.lf-new {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 12px 8px;
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--kb-primary-foreground);
  background: var(--kb-primary);
  border: none;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.lf-new:hover {
  opacity: 0.9;
}

.lf-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 12px 8px;
  padding: 7px 10px;
  border-radius: 9px;
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
  color: var(--kb-muted-foreground);
}
.lf-search :deep(svg) {
  flex-shrink: 0;
}
.lf-search-input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  font-family: inherit;
  color: var(--kb-foreground);
}

.lf-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.lf-empty {
  margin: 24px 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--kb-muted-foreground);
  text-align: center;
}

.lf-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  border-radius: 9px;
  cursor: pointer;
  color: var(--kb-foreground);
  transition: background 0.12s ease;
}
.lf-item:hover {
  background: var(--kb-muted);
}
.lf-item.active {
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
}
.lf-pin {
  flex-shrink: 0;
  color: var(--kb-primary);
}
.lf-item-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lf-item-rename {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid var(--kb-primary);
  outline: none;
  background: var(--kb-background);
  color: var(--kb-foreground);
  font-family: inherit;
}
.lf-more {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--kb-muted-foreground);
  background: transparent;
  border: none;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease;
}
.lf-item:hover .lf-more {
  opacity: 1;
}
.lf-more:hover {
  background: var(--kb-background);
  color: var(--kb-foreground);
}

.lf-menu {
  position: absolute;
  right: 8px;
  top: 38px;
  z-index: 20;
  min-width: 132px;
  padding: 4px;
  border-radius: 10px;
  background: var(--kb-popover, var(--kb-card));
  border: 1px solid var(--kb-border);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
}
.lf-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 7px;
  font-size: 13px;
  text-align: left;
  color: var(--kb-foreground);
  background: transparent;
  border: none;
  cursor: pointer;
}
.lf-menu button:hover {
  background: var(--kb-muted);
}
.lf-menu button.danger {
  color: var(--kb-destructive, #d92d20);
}
.lf-menu button.danger:hover {
  background: color-mix(in srgb, var(--kb-destructive, #d92d20) 12%, transparent);
}
</style>
