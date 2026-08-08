<template>
  <!-- 复习热力图：GitHub 风格 7 行（周一~周日）× 7 列（周）日活跃网格。
       数据源 GET /api/reviews/heatmap（wb_review_log + 源表 last_reviewed_at 补充）。 -->
  <section class="rh-card">
    <header class="rh-head">
      <span class="rh-title">
        <Icon name="calendar" :size="15" />
        复习热力图
      </span>
      <span class="rh-sub">
        近 {{ days }} 天 · 复习 <b>{{ totalReviews }}</b> 次 · 活跃 <b>{{ activeDays }}</b> 天
        <template v-if="streak > 0"> · 连续 <b>{{ streak }}</b> 天 🔥</template>
      </span>
    </header>

    <div v-if="heatmapLoading && !heatmap" class="rh-state">
      <Icon name="loader" :size="18" class="rh-spin" /> 加载中…
    </div>
    <div v-else-if="!heatmap || heatmap.data.length === 0" class="rh-state">
      <Icon name="calendar-x" :size="18" /> 暂无复习记录，完成一次复习后这里会亮起
    </div>

    <div v-else class="rh-body">
      <!-- 左侧星期标签（只标一/三/五，避免拥挤） -->
      <div class="rh-weekdays">
        <span v-for="(w, i) in WEEKDAYS" :key="w" class="rh-weekday">{{ i % 2 === 0 ? w : '' }}</span>
      </div>
      <div class="rh-grid">
        <span
          v-for="(cell, i) in cells"
          :key="i"
          class="rh-cell"
          :class="cell ? 'rh-l' + cell.level : 'rh-cell--pad'"
          :title="cell ? `${cell.date} · 复习 ${cell.count} 次` : ''"
        ></span>
      </div>
    </div>

    <footer v-if="heatmap && heatmap.data.length" class="rh-foot">
      <span class="rh-range">{{ heatmap.startDate }} ~ {{ heatmap.endDate }}</span>
      <span class="rh-legend">
        少
        <span class="rh-cell rh-l0"></span>
        <span class="rh-cell rh-l1"></span>
        <span class="rh-cell rh-l2"></span>
        <span class="rh-cell rh-l3"></span>
        <span class="rh-cell rh-l4"></span>
        多
      </span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import Icon from '@/components/ui/Icon.vue';
import { useReviewStore } from '@/store/review-store';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
/** 网格固定 7 列 × 7 行 */
const COLS = 7;
const ROWS = 7;

const store = useReviewStore();
const { heatmap, heatmapLoading, isFinished } = storeToRefs(store);

/** 以周一为一周起点的索引（0=周一 … 6=周日） */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/**
 * 请求天数 = 让「今天」正好落在最后一列、且首日恰好是周一。
 * COLS*ROWS=49 个格子，今天之后（本周剩余）的格子留空占位。
 */
const days = COLS * ROWS - (ROWS - 1 - mondayIndex(new Date()));

type Cell = { date: string; count: number; level: number };

/** 按列优先铺满 49 格；首日为周一 → 索引 i 的行号天然等于星期几 */
const cells = computed<(Cell | null)[]>(() => {
  const data = heatmap.value?.data ?? [];
  if (data.length === 0) return [];
  const max = Math.max(1, ...data.map((d) => d.count));
  const list: (Cell | null)[] = data.map((d) => ({
    date: d.date,
    count: d.count,
    level: d.count === 0 ? 0 : Math.min(4, Math.ceil((d.count / max) * 4)),
  }));
  while (list.length < COLS * ROWS) list.push(null);
  return list.slice(0, COLS * ROWS);
});

const totalReviews = computed(() =>
  (heatmap.value?.data ?? []).reduce((s, d) => s + d.count, 0),
);
const activeDays = computed(() => (heatmap.value?.data ?? []).filter((d) => d.count > 0).length);

/** 连续复习天数：从最后一天往前数（今天还没复习则从昨天起算） */
const streak = computed(() => {
  const data = heatmap.value?.data ?? [];
  let i = data.length - 1;
  if (i >= 0 && data[i].count === 0) i -= 1; // 今天还没开始，不打断昨天的连击
  let n = 0;
  for (; i >= 0; i--) {
    if (data[i].count === 0) break;
    n += 1;
  }
  return n;
});

// 本轮复习结束后刷新一次，让今天的格子立刻变亮
watch(isFinished, (v) => {
  if (v) void store.loadHeatmap(days);
});

onMounted(() => {
  void store.loadHeatmap(days);
});
</script>

<style scoped>
.rh-card {
  padding: 16px 18px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
}
.rh-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.rh-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 700;
  color: var(--kb-foreground);
}
.rh-sub {
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.rh-sub b {
  color: var(--kb-foreground);
  font-variant-numeric: tabular-nums;
}

.rh-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 108px;
  font-size: 13px;
  color: var(--kb-muted-foreground);
}
.rh-spin {
  animation: rh-rotate 0.9s linear infinite;
}
@keyframes rh-rotate {
  to { transform: rotate(360deg); }
}

.rh-body {
  --rh-cell: 14px;
  --rh-gap: 4px;
  display: flex;
  gap: 8px;
  justify-content: center;
}
.rh-weekdays {
  display: grid;
  grid-template-rows: repeat(7, var(--rh-cell));
  gap: var(--rh-gap);
}
.rh-weekday {
  font-size: 10px;
  line-height: var(--rh-cell);
  color: var(--kb-muted-foreground);
  text-align: right;
  width: 12px;
}
.rh-grid {
  display: grid;
  grid-template-rows: repeat(7, var(--rh-cell));
  grid-auto-flow: column;
  grid-auto-columns: var(--rh-cell);
  gap: var(--rh-gap);
}
.rh-cell {
  width: var(--rh-cell, 12px);
  height: var(--rh-cell, 12px);
  border-radius: 3px;
  background: var(--kb-muted);
  transition: transform 0.12s ease;
}
.rh-cell:hover {
  transform: scale(1.18);
}
.rh-cell--pad {
  background: transparent;
}
/* 5 级绿色透明度阶梯，基于 --kb-accent，不硬编码色值 */
.rh-l0 { background: var(--kb-muted); }
.rh-l1 { background: color-mix(in srgb, var(--kb-accent) 24%, var(--kb-muted)); }
.rh-l2 { background: color-mix(in srgb, var(--kb-accent) 48%, var(--kb-muted)); }
.rh-l3 { background: color-mix(in srgb, var(--kb-accent) 74%, var(--kb-muted)); }
.rh-l4 { background: var(--kb-accent); }

.rh-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  font-size: 11px;
  color: var(--kb-muted-foreground);
  flex-wrap: wrap;
}
.rh-range {
  font-family: var(--font-mono);
}
.rh-legend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.rh-legend .rh-cell {
  --rh-cell: 11px;
  pointer-events: none;
}
</style>
