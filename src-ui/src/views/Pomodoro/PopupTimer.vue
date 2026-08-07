<!--
  菜单栏番茄钟弹窗（pomodoro_popup 窗口，360×440 无边框透明）
  仿 macOS 下拉菜单形态：顶部小三角指向菜单栏图标 → 红色倒计时 banner → 三 Tab
  （时长/设置/声音）→ 底部固定菜单（给我们好评/关于/退出）。

  所有计时逻辑都在 pomodoroStore（应用级单例，跨窗口常驻）；本组件只是它的「遥控器」。
  窗口被隐藏（window.hide）时 WebView 的 JS 仍在跑，计时照常后台运行、状态栏标题照常更新。

  交互：
  - 红色 banner：点击切换开始/暂停
  - Tab：切换 时长 / 设置 / 声音 面板
  - 时长：4 个数字调节器（▲▼ 步进），改完空闲态立即重置倒计时、运行中保持当前这一段
  - 设置：自动开始下一段 / 阶段切换提示音 / 阶段切换通知 三个开关
  - 声音：发条声 / 叮 / 滴答声 三选一胶囊开关
  - 底部：给我们好评（开外链）/ 关于（开主窗跳关于页）/ 退出
  - 点击弹窗外部：Rust 侧 WindowEvent::Focused(false) 同步立即 hide()
-->
<template>
  <div class="pomo-menu">
    <div class="pomo-card">
      <!-- 顶部小三角：CSS 伪元素指向菜单栏图标，模拟原生下拉菜单的「连接线」 -->
      <div class="pomo-arrow" />

      <!-- 红色 Banner：倒计时 + 阶段状态 + 点击切换 -->
      <button class="pomo-banner" @click="onToggleTimer">
        <span class="pomo-banner-time">{{ timeText }}</span>
        <span class="pomo-banner-status">{{ statusHint }}</span>
      </button>

      <!-- Tab 切换 -->
      <div class="pomo-tabs" role="tablist">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="pomo-tab"
          :class="{ active: activeTab === t.key }"
          role="tab"
          :aria-selected="activeTab === t.key"
          @click="activeTab = t.key"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- Tab 内容区 -->
      <div class="pomo-pane">
        <!-- 时长 Tab：4 个数字调节器 -->
        <div v-show="activeTab === 'duration'" class="pomo-fields">
          <div v-for="f in durationFields" :key="f.key" class="pomo-field">
            <span class="pomo-field-label">{{ f.label }}</span>
            <div class="pomo-spinner">
              <button
                class="pomo-spin"
                :disabled="!canEditSettings"
                aria-label="减小"
                @click="bump(f.key, -f.step)"
              >−</button>
              <span class="pomo-val">
                <span class="pomo-val-num">{{ f.value }}</span>
                <span v-if="f.unit" class="pomo-val-unit">{{ f.unit }}</span>
              </span>
              <button
                class="pomo-spin"
                :disabled="!canEditSettings"
                aria-label="增大"
                @click="bump(f.key, +f.step)"
              >+</button>
            </div>
          </div>
          <p v-if="!canEditSettings" class="pomo-hint">
            计时进行中，时长设置已锁定（避免打断当前这一段）
          </p>
        </div>

        <!-- 设置 Tab：3 个开关 -->
        <div v-show="activeTab === 'settings'" class="pomo-fields">
          <label class="pomo-toggle-row">
            <span class="pomo-toggle-label">自动开始下一段</span>
            <button
              class="pomo-switch"
              :class="{ on: autoStartNext }"
              role="switch"
              :aria-checked="autoStartNext"
              @click="setAutoStartNext(!autoStartNext)"
            ><span class="pomo-switch-knob" /></button>
          </label>
          <label class="pomo-toggle-row">
            <span class="pomo-toggle-label">阶段切换提示音</span>
            <button
              class="pomo-switch"
              :class="{ on: soundSettings.enabled }"
              role="switch"
              :aria-checked="soundSettings.enabled"
              @click="setSoundEnabled(!soundSettings.enabled)"
            ><span class="pomo-switch-knob" /></button>
          </label>
          <label class="pomo-toggle-row">
            <span class="pomo-toggle-label">阶段切换通知</span>
            <button
              class="pomo-switch"
              :class="{ on: notifEnabled }"
              role="switch"
              :aria-checked="notifEnabled"
              @click="setNotifEnabled(!notifEnabled)"
            ><span class="pomo-switch-knob" /></button>
          </label>
          <button class="pomo-link-row" @click="showMain">
            <span>打开主窗口</span>
            <span class="pomo-shortcut">↗</span>
          </button>
        </div>

        <!-- 声音 Tab：3 个胶囊开关（互斥单选） -->
        <div v-show="activeTab === 'sound'" class="pomo-fields">
          <div v-for="s in soundOptions" :key="s.key" class="pomo-toggle-row">
            <span class="pomo-toggle-label">{{ s.label }}</span>
            <button
              class="pomo-switch"
              :class="{ on: soundSettings.soundType === s.key }"
              role="switch"
              :aria-checked="soundSettings.soundType === s.key"
              :aria-label="`切换提示音为 ${s.label}`"
              @click="pickSound(s.key)"
            ><span class="pomo-switch-knob" /></button>
          </div>
        </div>
      </div>

      <!-- 底部固定菜单：与我们主应用内下拉菜单风格保持一致（标签 + 右侧 ⌘ 快捷键占位） -->
      <div class="pomo-bottom">
        <button class="pomo-menu-item" @click="rateUs">
          <span>给我们好评</span>
        </button>
        <button class="pomo-menu-item" @click="showAbout">
          <span>关于</span>
          <span class="pomo-shortcut">⌘ A</span>
        </button>
        <button class="pomo-menu-item pomo-menu-item--danger" @click="quitApp">
          <span>退出</span>
          <span class="pomo-shortcut">⌘ Q</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { usePomodoroStore } from '@/store/pomodoroStore';
import type { SoundType } from '@/api/pomodoro';

// 「给我们好评」打开的链接。后续可换成 App Store / 反馈表单 / 官网。
// 用 GitHub 仓库地址兜底，避免占位空字符串被 `open` 当成本地路径打开失败。
const RATE_URL = 'https://github.com/beiluoL/LectoForge';

const store = usePomodoroStore();
const {
  phaseLabel,
  phaseEmoji,
  status,
  currentCycle,
  settings,
  timeText,
  isRunning,
  soundSettings,
  autoStartNext,
} = storeToRefs(store);
// actions 不能走 storeToRefs（它只解构 state/getter）；直接 destructure 让模板可见
const { setAutoStartNext, setSoundEnabled, updateSettings, setSoundType, init } = store;

/* ==================== Tab 状态 ==================== */

type TabKey = 'duration' | 'settings' | 'sound';
const tabs: { key: TabKey; label: string }[] = [
  { key: 'duration', label: '时长' },
  { key: 'settings', label: '设置' },
  { key: 'sound', label: '声音' },
];
const activeTab = ref<TabKey>('duration');

/* ==================== 派生 ==================== */

const statusHint = computed(() => {
  // banner 副标题：阶段 emoji + 阶段名 + 第 N 组；运行中额外标「进行中」
  const cycle = `第 ${currentCycle.value} / ${settings.value.cyclesPerSet} 组`;
  if (status.value === 'running') return `${phaseEmoji.value} ${phaseLabel.value} · ${cycle}`;
  if (status.value === 'paused') return `已暂停 · ${cycle}`;
  if (status.value === 'completed') return '本轮结束';
  return `${phaseEmoji.value} ${phaseLabel.value} · ${cycle}`;
});

/** 空闲态才允许改时长；运行/暂停中改会掐断当前这一段（与主页面行为一致） */
const canEditSettings = computed(() => status.value === 'idle');

/* ==================== 时长字段（动态拼装，给模板 for 循环用） ==================== */

type DurationField = {
  key: keyof typeof settings.value;
  label: string;
  value: number;
  unit: string;
  step: number;
};
const durationFields = computed<DurationField[]>(() => [
  { key: 'workMinutes', label: '工作时间', value: settings.value.workMinutes, unit: '分', step: 1 },
  { key: 'shortBreakMinutes', label: '小憩时间', value: settings.value.shortBreakMinutes, unit: '分', step: 1 },
  { key: 'longBreakMinutes', label: '长休息时间', value: settings.value.longBreakMinutes, unit: '分', step: 1 },
  { key: 'cyclesPerSet', label: '一组中工作的次数', value: settings.value.cyclesPerSet, unit: '', step: 1 },
]);

/* ==================== 声音选项 ==================== */

const soundOptions: { key: SoundType; label: string }[] = [
  { key: 'tick', label: '发条声' },
  { key: 'ding', label: '叮' },
  { key: 'alarm', label: '滴答声' },
];

/* ==================== 通知开关（前端常驻，暂不持久化） ==================== */

/**
 * 通知开关独立于提示音。store 里目前没有对应字段（后端 config schema 也未单独保留），
 * 这里用 localStorage 兜底持久化；非 Tauri 宿主下 localStorage 始终可用，try/catch 兜异常。
 */
const NOTIF_KEY = 'kf_pomodoro_notif_enabled';
const notifEnabled = ref<boolean>(true);
function loadNotifEnabled(): void {
  try {
    const v = localStorage.getItem(NOTIF_KEY);
    notifEnabled.value = v === null ? true : v === '1';
  } catch {
    notifEnabled.value = true;
  }
}
function setNotifEnabled(v: boolean): void {
  notifEnabled.value = v;
  try { localStorage.setItem(NOTIF_KEY, v ? '1' : '0'); } catch { /* 隐私模式可能抛 */ }
}

/* ==================== 操作 ==================== */

function onToggleTimer(): void {
  if (isRunning.value) store.pauseTimer();
  else store.startTimer();
}

function bump(key: keyof typeof settings.value, delta: number): void {
  if (!canEditSettings.value) return;
  // 单独走 store.updateSettings 而不是 Object.assign + saveSettings：前者会处理「空闲态同步倒计时」
  const current = settings.value[key] as number;
  const next = Math.max(1, current + delta);
  void updateSettings({ [key]: next } as Partial<typeof settings.value>);
}

function pickSound(t: SoundType): void {
  // store.setSoundType 内部会播一次试听，所以即使开关在关也无所谓——试听是显式行为
  void setSoundType(t);
}

function showMain(): void {
  void (async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      await getCurrentWindow().hide();
      // @tauri-apps/api 2.x：getByLabel 是 async
      const main = await WebviewWindow.getByLabel('main');
      if (main) {
        await main.show();
        await main.setFocus();
      }
    } catch {
      /* 浏览器预览态 */
    }
  })();
}

async function rateUs(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_external_url', { url: RATE_URL });
  } catch {
    /* 浏览器态：直接在新标签打开 */
    try { window.open(RATE_URL, '_blank', 'noopener,noreferrer'); } catch { /* 忽略 */ }
  }
  await hideSelf();
}

async function showAbout(): Promise<void> {
  // 跳转到主窗口的「关于」页（如果有）；先收起弹窗再显示主窗口
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const { emit } = await import('@tauri-apps/api/event');
    await getCurrentWindow().hide();
    // @tauri-apps/api 2.x：getByLabel 是 async
    const main = await WebviewWindow.getByLabel('main');
    if (main) {
      await main.show();
      await main.setFocus();
      // 主窗口的 App.vue 已 listen('navigate')，发个路径就跳
      await emit('navigate', '/settings/about');
    }
  } catch {
    /* 浏览器态：仅本地路由跳转（不影响主流程） */
  }
}

async function quitApp(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('quit_app');
  } catch {
    /* 浏览器态：忽略 */
  }
}

async function hideSelf(): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().hide();
  } catch {
    /* 浏览器态：忽略 */
  }
}

/* ==================== 初始化 ==================== */

onMounted(() => {
  // 弹窗自身的 store 初始化（幂等）；主窗口已 init 过的情况下 inited=true 立即返回
  void init();
  loadNotifEnabled();
});
</script>

<style scoped>
/* 根容器：100% 占满 360×440 透明窗口，铺底对齐让 .pomo-card 居中且能容纳小三角 */
.pomo-menu {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 6px 0 0; /* 顶部留 6px 让 .pomo-arrow 的小三角嵌进去 */
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
    sans-serif;
}
.pomo-card {
  position: relative;
  width: 100%;
  max-width: 360px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-sizing: border-box;
  overflow: hidden;
}
@media (prefers-color-scheme: dark) {
  .pomo-card {
    background: #1f2127;
    border-color: rgba(255, 255, 255, 0.08);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3);
  }
}

/* 小三角：定位在卡片顶部中央偏上，指向菜单栏图标。纯 CSS 三角形。 */
.pomo-arrow {
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 12px;
  height: 6px;
  pointer-events: none;
  z-index: 1;
}
.pomo-arrow::before {
  content: '';
  position: absolute;
  inset: 0;
  background: #ffffff;
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  border-left: 1px solid rgba(0, 0, 0, 0.08);
  border-right: 1px solid rgba(0, 0, 0, 0.08);
}
@media (prefers-color-scheme: dark) {
  .pomo-arrow::before {
    background: #1f2127;
    border-top-color: rgba(255, 255, 255, 0.08);
    border-left-color: rgba(255, 255, 255, 0.08);
    border-right-color: rgba(255, 255, 255, 0.08);
  }
}

/* 红色 Banner：占据视觉焦点，整块可点 */
.pomo-banner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 64px;
  margin: 8px 8px 6px;
  border-radius: 10px;
  background: #e5484d;
  color: #ffffff;
  border: none;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.05s ease;
}
.pomo-banner:hover {
  background: #d83d42;
}
.pomo-banner:active {
  transform: scale(0.99);
}
.pomo-banner-time {
  font-size: 26px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
  line-height: 1.1;
}
.pomo-banner-status {
  font-size: 11px;
  font-weight: 500;
  opacity: 0.92;
  letter-spacing: 0.2px;
}

/* Tab 条：等分三段，active 有灰底胶囊 */
.pomo-tabs {
  display: flex;
  gap: 4px;
  margin: 4px 8px 0;
  padding: 3px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 9px;
}
@media (prefers-color-scheme: dark) {
  .pomo-tabs {
    background: rgba(255, 255, 255, 0.06);
  }
}
.pomo-tab {
  flex: 1;
  height: 28px;
  border: none;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  color: var(--kb-muted-foreground, #6b7280);
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.pomo-tab:hover:not(.active) {
  color: var(--kb-foreground, #1a1d23);
}
.pomo-tab.active {
  background: #ffffff;
  color: #1a1d23;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
@media (prefers-color-scheme: dark) {
  .pomo-tab.active {
    background: #2a2c34;
    color: #f0f0f2;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }
}

/* 内容区 */
.pomo-pane {
  flex: 1;
  min-height: 0;
  padding: 8px 8px 4px;
  overflow-y: auto;
}
.pomo-fields {
  display: flex;
  flex-direction: column;
}

/* 时长字段行 */
.pomo-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 4px;
  border-radius: 6px;
}
.pomo-field + .pomo-field {
  margin-top: 2px;
}
.pomo-field-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--kb-foreground, #1a1d23);
}
.pomo-spinner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.pomo-spin {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  color: var(--kb-muted-foreground, #6b7280);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.pomo-spin:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.06);
  color: var(--kb-foreground, #1a1d23);
  border-color: rgba(0, 0, 0, 0.06);
}
.pomo-spin:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
@media (prefers-color-scheme: dark) {
  .pomo-spin:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.08);
  }
}
.pomo-val {
  min-width: 56px;
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}
.pomo-val-num {
  font-size: 15px;
  font-weight: 600;
  color: var(--kb-foreground, #1a1d23);
}
.pomo-val-unit {
  font-size: 11px;
  color: var(--kb-muted-foreground, #6b7280);
  margin-left: 1px;
}
.pomo-hint {
  margin: 6px 4px 0;
  font-size: 11px;
  color: var(--kb-muted-foreground, #6b7280);
  line-height: 1.5;
}

/* 通用行：标签左、开关/链接右；用于 设置 / 声音 两个 Tab */
.pomo-toggle-row,
.pomo-link-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  padding: 0 4px;
  border-radius: 6px;
  background: transparent;
  border: none;
  font-size: 13px;
  color: var(--kb-foreground, #1a1d23);
}
.pomo-toggle-row + .pomo-toggle-row,
.pomo-link-row {
  margin-top: 2px;
}
.pomo-toggle-label {
  font-size: 13px;
  font-weight: 500;
}

/* 胶囊开关：参考 macOS 风格，on=红/灰、off=浅灰 */
.pomo-switch {
  position: relative;
  width: 36px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.18);
  cursor: pointer;
  transition: background 0.18s ease;
}
.pomo-switch.on {
  background: #e5484d;
}
.pomo-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #ffffff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 0.18s ease;
}
.pomo-switch.on .pomo-switch-knob {
  transform: translateX(16px);
}
@media (prefers-color-scheme: dark) {
  .pomo-switch {
    background: rgba(255, 255, 255, 0.18);
  }
}

/* 「打开主窗口」链接行：底色微亮，区别于开关行 */
.pomo-link-row {
  cursor: pointer;
  transition: background 0.12s ease;
}
.pomo-link-row:hover {
  background: rgba(0, 0, 0, 0.04);
}
@media (prefers-color-scheme: dark) {
  .pomo-link-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }
}

/* 底部固定菜单：标签 + 右侧快捷键；与原生 NSMenu 项高度一致 */
.pomo-bottom {
  margin-top: auto;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  padding: 4px 6px 6px;
  display: flex;
  flex-direction: column;
}
@media (prefers-color-scheme: dark) {
  .pomo-bottom {
    border-top-color: rgba(255, 255, 255, 0.08);
  }
}
.pomo-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 8px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  color: var(--kb-foreground, #1a1d23);
  cursor: pointer;
  transition: background 0.1s ease;
}
.pomo-menu-item:hover {
  background: rgba(0, 0, 0, 0.06);
}
.pomo-menu-item--danger:hover {
  color: #e5484d;
}
@media (prefers-color-scheme: dark) {
  .pomo-menu-item:hover {
    background: rgba(255, 255, 255, 0.07);
  }
  .pomo-menu-item--danger:hover {
    color: #ff5e62;
  }
}
.pomo-shortcut {
  font-size: 12px;
  color: var(--kb-muted-foreground, #6b7280);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.5px;
}
</style>
