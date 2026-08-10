<template>
  <aside
    class="task-sidebar flex flex-col shrink-0 border-r h-full"
    :style="{ width: '244px', background: 'var(--kb-sidebar)', borderColor: 'var(--kb-border)' }"
  >
    <!-- 智能列表 -->
    <div class="px-3 pt-4 pb-1">
      <p class="sidebar-group-label">智能列表</p>
    </div>
    <nav class="px-2 space-y-0.5">
      <button
        v-for="s in smartLists"
        :key="s.key"
        type="button"
        class="sidebar-item"
        :class="{ active: store.currentView === s.key }"
        @click="store.selectView(s.key)"
      >
        <Icon :name="s.icon" size="sm" class="shrink-0" />
        <span class="flex-1 text-left truncate">{{ s.label }}</span>
        <span v-if="counterOf(s.key)" class="sidebar-count">{{ counterOf(s.key) }}</span>
      </button>
    </nav>

    <!-- 自定义清单 -->
    <div class="px-3 pt-5 pb-1 flex items-center justify-between">
      <p class="sidebar-group-label">清单</p>
    </div>
    <nav class="px-2 space-y-0.5 flex-1 min-h-0 overflow-y-auto">
      <button
        v-for="row in flatListRows"
        :key="row.list.id"
        type="button"
        class="sidebar-item"
        :class="{ active: store.currentView === `list:${row.list.id}` }"
        :style="{ paddingLeft: 10 + row.depth * 14 + 'px' }"
        @click="store.selectView(`list:${row.list.id}`)"
      >
        <Icon :name="iconFor(row.list)" size="xs" class="shrink-0" :style="{ color: row.list.color }" />
        <span class="flex-1 text-left truncate">{{ row.list.name }}</span>
        <span v-if="row.list.openCount" class="sidebar-count">{{ row.list.openCount }}</span>
      </button>

      <!-- 新建清单行 -->
      <div v-if="addingList" class="px-1 pt-1">
        <input
          ref="listInput"
          v-model="newListName"
          class="kb-input text-sm"
          placeholder="清单名称"
          @keyup.enter="confirmAddList"
          @keyup.esc="cancelAddList"
          @blur="confirmAddList"
        />
      </div>
      <button v-else type="button" class="sidebar-add" @click="startAddList">
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
.sidebar-group-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--kb-muted-foreground);
}
.sidebar-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--kb-radius-md);
  font-size: 13px;
  font-weight: 500;
  color: var(--kb-sidebar-foreground);
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.sidebar-item:hover {
  background: var(--kb-muted);
}
.sidebar-item.active {
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
  color: var(--kb-primary);
}
.sidebar-count {
  flex: none;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
  color: var(--kb-muted-foreground);
  background: var(--kb-muted);
}
.sidebar-item.active .sidebar-count {
  color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 15%, transparent);
}
.sidebar-add {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 10px;
  margin-top: 2px;
  border-radius: var(--kb-radius-md);
  font-size: 13px;
  font-weight: 500;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.sidebar-add:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}
</style>
