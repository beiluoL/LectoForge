<template>
  <div class="hb-page">
    <!-- ===== Hero ===== -->
    <section class="hb-hero">
      <div class="hb-hero-text">
        <span class="hb-eyebrow">
          <span class="hb-eyebrow-dot"></span>
          每日坚持，积微成著
        </span>
        <h1 class="hb-title">
          <Icon name="clipboard-check" :size="26" />
          📋 今日习惯打卡
        </h1>
        <p class="hb-subtitle">
          为每一天定下几个小目标，点一下就完成打卡。连续打卡会点亮左侧的进度环，
          坚持越久，环越满。
        </p>
      </div>
      <button class="kb-btn kb-btn-primary hb-new" :disabled="submitting" @click="openCreate">
        <Icon name="plus" :size="15" />
        新建习惯
      </button>
    </section>

    <!-- ===== 概览条 ===== -->
    <div class="hb-summary">
      <div class="hb-summary-card">
        <span class="hb-summary-num">{{ doneCount }}</span>
        <span class="hb-summary-label">今日已打卡</span>
      </div>
      <div class="hb-summary-card">
        <span class="hb-summary-num">{{ totalCount }}</span>
        <span class="hb-summary-label">习惯总数</span>
      </div>
      <div class="hb-summary-card hb-summary-hint">
        <span class="hb-summary-label">继续加油，别断签 🔥</span>
      </div>
    </div>

    <!-- ===== 列表 ===== -->
    <section>
      <!-- 加载骨架 -->
      <div v-if="loading" class="hb-skeleton">
        <span v-for="n in 3" :key="n" class="hb-skel-line"></span>
      </div>

      <!-- 空态 -->
      <div v-else-if="!totalCount" class="hb-empty">
        <span class="hb-empty-icon"><Icon name="sparkles" :size="28" /></span>
        <p class="hb-empty-title">还没有习惯</p>
        <p class="hb-empty-desc">点右上角「新建习惯」，从「每日阅读」「早起」这种小事开始吧。</p>
        <button class="kb-btn kb-btn-primary" @click="openCreate">
          <Icon name="plus" :size="15" />
          新建第一个习惯
        </button>
      </div>

      <!-- 习惯卡片 -->
      <ul v-else class="hb-list">
        <li
          v-for="h in habits"
          :key="h.id"
          class="hb-card"
          @click="openDetail(h)"
        >
          <!-- 左：Apple Watch 风格进度环（显示连续打卡天数） -->
          <svg class="hb-ring" viewBox="0 0 80 80" width="62" height="62" aria-hidden="true">
            <circle cx="40" cy="40" :r="RING_R" fill="none" stroke="currentColor"
              class="hb-ring-track" stroke-width="8" />
            <circle cx="40" cy="40" :r="RING_R" fill="none" :stroke="h.color"
              stroke-width="8" stroke-linecap="round"
              :stroke-dasharray="RING_C"
              :stroke-dashoffset="ringOffset(h.streak || 0)"
              transform="rotate(-90 40 40)" />
            <text x="40" y="46" text-anchor="middle" class="hb-ring-num">{{ h.streak || 0 }}</text>
          </svg>

          <!-- 中：图标 + 名称 + 描述 -->
          <div class="hb-card-mid">
            <span class="hb-card-icon" :style="{ background: h.color + '22', color: h.color }">
              <Icon :name="h.iconName || 'check-circle'" :size="18" />
            </span>
            <div class="hb-card-text">
              <p class="hb-card-name">{{ h.name }}</p>
              <p v-if="h.description" class="hb-card-desc">{{ h.description }}</p>
            </div>
          </div>

          <!-- 右：打卡按钮 -->
          <button
            class="hb-checkin"
            :class="{ 'is-done': h.todayStatus === 1 }"
            :style="h.todayStatus === 1 ? { background: h.color, borderColor: h.color } : {}"
            @click.stop="onToggle(h)"
          >
            <Icon :name="h.todayStatus === 1 ? 'check' : 'circle'" :size="15" />
            {{ h.todayStatus === 1 ? '已打卡' : '点击打卡' }}
          </button>
        </li>
      </ul>
    </section>

    <!-- ===== 新建 / 编辑弹窗 ===== -->
    <CreateHabitModal
      v-model:open="createOpen"
      :edit="editing"
      @saved="onCreateSaved"
    />

    <!-- ===== 详情抽屉（热力图） ===== -->
    <HabitDetailDrawer
      v-model:open="detailOpen"
      :habit="detailTarget"
      @edit="onEditFromDrawer"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import Icon from '@/components/ui/Icon.vue';
import { useHabitStore } from '@/store/habit-store';
import type { Habit } from '@/api/habit';
import CreateHabitModal from './components/CreateHabitModal.vue';
import HabitDetailDrawer from './components/HabitDetailDrawer.vue';

const store = useHabitStore();
const { habits, loading, submitting, doneCount, totalCount } = storeToRefs(store);

// 进度环几何
const RING_R = 34;
const RING_C = 2 * Math.PI * RING_R;
function ringOffset(streak: number): number {
  const ratio = Math.min(streak, 30) / 30; // 30 天满环
  return RING_C * (1 - ratio);
}

const createOpen = ref(false);
const editing = ref<Habit | null>(null);
const detailOpen = ref(false);
const detailTarget = ref<Habit | null>(null);

function openCreate() {
  editing.value = null;
  createOpen.value = true;
}

function openDetail(h: Habit) {
  detailTarget.value = h;
  detailOpen.value = true;
}

function onEditFromDrawer(h: Habit) {
  editing.value = h;
  createOpen.value = true;
}

function onCreateSaved() {
  // store 已本地更新；若是从详情抽屉发起的编辑，关掉抽屉
  if (detailOpen.value) detailOpen.value = false;
}

async function onToggle(h: Habit) {
  await store.toggleLog(h.id);
}

onMounted(() => {
  store.fetchHabits();
});
</script>

<style scoped>
.hb-page {
  max-width: 960px;
  margin: 0 auto;
  padding: 8px 16px 48px;
  min-height: 100%;
  background: var(--kb-background);
}

/* Hero */
.hb-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 4px 14px;
}
.hb-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--kb-muted-foreground);
  letter-spacing: 0.02em;
}
.hb-eyebrow-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--kb-primary);
}
.hb-title {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 8px 0 6px;
  font-size: 24px;
  font-weight: 800;
  color: var(--kb-foreground);
  font-family: var(--font-serif);
}
.hb-subtitle {
  margin: 0;
  max-width: 620px;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--kb-muted-foreground);
}
.hb-new {
  flex: none;
}

/* 概览条 */
.hb-summary {
  display: flex;
  gap: 12px;
  margin: 6px 0 18px;
  flex-wrap: wrap;
}
.hb-summary-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 18px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
}
.hb-summary-num {
  font-size: 22px;
  font-weight: 800;
  color: var(--kb-foreground);
  font-family: var(--font-mono);
}
.hb-summary-label {
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.hb-summary-hint {
  justify-content: center;
  flex: 1;
  min-width: 160px;
}

/* 列表 */
.hb-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hb-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.hb-card:hover {
  border-color: color-mix(in srgb, var(--kb-primary) 40%, var(--kb-border));
  box-shadow: var(--shadow-sm);
}
.hb-ring {
  flex: none;
  color: var(--kb-muted);
}
.hb-ring-track {
  opacity: 0.5;
}
.hb-ring-num {
  font-size: 20px;
  font-weight: 800;
  fill: var(--kb-foreground);
  font-family: var(--font-mono);
}
.hb-card-mid {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}
.hb-card-icon {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hb-card-text {
  min-width: 0;
}
.hb-card-name {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--kb-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hb-card-desc {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: var(--kb-muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hb-checkin {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  color: var(--kb-foreground);
  background: var(--kb-background);
  border: 1.5px solid var(--kb-border);
  cursor: pointer;
  transition: transform 0.12s ease, background 0.15s ease, color 0.15s ease;
  user-select: none;
}
.hb-checkin:active {
  transform: scale(0.95);
}
.hb-checkin.is-done {
  color: #fff;
}

/* 骨架 / 空态 */
.hb-skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hb-skel-line {
  height: 68px;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  opacity: 0.7;
}
.hb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 20px;
  text-align: center;
}
.hb-empty-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
  color: var(--kb-primary);
}
.hb-empty-title {
  margin: 4px 0 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--kb-foreground);
}
.hb-empty-desc {
  margin: 0;
  max-width: 360px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--kb-muted-foreground);
}
</style>
