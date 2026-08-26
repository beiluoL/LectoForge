<template>
  <aside
    class="task-sidebar flex h-full w-64 shrink-0 flex-col border-r border-[var(--kb-border)] pl-4 pr-3 pt-4 pb-4"
    :style="{ background: 'var(--kb-sidebar)' }"
  >
    <!-- 智能列表 -->
    <p class="sidebar-group-label">智能列表</p>
    <nav class="mt-1">
      <button
        v-for="s in smartLists"
        :key="s.key"
        type="button"
        class="side-item"
        :class="[{ active: store.currentView === s.key }, 'd0']"
        @click="store.selectView(s.key)"
      >
        <span class="side-selbar" :class="{ on: store.currentView === s.key }" aria-hidden="true"></span>
        <Icon :name="s.icon" size="sm" class="side-icon shrink-0" />
        <span class="flex-1 truncate text-left">{{ s.label }}</span>
        <span v-if="counterOf(s.key)" class="side-count">{{ counterOf(s.key) }}</span>
      </button>
    </nav>

    <div class="side-sep"></div>

    <!-- 自定义清单 -->
    <p class="sidebar-group-label">清单</p>
    <nav class="min-h-0 flex-1 overflow-y-auto">
      <button
        v-for="row in flatListRows"
        :key="row.list.id"
        type="button"
        class="side-item"
        :class="[{ active: store.currentView === `list:${row.list.id}` }, depthClass(row.depth)]"
        @click="store.selectView(`list:${row.list.id}`)"
      >
        <span class="side-selbar" :class="{ on: store.currentView === `list:${row.list.id}` }" aria-hidden="true"></span>
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
      <div v-if="addingList" class="pl-4 pt-1">
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
      <button v-else type="button" class="side-add d0" @click="startAddList">
        <span class="side-selbar" aria-hidden="true"></span>
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

/** 树状缩进：用 scoped 深度类（d0..d4）按 depth 递增，保证严格树形层级。
 * ⚠️ 不能用 Tailwind 的 pl-*：.side-item 的 scoped padding 简写优先级高于 pl-* 工具类，
 *    会把左内距压成 0，导致选中蓝条直接贴住图标（旧 bug）。这里改用 CSS 变量 --indent，
 *    深度类只设变量、.side-item 读取变量，绕开简写优先级冲突。 */
const depthClasses = ['d0', 'd1', 'd2', 'd3', 'd4'];
function depthClass(d: number): string {
  return depthClasses[Math.min(Math.max(d, 0), depthClasses.length - 1)];
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
  /* 上下与右内距固定；左内距交给 --indent 变量（由 d0..d4 深度类设置），
     避免 Tailwind pl-* 被本 scoped 简写覆盖。基准 4px + 指示条(3px) + gap(9px) ≈ 图标在 32px 处，
     与分组标题对齐。 */
  padding: 7px 8px 7px var(--indent, 4px);
  border-radius: var(--kb-radius-md);
  font-size: var(--kb-fs-body-sm);
  font-weight: 500;
  color: var(--kb-sidebar-foreground);
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
/* 树状缩进深度类：只设 --indent 变量，不直接写 padding-left（后者会被 .side-item 简写覆盖） */
.d0 { --indent: 4px; }
.d1 { --indent: 20px; }
.d2 { --indent: 36px; }
.d3 { --indent: 52px; }
.d4 { --indent: 68px; }
.side-item:hover {
  background: var(--kb-muted);
}
/* 选中态（Things 3）：极柔和主色底（5%）+ 主色字 + 字重微提。
   左侧 3px 指示条改用独立 .side-selbar 元素（固定宽度、透明占位），
   与图标间靠 flex gap 自然拉开间距，不再用 inset box-shadow（那条会把蓝条贴到图标上、压住左内距）。 */
.side-item.active {
  background: color-mix(in srgb, var(--kb-primary) 5%, transparent);
  color: var(--kb-primary);
  font-weight: 600;
}
/* 选中指示条：常驻占位（transparent）避免 active 切换时图标左右抖动；
   仅 .on 时填主色，3px 宽 + 圆角小药丸，高度固定不与整行等高。 */
.side-selbar {
  flex: none;
  width: 3px;
  height: 18px;
  border-radius: 9999px;
  background: transparent;
  transition: background 0.14s ease;
}
.side-selbar.on {
  background: var(--kb-primary);
}
/* 选中项 hover 不被中性灰盖掉，保持主色调性 */
.side-item.active:hover {
  background: color-mix(in srgb, var(--kb-primary) 9%, transparent);
}
.side-item.active .side-icon {
  color: var(--kb-primary);
}
/* 右侧徽章：圆角药丸。底色收回 CSS 用 token 表达——原先的
   bg-gray-200 dark:bg-neutral-700 在本项目暗色下不生效（Tailwind 未开 class 策略，
   且 style.css 只为 .bg-gray-50/100 做了 [data-theme] 兜底，.bg-gray-200 没有），
   会在深色侧边栏里留下一枚刺眼的亮灰药丸。 */
.side-count {
  flex: none;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 9999px;
  background: var(--kb-muted);
  font-size: var(--kb-fs-xs);
  font-weight: 600;
  line-height: 20px;
  text-align: center;
  color: var(--kb-muted-foreground);
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
  padding: 7px 8px 7px var(--indent, 4px);
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
