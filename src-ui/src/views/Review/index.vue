<template>
  <!-- 间隔复习「闪卡专注模式」（/review、/review/flashcard）：
       2026-08-07 架构收敛后本页只做刷卡一件事——进度条 + 卡型徽章 + 3D 翻转飞出 + 挂起 + 全屏专注 + 键盘盲操。
       热力图与遗忘趋势已上移到复习驾驶舱（/workbench/review），此处不再重复展示，避免刷题时被数据分心。 -->
  <div class="rv-wrap" :class="{ 'is-immersive': isImmersive }">
    <!-- 番茄钟状态条：跨页面常驻，专注时随时可见剩余时间，一键暂停/继续（计时引擎在 pomodoroStore，复习中被掐不断） -->
    <div class="rv-pomo" :class="{ 'is-active': isRunning || status === 'paused' }">
      <Icon name="timer" :size="14" style="color: var(--kb-primary)" />
      <span class="rv-pomo-phase">{{ phaseEmoji }} {{ phaseLabel }}</span>
      <span class="rv-pomo-time">{{ timeText }}</span>
      <button
        v-if="status !== 'idle'"
        class="rv-pomo-btn"
        @click="isRunning ? pomoStore.pauseTimer() : pomoStore.startTimer()"
      >
        <Icon :name="isRunning ? 'pause' : 'play'" :size="13" />
        {{ isRunning ? '暂停' : '继续' }}
      </button>
      <router-link to="/pomodoro" class="rv-pomo-link">打开番茄钟</router-link>
    </div>

    <!-- 顶部：返回 / 标题 / 卡型 / 进度 / 全屏 / 退出（视觉与复习驾驶舱对齐） -->
    <header class="rv-top">
      <div class="rv-title">
        <!-- 返回驾驶舱：沉浸模式下隐藏，保持画面干净 -->
        <button v-if="!isImmersive" class="rv-back" title="返回复习中心" @click="backToCockpit">
          <Icon name="arrow-left" :size="16" />
        </button>
        <Icon name="brain" :size="18" style="color: var(--kb-primary)" />
        间隔复习
        <!-- 当前卡型徽章：与卡面右上角同源，方便沉浸模式下扫一眼就知道难度 -->
        <span v-if="currentBadge" class="rv-type" :class="currentBadge.cls">{{ currentBadge.text }}</span>
      </div>

      <!-- 沉浸模式下隐藏进度条，只留卡片 -->
      <div v-if="!isImmersive" class="rv-progress">
        <div class="rv-progress-bar">
          <div class="rv-progress-fill" :style="{ width: progressPct + '%' }"></div>
        </div>
        <span class="rv-progress-text">已复习 {{ processedCount }} / {{ totalCount }}</span>
      </div>
      <div v-else class="rv-progress rv-progress--mini">
        <span class="rv-progress-text">{{ processedCount }} / {{ totalCount }}</span>
      </div>

      <div class="rv-top-actions">
        <button class="kb-btn rv-fs" :title="isImmersive ? '退出全屏（Esc）' : '全屏专注'" @click="toggleFullscreen">
          <Icon :name="isImmersive ? 'minimize' : 'maximize'" :size="15" />
          {{ isImmersive ? '退出全屏' : '全屏专注' }}
        </button>
        <button v-if="!isImmersive" class="kb-btn rv-exit" @click="exit">
          <Icon name="x" :size="15" /> 退出复习
        </button>
      </div>
    </header>

    <main class="rv-main">
      <!-- 加载态 -->
      <div v-if="isLoading" class="rv-center">
        <Icon name="loader" :size="28" class="rv-spin" />
        <p>正在加载待复习卡片…</p>
      </div>

      <!-- 复习中 -->
      <template v-else-if="current">
        <!-- 卡槽：飞出动画结束后在此隐身完成 splice，再淡入下一张（不干涉 currentIndex 恒为 0 的逻辑） -->
        <div class="rv-card-slot" :class="{ 'is-swapping': swapping }">
          <FlashCard
            :key="current.id"
            :card="current"
            :side="cardSide"
            :fly="flyState"
            @flip="onFlip"
            @fly-end="onFlyEnd"
          />
        </div>

        <!-- 操作区：正面显示答案 / 反面评分 -->
        <div class="rv-actions">
          <button
            v-if="cardSide === 'front'"
            class="kb-btn kb-btn-primary rv-show"
            :disabled="busy"
            @click="onFlip"
          >
            <Icon name="eye" :size="16" /> 显示答案
            <kbd class="rv-kbd">空格</kbd>
          </button>
          <div v-else class="rv-rate">
            <button class="rv-rate-btn rv-rate-hard" :disabled="busy" @click="rate('hard')">
              <span class="rv-rate-emoji">😣</span>困难<kbd class="rv-kbd">1</kbd>
            </button>
            <button class="rv-rate-btn rv-rate-good" :disabled="busy" @click="rate('good')">
              <span class="rv-rate-emoji">😐</span>良好<kbd class="rv-kbd">2</kbd>
            </button>
            <button class="rv-rate-btn rv-rate-easy" :disabled="busy" @click="rate('easy')">
              <span class="rv-rate-emoji">😄</span>轻松<kbd class="rv-kbd">3</kbd>
            </button>
            <button class="rv-rate-btn rv-rate-perfect" :disabled="busy" @click="rate('perfect')">
              <span class="rv-rate-emoji">🥳</span>完美<kbd class="rv-kbd">4</kbd>
            </button>
          </div>
        </div>

        <!-- 挂起：顺延 24h，不影响 ease / repetitions -->
        <div class="rv-secondary">
          <button class="rv-snooze" :disabled="busy" @click="snooze">
            <Icon name="pause-circle" :size="14" /> 稍后再背（挂起 24h）
            <kbd class="rv-kbd">0</kbd>
          </button>
        </div>
      </template>

      <!-- 结束页（与 index 同文件内联，不单独拆组件） -->
      <div v-else class="rv-complete">
        <div class="rv-complete-ic">🎉</div>
        <h2 class="rv-complete-title">今日复习任务已完成！</h2>
        <p class="rv-complete-sub">
          本次共复习了 <b>{{ stats.reviewed }}</b> 张卡片
          <template v-if="stats.snoozed"> · 挂起 <b>{{ stats.snoozed }}</b> 张</template>
        </p>

        <div v-if="stats.reviewed > 0" class="rv-stats">
          <div v-if="stats.hard" class="rv-stat"><span>😣 困难</span><b>{{ stats.hard }}</b></div>
          <div v-if="stats.good" class="rv-stat"><span>😐 良好</span><b>{{ stats.good }}</b></div>
          <div v-if="stats.easy" class="rv-stat"><span>😄 轻松</span><b>{{ stats.easy }}</b></div>
          <div v-if="stats.perfect" class="rv-stat"><span>🥳 完美</span><b>{{ stats.perfect }}</b></div>
        </div>
        <p v-else class="rv-complete-empty">
          暂时没有到期的卡片，去「收集箱 / 笔记 / 记忆宫殿」沉淀内容，稍后再来复习吧～
        </p>

        <div class="rv-complete-actions">
          <button class="kb-btn" @click="restart">
            <Icon name="rotate-ccw" :size="15" /> 重新开始
          </button>
          <!-- 结束后回驾驶舱看热力图/遗忘曲线，形成「刷完 → 看战绩」的闭环 -->
          <button class="kb-btn kb-btn-primary" @click="backToCockpit">
            <Icon name="gauge" :size="15" /> 查看复习战绩
          </button>
        </div>
      </div>
    </main>

    <!-- 屏幕中央反馈浮层：飞出瞬间弹出，500ms 后淡出 -->
    <Teleport to="body">
      <Transition name="rv-fb">
        <div v-if="feedback" class="rv-feedback" :class="'rv-feedback--' + feedback.tone">
          {{ feedback.text }}
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { onKeyStroke } from '@vueuse/core';
import Icon from '@/components/ui/Icon.vue';
import FlashCard from './FlashCard.vue';
import { useReviewStore } from '@/store/reviewStore';
import { usePomodoroStore } from '@/store/pomodoroStore';
import type { ReviewCard, ReviewRating } from '@/api/review';

const router = useRouter();
const store = useReviewStore();
// 番茄钟状态条：复用全局 pomodoroStore（常驻单例），复习页只展示 + 提供暂停/继续。
const pomoStore = usePomodoroStore();
const { phaseEmoji, phaseLabel, timeText, status, isRunning } = storeToRefs(pomoStore);
const {
  current,
  isLoading,
  cardSide,
  totalCount,
  stats,
  processedCount,
  progressPct,
} = storeToRefs(store);

/** 顶栏卡型徽章：与 FlashCard 内的判定口径保持一致（易忘 > 新卡 > 复习卡） */
const currentBadge = computed(() => {
  const c = current.value;
  if (!c) return null;
  if (c.lapseCount > 2) return { text: '⚠️ 易忘卡', cls: 'rv-type--risk' };
  if (c.repetitions === 0) return { text: '💡 新卡', cls: 'rv-type--new' };
  return { text: '🔄 复习卡', cls: 'rv-type--review' };
});

/* ============ 飞出动画编排 ============
 * 点评分 → 立即播放飞出动画 + 弹反馈浮层；动画结束（flyEnd）才真正调接口 + splice。
 * splice 期间用 swapping 把卡槽隐身，避免「旧卡回弹一帧」。 */
type PendingAction =
  | { type: 'rate'; rating: ReviewRating }
  | { type: 'snooze'; cardId: number; sourceType: ReviewCard['sourceType'] };

const flyState = ref<{ active: boolean; dir: 'left' | 'right' }>({ active: false, dir: 'right' });
const pending = ref<PendingAction | null>(null);
const swapping = ref(false);
/** 动画/请求进行中：锁住按钮与快捷键，防连点跳卡 */
const busy = ref(false);

const FEEDBACK: Record<ReviewRating | 'snooze', { text: string; tone: string }> = {
  hard: { text: '🤔 记住它！', tone: 'hard' },
  good: { text: '👍 继续保持', tone: 'good' },
  easy: { text: '😄 轻松拿下', tone: 'easy' },
  perfect: { text: '✅ 完美！', tone: 'perfect' },
  snooze: { text: '⏸️ 稍后再背', tone: 'snooze' },
};

const feedback = ref<{ text: string; tone: string } | null>(null);
let feedbackTimer: ReturnType<typeof setTimeout> | null = null;
function showFeedback(key: ReviewRating | 'snooze') {
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedback.value = FEEDBACK[key];
  feedbackTimer = setTimeout(() => {
    feedback.value = null;
    feedbackTimer = null;
  }, 500);
}

function onFlip() {
  if (busy.value) return;
  store.flipCard();
}

/** 评分：困难向左飞、其余向右飞 */
function rate(rating: ReviewRating) {
  if (!current.value || busy.value) return;
  busy.value = true;
  showFeedback(rating);
  pending.value = { type: 'rate', rating };
  flyState.value = { active: true, dir: rating === 'hard' ? 'left' : 'right' };
}

/** 挂起：向左飞出（与「暂时放下」语义一致） */
function snooze() {
  const c = current.value;
  if (!c || busy.value) return;
  busy.value = true;
  showFeedback('snooze');
  pending.value = { type: 'snooze', cardId: c.id, sourceType: c.sourceType };
  flyState.value = { active: true, dir: 'left' };
}

/** 飞出动画结束：隐身 → 复位动画 → 调接口（内部 splice） → 淡入下一张 */
async function onFlyEnd() {
  const act = pending.value;
  pending.value = null;
  if (!act) return;
  swapping.value = true;
  flyState.value = { active: false, dir: flyState.value.dir };
  try {
    if (act.type === 'rate') await store.submitRating(act.rating);
    else await store.snoozeCard(act.cardId, act.sourceType);
  } finally {
    await nextTick();
    swapping.value = false;
    busy.value = false;
  }
}

/* ============ 键盘盲操 ============ */
const KEY_TO_RATING: Record<string, ReviewRating> = {
  '1': 'hard',
  '2': 'good',
  '3': 'easy',
  '4': 'perfect',
};
onKeyStroke((e) => {
  if (!current.value || busy.value) return;
  if (e.key in KEY_TO_RATING && cardSide.value === 'back') {
    e.preventDefault();
    rate(KEY_TO_RATING[e.key]);
    return;
  }
  if (e.key === '0') {
    e.preventDefault();
    snooze();
    return;
  }
  if (e.key === ' ' && cardSide.value === 'front') {
    e.preventDefault();
    store.flipCard();
  }
});

/* ============ 全屏专注 ============
 * 用浏览器原生全屏 + body 类名隐藏顶栏，不拦截 Esc（原生退出全屏由 fullscreenchange 同步状态）。 */
const isImmersive = ref(false);
const IMMERSIVE_CLASS = 'kb-review-immersive';

function syncImmersive() {
  isImmersive.value = !!document.fullscreenElement;
  document.body.classList.toggle(IMMERSIVE_CLASS, isImmersive.value);
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    // 某些环境（如未获授权的 WebView）不支持全屏，降级为普通模式
    isImmersive.value = !isImmersive.value;
    document.body.classList.toggle(IMMERSIVE_CLASS, isImmersive.value);
  }
}

/* ============ 生命周期 ============ */
/** 退出全屏（若在）后再跳转，避免留在全屏态导致目标页顶栏被 body 类名藏起来 */
async function leaveTo(path: string) {
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  document.body.classList.remove(IMMERSIVE_CLASS);
  isImmersive.value = false;
  router.push(path);
}
function exit() {
  void leaveTo('/workbench');
}
/** 返回复习驾驶舱：热力图与遗忘曲线都在那边 */
function backToCockpit() {
  void leaveTo('/workbench/review');
}
function restart() {
  void store.restartSession();
}

onMounted(() => {
  // 每次进入都重新拉队列（loadQueue 内部已先 resetSession），
  // 保证从驾驶舱 ↔ 传统卡组来回切换时不会读到上一轮残留进度。
  void store.loadQueue();
  // 番茄钟配置水合（idempotent：若已在番茄钟页 init 过则直接跳过），让状态条拿到最新设置
  void pomoStore.init();
  document.addEventListener('fullscreenchange', syncImmersive);
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncImmersive);
  document.body.classList.remove(IMMERSIVE_CLASS);
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  if (feedbackTimer) clearTimeout(feedbackTimer);
});
</script>

<style scoped>
.rv-wrap {
  max-width: 760px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 3.5rem);
  padding: 20px 16px 40px;
}
/* 沉浸式全屏：铺满视口、加深背景、只留卡片 */
.rv-wrap.is-immersive {
  max-width: none;
  min-height: 100vh;
  padding: 24px clamp(16px, 8vw, 96px) 40px;
  background: var(--kb-immersive-bg);
}
.rv-wrap.is-immersive .rv-title,
.rv-wrap.is-immersive .rv-progress-text {
  color: var(--kb-immersive-foreground);
}
.rv-wrap.is-immersive .rv-main {
  justify-content: center;
}

.rv-top {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.rv-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--kb-fs-h4);
  font-weight: 700;
  color: var(--kb-foreground);
  white-space: nowrap;
}
/* 返回复习驾驶舱按钮（与顶栏/结束页返回按钮视觉对齐） */
.rv-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--kb-radius-sm);
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.rv-back:hover {
  color: var(--kb-primary);
  border-color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 8%, var(--kb-card));
}
/* 当前卡型徽章：与卡面右上角同源（易忘 > 新卡 > 复习卡），统一用 --kb-* 语义色收敛，禁止硬编码 */
.rv-type {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  border: 1px solid transparent;
  white-space: nowrap;
}
.rv-type--new {
  color: var(--kb-accent);
  border-color: color-mix(in srgb, var(--kb-accent) 35%, var(--kb-border));
  background: color-mix(in srgb, var(--kb-accent) 10%, var(--kb-card));
}
.rv-type--review {
  color: var(--kb-primary);
  border-color: color-mix(in srgb, var(--kb-primary) 35%, var(--kb-border));
  background: color-mix(in srgb, var(--kb-primary) 10%, var(--kb-card));
}
.rv-type--risk {
  color: var(--kb-destructive);
  border-color: color-mix(in srgb, var(--kb-destructive) 35%, var(--kb-border));
  background: color-mix(in srgb, var(--kb-destructive) 10%, var(--kb-card));
}
.rv-progress {
  flex: 1;
  min-width: 180px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.rv-progress--mini {
  justify-content: flex-end;
}
.rv-progress-bar {
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: var(--kb-muted);
  overflow: hidden;
}
.rv-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--kb-primary), var(--kb-highlight));
  transition: width 0.35s ease;
}
.rv-progress-text {
  font-size: 12px;
  color: var(--kb-muted-foreground);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.rv-top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rv-fs,
.rv-exit {
  white-space: nowrap;
}

.rv-main {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.rv-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--kb-muted-foreground);
}
.rv-spin {
  animation: rv-rotate 0.9s linear infinite;
  color: var(--kb-primary);
}
@keyframes rv-rotate {
  to { transform: rotate(360deg); }
}

/* 卡槽：换卡瞬间隐身，随后从左侧淡入 */
.rv-card-slot {
  transition: opacity 0.26s ease, transform 0.26s cubic-bezier(0.22, 1, 0.36, 1);
}
.rv-card-slot.is-swapping {
  opacity: 0;
  transform: translateX(-44px) scale(0.98);
  transition: none;
}

.rv-actions {
  margin-top: 22px;
  min-height: 52px;
  display: flex;
  justify-content: center;
}
.rv-show {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.rv-kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid var(--kb-border);
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
}
.rv-rate {
  display: flex;
  gap: 10px;
  width: 100%;
  justify-content: center;
  flex-wrap: wrap;
}
.rv-rate-btn {
  flex: 1;
  min-width: 110px;
  max-width: 160px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 14px;
  border-radius: var(--kb-radius-md);
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
  color: var(--kb-foreground);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.14s ease, border-color 0.14s ease, background 0.14s ease;
}
.rv-rate-btn:hover:not(:disabled) {
  transform: translateY(-2px);
}
.rv-rate-btn:disabled,
.rv-snooze:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.rv-rate-emoji {
  font-size: 18px;
}
.rv-rate-hard:hover:not(:disabled) { border-color: var(--kb-destructive); background: color-mix(in srgb, var(--kb-destructive) 10%, var(--kb-card)); }
.rv-rate-good:hover:not(:disabled) { border-color: var(--kb-warning); background: color-mix(in srgb, var(--kb-warning) 12%, var(--kb-card)); }
.rv-rate-easy:hover:not(:disabled) { border-color: var(--kb-primary); background: color-mix(in srgb, var(--kb-primary) 10%, var(--kb-card)); }
.rv-rate-perfect:hover:not(:disabled) { border-color: var(--kb-highlight); background: color-mix(in srgb, var(--kb-highlight) 12%, var(--kb-card)); }

/* 挂起（次级操作） */
.rv-secondary {
  margin-top: 12px;
  display: flex;
  justify-content: center;
}
.rv-snooze {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px dashed var(--kb-border);
  background: transparent;
  color: var(--kb-muted-foreground);
  font-size: 12.5px;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.rv-snooze:hover:not(:disabled) {
  color: var(--kb-warning);
  border-color: var(--kb-warning);
  background: color-mix(in srgb, var(--kb-warning) 8%, transparent);
}

/* 结束页 */
.rv-complete {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 10px;
}
.rv-complete-ic {
  font-size: 56px;
  animation: rv-pop 0.4s ease;
}
@keyframes rv-pop {
  from { transform: scale(0.6); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
.rv-complete-title {
  font-size: var(--kb-fs-h2);
  font-weight: 700;
  color: var(--kb-foreground);
  margin: 4px 0 0;
}
.rv-complete-sub {
  color: var(--kb-muted-foreground);
  margin: 0;
}
.rv-complete-sub b {
  color: var(--kb-primary);
  font-size: 1.15em;
}
.rv-stats {
  display: flex;
  gap: 10px;
  margin: 8px 0 4px;
  flex-wrap: wrap;
  justify-content: center;
}
.rv-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 16px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  min-width: 84px;
}
.rv-stat span { font-size: 12px; color: var(--kb-muted-foreground); }
.rv-stat b { font-size: 20px; color: var(--kb-foreground); }
.rv-complete-empty {
  color: var(--kb-muted-foreground);
  max-width: 360px;
  line-height: 1.7;
}
.rv-complete-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

@media (max-width: 640px) {
  .rv-rate-btn { min-width: 46%; }
}

/* 番茄钟状态条：常驻于复习页顶部，专注时高亮，空闲时收起为中性灰 */
.rv-pomo {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 13px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-muted);
  border: 1px solid transparent;
  font-size: var(--kb-fs-body-sm);
  color: var(--kb-muted-foreground);
  margin-bottom: 18px;
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}
.rv-pomo.is-active {
  background: color-mix(in srgb, var(--kb-primary) 8%, var(--kb-card));
  border-color: color-mix(in srgb, var(--kb-primary) 30%, var(--kb-border));
  color: var(--kb-foreground);
}
.rv-pomo-phase {
  font-weight: 600;
  white-space: nowrap;
}
.rv-pomo-time {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 15px;
  color: var(--kb-foreground);
}
.rv-pomo-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 11px;
  border-radius: 999px;
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
  color: var(--kb-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.rv-pomo-btn:hover {
  border-color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 8%, var(--kb-card));
}
.rv-pomo-link {
  margin-left: auto;
  font-size: 12px;
  color: var(--kb-muted-foreground);
  text-decoration: none;
  white-space: nowrap;
}
.rv-pomo-link:hover {
  color: var(--kb-primary);
}
</style>

<style>
/* 反馈浮层挂到 body（Teleport），故用非 scoped 样式；层级低于 Toast(z-50) 保证提示可见 */
.rv-feedback {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 45;
  pointer-events: none;
  padding: 14px 30px;
  border-radius: 999px;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: 0.02em;
  white-space: nowrap;
  color: var(--kb-foreground);
  background: color-mix(in srgb, var(--kb-card) 92%, transparent);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(6px);
}
.rv-feedback--hard { color: var(--kb-destructive); border-color: color-mix(in srgb, var(--kb-destructive) 40%, var(--kb-border)); }
.rv-feedback--good { color: var(--kb-warning); border-color: color-mix(in srgb, var(--kb-warning) 40%, var(--kb-border)); }
.rv-feedback--easy { color: var(--kb-primary); border-color: color-mix(in srgb, var(--kb-primary) 40%, var(--kb-border)); }
.rv-feedback--perfect { color: var(--kb-accent); border-color: color-mix(in srgb, var(--kb-accent) 40%, var(--kb-border)); }
.rv-feedback--snooze { color: var(--kb-muted-foreground); }

.rv-fb-enter-active {
  transition: opacity 0.16s ease, transform 0.22s cubic-bezier(0.22, 1.4, 0.36, 1);
}
.rv-fb-leave-active {
  transition: opacity 0.28s ease, transform 0.28s ease;
}
.rv-fb-enter-from {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.7);
}
.rv-fb-leave-to {
  opacity: 0;
  transform: translate(-50%, -62%) scale(1.06);
}
</style>
