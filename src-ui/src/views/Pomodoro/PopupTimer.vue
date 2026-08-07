<!--
  菜单栏番茄钟弹窗（pomodoro_popup 窗口，380×460 无边框透明，macOS 毛玻璃）
  ──「Harmony Glow / 光影辉光」设计语言 ──
  · 三重毛玻璃：环境动态光晕层(blur) → 玻璃面板(backdrop-blur) → 内高光描边
  · 主视觉「时光之环」：4px 深色底座环 + 4px 亮色进度环 + 进度点「太阳耀斑」光晕
  · 倒计时巨数字：font-thin + tabular-nums + 多层 text-shadow 辉光，平滑过渡不闪烁
  · 极小化顶栏：左状态点+阶段文字 / 右 一个透明圆底图标按钮（hover 才显底）
  · 底部悬浮无边框图标按钮（播放/暂停/重置/跳过）+ 左下角白噪音状态浮标
  · 阶段色映射：专注=珊瑚橙 / 小憩=海洋蓝 / 长休=薄荷绿，切换时整屏 0.8s 无缝过渡

  计时逻辑全部在 pomodoroStore（应用级单例、跨窗口常驻），本组件只是「遥控器」。
  菜单栏联动：store 内部 emit('tray:update') 已把 🍅 24:59 推给 Rust set_title，
  本组件只消费 store 的 timeText/phase/progress，无需自己发事件。
-->
<template>
  <div
    class="harmony"
    :style="{ '--glow': accent.glow, '--glow-soft': accent.soft }"
  >
    <!-- 环境动态光晕层（三重毛玻璃之第一层）：色随手阶段走，0.8s 无缝过渡 -->
    <div class="ambient" aria-hidden="true" />

    <!-- 玻璃面板（第二层 + 第三层内高光） -->
    <div class="glass">
      <!-- ============ 顶栏：极小化 ============ -->
      <header class="topbar">
        <div class="flex items-center gap-2">
          <span class="status-dot" />
          <span class="phase-text">{{ headerLabel }}</span>
        </div>
        <button
          class="icon-btn icon-btn--ghost"
          :title="whiteNoise.enabled ? '关闭白噪音' : '开启白噪音'"
          @click="store.toggleWhiteNoise()"
        >
          <component :is="whiteNoise.enabled ? Volume2 : VolumeX" class="h-[18px] w-[18px]" />
        </button>
      </header>

      <!-- ============ 主视觉：时光之环 + 巨型数字 ============ -->
      <main class="stage">
        <div class="ring-wrap">
          <svg viewBox="0 0 200 200" class="ring-svg">
            <defs>
              <radialGradient id="hg-glow">
                <stop offset="0%" style="stop-color: var(--glow)" stop-opacity="0.95" />
                <stop offset="100%" style="stop-color: var(--glow)" stop-opacity="0" />
              </radialGradient>
            </defs>

            <!-- 深色底座环 -->
            <circle
              class="ring-track"
              cx="100"
              cy="100"
              :r="RING"
              fill="none"
              :stroke-width="RING_STROKE"
            />
            <!-- 亮色进度环（从顶部顺时针「充满」，stroke-dashoffset 线性连续） -->
            <circle
              class="ring-progress"
              cx="100"
              cy="100"
              :r="RING"
              fill="none"
              :stroke-width="RING_STROKE"
              stroke-linecap="round"
              :stroke-dasharray="C"
              :stroke-dashoffset="ringDashoffset"
              transform="rotate(-90 100 100)"
            />
            <!-- 进度点「太阳耀斑」：跟随进度旋转，自带柔光 + 高亮核 -->
            <g class="glow" :class="{ 'is-running': isRunning }" :style="glowStyle">
              <circle class="glow-flare" cx="100" cy="10" r="13" fill="url(#hg-glow)" />
              <circle cx="100" cy="10" r="3" fill="#ffffff" opacity="0.92" />
            </g>
          </svg>

          <!-- 环中央内容：巨数字 + 胶囊状态标签 -->
          <div class="ring-center">
            <div class="countdown">{{ timeText }}</div>
            <div class="capsule">{{ capsuleLabel }}</div>
          </div>
        </div>
      </main>

      <!-- ============ 底部：悬浮控制区 ============ -->
      <footer class="controls">
        <!-- 白噪音状态浮标（左下角）：点击切换音轨（未开则顺带开启） -->
        <button class="noise-float" title="切换白噪音音轨" @click="cycleTrack">
          <component
            :is="whiteNoise.enabled ? Volume2 : VolumeX"
            class="h-3.5 w-3.5"
          />
          <span>{{ whiteNoise.enabled ? trackLabel : '白噪音关' }}</span>
        </button>

        <!-- 四枚悬浮无边框图标按钮 -->
        <div class="actions">
          <button
            class="icon-btn"
            :disabled="isRunning"
            title="开始"
            @click="store.startTimer()"
          >
            <Play class="h-5 w-5" />
          </button>
          <button
            class="icon-btn"
            :disabled="!isRunning"
            title="暂停"
            @click="store.pauseTimer()"
          >
            <Pause class="h-5 w-5" />
          </button>
          <button class="icon-btn" title="重置" @click="store.resetTimer()">
            <RotateCcw class="h-[18px] w-[18px]" />
          </button>
          <button class="icon-btn" title="切换阶段" @click="store.skipPhase()">
            <SkipForward class="h-5 w-5" />
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import {
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-vue-next';
import { usePomodoroStore, type PomodoroPhase } from '@/store/pomodoroStore';
import type { NoiseTrack } from '@/api/pomodoro';

const store = usePomodoroStore();
const {
  phase,
  status,
  currentCycle,
  settings,
  timeText,
  isRunning,
  progress,
  whiteNoise,
} = storeToRefs(store);

/* ============ 阶段辉光色（单点定义，模板只引用 var，杜绝硬编码散落） ============ */
const ACCENTS: Record<PomodoroPhase, { glow: string; soft: string }> = {
  // 专注：珊瑚橙（暖）
  work: { glow: '#FF6B35', soft: '#FFB380' },
  // 小憩：海洋蓝（冷）
  short_break: { glow: '#4A90D9', soft: '#9DC1F5' },
  // 长休：薄荷绿（生机）
  long_break: { glow: '#34C759', soft: '#8FE3AE' },
};
const accent = computed(() => ACCENTS[phase.value]);

/* ============ 时光之环几何 ============ */
const RING = 90;
const RING_STROKE = 4;
const C = 2 * Math.PI * RING;
// 进度环「充满」式：进度 0 → 空，100 → 满（耀斑领跑于填充前沿）
const ringDashoffset = computed(() => C * (1 - progress.value / 100));
// 耀斑角度：从顶部(0°)随进度顺时针旋转
const glowStyle = computed(() => ({
  transform: `rotate(${progress.value * 360}deg)`,
  transformOrigin: '100px 100px',
  transformBox: 'view-box' as const,
  transition: 'transform 0.3s linear',
}));

/* ============ 文案 ============ */
const headerLabel = computed(
  () => ({ work: '专注', short_break: '小憩', long_break: '长休' })[phase.value],
);
const capsuleLabel = computed(() => {
  if (phase.value === 'work') return `正在专注 · 第 ${currentCycle.value} 组`;
  if (phase.value === 'short_break') return '小憩时光';
  return '长休时光';
});

/* ============ 白噪音音轨 ============ */
const trackOptions: { value: NoiseTrack; label: string }[] = [
  { value: 'rain', label: '雨声' },
  { value: 'stream', label: '溪流' },
  { value: 'coffee', label: '咖啡馆' },
];
const trackLabel = computed(
  () => trackOptions.find((o) => o.value === whiteNoise.value.track)?.label ?? '雨声',
);
function cycleTrack(): void {
  const idx = trackOptions.findIndex((o) => o.value === whiteNoise.value.track);
  const next = trackOptions[(idx + 1) % trackOptions.length].value;
  store.setWhiteNoiseTrack(next);
  if (!whiteNoise.value.enabled) store.toggleWhiteNoise();
}

onMounted(() => {
  // 弹窗自身的 store 初始化（幂等）；主窗口已 init 过则立即返回
  void store.init();
});
</script>

<style scoped>
/* 注册为 <color> 类型自定义属性，使其可被 transition 插值 → 阶段切换时整屏 0.8s 无缝变色 */
@property --glow {
  syntax: '<color>';
  inherits: true;
  initial-value: #ff6b35;
}
@property --glow-soft {
  syntax: '<color>';
  inherits: true;
  initial-value: #ffb380;
}

/* 宿主：100% 占满 380×460 透明窗口，留 14px 内边距让辉光 halo 透气 */
.harmony {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 14px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
    sans-serif;
  user-select: none;
  -webkit-user-select: none;
  /* 关键：阶段色随时间 0.8s 平滑过渡（影响光晕/进度环/数字辉光等所有引用处） */
  transition: --glow 0.8s ease, --glow-soft 0.8s ease;
}

/* 第一层：环境动态光晕（模糊、半透明，色随阶段流动） */
.ambient {
  position: absolute;
  inset: -16%;
  z-index: 0;
  background:
    radial-gradient(48% 42% at 50% 16%, var(--glow) 0%, transparent 70%),
    radial-gradient(42% 50% at 82% 92%, var(--glow-soft) 0%, transparent 72%);
  filter: blur(48px) saturate(135%);
  opacity: 0.5;
  pointer-events: none;
}

/* 第二层：毛玻璃面板（超大圆角 + 弥散阴影 + 细描边） + 第三层内高光 */
.glass {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: 32px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);
  box-shadow:
    0 24px 60px -12px rgba(0, 0, 0, 0.18),
    0 8px 24px -8px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.45);
  padding: 16px 18px 18px;
  box-sizing: border-box;
}
@media (prefers-color-scheme: dark) {
  .glass {
    border-color: rgba(115, 115, 115, 0.3);
    background: rgba(23, 23, 23, 0.6);
    box-shadow:
      0 24px 60px -12px rgba(0, 0, 0, 0.55),
      0 8px 24px -8px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }
}

/* ============ 顶栏 ============ */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  background: var(--glow);
  box-shadow: 0 0 8px var(--glow);
  transition: background 0.8s ease, box-shadow 0.8s ease;
}
.phase-text {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #3f3f46;
}
@media (prefers-color-scheme: dark) {
  .phase-text {
    color: #e5e7eb;
  }
}

/* ============ 主视觉 ============ */
.stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
}
.ring-wrap {
  position: relative;
  width: 200px;
  height: 200px;
}
.ring-svg {
  width: 100%;
  height: 100%;
  display: block;
}
.ring-track {
  stroke: rgba(120, 120, 120, 0.18);
}
@media (prefers-color-scheme: dark) {
  .ring-track {
    stroke: rgba(255, 255, 255, 0.14);
  }
}
.ring-progress {
  stroke: var(--glow);
  filter: drop-shadow(0 0 6px var(--glow));
  transition: stroke 0.8s ease, stroke-dashoffset 0.3s linear;
}

/* 太阳耀斑：未运行时静止，运行时缓慢呼吸 */
.glow .glow-flare {
  transform-box: fill-box;
  transform-origin: center;
}
.glow.is-running .glow-flare {
  animation: hg-pulse 2.6s ease-in-out infinite;
}
@keyframes hg-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.95;
  }
  50% {
    transform: scale(1.18);
    opacity: 0.7;
  }
}

/* 环中央：巨数字 + 胶囊标签 */
.ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  pointer-events: none;
}
.countdown {
  font-size: 58px;
  font-weight: 200;
  line-height: 1;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  color: #18181b;
  /* 多层 text-shadow 制造辉光，避免闪烁：仅过渡颜色（数字内容本身不变形） */
  text-shadow:
    0 0 10px var(--glow),
    0 0 28px color-mix(in srgb, var(--glow) 45%, transparent);
  transition: text-shadow 0.8s ease, color 0.8s ease;
}
@media (prefers-color-scheme: dark) {
  .countdown {
    color: #fafafa;
  }
}
.capsule {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
  padding: 4px 12px;
  border-radius: 9999px;
  color: var(--glow);
  background: color-mix(in srgb, var(--glow) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--glow) 30%, transparent);
  transition: color 0.8s ease, background 0.8s ease, border-color 0.8s ease;
  white-space: nowrap;
}

/* ============ 底部控制区 ============ */
.controls {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 4px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
/* 悬浮无边框图标按钮：hover 弹性放大 + 微弱底；active 物理回弹 */
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 14px;
  background: transparent;
  color: #3f3f46;
  cursor: pointer;
  transition: transform 0.1s ease, background 0.15s ease, color 0.15s ease;
}
.icon-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
  transform: scale(1.1);
}
.icon-btn:active:not(:disabled) {
  transform: scale(0.95);
}
.icon-btn:disabled {
  opacity: 0.28;
  cursor: not-allowed;
}
@media (prefers-color-scheme: dark) {
  .icon-btn {
    color: #e5e7eb;
  }
  .icon-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }
}
/* 顶栏幽灵按钮：默认无底，hover 才显极淡背景 */
.icon-btn--ghost {
  width: 30px;
  height: 30px;
  border-radius: 9999px;
}

/* 白噪音状态浮标（左下角） */
.noise-float {
  position: absolute;
  left: 0;
  bottom: 2px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: none;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.04);
  color: #52525b;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.1s ease, background 0.15s ease;
}
.noise-float:hover {
  background: rgba(0, 0, 0, 0.08);
  transform: scale(1.04);
}
.noise-float:active {
  transform: scale(0.95);
}
@media (prefers-color-scheme: dark) {
  .noise-float {
    background: rgba(255, 255, 255, 0.08);
    color: #d4d4d8;
  }
  .noise-float:hover {
    background: rgba(255, 255, 255, 0.14);
  }
}
</style>
