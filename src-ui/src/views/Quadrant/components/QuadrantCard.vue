<template>
  <section
    class="qd-card"
    :class="{ 'is-dropping': dropping }"
    :style="{ '--q-color': meta.color, '--q-soft': softColor }"
    @dragover.prevent="onDragOver"
    @dragleave="dropping = false"
    @drop.prevent="onDrop"
  >
    <!-- 顶部色条：四个象限唯一的强色出现处，卡片其余部分保持中性， -->
    <!-- 避免四块高饱和色并排时整页变成调色盘 -->
    <span class="qd-stripe"></span>

    <!-- ===== 头部 ===== -->
    <header class="qd-head">
      <span class="qd-badge">{{ meta.order }}</span>
      <span class="qd-head-icon"><Icon :name="meta.icon" :size="15" /></span>
      <div class="qd-head-text">
        <h2 class="qd-title">{{ meta.label }}</h2>
        <p class="qd-hint">{{ meta.hint }}</p>
      </div>

      <span v-if="pending.length" class="qd-count">{{ pending.length }}</span>

      <!-- 更多菜单 -->
      <div class="qd-menu-wrap">
        <button class="qd-icon-btn" title="更多" @click.stop="menuOpen = !menuOpen">
          <Icon name="more-horizontal" :size="15" />
        </button>
        <div v-if="menuOpen" class="qd-menu" @click.stop>
          <button class="qd-menu-item" @click="onMenu('add')">
            <Icon name="plus" :size="14" />
            添加任务
          </button>
          <button
            class="qd-menu-item"
            :disabled="!done.length"
            @click="onMenu('clear')"
          >
            <Icon name="eraser" :size="14" />
            清空已完成（{{ done.length }}）
          </button>
        </div>
      </div>

      <button class="qd-icon-btn qd-add" title="添加任务" @click="emit('add', meta.key)">
        <Icon name="plus" :size="16" />
      </button>
    </header>

    <!-- ===== 任务区 ===== -->
    <div class="qd-body">
      <!-- 空态 -->
      <div v-if="!tasks.length" class="qd-empty">
        <Icon name="inbox" :size="20" />
        <p>暂无任务</p>
        <button class="qd-empty-add" @click="emit('add', meta.key)">添加一条</button>
      </div>

      <template v-else>
        <!-- 未完成 -->
        <ul class="qd-list">
          <li
            v-for="task in pending"
            :key="task.id"
            class="qd-item"
            draggable="true"
            @dragstart="onDragStart($event, task)"
            @dragend="emit('drag-end')"
            @dblclick="emit('edit', task)"
          >
            <!-- 圆形勾选框：原生 input 保留键盘可达性，外观用 appearance:none 重绘。
                 刻意用 :checked + @change 而不是 v-model —— completed 是 0/1 数字，
                 v-model 会把它写成布尔，破坏与后端的字段类型契约。 -->
            <input
              class="qd-check"
              type="checkbox"
              :checked="task.completed === 1"
              :aria-label="`完成 ${task.title}`"
              @change="emit('toggle', task.id)"
            />

            <div class="qd-item-main">
              <p class="qd-item-title">{{ task.title }}</p>
              <div v-if="task.scheduledAt || tagsOf(task).length" class="qd-item-meta">
                <span
                  v-if="task.scheduledAt"
                  class="qd-time"
                  :class="{ 'is-overdue': isOverdue(task.scheduledAt) }"
                >
                  <Icon name="clock" :size="11" />
                  {{ formatScheduleTime(task.scheduledAt) }}
                </span>
                <span v-for="t in tagsOf(task)" :key="t" class="qd-tag">{{ t }}</span>
              </div>
            </div>

            <div class="qd-item-actions">
              <button class="qd-icon-btn qd-tiny" title="编辑" @click.stop="emit('edit', task)">
                <Icon name="pencil" :size="13" />
              </button>
              <button class="qd-icon-btn qd-tiny qd-danger" title="删除" @click.stop="emit('remove', task.id)">
                <Icon name="trash-2" :size="13" />
              </button>
              <span class="qd-grip" title="拖拽到其他象限">
                <Icon name="grip-vertical" :size="13" />
              </span>
            </div>
          </li>
        </ul>

        <!-- 已完成（默认折叠） -->
        <div v-if="done.length" class="qd-done">
          <button class="qd-done-toggle" @click="doneOpen = !doneOpen">
            <Icon :name="doneOpen ? 'chevron-down' : 'chevron-right'" :size="13" />
            已完成 {{ done.length }}
          </button>
          <ul v-if="doneOpen" class="qd-list">
            <li v-for="task in done" :key="task.id" class="qd-item is-done">
              <input
                class="qd-check"
                type="checkbox"
                checked
                :aria-label="`取消完成 ${task.title}`"
                @change="emit('toggle', task.id)"
              />
              <div class="qd-item-main">
                <p class="qd-item-title">{{ task.title }}</p>
              </div>
              <div class="qd-item-actions">
                <button class="qd-icon-btn qd-tiny qd-danger" title="删除" @click.stop="emit('remove', task.id)">
                  <Icon name="trash-2" :size="13" />
                </button>
              </div>
            </li>
          </ul>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import type { QuadrantKey, QuadrantTask } from '@/api/quadrant';
import type { QuadrantMeta } from '../types';
import { formatScheduleTime, isOverdue } from '@/lib/date';

const props = defineProps<{ meta: QuadrantMeta; tasks: QuadrantTask[] }>();
const emit = defineEmits<{
  add: [QuadrantKey];
  toggle: [number];
  remove: [number];
  edit: [QuadrantTask];
  'clear-completed': [QuadrantKey];
  /** 拖拽落格：把某个任务移动到本象限 */
  drop: [{ id: number; quadrant: QuadrantKey }];
  'drag-start': [number];
  'drag-end': [];
}>();

const doneOpen = ref(false);
const menuOpen = ref(false);
const dropping = ref(false);

/* 后端已按 completed 排好序，这里只是拆成两段渲染；
 * 这不是「前端分组」——分组指的是按象限分桶，那件事只在后端做一次。 */
const pending = computed(() => props.tasks.filter((t) => t.completed !== 1));
const done = computed(() => props.tasks.filter((t) => t.completed === 1));

/** 卡片强色的 10% 软背景，用于徽章底 / 悬停高亮 */
const softColor = computed(() => `color-mix(in srgb, ${props.meta.color} 12%, transparent)`);

function tagsOf(task: QuadrantTask): string[] {
  if (!task.tags) return [];
  return task.tags
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function onMenu(action: 'add' | 'clear') {
  menuOpen.value = false;
  if (action === 'add') emit('add', props.meta.key);
  else emit('clear-completed', props.meta.key);
}

/* ---------------- 拖拽换象限 ---------------- */
/* 用原生 HTML5 DnD 而不是引入拖拽库：这里只有「卡片在四个容器间搬家」一种诉求，
 * dataTransfer 传个 id 就够了，为此装一个 3 万行的依赖不划算。 */
function onDragStart(e: DragEvent, task: QuadrantTask) {
  e.dataTransfer?.setData('text/plain', String(task.id));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  emit('drag-start', task.id);
}

function onDragOver(e: DragEvent) {
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  dropping.value = true;
}

function onDrop(e: DragEvent) {
  dropping.value = false;
  const raw = e.dataTransfer?.getData('text/plain');
  const id = Number(raw);
  if (!raw || Number.isNaN(id)) return;
  emit('drop', { id, quadrant: props.meta.key });
}

/* 点击卡片外关闭「更多」菜单。绑在 document 上而不是加遮罩层，
 * 是为了不挡住其他象限的点击——四格并排时遮罩会让人多点一次。 */
function closeMenu() {
  menuOpen.value = false;
}
onMounted(() => document.addEventListener('click', closeMenu));
onBeforeUnmount(() => document.removeEventListener('click', closeMenu));
</script>

<style scoped>
.qd-card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 260px;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.qd-card:hover {
  box-shadow: var(--shadow-md);
}
/* 拖拽悬停：整卡描边到象限色，明确「松手会掉进这里」 */
.qd-card.is-dropping {
  border-color: var(--q-color);
  box-shadow: 0 0 0 3px var(--q-soft);
}
.qd-stripe {
  height: 3px;
  background: var(--q-color);
}

/* ---------- 头部 ---------- */
.qd-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--kb-border);
}
.qd-badge {
  flex: none;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: var(--q-soft);
  color: var(--q-color);
  font-size: 11px;
  font-weight: 700;
  font-family: var(--font-mono);
}
.qd-head-icon {
  flex: none;
  display: grid;
  place-items: center;
  color: var(--q-color);
}
.qd-head-text {
  flex: 1;
  min-width: 0;
}
.qd-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--kb-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.qd-hint {
  margin: 1px 0 0;
  font-size: 11px;
  color: var(--kb-muted-foreground);
}
.qd-count {
  flex: none;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-mono);
}

.qd-icon-btn {
  flex: none;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: var(--kb-radius-sm);
  border: none;
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.qd-icon-btn:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}
.qd-add:hover {
  background: var(--q-soft);
  color: var(--q-color);
}
.qd-danger:hover {
  background: color-mix(in srgb, var(--kb-destructive) 12%, transparent);
  color: var(--kb-destructive);
}
.qd-tiny {
  width: 22px;
  height: 22px;
}

/* 更多菜单 */
.qd-menu-wrap {
  position: relative;
  flex: none;
}
.qd-menu {
  position: absolute;
  top: 28px;
  right: 0;
  z-index: 30;
  min-width: 168px;
  padding: 4px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-popover);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-lg);
}
.qd-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: none;
  border-radius: var(--kb-radius-sm);
  background: transparent;
  color: var(--kb-foreground);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.qd-menu-item:hover:not(:disabled) {
  background: var(--kb-muted);
}
.qd-menu-item:disabled {
  color: var(--kb-muted-foreground);
  cursor: not-allowed;
}

/* ---------- 任务区 ---------- */
.qd-body {
  flex: 1;
  min-height: 0;
  padding: 6px;
  overflow-y: auto;
}
.qd-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.qd-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border-radius: var(--kb-radius-md);
  cursor: grab;
  transition: background 0.12s ease;
}
.qd-item:hover {
  background: var(--kb-muted);
}
.qd-item:active {
  cursor: grabbing;
}
.qd-item.is-done {
  cursor: default;
}

/* 圆形勾选框 */
.qd-check {
  flex: none;
  appearance: none;
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1.5px solid var(--kb-border);
  background: var(--kb-card);
  cursor: pointer;
  position: relative;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.qd-check:hover {
  border-color: var(--q-color);
}
.qd-check:checked {
  border-color: var(--q-color);
  background: var(--q-color);
}
.qd-check:checked::after {
  content: '';
  position: absolute;
  left: 4.5px;
  top: 1.5px;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 1.8px 1.8px 0;
  transform: rotate(45deg);
}
.qd-check:focus-visible {
  outline: none;
  box-shadow: var(--kb-focus-ring);
}

.qd-item-main {
  flex: 1;
  min-width: 0;
}
.qd-item-title {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--kb-foreground);
  word-break: break-word;
}
.is-done .qd-item-title {
  text-decoration: line-through;
  color: var(--kb-muted-foreground);
}
.qd-item-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 3px;
}
.qd-time {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--kb-muted-foreground);
  font-family: var(--font-mono);
}
.qd-time.is-overdue {
  color: var(--kb-destructive);
  font-weight: 600;
}
.qd-tag {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
  font-size: 10.5px;
}

.qd-item-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 1px;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.qd-item:hover .qd-item-actions,
.qd-item:focus-within .qd-item-actions {
  opacity: 1;
}
.qd-grip {
  display: grid;
  place-items: center;
  width: 18px;
  color: var(--kb-muted-foreground);
  cursor: grab;
}

/* 已完成折叠区 */
.qd-done {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px dashed var(--kb-border);
}
.qd-done-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: var(--kb-radius-sm);
  background: transparent;
  color: var(--kb-muted-foreground);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.qd-done-toggle:hover {
  background: var(--kb-muted);
}

/* 空态 */
.qd-empty {
  height: 100%;
  min-height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: var(--kb-muted-foreground);
}
.qd-empty p {
  margin: 0;
  font-size: 12px;
}
.qd-empty-add {
  margin-top: 2px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px dashed var(--kb-border);
  background: transparent;
  color: var(--q-color);
  font-size: 11.5px;
  cursor: pointer;
}
.qd-empty-add:hover {
  background: var(--q-soft);
  border-color: var(--q-color);
}
</style>
