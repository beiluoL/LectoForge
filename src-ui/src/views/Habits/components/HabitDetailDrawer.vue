<template>
  <Teleport to="body">
    <Transition name="hb-drawer">
      <div v-if="open" class="hb-drawer-mask" @click.self="close">
        <aside class="hb-drawer" role="dialog" aria-modal="true">
          <!-- 头部 -->
          <header class="hb-drawer-head">
            <span class="hb-drawer-icon" :style="{ background: habit?.color + '22', color: habit?.color }">
              <Icon :name="habit?.iconName || 'check-circle'" :size="'xl'" />
            </span>
            <div class="hb-drawer-titles">
              <h2 class="hb-drawer-title">{{ habit?.name }}</h2>
              <p v-if="habit?.description" class="hb-drawer-desc">{{ habit.description }}</p>
            </div>
            <button class="qcm-close" @click="close">
              <Icon name="x" :size="'md'" />
            </button>
          </header>

          <!-- 统计三连 -->
          <div class="hb-stat-row" v-if="stats">
            <div class="hb-stat">
              <span class="hb-stat-num" :style="{ color: habit?.color }">{{ stats.streak }}</span>
              <span class="hb-stat-label">当前连续(天)</span>
            </div>
            <div class="hb-stat">
              <span class="hb-stat-num">{{ stats.bestStreak }}</span>
              <span class="hb-stat-label">最长连续</span>
            </div>
            <div class="hb-stat">
              <span class="hb-stat-num">{{ stats.totalDone }}</span>
              <span class="hb-stat-label">累计打卡</span>
            </div>
            <div class="hb-stat">
              <span class="hb-stat-num">{{ monthRate }}%</span>
              <span class="hb-stat-label">本月打卡率</span>
            </div>
          </div>

          <!-- 热力图 -->
          <section class="hb-heat-section">
            <div class="wb-section-title">
              <Icon name="calendar-days" :size="'md'" />
              近一年打卡热力图
              <span class="wb-section-hint">点击格子可补卡 / 取消（绿色越深表示连续越久）</span>
            </div>

            <div v-if="loadingStats" class="hb-heat-loading">
              <Icon name="loader" size="sm" class="hb-spin" />
              正在统计打卡数据…
            </div>
            <div v-else-if="weeks.length" class="hb-heat-wrap">
              <!-- 周几标签 -->
              <div class="hb-heat-weekdays">
                <span v-for="(w, i) in WEEK_LABELS" :key="i" class="hb-heat-wd">{{ w }}</span>
              </div>
              <!-- 周列 -->
              <div class="hb-heat">
                <div v-for="(week, wi) in weeks" :key="wi" class="hb-heat-week">
                  <button
                    v-for="(cell, ci) in week"
                    :key="ci"
                    class="hb-heat-cell"
                    :class="heatClass(cell)"
                    :title="cellTitle(cell)"
                    :disabled="!cell.inRange"
                    @click="onCellClick(cell)"
                  ></button>
                </div>
              </div>
            </div>
            <div v-else class="hb-heat-empty">暂无数据</div>

            <!-- 图例 -->
            <div class="hb-heat-legend">
              <span class="hb-heat-legend-text">少</span>
              <span class="hb-heat-cell" :class="HEAT_LEVELS[0]"></span>
              <span class="hb-heat-cell" :class="HEAT_LEVELS[1]"></span>
              <span class="hb-heat-cell" :class="HEAT_LEVELS[2]"></span>
              <span class="hb-heat-cell" :class="HEAT_LEVELS[3]"></span>
              <span class="hb-heat-cell" :class="HEAT_LEVELS[4]"></span>
              <span class="hb-heat-legend-text">多</span>
            </div>
          </section>

          <div class="hb-drawer-foot">
            <button class="kb-btn" @click="onEdit">
              <Icon name="pencil" :size="'15px'" />
              编辑
            </button>
            <button class="kb-btn kb-btn-danger" @click="onDelete">
              <Icon name="trash-2" :size="'15px'" />
              删除习惯
            </button>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import dayjs from 'dayjs';
import Icon from '@/components/ui/Icon.vue';
import { fetchHabitStats, toggleHabitLog, type Habit, type HabitStats } from '@/api/habit';
import { useHabitStore } from '@/store/habit-store';
import { confirmDialog, getApiError, notify } from '@/utils/toast';

const props = defineProps<{ open: boolean; habit: Habit | null }>();
const emit = defineEmits<{ 'update:open': [boolean]; edit: [Habit] }>();

const store = useHabitStore();
const stats = ref<HabitStats | null>(null);
const loadingStats = ref(false);

const WEEK_LABELS = ['', '一', '', '三', '', '五', ''];
const HEAT_LEVELS = [
  'lv0', // 未打卡（空）
  'lv1',
  'lv2',
  'lv3',
  'lv4',
];

/** 连续天数 → 热力等级（1..4，未打卡为 0） */
function levelFor(key: string, map: Map<string, number>): number {
  let run = 0;
  let c = dayjs(key);
  while (map.get(c.format('YYYY-MM-DD')) === 1) {
    run += 1;
    c = c.subtract(1, 'day');
  }
  return 1 + Math.min(3, Math.floor(run / 7));
}

/** 把近 365 天数据排成「周列 × 7 行」的 GitHub 网格 */
const weeks = computed<{ date: string; status: 0 | 1; level: number; inRange: boolean }[][]>(() => {
  const data = stats.value?.yearlyHeatmapData ?? [];
  if (!data.length) return [];
  const map = new Map(data.map((d) => [d.date, d.status]));
  const first = dayjs(data[0].date);
  const start = first.subtract(first.day(), 'day'); // 回退到周日，作为首列起点
  const endKey = data[data.length - 1].date;

  const result: { date: string; status: 0 | 1; level: number; inRange: boolean }[][] = [];
  let week: { date: string; status: 0 | 1; level: number; inRange: boolean }[] = [];
  let cursor = start;
  let guard = 0;
  while (guard < 400) {
    const key = cursor.format('YYYY-MM-DD');
    const inRange = key >= data[0].date && key <= endKey;
    const status = (inRange ? map.get(key) ?? 0 : 0) as 0 | 1;
    const level = status ? levelFor(key, map) : 0;
    week.push({ date: key, status, level, inRange });
    if (week.length === 7) {
      result.push(week);
      week = [];
    }
    cursor = cursor.add(1, 'day');
    guard += 1;
    if (key > endKey) break;
  }
  if (week.length) result.push(week);
  return result;
});

const monthRate = computed(() => {
  const m = stats.value?.monthlyData ?? [];
  if (!m.length) return 0;
  const done = m.filter((d) => d.status === 1).length;
  return Math.round((done / m.length) * 100);
});

function heatClass(cell: { status: 0 | 1; level: number; inRange: boolean }): string {
  if (!cell.inRange) return 'hb-heat-out';
  return HEAT_LEVELS[cell.level];
}

function cellTitle(cell: { date: string; status: 0 | 1; inRange: boolean }): string {
  if (!cell.inRange) return '';
  return `${cell.date} · ${cell.status ? '已打卡' : '未打卡'}`;
}

async function loadStats() {
  if (!props.habit) return;
  loadingStats.value = true;
  try {
    stats.value = await fetchHabitStats(props.habit.id);
  } catch (e) {
    notify(getApiError(e, '统计加载失败'), 'error');
  } finally {
    loadingStats.value = false;
  }
}

async function onCellClick(cell: { date: string; status: 0 | 1; level: number; inRange: boolean }) {
  if (!props.habit || !cell.inRange) return;
  const prev = cell.status;
  // 乐观翻面（本地 stats 副本）
  cell.status = prev ? 0 : 1;
  cell.level = cell.status ? 4 : 0;
  try {
    await toggleHabitLog(props.habit.id, cell.date);
    await loadStats(); // 重新拉取以校正连续天数等级
  } catch (e) {
    cell.status = prev;
    cell.level = prev ? 4 : 0;
    notify(getApiError(e, '打卡失败'), 'error');
  }
}

function close() {
  emit('update:open', false);
}

function onEdit() {
  if (props.habit) emit('edit', props.habit);
}

async function onDelete() {
  if (!props.habit) return;
  const ok = await confirmDialog(`确定删除「${props.habit.name}」？打卡记录将一并清除。`);
  if (!ok) return;
  await store.removeHabit(props.habit.id);
  notify('习惯已删除', 'success');
  close();
}

// 打开或切换习惯时重新拉统计
watch(
  () => [props.open, props.habit?.id] as const,
  ([o]) => {
    if (o) loadStats();
  },
  { immediate: true },
);
</script>

<style scoped>
.hb-drawer-mask {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  justify-content: flex-end;
  background: rgba(15, 18, 24, 0.42);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.hb-drawer {
  width: 460px;
  max-width: 94vw;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--kb-card);
  border-left: 1px solid var(--kb-border);
  box-shadow: var(--shadow-lg);
  overflow-y: auto;
  padding: 20px 24px 24px;
}

/* 头部 */
.hb-drawer-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.hb-drawer-icon {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hb-drawer-titles {
  flex: 1;
  min-width: 0;
}
.hb-drawer-title {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  color: var(--kb-foreground);
  font-family: var(--font-serif);
}
.hb-drawer-desc {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--kb-muted-foreground);
}
.qcm-close {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--kb-border);
  background: var(--kb-background);
  color: var(--kb-muted-foreground);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.qcm-close:hover {
  color: var(--kb-foreground);
}

/* 统计 */
.hb-stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin: 16px 0;
}
.hb-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 12px 8px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
}
.hb-stat-num {
  font-size: 22px;
  font-weight: 800;
  color: var(--kb-foreground);
  font-family: var(--font-mono);
}
.hb-stat-label {
  font-size: 11px;
  color: var(--kb-muted-foreground);
}

/* 热力图 */
.hb-heat-section {
  margin-top: 8px;
}
.hb-heat-wrap {
  display: flex;
  gap: 4px;
  margin-top: 12px;
  overflow-x: auto;
}
.hb-heat-weekdays {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: none;
  padding-top: 0;
}
.hb-heat-wd {
  width: 14px;
  height: 13px;
  font-size: var(--kb-fs-xs);
  line-height: 13px;
  color: var(--kb-muted-foreground);
  text-align: center;
}
.hb-heat {
  display: flex;
  gap: 3px;
}
.hb-heat-week {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.hb-heat-cell {
  width: 13px;
  height: 13px;
  border-radius: 3px;
  padding: 0;
  border: none;
  cursor: pointer;
  transition: transform 0.1s ease;
}
.hb-heat-cell:active {
  transform: scale(0.85);
}
.hb-heat-cell:disabled {
  cursor: default;
}
.hb-heat-out {
  background: transparent;
}
.lv0 {
  background: var(--kb-muted);
}
.lv1 {
  background: #bbf7d0;
}
.lv2 {
  background: #86efac;
}
.lv3 {
  background: #34d399;
}
.lv4 {
  background: #059669;
}
.hb-heat-empty {
  margin-top: 12px;
  font-size: 13px;
  color: var(--kb-muted-foreground);
}
.hb-heat-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--kb-muted-foreground);
}
.hb-spin {
  animation: hb-rotate 0.8s linear infinite;
}
@keyframes hb-rotate {
  to {
    transform: rotate(360deg);
  }
}
.hb-heat-legend {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 12px;
  justify-content: flex-end;
}
.hb-heat-legend-text {
  font-size: 11px;
  color: var(--kb-muted-foreground);
  margin: 0 4px;
}

/* 底部 */
.hb-drawer-foot {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}
.hb-drawer-foot .kb-btn {
  flex: 1;
  justify-content: center;
}

/* 抽屉过渡 */
.hb-drawer-enter-active,
.hb-drawer-leave-active {
  transition: opacity 0.2s ease;
}
.hb-drawer-enter-active .hb-drawer,
.hb-drawer-leave-active .hb-drawer {
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
.hb-drawer-enter-from,
.hb-drawer-leave-to {
  opacity: 0;
}
.hb-drawer-enter-from .hb-drawer,
.hb-drawer-leave-to .hb-drawer {
  transform: translateX(100%);
}
</style>
