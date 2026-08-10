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

      <!-- 主体：标题 / 行内编辑 / 日期胶囊 -->
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

        <!-- 日期胶囊：目标日(橙) / 截止日(红)。点击胶囊 = 打开一体化日历弹窗。
             原生 <input type="date"> 已被 @vuepic/vue-datepicker 取代：
             - 触发点就是下面 #trigger 插槽渲染的胶囊；
             - 弹窗含：日历 + 时间选择 + 4 个快捷预设 + 「清除 / 确定」操作栏；
             - 红绿逻辑（targetDate / dueDate）与 store 调用完全不变，仅 UI 层替换。 -->
        <VueDatePicker
          ref="dpRef"
          :model-value="dateModel"
          :enable-time-picker="true"
          :is-24="true"
          :enable-seconds="false"
          :auto-apply="false"
          :clearable="false"
          :teleport="true"
          :dark="isDark"
          menu-class-name="lf-task-dp"
          class="lf-task-datepicker"
          @update:model-value="onPickerChange"
          @open="onPickerOpen"
        >
          <!-- 唯一触发点：日期胶囊。teleport 到 body 的浮层不在本子树内，
               故只能用 #trigger 插槽渲染触发元素；点击由根 div 的 onClick 负责 toggle，
               这里再 @click.stop 阻止冒泡到 task-row（否则会误触发标题行内编辑）。 -->
          <template #trigger>
            <button
              type="button"
              class="task-date-pill"
              :class="pillClass"
              @click.stop="dp()?.toggleMenu()"
            >
              <Icon :name="hasDate ? 'calendar' : 'calendar-plus'" size="xs" />
              <span>{{ pillLabel }}</span>
            </button>
          </template>

          <!-- 快捷预设：今天 15:00 / 今晚 18:00 / 下周 +7 / 某天（仅留日期） -->
          <template #action-extra>
            <div class="lf-dp-presets">
              <button type="button" class="lf-dp-preset" @click="presetToday">☀️ 今天</button>
              <button type="button" class="lf-dp-preset" @click="presetTonight">🌙 今晚</button>
              <button type="button" class="lf-dp-preset" @click="presetNextWeek">＋7 下周</button>
              <button type="button" class="lf-dp-preset" @click="presetSomeday">📦 某天</button>
            </div>
          </template>

          <!-- 一体化操作栏：清除（清空日期时间）/ 确定（落库后端） -->
          <template #action-row="{ internalModelValue, selectDate }">
            <div class="lf-dp-actions">
              <span class="lf-dp-preview">{{ formatPickerValue(internalModelValue) }}</span>
              <div class="lf-dp-btns">
                <button type="button" class="lf-dp-btn ghost" @click="onClearClick">清除</button>
                <button type="button" class="lf-dp-btn primary" @click="selectDate">确定</button>
              </div>
            </div>
          </template>
        </VueDatePicker>
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
// 日期控件从原生 <input type="date"> 升级为 @vuepic/vue-datepicker 一体化弹窗：
//   - 触发点 = 日期胶囊（#trigger 插槽），点击开/关弹窗；
//   - 弹窗 = 毛玻璃卡片（全局 style.css 的 .lf-task-dp 段覆盖 .dp__menu），
//     含日历 + 时间选择 + 4 个快捷预设 + 「清除 / 确定」；
//   - 后端只认 YYYY-MM-DD（taskService.normalizeDate 校验），「几点做」的 HH:mm
//     走 UI 层旁路存储 utils/taskTime.ts（localStorage），日期仍以服务端为准；
//   - 所有写操作仍只走 useTaskStore.updateTask，逻辑与红线约束完全不变。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import dayjs from 'dayjs';
import VueDatePicker from '@vuepic/vue-datepicker';
import Icon from '@/components/ui/Icon.vue';
import { useTaskStore } from '@/store/task-store';
import { readTaskTime, writeTaskTime } from '@/utils/taskTime';
import type { TaskNode } from '@/api/task';

interface Props {
  task: TaskNode;
  /** 高亮任务 id（从日历 /tasks?taskId= 跳入时定位） */
  highlightId?: number | null;
}
const props = withDefaults(defineProps<Props>(), { highlightId: null });

/* 组件暴露方法的最小子集（避免直接 any，集中在一处 cast） */
interface DpHandle {
  toggleMenu: () => void;
  clearValue: () => void;
  updateInternalModelValue: (v: Date | Date[] | null) => void;
  setMonthYear: (v: { month?: number | string; year?: number | string }) => void;
}
const dpRef = ref<InstanceType<typeof VueDatePicker> | null>(null);
function dp(): DpHandle | null {
  return (dpRef.value as unknown as DpHandle) ?? null;
}

const store = useTaskStore();
const root = ref<HTMLElement | null>(null);
const titleInput = ref<HTMLInputElement | null>(null);

const editingTitle = ref(false);
const titleDraft = ref('');
/** 弹窗内部模型：本地 Date（含时分）；null = 未选 */
const dateModel = ref<Date | null>(null);
/** 确定时是否以「全天（无时刻）」落库 */
const isAllDay = ref(true);

const isHighlight = computed(() => props.highlightId === props.task.id);

/* 暗色跟随全局 data-theme（浮层 teleport 到 body 后不再继承主题） */
const isDark = ref(false);
let themeObserver: MutationObserver | null = null;
function syncTheme() {
  isDark.value = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
}

/* ---------------- 胶囊展示 ---------------- */
const hasDate = computed(() => !!(props.task.targetDate || props.task.dueDate));
const pillClass = computed(() => (props.task.targetDate ? 'when' : 'due'));
const pillLabel = computed(() => {
  const d = props.task.targetDate || props.task.dueDate;
  if (!d) return '添加日期';
  const dt = dayjs(d);
  const wk = ['日', '一', '二', '三', '四', '五', '六'][dt.day()];
  const time = readTaskTime(props.task.id);
  return `${dt.month() + 1}月${dt.date()}日 周${wk}${time ? ' ' + time : ''}`;
});

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

/** 任务原本落在 targetDate 还是 dueDate（沿用原 onDateChange 的语义） */
function activeField(): 'targetDate' | 'dueDate' {
  return props.task.targetDate !== null ? 'targetDate' : 'dueDate';
}

/** 打开弹窗时，用任务现有日期 + 本地存储的时刻回填内部模型 */
function onPickerOpen() {
  syncTheme();
  const d = props.task.targetDate || props.task.dueDate;
  const t = readTaskTime(props.task.id);
  if (d) {
    const base = t ? `${d}T${t}` : `${d}T09:00`;
    const parsed = new Date(base);
    dateModel.value = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    isAllDay.value = !t;
  } else {
    dateModel.value = null;
    isAllDay.value = true;
  }
}

/** 确定 / 清除 都会走到这里：Date = 落库日期，null = 清空 */
function onPickerChange(value: Date | Date[] | null) {
  if (Array.isArray(value)) value = value[0] ?? null;
  const field = activeField();
  if (!value || !(value instanceof Date) || Number.isNaN(value.getTime())) {
    store.updateTask(props.task.id, { [field]: null } as { targetDate: null } | { dueDate: null });
    writeTaskTime(props.task.id, null);
    return;
  }
  const key = dateKeyOf(value);
  const time = isAllDay.value ? null : hhmmOf(value);
  store.updateTask(props.task.id, { [field]: key } as { targetDate: string } | { dueDate: string });
  writeTaskTime(props.task.id, time);
}

function onClearClick() {
  dp()?.clearValue(); // 内部会 emit update:model-value(null) → onPickerChange 清空
}

/* ---------------- 快捷预设 ---------------- */
function applyPreset(d: Date, allDay: boolean) {
  dateModel.value = d;
  isAllDay.value = allDay;
  dp()?.updateInternalModelValue(d);
  dp()?.setMonthYear({ month: d.getMonth(), year: d.getFullYear() });
}
function presetToday() {
  const d = new Date();
  d.setHours(15, 0, 0, 0);
  applyPreset(d, false);
}
function presetTonight() {
  const d = new Date();
  d.setHours(18, 0, 0, 0);
  applyPreset(d, false);
}
function presetNextWeek() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(9, 0, 0, 0);
  applyPreset(d, true);
}
function presetSomeday() {
  const base = dateModel.value ?? new Date();
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  applyPreset(d, true);
}

function onDelete() {
  store.deleteTask(props.task.id);
}

/* ---------------- 工具 ---------------- */
/** 本地 Date → YYYY-MM-DD（用本地年月日，绝不用 toISOString，避免跨时区错位） */
function dateKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
/** 本地 Date → HH:mm */
function hhmmOf(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** 操作栏预览：弹窗内当前选择 */
function formatPickerValue(v: Date | Date[] | null): string {
  if (!v) return '未选择日期';
  const d = Array.isArray(v) ? v[0] : v;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '未选择日期';
  const wk = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${wk} ${hhmmOf(d)}`;
}

/* ---------------- 高亮滚动定位 ---------------- */
function scrollToSelf() {
  root.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
watch(isHighlight, (v) => {
  if (v) scrollToSelf();
});

onMounted(() => {
  syncTheme();
  themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (isHighlight.value) nextTick(scrollToSelf);
});
onUnmounted(() => {
  themeObserver?.disconnect();
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
/* 对勾入场动画：scale(0)+rotate(-45deg) → scale(1)+rotate(0deg) */
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

/* 日期胶囊（= 日历弹窗唯一触发点）：「隐形胶囊」——极浅中性底 + 11px 字 + 全圆角。
   底色用 --kb-muted（浅 #E8ECF1 / 深 #252932），等价 bg-gray-100 dark:bg-neutral-800，
   但跟随 [data-theme] 切换；本项目 Tailwind 未开 class 暗色策略，dark: 变体不可靠。
   新增 .add 态（无日期）：幽灵描边，提示用户「可添加日期」。 */
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
/* 无日期：幽灵描边胶囊 */
.task-date-pill.add,
.task-date-pill:not(.when):not(.due) {
  background: transparent;
  border: 1px dashed var(--kb-border);
  color: var(--kb-muted-foreground);
}
.task-date-pill.add:hover,
.task-date-pill:not(.when):not(.due):hover {
  border-color: var(--kb-primary);
  color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 8%, transparent);
}

/* VueDatePicker 根（= 胶囊容器）：行内自适应宽度，不要撑满整行 */
.lf-task-datepicker {
  width: auto;
  display: inline-flex;
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
