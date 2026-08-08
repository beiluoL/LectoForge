<template>
  <!-- 番茄钟历史统计：调用 /api/pomodoro/stats 按天聚合，柱状图（蓝=工作/橙=休息）+ 三张总结卡。 -->
  <div class="ps-wrap">
    <div class="ps-inner">
      <header class="ps-head">
        <div class="ps-title">
          <Icon name="bar-chart" :size="22" style="color: var(--kb-primary)" />
          <h1>番茄钟统计</h1>
        </div>
        <div class="ps-range">
          <button
            v-for="d in ranges"
            :key="d"
            class="ps-range-btn"
            :class="{ active: days === d }"
            @click="load(d)"
          >
            {{ d }} 天
          </button>
        </div>
      </header>

      <!-- 加载态 -->
      <div v-if="loading" class="ps-center">
        <Icon name="loader" :size="26" class="ps-spin" />
        <p>正在加载统计…</p>
      </div>

      <template v-else>
        <!-- 三张总结卡 -->
        <section class="ps-summary">
          <div class="ps-stat">
            <span class="ps-stat-ic">🍅</span>
            <span class="ps-stat-val">{{ totalWorkText }}</span>
            <span class="ps-stat-label">累计专注时长</span>
          </div>
          <div class="ps-stat">
            <span class="ps-stat-ic">📅</span>
            <span class="ps-stat-val">{{ avgWorkText }}</span>
            <span class="ps-stat-label">日均专注</span>
          </div>
          <div class="ps-stat">
            <span class="ps-stat-ic">✅</span>
            <span class="ps-stat-val">{{ summary.completedPomodoros }}</span>
            <span class="ps-stat-label">完成番茄数</span>
          </div>
        </section>

        <!-- 柱状图 -->
        <section class="ps-chart-card">
          <div class="ps-chart-head">
            <span>每日专注 / 休息时长（分钟）</span>
            <div class="ps-legend">
              <span class="ps-legend-item"><i class="ps-dot ps-dot--work"></i>专注</span>
              <span class="ps-legend-item"><i class="ps-dot ps-dot--break"></i>休息</span>
            </div>
          </div>
          <div v-if="hasData" class="ps-chart-box">
            <Bar :data="chartData" :options="chartOptions" />
          </div>
          <div v-else class="ps-empty">
            <span>🌱</span>
            <p>这段时间还没有专注记录，去番茄钟页面开始第一个番茄吧～</p>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Bar } from 'vue-chartjs';
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from 'chart.js';
import Icon from '@/components/ui/Icon.vue';
import { getPomodoroStats } from '@/api/pomodoro';
import { formatDuration } from '@/lib/date';
import type { PomodoroStatsResult } from '@/api/pomodoro';

// 注册 chart.js 必需组件（局部注册避免污染全局）
ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const ranges = [7, 14, 30];
const days = ref(7);
const loading = ref(true);
const stats = ref<PomodoroStatsResult | null>(null);

/** 读取 CSS 变量解析后的真实色值，保证图表与 --kb-* 设计令牌保持一致（不写死 hex） */
function cssVar(name: string): string {
  if (typeof window === 'undefined') return '#000';
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || '#000';
}

const summary = computed(
  () =>
    stats.value?.summary ?? {
      totalWorkSeconds: 0,
      totalBreakSeconds: 0,
      avgWorkSecondsPerDay: 0,
      completedPomodoros: 0,
    },
);
const totalWorkText = computed(() => formatDuration(summary.value.totalWorkSeconds));
const avgWorkText = computed(() => formatDuration(summary.value.avgWorkSecondsPerDay));
const hasData = computed(() => (stats.value?.points ?? []).some((p) => p.work > 0 || p.breakTotal > 0));

const chartData = computed(() => {
  const pts = stats.value?.points ?? [];
  const primary = cssVar('--kb-primary');
  const warning = cssVar('--kb-warning');
  return {
    labels: pts.map((p) => p.date.slice(5)), // MM-DD
    datasets: [
      {
        label: '专注',
        data: pts.map((p) => Math.round(p.work / 60)),
        backgroundColor: primary,
        borderRadius: 5,
        maxBarThickness: 26,
      },
      {
        label: '休息',
        data: pts.map((p) => Math.round(p.breakTotal / 60)),
        backgroundColor: warning,
        borderRadius: 5,
        maxBarThickness: 26,
      },
    ],
  };
});

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}：${ctx.parsed.y} 分钟`,
      },
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { color: cssVar('--kb-muted-foreground'), font: { size: 11 } },
    },
    y: {
      beginAtZero: true,
      grid: { color: cssVar('--kb-border') },
      ticks: { color: cssVar('--kb-muted-foreground'), font: { size: 11 } },
      title: { display: true, text: '分钟', color: cssVar('--kb-muted-foreground'), font: { size: 11 } },
    },
  },
}));

async function load(d: number) {
  days.value = d;
  loading.value = true;
  try {
    stats.value = await getPomodoroStats(d);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load(days.value);
});
</script>

<style scoped>
.ps-wrap {
  min-height: calc(100vh - 3.5rem);
  padding: 28px 16px 48px;
  display: flex;
  justify-content: center;
}
.ps-inner {
  width: 100%;
  max-width: 880px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.ps-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.ps-title {
  display: flex;
  align-items: center;
  gap: 9px;
}
.ps-title h1 {
  font-size: var(--kb-fs-h3);
  font-weight: 700;
  color: var(--kb-foreground);
  margin: 0;
}
.ps-range {
  display: flex;
  gap: 6px;
  background: var(--kb-muted);
  padding: 3px;
  border-radius: var(--kb-radius-md);
}
.ps-range-btn {
  border: none;
  background: transparent;
  color: var(--kb-muted-foreground);
  font-size: var(--kb-fs-body-sm);
  font-weight: 500;
  padding: 6px 13px;
  border-radius: var(--kb-radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
}
.ps-range-btn.active {
  background: var(--kb-card);
  color: var(--kb-primary);
  box-shadow: var(--shadow-sm);
}

.ps-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--kb-muted-foreground);
  min-height: 300px;
}
.ps-spin {
  animation: ps-rotate 0.9s linear infinite;
  color: var(--kb-primary);
}
@keyframes ps-rotate {
  to {
    transform: rotate(360deg);
  }
}

.ps-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.ps-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 18px 12px;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
}
.ps-stat-ic {
  font-size: 22px;
}
.ps-stat-val {
  font-size: 22px;
  font-weight: 700;
  color: var(--kb-foreground);
  font-variant-numeric: tabular-nums;
}
.ps-stat-label {
  font-size: var(--kb-fs-caption);
  color: var(--kb-muted-foreground);
}

.ps-chart-card {
  padding: 18px;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
}
.ps-chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  font-size: var(--kb-fs-body-md);
  font-weight: 600;
  color: var(--kb-foreground);
}
.ps-legend {
  display: flex;
  gap: 14px;
}
.ps-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--kb-fs-caption);
  font-weight: 500;
  color: var(--kb-muted-foreground);
}
.ps-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}
.ps-dot--work {
  background: var(--kb-primary);
}
.ps-dot--break {
  background: var(--kb-warning);
}
.ps-chart-box {
  height: 320px;
  position: relative;
}
.ps-empty {
  height: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--kb-muted-foreground);
  text-align: center;
}
.ps-empty span {
  font-size: 40px;
}

@media (max-width: 600px) {
  .ps-summary {
    grid-template-columns: 1fr;
  }
}
</style>
