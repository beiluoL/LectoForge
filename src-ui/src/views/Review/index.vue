<template>
  <!-- 间隔重复闪卡复习主页：进度看板 + 飞出动效卡牌 + 键盘盲操打分 + 挂起 + 全屏专注 + 热力图/遗忘曲线 -->
  <div class="rv-wrap" :class="{ 'is-immersive': isImmersive }">
    <!-- 顶部：标题 / 进度 / 全屏 / 退出 -->
    <header class="rv-top">
      <div class="rv-title">
        <Icon name="repeat" :size="18" style="color: var(--kb-primary)" />
        间隔复习
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
          <button class="kb-btn kb-btn-primary" @click="exit">
            <Icon name="arrow-right" :size="15" /> 返回工作台
          </button>
        </div>
      </div>
    </main>

    <!-- ===== 底部统计区（沉浸模式下隐藏） ===== -->
    <section v-if="!isImmersive" class="rv-bottom">
      <ReviewHeatmap />

      <!-- 遗忘曲线折叠面板 -->
      <div class="rv-panel">
        <button class="rv-panel-head" @click="toggleCurve">
          <span class="rv-panel-title">
            <Icon name="trending-down" :size="15" />
            📊 近 {{ curveDays }} 天遗忘趋势
          </span>
          <span class="rv-panel-meta">
            <template v-if="forgettingCurve">
              复习 {{ forgettingCurve.totalReviews }} 次 · 遗忘率
              {{ (forgettingCurve.overallLapseRate * 100).toFixed(1) }}%
            </template>
            <Icon :name="curveOpen ? 'chevron-up' : 'chevron-down'" :size="16" />
          </span>
        </button>

        <div v-if="curveOpen" class="rv-panel-body">
          <div class="rv-curve-toolbar">
            <div class="rv-range">
              <button
                v-for="d in [14, 30, 90]"
                :key="d"
                class="rv-range-btn"
                :class="{ 'is-active': curveDays === d }"
                @click="switchCurveDays(d)"
              >{{ d }}天</button>
            </div>
            <div v-if="forgettingCurve" class="rv-legend">
              <span class="rv-legend-item"><span class="rv-legend-bar"></span>每日复习量</span>
              <span class="rv-legend-item"><span class="rv-legend-line"></span>遗忘率</span>
            </div>
          </div>

          <div v-if="curveLoading" class="rv-curve-state">
            <Icon name="loader" :size="20" class="rv-spin" />
          </div>
          <div v-else-if="!forgettingCurve || forgettingCurve.points.length === 0" class="rv-curve-state">
            <Icon name="bar-chart-2" :size="28" style="opacity: 0.4" />
            <p>暂无复习记录，完成复习后这里会呈现记忆巩固趋势</p>
          </div>
          <svg v-else :viewBox="`0 0 ${SVG_W} ${SVG_H}`" class="rv-curve-svg">
            <line
              v-for="g in yTicks"
              :key="'g' + g.label"
              :x1="PAD_L" :y1="g.y" :x2="SVG_W - PAD_R" :y2="g.y"
              stroke="var(--kb-border)" stroke-width="1" stroke-dasharray="3 4"
            />
            <text
              v-for="g in yTicks"
              :key="'gt' + g.label"
              :x="PAD_L - 8" :y="g.y + 4" text-anchor="end"
              font-size="10" font-family="var(--font-mono)" fill="var(--kb-muted-foreground)"
            >{{ g.label }}</text>

            <rect
              v-for="(p, i) in chartPoints"
              :key="'b' + i"
              :x="p.x - p.barW / 2" :y="p.barY" :width="p.barW" :height="p.barH"
              rx="2" fill="var(--kb-primary)" fill-opacity="0.28"
            />

            <polyline
              :points="chartPoints.map((p) => `${p.x},${p.lineY}`).join(' ')"
              fill="none" stroke="var(--kb-destructive)" stroke-width="2.5" stroke-linejoin="round"
            />
            <circle
              v-for="(p, i) in chartPoints"
              :key="'c' + i"
              :cx="p.x" :cy="p.lineY" r="3" fill="var(--kb-destructive)"
            />

            <text
              v-for="(p, i) in chartPoints"
              :key="'x' + i"
              v-show="i % xLabelStep === 0"
              :x="p.x" :y="SVG_H - 8" text-anchor="middle"
              font-size="10" font-family="var(--font-mono)" fill="var(--kb-muted-foreground)"
            >{{ p.dateLabel }}</text>
          </svg>
        </div>
      </div>
    </section>

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
import ReviewHeatmap from '@/components/ReviewHeatmap.vue';
import FlashCard from './FlashCard.vue';
import { useReviewStore } from '@/store/reviewStore';
import type { ReviewCard, ReviewRating } from '@/api/review';

const router = useRouter();
const store = useReviewStore();
const {
  current,
  isLoading,
  cardSide,
  totalCount,
  stats,
  processedCount,
  progressPct,
  forgettingCurve,
  curveLoading,
  curveDays,
} = storeToRefs(store);

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

/* ============ 遗忘曲线折叠面板 ============ */
const curveOpen = ref(false);
const SVG_W = 720;
const SVG_H = 220;
const PAD_L = 36;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 28;

const chartPoints = computed(() => {
  const c = forgettingCurve.value;
  if (!c) return [];
  const pts = c.points;
  const n = pts.length;
  if (n === 0) return [];
  const innerW = SVG_W - PAD_L - PAD_R;
  const innerH = SVG_H - PAD_T - PAD_B;
  const maxReviews = Math.max(1, ...pts.map((p) => p.reviews));
  const barW = Math.max(2, Math.min(14, innerW / n - 2));
  return pts.map((p, i) => {
    const x = PAD_L + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
    const barH = (p.reviews / maxReviews) * innerH;
    return {
      x,
      barY: PAD_T + innerH - barH,
      barH,
      barW,
      lineY: PAD_T + innerH - p.lapseRate * innerH,
      dateLabel: p.date.slice(5),
    };
  });
});
const yTicks = [
  { y: PAD_T, label: '0%' },
  { y: PAD_T + (SVG_H - PAD_T - PAD_B) * 0.25, label: '25%' },
  { y: PAD_T + (SVG_H - PAD_T - PAD_B) * 0.5, label: '50%' },
  { y: PAD_T + (SVG_H - PAD_T - PAD_B) * 0.75, label: '75%' },
  { y: SVG_H - PAD_B, label: '100%' },
];
const xLabelStep = computed(() =>
  Math.max(1, Math.ceil((forgettingCurve.value?.points.length || 1) / 10)),
);

function toggleCurve() {
  curveOpen.value = !curveOpen.value;
  if (curveOpen.value && !forgettingCurve.value) void store.loadForgettingCurve();
}
function switchCurveDays(d: number) {
  store.curveDays = d;
  void store.loadForgettingCurve(d);
}

/* ============ 生命周期 ============ */
function exit() {
  router.push('/workbench');
}
function restart() {
  void store.restartSession();
}

onMounted(() => {
  void store.loadQueue();
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

/* ===== 底部统计区 ===== */
.rv-bottom {
  margin-top: 32px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rv-panel {
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  overflow: hidden;
}
.rv-panel-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 18px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--kb-foreground);
  text-align: left;
}
.rv-panel-head:hover {
  background: var(--kb-muted);
}
.rv-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 700;
}
.rv-panel-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.rv-panel-body {
  padding: 4px 18px 18px;
  border-top: 1px solid var(--kb-border);
}
.rv-curve-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 14px 0;
  flex-wrap: wrap;
}
.rv-range {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border-radius: var(--kb-radius-sm);
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
}
.rv-range-btn {
  padding: 5px 12px;
  border-radius: var(--kb-radius-sm);
  background: transparent;
  border: none;
  color: var(--kb-muted-foreground);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.rv-range-btn.is-active {
  background: var(--kb-primary);
  color: var(--kb-primary-foreground, #fff);
  font-weight: 600;
}
.rv-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 11px;
  color: var(--kb-muted-foreground);
}
.rv-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.rv-legend-bar {
  width: 12px;
  height: 10px;
  border-radius: 2px;
  background: var(--kb-primary);
  opacity: 0.28;
}
.rv-legend-line {
  width: 14px;
  height: 2px;
  background: var(--kb-destructive);
}
.rv-curve-svg {
  width: 100%;
  height: auto;
}
.rv-curve-state {
  height: 170px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
  color: var(--kb-muted-foreground);
}

@media (max-width: 640px) {
  .rv-rate-btn { min-width: 46%; }
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
