<template>
  <aside
    class="task-sidebar flex h-full w-64 shrink-0 flex-col border-r"
    :style="{ background: 'var(--kb-sidebar)', borderColor: 'var(--kb-border)' }"
  >
    <!-- 智能列表 -->
    <p class="sidebar-group-label">智能列表</p>
    <nav class="mt-1 px-2">
      <button
        v-for="s in smartLists"
        :key="s.key"
        type="button"
        class="side-item"
        :class="{ active: store.currentView === s.key }"
        @click="store.selectView(s.key)"
      >
        <Icon :name="s.icon" size="sm" class="side-icon shrink-0" />
        <span class="flex-1 truncate text-left">{{ s.label }}</span>
        <span v-if="counterOf(s.key)" class="side-count">{{ counterOf(s.key) }}</span>
      </button>
    </nav>

    <div class="side-sep"></div>

    <!-- 自定义清单 -->
    <p class="sidebar-group-label">清单</p>
    <nav class="min-h-0 flex-1 overflow-y-auto px-2">
      <button
        v-for="row in flatListRows"
        :key="row.list.id"
        type="button"
        class="side-item"
        :class="{ active: store.currentView === `list:${row.list.id}` }"
        :style="{ paddingLeft: 8 + row.depth * 14 + 'px' }"
        @click="store.selectView(`list:${row.list.id}`)"
      >
        <Icon
          :name="iconFor(row.list)"
          size="xs"
          class="shrink-0"
          :style="{ color: row.list.color || 'var(--kb-muted-foreground)' }"
        />
        <span class="flex-1 truncate text-left">{{ row.list.name }}</span>
        <span v-if="row.list.openCount" class="side-count">{{ row.list.openCount }}</span>
      </button>

      <!-- 新建清单行 -->
      <div v-if="addingList" class="px-1 pt-1">
        <input
          ref="listInput"
          v-model="newListName"
          class="kb-input text-[length:var(--kb-fs-body-sm)]"
          placeholder="清单名称"
          @keyup.enter="confirmAddList"
          @keyup.esc="cancelAddList"
          @blur="confirmAddList"
        />
      </div>
      <button v-else type="button" class="side-add" @click="startAddList">
        <Icon name="plus" size="xs" />
        <span>新建清单</span>
      </button>
    </nav>
  </aside>
</template>

<script setup lang="ts">
// 任务模块左侧栏：五个智能列表 + 自定义清单树 + 新建清单。
// 树在 JS 层先拍平成「带 depth 的扁平数组」再一次性 v-for（不嵌套递归模板），
// 既支持 area→project→list 任意层级，又避免递归组件带来的类型/key 复杂度。
// 计数统一读 store.counters（智能列表）与 list.openCount（清单）。
// 本文件仅做视觉/布局重构，所有 store 绑定与业务逻辑保持不变。
import { computed, nextTick, ref } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import { useTaskStore } from '@/store/task-store';
import type { TaskList, TaskStatus } from '@/api/task';

const store = useTaskStore();

interface SmartItem {
  key: TaskStatus;
  label: string;
  icon: string;
}
// 顺序对齐 Things 3：收件箱 / 今天 / 计划 / 某天 / 日志本
const smartLists: SmartItem[] = [
  { key: 'inbox', label: '收件箱', icon: 'inbox' },
  { key: 'today', label: '今天', icon: 'calendar-check' },
  { key: 'upcoming', label: '计划', icon: 'calendar' },
  { key: 'someday', label: '某天', icon: 'cloud' },
  { key: 'logbook', label: '日志本', icon: 'book-check' },
];

function counterOf(key: TaskStatus): number {
  return (store.counters as Record<string, number>)[key] ?? 0;
}

/** 清单树拍平（保留 depth），单次 v-for 渲染 */
const flatListRows = computed<{ list: TaskList; depth: number }[]>(() => {
  const out: { list: TaskList; depth: number }[] = [];
  const walk = (arr: TaskList[], d: number) => {
    arr.forEach((l) => {
      out.push({ list: l, depth: d });
      if (l.children?.length) walk(l.children, d + 1);
    });
  };
  walk(store.lists, 0);
  return out;
});

function iconFor(list: TaskList): string {
  if (list.type === 'area') return 'layers';
  if (list.type === 'project') return 'folder-open';
  return 'list';
}

/* ---------------- 新建清单 ---------------- */
const addingList = ref(false);
const newListName = ref('');
const listInput = ref<HTMLInputElement | null>(null);

function startAddList() {
  addingList.value = true;
  newListName.value = '';
  nextTick(() => listInput.value?.focus());
}
function confirmAddList() {
  if (!addingList.value) return;
  const name = newListName.value.trim();
  addingList.value = false;
  newListName.value = '';
  if (name) store.createList({ name, type: 'list' });
}
function cancelAddList() {
  addingList.value = false;
  newListName.value = '';
}
</script>

<style scoped>
/* 分组小标题：caption 字号 + 大写 + 宽字距，对齐设计系统 --kb-fs-caption */
.sidebar-group-label {
  padding: 16px 16px 8px;
  font-size: var(--kb-fs-caption);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--kb-muted-foreground);
}
.side-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 8px;
  border-radius: var(--kb-radius-md);
  font-size: var(--kb-fs-body-sm);
  font-weight: 500;
  color: var(--kb-sidebar-foreground);
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.side-item:hover {
  background: var(--kb-muted);
}
/* 选中态：极柔和主色底 + 主色字（等价于 bg-primary/10） */
.side-item.active {
  background: color-mix(in srgb, var(--kb-primary) 10%, transparent);
  color: var(--kb-primary);
}
.side-item.active .side-icon {
  color: var(--kb-primary);
}
/* 右侧徽章：ml-auto 右对齐 + 浅灰圆角胶囊 */
.side-count {
  flex: none;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 9999px;
  font-size: var(--kb-fs-xs);
  font-weight: 600;
  line-height: 20px;
  text-align: center;
  color: var(--kb-muted-foreground);
  background: var(--kb-muted);
}
.side-item.active .side-count {
  color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 16%, transparent);
}
.side-sep {
  height: 1px;
  margin: 10px 16px;
  background: var(--kb-border);
}
.side-add {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 8px;
  margin-top: 2px;
  border-radius: var(--kb-radius-md);
  font-size: var(--kb-fs-body-sm);
  font-weight: 500;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.side-add:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}
</style>
