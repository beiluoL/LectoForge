<template>
  <div class="wb-page animate-fade-in" :style="{ '--mc': themeColor }">
    <!-- ============ Hero ============ -->
    <section class="wb-hero">
      <div class="wb-hero-bg" aria-hidden="true">
        <span class="wb-blob"></span>
        <span class="wb-grid"></span>
      </div>
      <div class="wb-hero-inner">
        <div class="wb-hero-head">
          <div class="wb-hero-text">
            <span class="wb-eyebrow">
              <span class="wb-eyebrow-dot"></span>
              Step 01 · 输入 · Capture
            </span>
            <h1 class="wb-title">
              <Icon name="inbox" :size="28" class="wb-title-icon" />
              收集箱
            </h1>
            <p class="wb-subtitle">
              极速输入，<strong>先积累，再沉淀</strong>。
              念头、摘录、网页剪藏统统先扔进来，稍后一键流向文档库或康奈尔笔记。
            </p>
          </div>

          <div class="ib-hero-stat" :title="`当前有 ${total} 条待处理`">
            <span class="ib-stat-num">{{ total }}</span>
            <span class="ib-stat-label">待处理</span>
          </div>
        </div>

        <!-- 闭环导航条 -->
        <nav class="wb-loop-nav" aria-label="学习闭环">
          <router-link
            v-for="s in loopSteps"
            :key="s.key"
            :to="s.path"
            class="wb-loop-step"
            :class="{ 'is-current': s.key === 'input' }"
          >
            <span class="wb-loop-num">{{ s.num }}</span>
            <span class="wb-loop-name">{{ s.name }}</span>
          </router-link>
        </nav>
      </div>
    </section>

    <!-- ============ 极速输入 ============ -->
    <section>
      <h2 class="wb-section-title">
        <Icon name="zap" :size="16" />
        极速输入
        <span class="wb-section-hint">粘贴网址自动剪藏 · ⌘/Ctrl + Enter 收集</span>
      </h2>
      <QuickCapture @created="onCreated" />
    </section>

    <!-- 收件箱积压视图提示条：来自首页「今日聚焦」跳转，按创建时间升序排最旧的 -->
    <p v-if="overdueView" class="ib-overdue-note">
      <Icon name="clock" :size="14" />
      收件箱积压视图：按创建时间升序，最久未整理的排在最前。
      <button class="ib-overdue-clear" type="button" @click="exitOverdueView">返回最新优先</button>
    </p>

    <!-- ============ 待处理清单 ============ -->
    <section>
      <div class="ib-list-head">
        <h2 class="wb-section-title" style="margin: 0">
          <Icon name="layers" :size="16" />
          待处理
          <span v-if="total" class="ib-count">{{ total }}</span>
        </h2>
        <button class="kb-btn kb-btn-sm" :disabled="loading" title="重新拉取" @click="reload">
          <Icon name="refresh-cw" :size="12" :class="{ 'ib-spin': loading }" />
          刷新
        </button>
      </div>

      <p v-if="error" class="ib-error">
        <Icon name="triangle-alert" :size="14" />
        {{ error }}
        <button class="ib-retry" @click="reload">重试</button>
      </p>

      <InboxList :items="items" :loading="loading" />
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * 收集箱页面（知识闭环第一步）。
 *
 * 路径为 /inbox 而非 /workbench/capture —— 顶栏 isActive 用 startsWith 判断，
 * 挂在 /workbench 前缀下会与「工作台」互相误高亮（与 /library、/mindmap 同理）。
 * 旧路径已在 router 里配了 redirect，历史链接不会 404。
 */
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import Icon from '@/components/ui/Icon.vue';
import QuickCapture from './components/QuickCapture.vue';
import InboxList from './components/InboxList.vue';
import { useInboxStore } from '@/store/inbox-store';
import './../workbench-shared.css';

const themeColor = 'var(--kb-primary)';

const store = useInboxStore();
const { items, loading, error } = storeToRefs(store);
const route = useRoute();
const router = useRouter();

const total = computed(() => items.value.length);

/** 是否处于「收件箱积压」视图（来自首页今日聚焦的跳转），按创建时间升序、最旧排最前 */
const overdueView = computed(() => route.query.overdue === '1');

const loopSteps = [
  { key: 'input', num: '01', name: '输入', path: '/inbox' },
  { key: 'organize', num: '02', name: '整理', path: '/workbench/notes' },
  { key: 'review', num: '03', name: '复习', path: '/review' },
  { key: 'output', num: '04', name: '输出', path: '/workbench/story' },
];

function reload() {
  store.loadInbox(overdueView.value ? 'asc' : undefined);
}

/** 新建成功后无需重拉：store 已把新条目 unshift 进列表 */
function onCreated() {
  /* no-op：保留钩子，便于后续接埋点 */
}

/** 退出积压视图：去掉 ?overdue=1，回到默认「最新优先」 */
function exitOverdueView() {
  if (!overdueView.value) return;
  const q = { ...route.query };
  delete q.overdue;
  router.replace({ query: q });
}

onMounted(reload);
</script>

<style scoped>
/* Hero 右侧待处理计数 */
.ib-hero-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 76px;
  padding: 10px 16px;
  border-radius: var(--kb-radius-md);
  background: color-mix(in srgb, var(--kb-card) 72%, transparent);
  border: 1px solid var(--kb-border);
  backdrop-filter: blur(6px);
  flex-shrink: 0;
}
.ib-stat-num {
  font-family: var(--font-mono);
  font-size: 26px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--mc);
  font-variant-numeric: tabular-nums;
}
.ib-stat-label {
  margin-top: 2px;
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
}

/* 清单标题行 */
.ib-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.ib-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--mc) 12%, transparent);
  color: var(--mc);
  font-family: var(--font-mono);
  font-size: var(--kb-fs-xs);
  font-weight: 700;
}
.ib-spin {
  animation: ib-rotate 0.8s linear infinite;
}
@keyframes ib-rotate {
  to { transform: rotate(360deg); }
}

/* 错误条 */
.ib-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: var(--kb-radius-sm);
  background: color-mix(in srgb, var(--kb-destructive) 7%, transparent);
  border: 1px solid color-mix(in srgb, var(--kb-destructive) 28%, transparent);
  color: var(--kb-destructive);
  font-size: var(--kb-fs-body-sm);
}
.ib-retry {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--kb-destructive);
  font-family: inherit;
  font-size: var(--kb-fs-body-sm);
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}

/* 收件箱积压视图提示条（暖橙警示色，呼应首页「待整理」卡片） */
.ib-overdue-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: var(--kb-radius-sm);
  background: rgba(224, 122, 0, 0.1);
  border: 1px solid rgba(224, 122, 0, 0.35);
  color: var(--kb-foreground);
  font-size: var(--kb-fs-body-sm);
}
.ib-overdue-clear {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--kb-primary);
  font-family: inherit;
  font-size: var(--kb-fs-body-sm);
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
}
</style>
