<template>
  <!-- 间隔重复闪卡复习主页：进度条 + 沉浸式卡牌 + 键盘盲操打分 + 完成页 -->
  <div class="rv-wrap">
    <!-- 顶部：标题 / 进度 / 退出 -->
    <header class="rv-top">
      <div class="rv-title">
        <Icon name="repeat" :size="18" style="color: var(--kb-primary)" />
        间隔复习
      </div>
      <div class="rv-progress">
        <div class="rv-progress-bar">
          <div class="rv-progress-fill" :style="{ width: progressPct + '%' }"></div>
        </div>
        <span class="rv-progress-text">已复习 {{ stats.reviewed }} / {{ totalCount }}</span>
      </div>
      <button class="kb-btn rv-exit" @click="exit">
        <Icon name="x" :size="15" /> 退出复习
      </button>
    </header>

    <main class="rv-main">
      <!-- 加载态 -->
      <div v-if="isLoading" class="rv-center">
        <Icon name="loader" :size="28" class="rv-spin" />
        <p>正在加载待复习卡片…</p>
      </div>

      <!-- 复习中 -->
      <template v-else-if="current">
        <Transition name="rcard" mode="out-in">
          <FlashCard :key="current.id" :card="current" :side="cardSide" @flip="flipCard" />
        </Transition>

        <!-- 操作区：正面显示答案 / 反面评分 -->
        <div class="rv-actions">
          <button v-if="cardSide === 'front'" class="kb-btn kb-btn-primary rv-show" @click="flipCard">
            <Icon name="eye" :size="16" /> 显示答案
            <kbd class="rv-kbd">空格</kbd>
          </button>
          <div v-else class="rv-rate">
            <button class="rv-rate-btn rv-rate-hard" @click="rate('hard')">
              <span class="rv-rate-emoji">😣</span>困难<kbd class="rv-kbd">1</kbd>
            </button>
            <button class="rv-rate-btn rv-rate-good" @click="rate('good')">
              <span class="rv-rate-emoji">😐</span>良好<kbd class="rv-kbd">2</kbd>
            </button>
            <button class="rv-rate-btn rv-rate-easy" @click="rate('easy')">
              <span class="rv-rate-emoji">😄</span>轻松<kbd class="rv-kbd">3</kbd>
            </button>
            <button class="rv-rate-btn rv-rate-perfect" @click="rate('perfect')">
              <span class="rv-rate-emoji">🥳</span>完美<kbd class="rv-kbd">4</kbd>
            </button>
          </div>
        </div>
      </template>

      <!-- 结束页（与 index 同文件内联，不单独拆组件） -->
      <div v-else class="rv-complete">
        <div class="rv-complete-ic">🎉</div>
        <h2 class="rv-complete-title">今日复习任务已完成！</h2>
        <p class="rv-complete-sub">
          本次共复习了 <b>{{ stats.reviewed }}</b> 张卡片
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { onKeyStroke } from '@vueuse/core';
import Icon from '@/components/ui/Icon.vue';
import FlashCard from './FlashCard.vue';
import { useReviewStore } from '@/store/reviewStore';
import type { ReviewRating } from '@/api/review';

const router = useRouter();
const store = useReviewStore();
const { queue, current, isLoading, isFinished, cardSide, totalCount, stats } = storeToRefs(store);
// Pinia actions 是已绑定的方法，可直接解构暴露给模板（不参与响应式追踪）
const { flipCard } = store;

const progressPct = computed(() =>
  totalCount.value > 0 ? Math.round((stats.value.reviewed / totalCount.value) * 100) : 0,
);

function exit() {
  router.push('/workbench');
}

function rate(rating: ReviewRating) {
  if (!current.value) return;
  void store.submitRating(rating);
}

// 键盘盲操：翻转后按 1/2/3/4 评分；正面按空格翻面
const KEY_TO_RATING: Record<string, ReviewRating> = {
  '1': 'hard',
  '2': 'good',
  '3': 'easy',
  '4': 'perfect',
};
onKeyStroke((e) => {
  if (!current.value) return;
  if (e.key in KEY_TO_RATING && cardSide.value === 'back') {
    e.preventDefault();
    rate(KEY_TO_RATING[e.key]);
    return;
  }
  if (e.key === ' ' && cardSide.value === 'front') {
    e.preventDefault();
    store.flipCard();
  }
});

function restart() {
  void store.restartSession();
}

onMounted(() => {
  void store.loadQueue();
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

/* 卡牌飞出 / 飞入过渡（与内部 3D 翻转互不干扰） */
.rcard-enter-active,
.rcard-leave-active {
  transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.32s ease;
}
.rcard-leave-to {
  opacity: 0;
  transform: translateX(64px) rotate(3deg);
}
.rcard-enter-from {
  opacity: 0;
  transform: translateX(-64px) rotate(-3deg);
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
.rv-rate-btn:hover {
  transform: translateY(-2px);
}
.rv-rate-emoji {
  font-size: 18px;
}
.rv-rate-hard:hover { border-color: var(--kb-destructive); background: color-mix(in srgb, var(--kb-destructive) 10%, var(--kb-card)); }
.rv-rate-good:hover { border-color: var(--kb-warning); background: color-mix(in srgb, var(--kb-warning) 12%, var(--kb-card)); }
.rv-rate-easy:hover { border-color: var(--kb-primary); background: color-mix(in srgb, var(--kb-primary) 10%, var(--kb-card)); }
.rv-rate-perfect:hover { border-color: var(--kb-highlight); background: color-mix(in srgb, var(--kb-highlight) 12%, var(--kb-card)); }

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
</style>
