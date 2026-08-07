<!--
  菜单栏番茄钟弹窗（pomodoro_popup 窗口，320×400 无边框透明，macOS 毛玻璃）
  仿 macOS 控制中心（Control Center）：悬浮玻璃面板 + 纵向 4 组独立卡片。

  所有计时逻辑都在 pomodoroStore（应用级单例，跨窗口常驻）；本组件只是它的「遥控器」。
  窗口被隐藏（window.hide）时 WebView 的 JS 仍在跑，计时照常后台运行、状态栏标题照常更新。

  交互：
  - 卡片 1：阶段 + 大号倒计时 + 渐变 SVG 进度环（环中央显示阶段图标）
  - 卡片 2：开始 / 暂停 / 重置 / 跳过当前阶段（四列无缝按钮）
  - 卡片 3：当前循环进度（第 X 组 / 共 Y 组）+ 下一阶段预览
  - 卡片 4：白噪音控制条（图标一键播放/静音 · 下拉选音源 · 音量滑块）
  - 点击弹窗外部：Rust 侧 WindowEvent::Focused(false) 延迟 200ms 同步隐藏
-->
<template>
  <div class="pomo-host">
    <!-- 玻璃面板外层：极致毛玻璃 + 圆角 + 阴影 + 细边框 -->
    <div
      class="pomo-glass flex h-full w-full flex-col gap-4 rounded-2xl border border-white/20 bg-white/85 p-4 shadow-2xl backdrop-blur-2xl dark:border-black/20 dark:bg-black/85"
    >
      <!-- ============ 卡片 1：核心状态 + 计时大圆环 ============ -->
      <div class="flex items-center gap-3">
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-xs font-medium text-gray-500 dark:text-gray-400">
            {{ phaseEmoji }} {{ phaseLabel }}
          </span>
          <span
            class="tabular-nums text-[40px] font-bold leading-none tracking-tight text-gray-900 dark:text-white"
          >
            {{ timeText }}
          </span>
          <span class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            {{ statusText }}
          </span>
        </div>

        <!-- 渐变 SVG 进度环 -->
        <div class="relative h-[88px] w-[88px] shrink-0">
          <svg viewBox="0 0 100 100" class="h-full w-full -rotate-90">
            <defs>
              <linearGradient :id="RING_ID" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" :stop-color="ringFrom" />
                <stop offset="100%" :stop-color="ringTo" />
              </linearGradient>
            </defs>
            <circle
              cx="50"
              cy="50"
              :r="RING_R"
              fill="none"
              stroke="rgba(120,120,120,0.18)"
              :stroke-width="RING_STROKE"
            />
            <circle
              cx="50"
              cy="50"
              :r="RING_R"
              fill="none"
              :stroke="`url(#${RING_ID})`"
              :stroke-width="RING_STROKE"
              stroke-linecap="round"
              :stroke-dasharray="ringCircumference"
              :stroke-dashoffset="ringDashoffset"
              style="transition: stroke-dashoffset 0.3s linear"
            />
          </svg>
          <div class="absolute inset-0 flex items-center justify-center">
            <component :is="phaseIcon" class="h-7 w-7" :style="{ color: ringTo }" />
          </div>
        </div>
      </div>

      <!-- ============ 卡片 2：核心动作栏（四列无缝按钮） ============ -->
      <div class="grid grid-cols-4 gap-1 rounded-xl bg-gray-100/50 p-1 dark:bg-gray-800/50">
        <button
          class="pomo-act"
          :disabled="isRunning"
          title="开始"
          @click="store.startTimer()"
        >
          <Play class="h-5 w-5" />
          <span>开始</span>
        </button>
        <button
          class="pomo-act"
          :disabled="!isRunning"
          title="暂停"
          @click="store.pauseTimer()"
        >
          <Pause class="h-5 w-5" />
          <span>暂停</span>
        </button>
        <button class="pomo-act" title="重置" @click="store.resetTimer()">
          <RotateCcw class="h-5 w-5" />
          <span>重置</span>
        </button>
        <button class="pomo-act" title="跳过当前阶段" @click="store.skipPhase()">
          <SkipForward class="h-5 w-5" />
          <span>跳过</span>
        </button>
      </div>

      <!-- ============ 卡片 3：当前阶段统计（独立分组卡片） ============ -->
      <div
        class="flex items-center justify-between rounded-xl bg-gray-100/60 px-3 py-2.5 dark:bg-gray-800/60"
      >
        <div class="flex flex-col">
          <span class="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            当前循环
          </span>
          <span class="text-sm font-semibold text-gray-800 dark:text-gray-100">
            第 {{ currentCycle }} / {{ settings.cyclesPerSet }} 组
          </span>
        </div>
        <div class="flex flex-col items-end">
          <span class="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            下一阶段
          </span>
          <span class="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {{ nextPhase.name }} {{ nextPhase.time }}
          </span>
        </div>
      </div>

      <!-- ============ 卡片 4：专注与白噪音设置（底部折叠分组卡片） ============ -->
      <div
        class="flex items-center gap-3 rounded-xl bg-gray-100/50 p-3 dark:bg-gray-800/50"
      >
        <!-- 左：白噪音图标（点击一键播放/静音） -->
        <button
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80 transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/20"
          :title="whiteNoise.enabled ? '点击静音' : '点击播放'"
          @click="store.toggleWhiteNoise()"
        >
          <component
            :is="whiteNoise.enabled ? Volume2 : VolumeX"
            class="h-4 w-4"
            :class="whiteNoise.enabled ? 'text-[#FF6B35]' : 'text-gray-400'"
          />
        </button>

        <!-- 中：音源下拉选择 -->
        <select
          :value="whiteNoise.track"
          class="min-w-0 flex-1 cursor-pointer rounded-lg bg-transparent px-2 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10"
          @change="onTrackChange"
        >
          <option v-for="o in trackOptions" :key="o.value" :value="o.value" class="text-black">
            {{ o.label }}
          </option>
        </select>

        <!-- 右：音量滑块 -->
        <input
          type="range"
          min="0"
          max="100"
          :value="whiteNoise.volume"
          class="w-16 cursor-pointer accent-[#FF6B35]"
          @input="onVolume"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import type { Component } from 'vue';
import {
  Timer,
  Coffee,
  Sun,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-vue-next';
import { usePomodoroStore, PHASE_LABEL, type PomodoroPhase } from '@/store/pomodoroStore';
import type { NoiseTrack } from '@/api/pomodoro';

const store = usePomodoroStore();
const {
  phase,
  phaseLabel,
  phaseEmoji,
  status,
  currentCycle,
  settings,
  timeText,
  isRunning,
  progress,
  whiteNoise,
} = storeToRefs(store);

/* ============ 进度环几何 ============ */
const RING_ID = 'pomo-ring-grad';
const RING_R = 42;
const RING_STROKE = 8;
const ringCircumference = 2 * Math.PI * RING_R;
// 剩余比例 = 1 - 已用比例；dashoffset 越大可见弧越短（环随倒计时收缩）
const ringDashoffset = computed(() => ringCircumference * (progress.value / 100));

/* ============ 阶段配色（渐变两端）+ 阶段图标 ============ */
const RING_COLORS: Record<PomodoroPhase, { from: string; to: string }> = {
  work: { from: '#FFB380', to: '#FF6B35' }, // 番茄红
  short_break: { from: '#6EE7B7', to: '#10B981' }, // 休息绿
  long_break: { from: '#93B3F5', to: '#3B6FE0' }, // 长休蓝
};
const PHASE_ICON: Record<PomodoroPhase, Component> = {
  work: Timer,
  short_break: Coffee,
  long_break: Sun,
};
const ringFrom = computed(() => RING_COLORS[phase.value].from);
const ringTo = computed(() => RING_COLORS[phase.value].to);
const phaseIcon = computed(() => PHASE_ICON[phase.value]);

/* ============ 状态副标题 ============ */
const statusText = computed(() => {
  if (status.value === 'running') return '进行中…';
  if (status.value === 'paused') return '已暂停';
  if (status.value === 'completed') return '本轮结束';
  return '待开始';
});

/* ============ 下一阶段预览 ============ */
const nextPhase = computed(() => {
  let next: PomodoroPhase;
  if (phase.value === 'work') {
    next = currentCycle.value >= Math.max(1, settings.value.cyclesPerSet) ? 'long_break' : 'short_break';
  } else {
    next = 'work';
  }
  const mins =
    next === 'work'
      ? settings.value.workMinutes
      : next === 'short_break'
        ? settings.value.shortBreakMinutes
        : settings.value.longBreakMinutes;
  const s = Math.max(0, Math.floor(mins * 60));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return { name: PHASE_LABEL[next], time: `${mm}:${ss}` };
});

/* ============ 白噪音音源选项 ============ */
const trackOptions: { value: NoiseTrack; label: string }[] = [
  { value: 'rain', label: '雨声 🌧️' },
  { value: 'stream', label: '溪流 🌊' },
  { value: 'coffee', label: '咖啡馆 ☕' },
];
function onTrackChange(e: Event): void {
  store.setWhiteNoiseTrack((e.target as HTMLSelectElement).value as NoiseTrack);
}
function onVolume(e: Event): void {
  store.setWhiteNoiseVolume(Number((e.target as HTMLInputElement).value));
}

onMounted(() => {
  // 弹窗自身的 store 初始化（幂等）；主窗口已 init 过的情况下 inited=true 立即返回
  void store.init();
});
</script>

<style scoped>
/* 宿主：100% 占满 320×400 透明窗口，留 8px 内边距让玻璃面板阴影透气 */
.pomo-host {
  width: 100%;
  height: 100%;
  padding: 8px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
    sans-serif;
}

/* 四列动作按钮：无边框、极简，仅 hover/active 出现浅灰底 */
.pomo-act {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 8px 0;
  border: none;
  background: transparent;
  border-radius: 10px;
  color: var(--kb-foreground, #1a1d23);
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.pomo-act:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.06);
}
.pomo-act:active:not(:disabled) {
  background: rgba(0, 0, 0, 0.1);
}
.pomo-act:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
@media (prefers-color-scheme: dark) {
  .pomo-act {
    color: #f0f0f2;
  }
  .pomo-act:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }
  .pomo-act:active:not(:disabled) {
    background: rgba(255, 255, 255, 0.16);
  }
}
</style>
