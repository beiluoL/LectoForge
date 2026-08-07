<template>
  <div class="pomo-popup-root">
    <div class="pomo-card">
      <!-- 顶部：阶段 + 循环 + 收起 -->
      <div class="pomo-head">
        <span class="pomo-phase" :style="{ color: ringColor }">
          {{ phaseEmoji }} {{ phaseLabel }}
        </span>
        <span class="pomo-cycle">第 {{ currentCycle }} / {{ settings.cyclesPerSet }} 组</span>
        <button class="pomo-icon-btn" title="收起面板" @click="closePopup">
          <Icon name="x" size="sm" />
        </button>
      </div>

      <!-- 中央：SVG 圆形进度环 + 剩余时间 -->
      <div class="pomo-ring-wrap">
        <svg viewBox="0 0 200 200" class="pomo-ring">
          <circle cx="100" cy="100" :r="R" class="pomo-ring-bg" />
          <circle
            cx="100"
            cy="100"
            :r="R"
            class="pomo-ring-fg"
            :stroke="ringColor"
            :stroke-dasharray="circumference"
            :stroke-dashoffset="dashOffset"
            transform="rotate(-90 100 100)"
          />
        </svg>
        <div class="pomo-ring-center">
          <div class="pomo-time">{{ timeText }}</div>
          <div class="pomo-status">{{ statusText }}</div>
        </div>
      </div>

      <!-- 主控制：开始/暂停 + 重置 -->
      <div class="pomo-controls">
        <button class="pomo-btn-primary" @click="onToggle">
          <Icon :name="isRunning ? 'pause' : 'play'" size="md" />
          <span>{{ isRunning ? '暂停' : '开始' }}</span>
        </button>
        <button class="pomo-btn" @click="store.resetTimer()">
          <Icon name="rotate-ccw" size="md" />
          <span>重置</span>
        </button>
      </div>

      <!-- 阶段切换：专注 / 小憩 / 长休息 -->
      <div class="pomo-seg">
        <button
          v-for="p in phases"
          :key="p.key"
          class="pomo-seg-item"
          :class="{ active: phase === p.key }"
          :style="phase === p.key ? { color: segColor(p.key), borderColor: segColor(p.key) } : undefined"
          @click="store.switchPhase(p.key)"
        >
          {{ p.label }}
        </button>
      </div>

      <!-- 白噪音面板 -->
      <div class="pomo-panel">
        <button class="pomo-panel-head" @click="showNoise = !showNoise">
          <Icon name="volume-2" size="sm" />
          <span>白噪音</span>
          <span class="pomo-spacer" />
          <Icon :name="showNoise ? 'chevron-up' : 'chevron-down'" size="sm" />
        </button>
        <div v-show="showNoise" class="pomo-panel-body">
          <div class="pomo-row">
            <button
              class="pomo-noise-toggle"
              :class="{ on: whiteNoise.enabled }"
              @click="store.toggleWhiteNoise()"
            >
              {{ whiteNoise.enabled ? '▶ 播放中' : '○ 已关闭' }}
            </button>
            <select class="pomo-select" :value="whiteNoise.track" @change="onTrackChange">
              <option v-for="t in tracks" :key="t.key" :value="t.key">{{ t.label }}</option>
            </select>
          </div>
          <div class="pomo-row">
            <input
              class="pomo-range"
              type="range"
              min="0"
              max="100"
              :value="whiteNoise.volume"
              @input="onVolume"
            />
            <span class="pomo-vol">{{ whiteNoise.volume }}</span>
          </div>
        </div>
      </div>

      <!-- 提示音面板 -->
      <div class="pomo-panel">
        <button class="pomo-panel-head" @click="showSound = !showSound">
          <Icon name="bell" size="sm" />
          <span>提示音</span>
          <span class="pomo-spacer" />
          <Icon :name="showSound ? 'chevron-up' : 'chevron-down'" size="sm" />
        </button>
        <div v-show="showSound" class="pomo-panel-body">
          <label class="pomo-check">
            <input
              type="checkbox"
              :checked="soundSettings.enabled"
              @change="store.setSoundEnabled(($event.target as HTMLInputElement).checked)"
            />
            <span>阶段切换时播放提示音</span>
          </label>
          <div class="pomo-row">
            <select class="pomo-select" :value="soundSettings.soundType" @change="onSoundType">
              <option v-for="s in sounds" :key="s.key" :value="s.key">{{ s.label }}</option>
            </select>
            <button class="pomo-btn-sm" @click="store.playSound()">试听</button>
          </div>
        </div>
      </div>

      <!-- 底部：回到主窗口 -->
      <button class="pomo-show-main" @click="showMain">打开主窗口 ↗</button>
    </div>
  </div>
</template>

<script setup lang="ts">
// 菜单栏番茄钟弹窗（pomodoro_popup 窗口，360×480 无边框透明）。
// 所有计时逻辑都在 pomodoroStore（应用级单例，跨窗口常驻）；本组件只是它的一个「遥控器」。
// 窗口被隐藏（window.hide）时 WebView 的 JS 仍在跑，计时照常后台运行、状态栏标题照常更新。
import { ref, computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import Icon from '@/components/ui/Icon.vue';
import { usePomodoroStore } from '@/store/pomodoroStore';
import type { NoiseTrack, PomodoroPhase, SoundType } from '@/api/pomodoro';

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
  soundSettings,
} = storeToRefs(store);

// 进度环几何
const R = 86;
const circumference = 2 * Math.PI * R;
const dashOffset = computed(() => circumference * (1 - progress.value / 100));

const ringColor = computed(() => {
  if (phase.value === 'work') return '#e5484d';
  if (phase.value === 'short_break') return '#f59e0b';
  return '#22c55e';
});
function segColor(p: PomodoroPhase): string {
  if (p === 'work') return '#e5484d';
  if (p === 'short_break') return '#f59e0b';
  return '#22c55e';
}

const statusText = computed(() => {
  if (status.value === 'running') return '专注进行中';
  if (status.value === 'paused') return '已暂停';
  if (status.value === 'completed') return '本轮结束';
  return '准备开始';
});

const phases: { key: PomodoroPhase; label: string }[] = [
  { key: 'work', label: '专注' },
  { key: 'short_break', label: '小憩' },
  { key: 'long_break', label: '长休息' },
];
const tracks: { key: NoiseTrack; label: string }[] = [
  { key: 'rain', label: '🌧 雨声' },
  { key: 'stream', label: '🌊 溪流' },
  { key: 'coffee', label: '☕ 咖啡馆' },
];
const sounds: { key: SoundType; label: string }[] = [
  { key: 'ding', label: '叮（双音）' },
  { key: 'tick', label: '嗒（脉冲）' },
  { key: 'alarm', label: '闹钟（方波）' },
];

const showNoise = ref(true);
const showSound = ref(false);

function onToggle() {
  if (isRunning.value) store.pauseTimer();
  else store.startTimer();
}
function onTrackChange(e: Event) {
  store.setWhiteNoiseTrack((e.target as HTMLSelectElement).value as NoiseTrack);
}
function onVolume(e: Event) {
  store.setWhiteNoiseVolume(Number((e.target as HTMLInputElement).value));
}
function onSoundType(e: Event) {
  store.setSoundType((e.target as HTMLSelectElement).value as SoundType);
}

// 收起面板：仅隐藏弹窗窗口（计时继续后台运行）
async function closePopup() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().hide();
  } catch {
    /* 浏览器预览态 */
  }
}
// 回到主窗口：隐藏弹窗、显示并聚焦主窗口
async function showMain() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    await getCurrentWindow().hide();
    const main = WebviewWindow.getByLabel('main');
    if (main) {
      await main.show();
      await main.setFocus();
    }
  } catch {
    /* 浏览器预览态 */
  }
}

onMounted(() => {
  // 弹窗自身的 store 初始化（幂等）；即便主窗口隐藏，这里的计时引擎也独立存活
  void store.init();
});
</script>

<style scoped>
.pomo-popup-root {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 8px;
  box-sizing: border-box;
}
.pomo-card {
  width: 100%;
  max-height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
  box-sizing: border-box;
}
@media (prefers-color-scheme: dark) {
  .pomo-card {
    background: rgba(20, 22, 28, 0.82);
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.pomo-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pomo-phase {
  font-size: 14px;
  font-weight: 700;
}
.pomo-cycle {
  font-size: 11px;
  color: #888;
  background: rgba(127, 127, 127, 0.14);
  padding: 2px 8px;
  border-radius: 999px;
}
.pomo-spacer {
  flex: 1;
}
.pomo-icon-btn {
  margin-left: auto;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: #666;
  border: none;
  background: transparent;
  cursor: pointer;
}
.pomo-icon-btn:hover {
  background: rgba(127, 127, 127, 0.16);
}

.pomo-ring-wrap {
  position: relative;
  width: 188px;
  height: 188px;
  margin: 4px auto;
}
.pomo-ring {
  width: 100%;
  height: 100%;
}
.pomo-ring-bg {
  fill: none;
  stroke: rgba(127, 127, 127, 0.18);
  stroke-width: 12;
}
.pomo-ring-fg {
  fill: none;
  stroke-width: 12;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.3s linear;
}
.pomo-ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.pomo-time {
  font-size: 40px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
  color: #1d1d1f;
}
.pomo-status {
  font-size: 11px;
  color: #888;
  margin-top: 2px;
}
@media (prefers-color-scheme: dark) {
  .pomo-time {
    color: #f2f2f2;
  }
}

.pomo-controls {
  display: flex;
  gap: 10px;
}
.pomo-btn-primary,
.pomo-btn {
  flex: 1;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.pomo-btn-primary {
  background: #e5484d;
  color: #fff;
  border-color: transparent;
}
.pomo-btn-primary:hover {
  filter: brightness(1.05);
}
.pomo-btn {
  background: rgba(127, 127, 127, 0.12);
  color: #333;
}
@media (prefers-color-scheme: dark) {
  .pomo-btn {
    color: #e6e6e6;
  }
}
.pomo-btn:hover {
  background: rgba(127, 127, 127, 0.2);
}

.pomo-seg {
  display: flex;
  gap: 6px;
  background: rgba(127, 127, 127, 0.1);
  padding: 4px;
  border-radius: 12px;
}
.pomo-seg-item {
  flex: 1;
  height: 32px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  color: #666;
  cursor: pointer;
}
.pomo-seg-item.active {
  background: #fff;
  color: #e5484d;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}
@media (prefers-color-scheme: dark) {
  .pomo-seg-item.active {
    background: rgba(40, 42, 50, 0.95);
  }
}

.pomo-panel {
  border-radius: 12px;
  background: rgba(127, 127, 127, 0.08);
  overflow: hidden;
}
.pomo-panel-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 600;
  color: #444;
  background: transparent;
  border: none;
  cursor: pointer;
}
@media (prefers-color-scheme: dark) {
  .pomo-panel-head {
    color: #ccc;
  }
}
.pomo-panel-body {
  padding: 4px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pomo-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pomo-noise-toggle {
  flex: 1;
  height: 34px;
  border-radius: 9px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(127, 127, 127, 0.12);
  color: #555;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.pomo-noise-toggle.on {
  background: #e5484d;
  color: #fff;
  border-color: transparent;
}
.pomo-select {
  flex: 1;
  height: 34px;
  border-radius: 9px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: #fff;
  color: #222;
  font-size: 13px;
  padding: 0 8px;
}
@media (prefers-color-scheme: dark) {
  .pomo-select {
    background: #2a2c34;
    color: #eee;
    border-color: rgba(255, 255, 255, 0.12);
  }
}
.pomo-range {
  flex: 1;
  accent-color: #e5484d;
}
.pomo-vol {
  width: 30px;
  text-align: right;
  font-size: 12px;
  color: #888;
  font-variant-numeric: tabular-nums;
}
.pomo-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #555;
}
@media (prefers-color-scheme: dark) {
  .pomo-check {
    color: #ccc;
  }
}
.pomo-btn-sm {
  height: 34px;
  padding: 0 14px;
  border-radius: 9px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(127, 127, 127, 0.12);
  color: #444;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
@media (prefers-color-scheme: dark) {
  .pomo-btn-sm {
    color: #ddd;
  }
}

.pomo-show-main {
  margin-top: 2px;
  height: 36px;
  border-radius: 10px;
  border: 1px dashed rgba(127, 127, 127, 0.4);
  background: transparent;
  color: #777;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.pomo-show-main:hover {
  background: rgba(127, 127, 127, 0.1);
}
</style>
