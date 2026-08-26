<template>
  <div class="qd-page">
    <!-- ===== Hero ===== -->
    <section class="qd-hero">
      <div class="qd-hero-text">
        <span class="qd-eyebrow">
          <span class="qd-eyebrow-dot"></span>
          先做重要的事，而不是最吵的那件
        </span>
        <h1 class="qd-page-title">
          <Icon name="layout-grid" :size="'2xl'" />
          🗂️ 四象限
        </h1>
        <p class="qd-subtitle">
          把手头的事按「紧急」和「重要」两个轴摆进四个格子。
          卡片可以直接拖到别的象限——重新评估优先级，本质上就是换个位置。
        </p>
      </div>
      <button class="kb-btn kb-btn-primary qd-new" @click="openCreate()">
        <Icon name="plus" :size="'15px'" />
        快速添加
      </button>
    </section>

    <!-- ===== 概览条 ===== -->
    <div class="qd-summary">
      <div class="qd-summary-card">
        <span class="qd-summary-num">{{ pendingCount }}</span>
        <span class="qd-summary-label">待办任务</span>
      </div>
      <div class="qd-summary-card">
        <span class="qd-summary-num">{{ doneCount }}</span>
        <span class="qd-summary-label">已完成</span>
      </div>
      <div class="qd-summary-card qd-summary-focus">
        <span class="qd-summary-num" :style="{ color: 'var(--kb-destructive)' }">
          {{ firstQuadrantPending }}
        </span>
        <span class="qd-summary-label">第一象限待处理（今天必须清）</span>
      </div>
    </div>

    <!-- ===== 2×2 网格 ===== -->
    <section v-if="loading" class="qd-grid">
      <div v-for="n in 4" :key="n" class="qd-skeleton"></div>
    </section>

    <section v-else class="qd-grid">
      <QuadrantCard
        v-for="meta in QUADRANTS"
        :key="meta.key"
        :meta="meta"
        :tasks="tasks[meta.group]"
        @add="openCreate"
        @toggle="store.toggleTask"
        @remove="store.deleteTask"
        @edit="openEdit"
        @clear-completed="store.clearCompleted"
        @drop="onDrop"
      />
    </section>

    <!-- 坐标轴图例：两条轴分别是什么，别让用户靠猜 -->
    <p class="qd-axis-note">
      <Icon name="move-horizontal" :size="'13px'" />
      横轴＝紧急程度（左急右缓）
      <span class="qd-axis-sep">·</span>
      <Icon name="move-vertical" :size="'13px'" />
      纵轴＝重要程度（上重下轻）
    </p>

    <!-- ===== 新建 / 编辑弹窗 ===== -->
    <CreateTaskModal
      v-model:open="modalOpen"
      :edit="editing"
      :default-quadrant="defaultQuadrant"
      :quadrants="QUADRANTS"
      @submit="onSubmit"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import Icon from '@/components/ui/Icon.vue';
import QuadrantCard from './components/QuadrantCard.vue';
import CreateTaskModal from './components/CreateTaskModal.vue';
import { QUADRANTS } from './types';
import type { QuadrantKey, QuadrantTask } from '@/api/quadrant';
import { useQuadrantStore } from '@/store/quadrant-store';

const store = useQuadrantStore();
// storeToRefs 只解 state / getter，action 仍从 store 上直接取（解了会丢 this）
const { tasks, loading, doneCount, pendingCount } = storeToRefs(store);

const modalOpen = ref(false);
const editing = ref<QuadrantTask | null>(null);
const defaultQuadrant = ref<QuadrantKey>('urgent-important');

/** 第一象限未完成数：这是整个矩阵里唯一需要「今天就清空」的数字 */
const firstQuadrantPending = computed(
  () => tasks.value.urgent_important.filter((t) => t.completed !== 1).length,
);

function openCreate(quadrant: QuadrantKey = 'urgent-important') {
  editing.value = null;
  defaultQuadrant.value = quadrant;
  modalOpen.value = true;
}

function openEdit(task: QuadrantTask) {
  editing.value = task;
  modalOpen.value = true;
}

/** 弹窗只负责收集数据，落库统一在这里走 store，新建 / 编辑共用一个出口 */
async function onSubmit(payload: {
  id?: number;
  title: string;
  quadrant: QuadrantKey;
  description: string | null;
  scheduledAt: string | null;
  tags: string | null;
}) {
  const { id, ...data } = payload;
  if (id) await store.updateTask(id, data);
  else await store.createTask({ ...data, source: 'manual' });
}

function onDrop(e: { id: number; quadrant: QuadrantKey }) {
  store.moveTask(e.id, e.quadrant);
}

onMounted(() => {
  store.fetchTasks();
});
</script>

<style scoped>
.qd-page {
  max-width: 1180px;
  margin: 0 auto;
  padding: 8px 16px 48px;
  min-height: 100%;
  background: var(--kb-background);
}

/* Hero */
.qd-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 4px 16px;
}
.qd-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--kb-muted-foreground);
  letter-spacing: 0.02em;
}
.qd-eyebrow-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--kb-destructive);
}
.qd-page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 8px;
  font-size: 24px;
  font-weight: 800;
  color: var(--kb-foreground);
  font-family: var(--font-serif);
}
.qd-subtitle {
  margin: 0;
  max-width: 660px;
  font-size: var(--kb-fs-body-md);
  line-height: 1.7;
  color: var(--kb-muted-foreground);
}
.qd-new {
  flex: none;
}

/* 概览条 */
.qd-summary {
  display: flex;
  gap: 12px;
  margin: 8px 0 16px;
  flex-wrap: wrap;
}
.qd-summary-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 16px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
}
.qd-summary-num {
  font-size: 22px;
  font-weight: 800;
  color: var(--kb-foreground);
  font-family: var(--font-mono);
}
.qd-summary-label {
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.qd-summary-focus {
  flex: 1;
  min-width: 200px;
}

/* 2×2 网格：窄窗自动退化为单列，四象限的语义不依赖物理排布 */
.qd-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
@media (max-width: 860px) {
  .qd-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.qd-skeleton {
  min-height: 260px;
  border-radius: var(--kb-radius-lg);
  background: linear-gradient(
    90deg,
    var(--kb-muted) 25%,
    color-mix(in srgb, var(--kb-muted) 55%, var(--kb-card)) 37%,
    var(--kb-muted) 63%
  );
  background-size: 400% 100%;
  animation: qd-shimmer 1.4s ease infinite;
}
@keyframes qd-shimmer {
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0 50%;
  }
}

.qd-axis-note {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 4px;
  margin: 16px 0 0;
  font-size: var(--kb-fs-caption);
  color: var(--kb-muted-foreground);
}
.qd-axis-sep {
  margin: 0 8px;
}
</style>
