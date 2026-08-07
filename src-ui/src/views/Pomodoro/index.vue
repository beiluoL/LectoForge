<template>
  <!-- 番茄钟主页面：计时环 + 参数配置 + 控制 + 白噪音 + 声音设置。
       计时逻辑全在 pomodoroStore（应用级单例，跨页面常驻），本页只负责展示与派发动作。 -->
  <div class="pm-wrap">
    <div class="pm-inner">
      <!-- 顶部标题 -->
      <header class="pm-head">
        <div class="pm-title">
          <Icon name="timer" :size="22" style="color: var(--kb-primary)" />
          <h1>番茄钟</h1>
        </div>
        <router-link to="/pomodoro/stats" class="pm-link">
          <Icon name="bar-chart" :size="15" />
          历史统计
        </router-link>
      </header>

      <!-- 参数配置：仅空闲态可编辑（运行中改时长会掐断当前这一段） -->
      <section class="pm-config" :class="{ 'is-locked': status !== 'idle' }">
        <div class="pm-field">
          <label>专注</label>
          <div class="pm-input-group">
            <input
              class="kb-input pm-num"
              type="number"
              min="1"
              max="180"
              :value="settings.workMinutes"
              :disabled="status !== 'idle'"
              @change="onSetting('workMinutes', $event)"
            />
            <span class="pm-unit">分</span>
          </div>
        </div>
        <div class="pm-field">
          <label>小憩</label>
          <div class="pm-input-group">
            <input
              class="kb-input pm-num"
              type="number"
              min="1"
              max="60"
              :value="settings.shortBreakMinutes"
              :disabled="status !== 'idle'"
              @change="onSetting('shortBreakMinutes', $event)"
            />
            <span class="pm-unit">分</span>
          </div>
        </div>
        <div class="pm-field">
          <label>长休息</label>
          <div class="pm-input-group">
            <input
              class="kb-input pm-num"
              type="number"
              min="1"
              max="120"
              :value="settings.longBreakMinutes"
              :disabled="status !== 'idle'"
              @change="onSetting('longBreakMinutes', $event)"
            />
            <span class="pm-unit">分</span>
          </div>
        </div>
        <div class="pm-field">
          <label>每组番茄</label>
          <div class="pm-input-group">
            <input
              class="kb-input pm-num"
              type="number"
              min="1"
              max="12"
              :value="settings.cyclesPerSet"
              :disabled="status !== 'idle'"
              @change="onSetting('cyclesPerSet', $event)"
            />
            <span class="pm-unit">个</span>
          </div>
        </div>
      </section>

      <!-- 中央计时环 -->
      <section class="pm-timer">
        <div
          class="pm-ring"
          :style="{
            background: `conic-gradient(${ringColor} ${progress}, var(--kb-muted) 0)`,
          }"
        >
          <div class="pm-ring-inner">
            <span class="pm-phase">{{ phaseEmoji }} {{ phaseLabel }}</span>
            <span class="pm-time">{{ timeText }}</span>
            <span class="pm-cycle">第 {{ currentCycle }} / {{ settings.cyclesPerSet }} 个番茄</span>
          </div>
        </div>

        <!-- 控制按钮 -->
        <div class="pm-controls">
          <button
            class="kb-btn kb-btn-primary pm-ctrl-main"
            :disabled="status === 'completed'"
            @click="toggleStart"
          >
            <Icon :name="isRunning ? 'pause' : (status === 'paused' ? 'play' : 'play')" :size="16" />
            {{ isRunning ? '暂停' : (status === 'paused' ? '继续' : '开始') }}
          </button>
          <button class="kb-btn pm-ctrl" :disabled="status === 'idle'" @click="store.resetTimer()">
            <Icon name="rotate-ccw" :size="15" /> 重置
          </button>
          <button class="kb-btn pm-ctrl" :disabled="status === 'idle'" @click="skipPhase">
            <Icon name="skip-forward" :size="15" /> 跳过本段
          </button>
          <button class="kb-btn pm-ctrl" @click="store.stopSession()">
            <Icon name="square" :size="15" /> 退出
          </button>
        </div>

        <p class="pm-hint" v-if="status === 'idle'">
          配置好时长后点「开始」，专注会被番茄钟接管并在后台持续计时。
        </p>
        <p class="pm-hint" v-else-if="isRunning">
          计时中——你可以随时切去「复习 / 笔记」页面，番茄钟不会停。
        </p>
        <p class="pm-hint" v-else>
          已暂停。恢复后从当前剩余时间接着算，不会丢失已专注的时长。
        </p>
      </section>

      <!-- 底部：白噪音 + 声音设置 两栏 -->
      <section class="pm-bottom">
        <!-- 白噪音 Mini 播放器 -->
        <div class="pm-card">
          <div class="pm-card-head">
            <Icon name="headphones" :size="16" style="color: var(--kb-primary)" />
            <span>白噪音</span>
            <span class="pm-card-tag" :class="{ on: whiteNoise.enabled }">
              {{ whiteNoise.enabled ? '播放中' : '已静音' }}
            </span>
          </div>
          <div class="pm-track-list">
            <button
              v-for="t in noiseTracks"
              :key="t"
              class="pm-track"
              :class="{ active: whiteNoise.track === t && whiteNoise.enabled }"
              @click="onPickTrack(t)"
            >
              {{ trackLabel(t) }}
            </button>
          </div>
          <div class="pm-volume">
            <button class="pm-vol-btn" :class="{ on: whiteNoise.enabled }" @click="store.toggleWhiteNoise()">
              <Icon :name="whiteNoise.enabled ? 'volume-2' : 'volume-x'" :size="16" />
            </button>
            <input
              class="pm-range"
              type="range"
              min="0"
              max="100"
              :value="whiteNoise.volume"
              @input="onVolume"
            />
            <span class="pm-vol-val">{{ whiteNoise.volume }}</span>
          </div>
        </div>

        <!-- 提示音设置 -->
        <div class="pm-card">
          <div class="pm-card-head">
            <Icon name="bell" :size="16" style="color: var(--kb-primary)" />
            <span>提示音</span>
            <label class="pm-switch">
              <input
                type="checkbox"
                :checked="soundSettings.enabled"
                @change="store.setSoundEnabled(($event.target as HTMLInputElement).checked)"
              />
              <span class="pm-switch-track"></span>
            </label>
          </div>
          <div class="pm-sound-types">
            <button
              v-for="s in soundTypes"
              :key="s"
              class="pm-track"
              :class="{ active: soundSettings.soundType === s }"
              :disabled="!soundSettings.enabled"
              @click="store.setSoundType(s)"
            >
              {{ soundLabel(s) }}
            </button>
          </div>
          <button class="kb-btn pm-preview" :disabled="!soundSettings.enabled" @click="store.playSound()">
            <Icon name="play" :size="14" /> 试听
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import Icon from '@/components/ui/Icon.vue';
import { usePomodoroStore } from '@/store/pomodoroStore';
import type { NoiseTrack, PomodoroPhase, SoundType } from '@/api/pomodoro';

const store = usePomodoroStore();
const {
  settings,
  status,
  phase,
  currentCycle,
  timeLeft,
  soundSettings,
  whiteNoise,
  progress,
  timeText,
  phaseLabel,
  phaseEmoji,
  isRunning,
  completedToday,
} = storeToRefs(store);

onMounted(() => {
  void store.init();
});

/** 计时环颜色随阶段变化（专注=主蓝 / 小憩=橙 / 长休息=绿），禁止硬编码 */
const ringColor = computed(() => {
  if (phase.value === 'work') return 'var(--kb-primary)';
  if (phase.value === 'short_break') return 'var(--kb-warning)';
  return 'var(--kb-accent)';
});

function toggleStart() {
  if (isRunning.value) store.pauseTimer();
  else store.startTimer();
}

/** 跳过本段：复用 finishPhase 的「下一步」算法，但不落库、不计入完成数 */
function skipPhase() {
  const next: PomodoroPhase =
    phase.value === 'work'
      ? currentCycle.value >= Math.max(1, settings.value.cyclesPerSet)
        ? 'long_break'
        : 'short_break'
      : 'work';
  store.switchPhase(next);
}

function onSetting(key: 'workMinutes' | 'shortBreakMinutes' | 'longBreakMinutes' | 'cyclesPerSet', e: Event) {
  const v = Math.floor(Number((e.target as HTMLInputElement).value) || 0);
  store.updateSettings({ [key]: v } as any);
}

const noiseTracks: NoiseTrack[] = ['rain', 'stream', 'coffee'];
const TRACK_TEXT: Record<NoiseTrack, string> = {
  rain: '🌧️ 雨声',
  stream: '💧 溪流',
  coffee: '☕ 咖啡馆',
};
function trackLabel(t: NoiseTrack) {
  return TRACK_TEXT[t];
}
function onPickTrack(t: NoiseTrack) {
  // 点同一个 = 开关；点别的 = 切源
  if (whiteNoise.value.track === t && whiteNoise.value.enabled) store.toggleWhiteNoise();
  else store.setWhiteNoiseTrack(t);
}

function onVolume(e: Event) {
  store.setWhiteNoiseVolume(Number((e.target as HTMLInputElement).value));
}

const soundTypes: SoundType[] = ['ding', 'tick', 'alarm'];
const SOUND_TEXT: Record<SoundType, string> = {
  ding: '🔔 叮',
  tick: '⏱️ 滴答',
  alarm: '⏰ 发条',
};
function soundLabel(s: SoundType) {
  return SOUND_TEXT[s];
}
</script>

<style scoped>
.pm-wrap {
  min-height: calc(100vh - 3.5rem);
  padding: 28px 16px 48px;
  display: flex;
  justify-content: center;
}
.pm-inner {
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

/* 头部 */
.pm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pm-title {
  display: flex;
  align-items: center;
  gap: 9px;
}
.pm-title h1 {
  font-size: var(--kb-fs-h3);
  font-weight: 700;
  color: var(--kb-foreground);
  margin: 0;
}
.pm-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--kb-fs-body-sm);
  color: var(--kb-muted-foreground);
  text-decoration: none;
  padding: 6px 11px;
  border-radius: var(--kb-radius-md);
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
  transition: color 0.15s ease, border-color 0.15s ease;
}
.pm-link:hover {
  color: var(--kb-primary);
  border-color: var(--kb-primary);
}

/* 参数配置 */
.pm-config {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  padding: 16px;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  transition: opacity 0.2s ease;
}
.pm-config.is-locked {
  opacity: 0.6;
}
.pm-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pm-field label {
  font-size: var(--kb-fs-caption);
  color: var(--kb-muted-foreground);
  font-weight: 500;
}
.pm-input-group {
  position: relative;
  display: flex;
  align-items: center;
}
.pm-num {
  width: 100%;
  padding-right: 26px;
  text-align: center;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.pm-num::-webkit-outer-spin-button,
.pm-num::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.pm-num {
  -moz-appearance: textfield;
}
.pm-unit {
  position: absolute;
  right: 9px;
  font-size: 11px;
  color: var(--kb-muted-foreground);
  pointer-events: none;
}

/* 计时环 */
.pm-timer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}
.pm-ring {
  width: 260px;
  height: 260px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.25s linear;
  box-shadow: var(--shadow-card);
}
.pm-ring-inner {
  width: 214px;
  height: 214px;
  border-radius: 50%;
  background: var(--kb-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: inset 0 0 0 1px var(--kb-border);
}
.pm-phase {
  font-size: var(--kb-fs-body-md);
  font-weight: 600;
  color: var(--kb-muted-foreground);
}
.pm-time {
  font-family: var(--font-mono);
  font-size: 52px;
  font-weight: 600;
  line-height: 1;
  color: var(--kb-foreground);
  font-variant-numeric: tabular-nums;
}
.pm-cycle {
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
}

/* 控制按钮 */
.pm-controls {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}
.pm-ctrl-main {
  min-width: 108px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}
.pm-ctrl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.pm-hint {
  margin: 0;
  font-size: var(--kb-fs-caption);
  color: var(--kb-muted-foreground);
  text-align: center;
  max-width: 420px;
}

/* 底部两栏 */
.pm-bottom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.pm-card {
  padding: 16px;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pm-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--kb-fs-body-md);
  font-weight: 600;
  color: var(--kb-foreground);
}
.pm-card-tag {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 999px;
  color: var(--kb-muted-foreground);
  background: var(--kb-muted);
}
.pm-card-tag.on {
  color: var(--kb-accent);
  background: color-mix(in srgb, var(--kb-accent) 12%, var(--kb-card));
}
.pm-track-list,
.pm-sound-types {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.pm-track {
  flex: 1;
  min-width: 64px;
  padding: 9px 8px;
  border-radius: var(--kb-radius-md);
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
  color: var(--kb-muted-foreground);
  font-size: var(--kb-fs-body-sm);
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.pm-track:hover:not(:disabled) {
  color: var(--kb-primary);
  border-color: var(--kb-primary);
}
.pm-track.active {
  color: var(--kb-primary-foreground);
  background: var(--kb-primary);
  border-color: var(--kb-primary);
}
.pm-track:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 音量条 */
.pm-volume {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pm-vol-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--kb-radius-md);
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.pm-vol-btn.on {
  color: var(--kb-primary);
  border-color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 8%, var(--kb-card));
}
.pm-range {
  flex: 1;
  accent-color: var(--kb-primary);
  cursor: pointer;
}
.pm-vol-val {
  font-family: var(--font-mono);
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
  width: 24px;
  text-align: right;
}

/* 提示音开关 */
.pm-switch {
  margin-left: auto;
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  cursor: pointer;
}
.pm-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.pm-switch-track {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: var(--kb-muted);
  transition: background 0.2s ease;
}
.pm-switch-track::before {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: var(--shadow-sm);
  transition: transform 0.2s ease;
}
.pm-switch input:checked + .pm-switch-track {
  background: var(--kb-primary);
}
.pm-switch input:checked + .pm-switch-track::before {
  transform: translateX(18px);
}
.pm-preview {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

@media (max-width: 600px) {
  .pm-config {
    grid-template-columns: repeat(2, 1fr);
  }
  .pm-bottom {
    grid-template-columns: 1fr;
  }
}
</style>
