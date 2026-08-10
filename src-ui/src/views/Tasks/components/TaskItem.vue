<template>
  <div>
    <!-- 单条任务：圆形复选框 + 标题 + 日期标签 + 悬停操作 -->
    <div
      ref="root"
      class="task-row group"
      :class="{ 'is-done': task.completed === 1, 'is-hl': isHighlight }"
      @click="onRowClick"
    >
      <!-- 圆形复选框：完成态填充主色，对勾以 <Transition> 缩放+旋转淡入 -->
      <button
        type="button"
        class="task-check"
        :class="{ done: task.completed === 1 }"
        :aria-checked="task.completed === 1"
        role="checkbox"
        :title="task.completed === 1 ? '标记为未完成' : '标记为完成'"
        @click.stop="onToggle"
      >
        <Transition name="check-pop">
          <Icon v-if="task.completed === 1" name="check" size="xs" :color="'var(--kb-primary-foreground)'" />
        </Transition>
      </button>

      <!-- 主体：标题 / 行内编辑 / 日期标签 -->
      <div class="task-main min-w-0 flex-1">
        <input
          v-if="editingTitle"
          ref="titleInput"
          v-model="titleDraft"
          class="task-title-input"
          :class="{ 'is-done': task.completed === 1 }"
          @click.stop
          @keyup.enter="commitTitle"
          @keyup.esc="cancelTitle"
          @blur="commitTitle"
        />
        <span
          v-else
          class="task-title"
          :class="{ 'is-done': task.completed === 1 }"
          :title="task.title"
        >{{ task.title }}</span>

        <!-- 日期标签：目标日(橙) / 截止日(红)。点击展开原生日期选择器 -->
        <div v-if="(task.targetDate || task.dueDate) && !editingDate" class="task-date-pill-wrap">
          <button
            type="button"
            class="task-date-pill"
            :class="task.targetDate ? 'when' : 'due'"
            @click.stop="editingDate = true"
          >
            <Icon :name="task.targetDate ? 'calendar' : 'alert-circle'" size="xs" />
            <span>{{ formatDate(task.targetDate || task.dueDate!) }}</span>
          </button>
        </div>
        <input
          v-else-if="editingDate"
          ref="dateInput"
          type="date"
          class="kb-input task-date-input"
          :value="task.targetDate || task.dueDate || ''"
          @click.stop
          @change="onDateChange"
          @blur="editingDate = false"
        />
      </div>

      <!-- 悬停操作：编辑 / 删除（仅 hover / 键盘聚焦时显现） -->
      <div
        class="task-actions opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <button type="button" class="task-action" title="重命名" @click.stop="startEditTitle">
          <Icon name="edit" size="xs" />
        </button>
        <button type="button" class="task-action danger" title="删除" @click.stop="onDelete">
          <Icon name="trash-2" size="xs" />
        </button>
      </div>
    </div>

    <!-- 子任务：缩进一层，递归复用自身 -->
    <div v-if="task.children.length" class="task-children">
      <TaskItem
        v-for="child in task.children"
        :key="child.id"
        :task="child"
        :highlight-id="highlightId"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// 单条任务的渲染单元（Things 3 行样式）。
// - 圆形复选框用 <Transition name="check-pop"> 做「缩放 0 → 1 + 旋转 -45° → 0°」淡入，
//   契合「勾选是一个有重量的动作」的 macOS 原生手感；
// - 目标日期标签用橙色（when）/ 截止日红色（due），点击就地改；
// - 子任务通过自身递归渲染（Vue3 <script setup> 支持按文件名自引用）；
// - 所有写操作直接走 useTaskStore：toggleComplete 乐观翻面+级联子任务，
//   updateTask 改标题/日期，deleteTask 乐观摘除。
// 本文件仅调整视觉尺寸/字体层级，逻辑与 store 绑定完全不变。
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import dayjs from 'dayjs';
import Icon from '@/components/ui/Icon.vue';
import { useTaskStore } from '@/store/task-store';
import type { TaskNode } from '@/api/task';

interface Props {
  task: TaskNode;
  /** 高亮任务 id（从日历 /tasks?taskId= 跳入时定位） */
  highlightId?: number | null;
}
const props = withDefaults(defineProps<Props>(), { highlightId: null });

const store = useTaskStore();
const root = ref<HTMLElement | null>(null);
const titleInput = ref<HTMLInputElement | null>(null);
const dateInput = ref<HTMLInputElement | null>(null);

const editingTitle = ref(false);
const titleDraft = ref('');
const editingDate = ref(false);

const isHighlight = computed(() => props.highlightId === props.task.id);

/* ---------------- 交互 ---------------- */
function onToggle() {
  store.toggleComplete(props.task.id);
}

function onRowClick() {
  if (!editingTitle.value) startEditTitle();
}

function startEditTitle() {
  titleDraft.value = props.task.title;
  editingTitle.value = true;
  nextTick(() => titleInput.value?.focus());
}
function commitTitle() {
  if (!editingTitle.value) return;
  editingTitle.value = false;
  const next = titleDraft.value.trim();
  if (next && next !== props.task.title) {
    store.updateTask(props.task.id, { title: next });
  }
}
function cancelTitle() {
  editingTitle.value = false;
}

function onDateChange(e: Event) {
  const v = (e.target as HTMLInputElement).value || null;
  editingDate.value = false;
  // 优先写「目标日」；若该任务只有截止日（dueDate 非空、targetDate 为空），则改截止日
  if (props.task.targetDate !== null) {
    store.updateTask(props.task.id, { targetDate: v });
  } else {
    store.updateTask(props.task.id, { dueDate: v });
  }
}

function onDelete() {
  store.deleteTask(props.task.id);
}

/* ---------------- 工具 ---------------- */
/** YYYY-MM-DD → 「今天 / 明天 / 昨天 / M月D日」，纯展示（不含周几，胶囊更紧凑） */
function formatDate(d: string): string {
  const dt = dayjs(d);
  const wk = ['日', '一', '二', '三', '四', '五', '六'][dt.day()];
  return `${dt.month() + 1}月${dt.date()}日 周${wk}`;
}

/* ---------------- 高亮滚动定位 ---------------- */
function scrollToSelf() {
  root.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
watch(isHighlight, (v) => {
  if (v) scrollToSelf();
});
onMounted(() => {
  if (isHighlight.value) nextTick(scrollToSelf);
});
</script>

<style scoped>
.task-row {
  display: flex;
  align-items: center;
  gap: 10px;
  /* 行内一致内边距：左右 16px / 上下 12px，整行约 44–50px，可点击区域均匀 */
  padding: 12px 16px;
  border-radius: var(--kb-radius-md);
  cursor: default;
  transition: background 0.14s ease;
}
.task-row:hover {
  background: var(--kb-muted);
}
.task-row.is-hl {
  box-shadow: 0 0 0 2px var(--kb-warning);
}

/* 圆形复选框：20px / 2px 边，token 色 */
.task-check {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  border: 2px solid var(--kb-border);
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}
.task-check:hover {
  border-color: var(--kb-primary);
}
.task-check.done {
  border-color: var(--kb-primary);
  background: var(--kb-primary);
}
/* 对勾入场动画：scale(0)+rotate(-45deg) → scale(1)+rotate(0) */
.check-pop-enter-active {
  transition: transform 0.18s ease, opacity 0.18s ease;
}
.check-pop-enter-from {
  transform: scale(0) rotate(-45deg);
  opacity: 0;
}
.check-pop-enter-to {
  transform: scale(1) rotate(0deg);
  opacity: 1;
}

.task-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.task-title {
  /* 标题：text-sm / medium / 前景色 */
  font-size: var(--kb-fs-body-md);
  font-weight: 500;
  color: var(--kb-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.14s ease;
}
.task-title.is-done {
  color: var(--kb-muted-foreground);
  text-decoration: line-through;
}
.task-title-input {
  flex: 1;
  min-width: 0;
  font-size: var(--kb-fs-body-md);
  border: none;
  outline: none;
  background: transparent;
  color: var(--kb-foreground);
}

/* 日期标签：「隐形胶囊」——极浅中性底 + 11px 字 + 全圆角，紧凑如 [ 8月9日 ]。
   底色用 --kb-muted（浅 #E8ECF1 / 深 #252932），等价于 bg-gray-100 dark:bg-neutral-800，
   但跟随 [data-theme] 切换；本项目 Tailwind 未开 class 暗色策略，dark: 变体不可靠。 */
.task-date-pill-wrap {
  flex: none;
}
.task-date-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--kb-fs-xs);
  font-weight: 500;
  line-height: 1;
  padding: 3px 7px;
  border-radius: 9999px;
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.task-date-pill:hover {
  background: var(--kb-border);
  color: var(--kb-foreground);
}
/* 目标日：完全中性，不抢视线 */
.task-date-pill.when {
  color: var(--kb-muted-foreground);
}
/* 截止日：保留语义——只把文字染成警示色，背景仍是那层极浅中性底 */
.task-date-pill.due {
  color: var(--kb-destructive);
}
.task-date-pill.due:hover {
  color: var(--kb-destructive);
  background: color-mix(in srgb, var(--kb-destructive) 12%, transparent);
}
.task-date-input {
  flex: none;
  width: 150px;
  font-size: var(--kb-fs-caption);
  padding: 2px 6px;
}

/* 悬停操作 */
.task-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
/* 图标按钮容器化：28px（w-7 h-7）实心圆形命中区，hover 浮出底色形成「可按压的实体按钮」，
   :active 轻微回弹，替代原先「点一个虚无图标」的手感 */
.task-action {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease, transform 0.1s ease;
}
.task-action:hover {
  background: var(--kb-border);
  color: var(--kb-foreground);
}
.task-action:active {
  transform: scale(0.92);
}
.task-action.danger:hover {
  color: var(--kb-destructive);
  background: color-mix(in srgb, var(--kb-destructive) 12%, transparent);
}

/* 子任务缩进 */
.task-children {
  padding-left: 22px;
}
</style>
