<template>
  <!-- 单日复盘弹窗：点热力图格子 / 遗忘曲线柱子后展开当天复习了什么、哪些没记住。
       与待复习抽屉一样 Teleport 到 body —— 驾驶舱里图表本身带 transform/overflow，
       在其内部渲染 fixed 会被裁剪。 -->
  <Teleport to="body">
    <Transition name="rdd-fade">
      <div v-if="dayDetailVisible" class="rdd-mask" @click.self="close">
        <Transition name="rdd-pop" appear>
          <section v-if="dayDetailVisible" class="rdd-panel" role="dialog" aria-label="当日复习明细">
            <!-- 头部：日期 + 当日三项指标 -->
            <header class="rdd-head">
              <div class="rdd-head-main">
                <h3 class="rdd-title">
                  <Icon name="calendar-check" :size="'md'" />
                  {{ dateLabel }}
                </h3>
                <p class="rdd-sub">复习明细 · 数据来自复习流水</p>
              </div>
              <button class="rdd-icon-btn" title="关闭（Esc）" @click="close">
                <Icon name="x" :size="'lg'" />
              </button>
            </header>

            <!-- 指标条：复习总数 / 没记住 / 遗忘率 -->
            <div v-if="detail && detail.total > 0" class="rdd-metrics">
              <div class="rdd-metric">
                <span class="rdd-metric-num">{{ detail.total }}</span>
                <span class="rdd-metric-label">复习张数</span>
              </div>
              <div class="rdd-metric rdd-metric--warn">
                <span class="rdd-metric-num">{{ detail.lapses }}</span>
                <span class="rdd-metric-label">没记住</span>
              </div>
              <div class="rdd-metric">
                <span class="rdd-metric-num">{{ lapseRateText }}</span>
                <span class="rdd-metric-label">遗忘率</span>
              </div>
            </div>

            <!-- 筛选：只在有遗忘卡时才出现，避免空按钮占位 -->
            <div v-if="detail && detail.lapses > 0" class="rdd-filters">
              <button class="rdd-chip" :class="{ 'is-on': !onlyLapsed }" @click="onlyLapsed = false">
                全部 <span class="rdd-chip-num">{{ detail.total }}</span>
              </button>
              <button class="rdd-chip rdd-chip--warn" :class="{ 'is-on': onlyLapsed }" @click="onlyLapsed = true">
                只看没记住 <span class="rdd-chip-num">{{ detail.lapses }}</span>
              </button>
            </div>

            <!-- 主体 -->
            <div class="rdd-body">
              <div v-if="dayDetailLoading" class="rdd-state">
                <Icon name="loader-2" :size="'xl'" class="rdd-spin" />
                <span>加载中…</span>
              </div>

              <div v-else-if="!detail || detail.items.length === 0" class="rdd-state">
                <Icon name="coffee" :size="'26px'" class="rdd-state-ic" />
                <p class="rdd-state-title">这天没有复习记录</p>
                <p class="rdd-state-desc">偶尔断一天没关系，明天继续就好</p>
              </div>

              <ul v-else class="rdd-list">
                <li
                  v-for="(it, i) in visibleItems"
                  :key="`${it.sourceType}-${it.cardId}-${i}`"
                  class="rdd-item"
                  :class="{ 'is-lapsed': it.lapsed }"
                >
                  <span class="rdd-quality" :class="qualityOf(it).cls" :title="qualityOf(it).label">
                    {{ qualityOf(it).emoji }}
                  </span>
                  <div class="rdd-item-main">
                    <p class="rdd-front">{{ it.front || '（原卡片已删除）' }}</p>
                    <p class="rdd-meta">
                      <span class="rdd-src">{{ SOURCE_LABEL[it.sourceType] }}</span>
                      <span class="rdd-meta-sep">·</span>
                      {{ qualityOf(it).label }}
                      <span class="rdd-meta-sep">·</span>
                      {{ timeOf(it.reviewedAt) }}
                    </p>
                  </div>
                  <span v-if="it.lapsed" class="rdd-flag">没记住</span>
                </li>
              </ul>
            </div>

            <footer class="rdd-foot">
              <p class="rdd-foot-tip">
                <Icon name="info" :size="'xs'" />
                「没记住」= 评分为困难（quality &lt; 2），与遗忘曲线口径一致
              </p>
              <button class="kb-btn rdd-foot-btn" @click="close">关闭</button>
            </footer>
          </section>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 单日复盘弹窗。
 *
 * 数据完全由 store 驱动：热力图/曲线调 `store.openDayDetail(date)` 拉数并置 visible，
 * 本组件只负责渲染 —— 这样驾驶舱里两个图表可以共用同一个弹窗实例，不必各挂一份。
 *
 * quality 口径（后端 RATING_TO_QUALITY）：hard=1 / good=2 / easy|perfect=3，
 * 旧卡组流水可能出现 0 与 4~5，故这里按区间判定而非等值匹配。
 */
import { computed, ref, watch } from 'vue';
import { onKeyStroke } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import Icon from '@/components/ui/Icon.vue';
import { useReviewStore } from '@/store/review-store';
import type { ReviewDayItem } from '@/api/review';

const store = useReviewStore();
const { dayDetail, dayDetailLoading, dayDetailVisible } = storeToRefs(store);

const detail = computed(() => dayDetail.value);
const onlyLapsed = ref(false);

const SOURCE_LABEL: Record<ReviewDayItem['sourceType'], string> = {
  note: '康奈尔笔记',
  loci: '记忆宫殿',
  card: '传统卡组',
};

/** 日期人话化：今天 / 昨天 / 具体日期 + 星期 */
const dateLabel = computed(() => {
  const d = detail.value?.date;
  if (!d) return '当日复习';
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const y = new Date(today.getTime() - 86400000);
  const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  if (d === todayStr) return `今天 · ${d}`;
  if (d === yStr) return `昨天 · ${d}`;
  const dt = new Date(`${d}T00:00:00`);
  const week = ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()] ?? '';
  return `${d} 周${week}`;
});

const lapseRateText = computed(() => {
  const r = detail.value?.lapseRate ?? 0;
  // 后端可能给 0~1 小数，也可能已是百分数，这里统一按小数处理
  return `${Math.round((r <= 1 ? r * 100 : r))}%`;
});

const visibleItems = computed(() => {
  const items = detail.value?.items ?? [];
  return onlyLapsed.value ? items.filter((i) => i.lapsed) : items;
});

/** quality → 展示档位。与刷题页的四档评分反向对齐 */
function qualityOf(it: ReviewDayItem) {
  if (it.quality < 2) return { emoji: '😣', label: '困难', cls: 'rdd-q--hard' };
  if (it.quality === 2) return { emoji: '😐', label: '良好', cls: 'rdd-q--good' };
  if (it.quality === 3) return { emoji: '😄', label: '轻松', cls: 'rdd-q--easy' };
  return { emoji: '🥳', label: '完美', cls: 'rdd-q--perfect' };
}

function timeOf(iso: string): string {
  if (!iso) return '--:--';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '--:--';
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

function close(): void {
  store.closeDayDetail();
}

onKeyStroke('Escape', () => {
  if (dayDetailVisible.value) close();
});

// 每次重新打开都回到「全部」视图，避免继承上一天的筛选状态
watch(dayDetailVisible, (v) => {
  if (v) onlyLapsed.value = false;
});
</script>

<style scoped>
.rdd-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, var(--kb-foreground) 28%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.rdd-panel {
  width: min(520px, 100%);
  max-height: min(680px, 88vh);
  display: flex;
  flex-direction: column;
  border-radius: var(--kb-radius-lg);
  border: 1px solid var(--kb-border);
  background: color-mix(in srgb, var(--kb-card) 94%, transparent);
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

/* ---------- 头部 ---------- */
.rdd-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--kb-border);
}
.rdd-head-main {
  flex: 1;
  min-width: 0;
}
.rdd-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--kb-foreground);
}
.rdd-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.rdd-icon-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--kb-radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.rdd-icon-btn:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}

/* ---------- 指标条 ---------- */
.rdd-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 16px 16px 4px;
}
.rdd-metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 12px 8px;
  border-radius: var(--kb-radius-md);
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
}
.rdd-metric--warn .rdd-metric-num {
  color: var(--kb-destructive);
}
.rdd-metric-num {
  font-size: 20px;
  font-weight: 700;
  color: var(--kb-foreground);
  font-variant-numeric: tabular-nums;
}
.rdd-metric-label {
  font-size: var(--kb-fs-caption);
  color: var(--kb-muted-foreground);
}

/* ---------- 筛选 ---------- */
.rdd-filters {
  display: flex;
  gap: 8px;
  padding: 12px 16px 0;
}
.rdd-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--kb-border);
  background: transparent;
  font-size: 12px;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: all 0.15s;
}
.rdd-chip:hover {
  color: var(--kb-foreground);
  border-color: var(--kb-primary);
}
.rdd-chip.is-on {
  border-color: var(--kb-primary);
  color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 10%, transparent);
  font-weight: 600;
}
.rdd-chip--warn.is-on {
  border-color: var(--kb-destructive);
  color: var(--kb-destructive);
  background: color-mix(in srgb, var(--kb-destructive) 10%, transparent);
}
.rdd-chip-num {
  font-size: 11px;
  opacity: 0.75;
}

/* ---------- 列表 ---------- */
.rdd-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
.rdd-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rdd-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 12px;
  border-radius: var(--kb-radius-md);
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
}
.rdd-item.is-lapsed {
  border-color: color-mix(in srgb, var(--kb-destructive) 35%, var(--kb-border));
  background: color-mix(in srgb, var(--kb-destructive) 5%, var(--kb-card));
}
.rdd-quality {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  font-size: 15px;
  background: var(--kb-muted);
}
.rdd-q--hard { background: color-mix(in srgb, var(--kb-destructive) 14%, transparent); }
.rdd-q--good { background: color-mix(in srgb, var(--kb-warning) 16%, transparent); }
.rdd-q--easy { background: color-mix(in srgb, var(--kb-primary) 12%, transparent); }
.rdd-q--perfect { background: color-mix(in srgb, var(--kb-accent) 14%, transparent); }
.rdd-item-main {
  flex: 1;
  min-width: 0;
}
.rdd-front {
  margin: 0;
  font-size: var(--kb-fs-body-md);
  font-weight: 600;
  line-height: 1.45;
  color: var(--kb-foreground);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.rdd-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 3px 0 0;
  font-size: 11px;
  color: var(--kb-muted-foreground);
}
.rdd-meta-sep {
  opacity: 0.5;
}
.rdd-flag {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: var(--kb-fs-xs);
  font-weight: 600;
  color: var(--kb-destructive);
  background: color-mix(in srgb, var(--kb-destructive) 12%, transparent);
}

/* ---------- 空态 / 加载 ---------- */
.rdd-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 52px 20px;
  color: var(--kb-muted-foreground);
  font-size: 13px;
}
.rdd-state-ic {
  color: var(--kb-muted-foreground);
}
.rdd-state-title {
  margin: 4px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--kb-foreground);
}
.rdd-state-desc {
  margin: 0;
  font-size: 12px;
}
.rdd-spin {
  animation: rdd-rotate 0.9s linear infinite;
}
@keyframes rdd-rotate {
  to {
    transform: rotate(360deg);
  }
}

/* ---------- 底部 ---------- */
.rdd-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--kb-border);
}
.rdd-foot-tip {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: 11px;
  color: var(--kb-muted-foreground);
}
.rdd-foot-btn {
  flex-shrink: 0;
}

/* ---------- 过渡 ---------- */
.rdd-fade-enter-active,
.rdd-fade-leave-active {
  transition: opacity 0.2s ease;
}
.rdd-fade-enter-from,
.rdd-fade-leave-to {
  opacity: 0;
}
.rdd-pop-enter-active {
  transition: transform 0.24s cubic-bezier(0.22, 1.2, 0.36, 1), opacity 0.2s ease;
}
.rdd-pop-leave-active {
  transition: transform 0.18s ease, opacity 0.18s ease;
}
.rdd-pop-enter-from,
.rdd-pop-leave-to {
  opacity: 0;
  transform: scale(0.94) translateY(8px);
}
</style>
