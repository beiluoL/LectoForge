<template>
  <!-- 番茄钟胶囊：常驻主工作台顶栏最右侧的迷你控制台。
       高度 28px，置于 56px 顶栏的 items-center 流中自动垂直居中。 -->
  <div
    class="tc-capsule hidden sm:inline-flex items-center gap-1.5 rounded-full px-2 py-1"
    :style="{ background: 'var(--kb-muted)' }"
    :title="`${phaseLabel} · ${timeText}`"
  >
    <!-- 阶段状态点：专注红 / 休息绿；运行中呼吸闪烁，暂停或空闲时静止 -->
    <span
      class="tc-dot"
      :class="{ 'is-running': isRunning }"
      :style="{ background: dotColor }"
      aria-hidden="true"
    ></span>

    <!-- 倒计时数字：等宽 + tabular-nums，逐秒跳动时宽度不抖；点击进入番茄钟页 -->
    <button type="button" class="tc-time" :aria-label="`番茄钟 ${phaseLabel} 剩余 ${timeText}`" @click="openPomodoro">
      {{ timeText }}
    </button>

    <!-- 三个极小的无边框按钮：开始 / 暂停 / 重置 -->
    <button
      type="button"
      class="tc-btn"
      title="开始"
      aria-label="开始"
      :disabled="isRunning"
      @click="pomodoro.startTimer()"
    >
      <Icon name="play" size="xs" />
    </button>
    <button
      type="button"
      class="tc-btn"
      title="暂停"
      aria-label="暂停"
      :disabled="!isRunning"
      @click="pomodoro.pauseTimer()"
    >
      <Icon name="pause" size="xs" />
    </button>
    <button
      type="button"
      class="tc-btn"
      title="重置"
      aria-label="重置"
      @click="pomodoro.resetTimer()"
    >
      <Icon name="square" size="xs" />
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * TimerCapsule —— 顶栏内嵌番茄钟胶囊（2026-08-08 形态回归）。
 *
 * 背景：番茄钟原先是「独立 macOS 菜单栏弹窗应用」（pomodoro_popup 透明窗口），
 * 现改为沉浸在主工作台里的辅助工具——控制台就是这枚胶囊，菜单栏只留倒计时指示。
 *
 * 关键约束：
 * - 状态一律来自 usePomodoroStore（应用级单例，计时引擎在 store 里跨页面常驻），
 *   本组件是纯展示 + 派发 action，自己不持有任何计时状态；
 * - storeToRefs 只解构 state/getter，action 必须从 store 实例上直接调用
 *   （storeToRefs 不会解构 action，解错了会拿到 undefined）；
 * - 配色走 --kb-* token，不硬编码明暗两套色值，深色模式自动跟随。
 */
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import Icon from '@/components/ui/Icon.vue';
import { usePomodoroStore } from '@/store/pomodoro-store';
import { formatMMSS } from '@/lib/date';

const pomodoro = usePomodoroStore();
// timeLeft / phase / isRunning 为响应式来源；phaseLabel 仅用于 title 文案
const { timeLeft, phase, isRunning, phaseLabel } = storeToRefs(pomodoro);

/** MM:SS 文本：与 store.timeText 同一格式化函数，避免两处实现漂移 */
const timeText = computed(() => formatMMSS(timeLeft.value));

/**
 * 阶段状态点配色：专注红（番茄珊瑚红）/ 休息绿（薄荷绿）。
 * 与 Rust 侧 tray.rs::paint_tray_title 的圆点取色保持一致，
 * 让「顶栏胶囊」和「菜单栏图标」在任何时刻传达同一状态。
 */
const dotColor = computed(() => (phase.value === 'work' ? '#FF6B35' : '#34C759'));

const router = useRouter();
const route = useRoute();

/** 点击倒计时数字 → 打开番茄钟完整页（设置 / 统计 / 大号进度环都在那儿） */
function openPomodoro() {
  if (route.path !== '/pomodoro') router.push('/pomodoro');
}
</script>

<style scoped>
.tc-capsule {
  /* 28px 高：与顶栏其它 wb-icon-btn 视觉等高，不撑破 56px 顶栏 */
  height: 28px;
  user-select: none;
}

/* 阶段状态点 */
.tc-dot {
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  flex: none;
}
.tc-dot.is-running {
  animation: tc-pulse 1.6s ease-in-out infinite;
}
@keyframes tc-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.45;
    transform: scale(0.82);
  }
}

/* 倒计时数字：等宽字体 + 定宽数字，逐秒刷新不抖动 */
.tc-time {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--kb-foreground);
  letter-spacing: 0.02em;
  padding: 10px 5px;
  margin: -10px -5px;
  background: none;
  border: 0;
  cursor: pointer;
}
.tc-time:hover {
  color: var(--kb-primary);
}

/* 三个极小的无边框控制按钮 */
.tc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: content-box;
  width: 18px;
  height: 18px;
  padding: 8px;
  margin: -8px;
  border: 0;
  border-radius: 9999px;
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease, opacity 0.15s ease;
}
.tc-btn:hover:not(:disabled) {
  color: var(--kb-primary);
  background: var(--kb-card);
}
.tc-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
