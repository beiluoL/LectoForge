<template>
  <div class="dr-wrap animate-fade-in">
    <div class="dr-container">
      <!-- 顶部：日期标题 + 一键刷新 -->
      <header class="dr-head">
        <div>
          <h1 class="kb-h1 dr-title">
            <Icon name="calendar-clock" :size="24" style="color: var(--kb-highlight);" />
            学习日报
          </h1>
          <p class="kb-body dr-sub">
            <template v-if="stats">本地昨日 · {{ stats.date }}</template>
            <template v-else>主动智能 · 昨日数据复盘</template>
          </p>
        </div>
        <button class="kb-btn" :disabled="loading" @click="onRefresh">
          <Icon :name="loading ? 'loader' : 'refresh-cw'" :size="16" :class="loading ? 'ai-spin' : ''" />
          {{ loading ? '刷新中…' : '一键刷新' }}
        </button>
      </header>

      <!-- 未配置 AI 提示 -->
      <div v-if="aiHint" class="ai-hint">
        <Icon name="info" :size="14" />
        <span>尚未配置 AI 服务，<router-link to="/settings">前往 AI 设置</router-link> 后即可生成日报文案。</span>
      </div>

      <!-- 错误条 -->
      <div v-else-if="error && !stats" class="ai-hint" style="border-color: var(--kb-destructive);">
        <Icon name="alert-circle" :size="14" style="color: var(--kb-destructive);" />
        <span>{{ error }}</span>
      </div>

      <!-- 4 张统计卡（Apple Health 风格） -->
      <section class="dr-grid">
        <!-- 📥 昨日输入 -->
        <article class="dr-stat-card" :style="{ '--accent': 'var(--kb-highlight)' }">
          <div class="dr-stat-icon"><Icon name="inbox" :size="22" /></div>
          <p class="dr-stat-label">📥 昨日输入</p>
          <p class="dr-stat-value">{{ stats?.capturesYesterday ?? '—' }}</p>
          <p class="dr-stat-foot">条收集箱新增</p>
        </article>

        <!-- 📚 昨日复习 -->
        <article class="dr-stat-card" :style="{ '--accent': 'var(--kb-primary)' }">
          <div class="dr-stat-icon"><Icon name="book-open" :size="22" /></div>
          <p class="dr-stat-label">📚 昨日复习</p>
          <p class="dr-stat-value">{{ stats?.reviewsYesterday ?? '—' }}</p>
          <p class="dr-stat-foot">次间隔复习</p>
        </article>

        <!-- 🎯 薄弱知识点 -->
        <article class="dr-stat-card" :style="{ '--accent': 'var(--kb-accent)' }">
          <div class="dr-stat-icon"><Icon name="target" :size="22" /></div>
          <p class="dr-stat-label">🎯 薄弱知识点</p>
          <div v-if="stats && stats.weakPoints.length" class="dr-tags">
            <span v-for="(w, i) in stats.weakPoints" :key="i" class="dr-tag">{{ w }}</span>
          </div>
          <p v-else class="dr-stat-value dr-stat-value-sm">完美</p>
          <p class="dr-stat-foot">quality&lt;2 的错题</p>
        </article>

        <!-- 🔄 7 天转化率 -->
        <article class="dr-stat-card" :style="{ '--accent': 'var(--kb-highlight)' }">
          <div class="dr-stat-icon"><Icon name="repeat" :size="22" /></div>
          <p class="dr-stat-label">🔄 7 天转化率</p>
          <p class="dr-stat-value">{{ stats ? stats.conversion7d : '—' }}<span class="dr-pct">%</span></p>
          <div class="dr-bar"><i :style="{ width: (stats ? stats.conversion7d : 0) + '%' }" /></div>
          <p class="dr-stat-foot" v-if="stats">已沉淀 {{ stats.conversionDetail.converted }}/{{ stats.conversionDetail.captured }} 条</p>
        </article>
      </section>

      <!-- AI 日报面板（磨砂玻璃） -->
      <section class="dr-glass" v-if="content || generating">
        <div class="ai-panel-head">
          <span class="ai-panel-title">
            <Icon name="ai-sparkle" :size="14" style="color: var(--kb-highlight);" />
            {{ content?.title || '生成中…' }}
          </span>
          <span v-if="content" class="ai-meta">{{ content.model }} · {{ content.latencyMs }}ms</span>
        </div>

        <div v-if="generating && !content" class="dr-loading">
          <Icon name="loader" :size="18" class="ai-spin" />
          <span>AI 正在复盘昨日学习…</span>
        </div>

        <template v-else-if="content">
          <p v-if="content.summary" class="dr-summary">{{ content.summary }}</p>

          <div v-if="content.weakPoints" class="dr-block">
            <p class="ai-subtitle">薄弱点归纳</p>
            <p class="dr-feedback">{{ content.weakPoints }}</p>
          </div>

          <div v-if="content.encouragement" class="dr-encourage">
            <Icon name="sparkles" :size="16" style="color: var(--kb-highlight);" />
            <span>{{ content.encouragement }}</span>
          </div>

          <div v-if="content.suggestions" class="dr-block">
            <p class="ai-subtitle">下一步建议</p>
            <ul class="ai-list">
              <li v-for="(s, i) in suggestionList" :key="i">{{ s }}</li>
            </ul>
          </div>
        </template>

        <!-- 操作按钮 -->
        <div class="dr-actions">
          <button class="kb-btn ai-btn" :disabled="generating" @click="onRegenerate">
            <Icon :name="generating ? 'loader' : 'repeat'" :size="14" :class="generating ? 'ai-spin' : ''" />
            {{ generating ? '重新生成中…' : '🔁 重新生成' }}
          </button>
          <button class="kb-btn ai-btn" :disabled="cardBusy || !hasWeakPoints" @click="onGenerateCards">
            <Icon :name="cardBusy ? 'loader' : 'brain-circuit'" :size="14" :class="cardBusy ? 'ai-spin' : ''" />
            {{ cardBusy ? '生成中…' : '🧠 一键生成 3 张复习闪卡' }}
          </button>
        </div>
        <p v-if="!hasWeakPoints && !cardBusy" class="dr-tip">昨日无薄弱点，无需生成错题卡 🎉</p>
      </section>

      <!-- 空态：AI 未生成（未配置或尚未触发） -->
      <section v-else-if="stats && !aiHint" class="ai-hint">
        <Icon name="sparkles" :size="14" style="color: var(--kb-highlight);" />
        <span>点击「🔁 重新生成」让 AI 为你复盘昨日学习，并基于薄弱点生成复习卡。</span>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';

import '../ai-shared.css';
import { useDailyReportStore } from '@/store/daily-report-store';

const store = useDailyReportStore();
// storeToRefs 把 state 解构成模板可用的顶层 ref（action 仍走 store.xxx 调用）
const { stats, content, loading, generating, cardBusy, error, aiHint } = storeToRefs(store);

const hasWeakPoints = computed(() => !!store.stats?.weakPoints.length);
const suggestionList = computed(() =>
  (store.content?.suggestions || '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean),
);

function onRefresh() {
  store.fetchReport();
  if (!store.content) store.generateReport();
}

function onRegenerate() {
  store.generateReport();
}

function onGenerateCards() {
  store.generateCards();
}

onMounted(() => {
  store.fetchReport();
  // 首次进入即主动生成（后端按日期缓存 1h，重复进入不会刷爆 LLM）
  store.generateReport();
});
</script>

<style scoped>
.dr-wrap {
  width: 100%;
  min-height: 100%;
  /* 由主题令牌驱动背景，明暗自适应 */
  background:
    radial-gradient(1200px 480px at 100% -10%, color-mix(in srgb, var(--kb-highlight) 8%, transparent), transparent 60%),
    var(--kb-background);
  padding: 22px 26px 40px;
}
.dr-container {
  max-width: 920px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.dr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.dr-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--kb-foreground);
}
.dr-sub {
  margin: 4px 0 0;
  color: var(--kb-muted-foreground);
}

/* ===== 4 张统计卡 ===== */
.dr-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}
.dr-stat-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 18px;
  border-radius: var(--kb-radius-lg);
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  animation: dr-pop 0.25s ease both;
}
.dr-stat-card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 20%, transparent));
}
.dr-stat-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--kb-radius-md);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  margin-bottom: 6px;
}
.dr-stat-label {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--kb-muted-foreground);
}
.dr-stat-value {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 32px;
  font-weight: 700;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
  color: var(--kb-foreground);
}
.dr-stat-value-sm {
  font-size: 22px;
  color: var(--kb-accent);
}
.dr-pct {
  font-size: 15px;
  font-weight: 600;
  margin-left: 2px;
  color: var(--kb-muted-foreground);
}
.dr-stat-foot {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--kb-muted-foreground);
}
.dr-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.dr-tag {
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dr-bar {
  position: relative;
  height: 7px;
  border-radius: 999px;
  background: var(--kb-muted);
  overflow: hidden;
  margin-top: 6px;
}
.dr-bar > i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  transition: width 0.45s ease;
}

/* ===== 磨砂 AI 面板 ===== */
.dr-glass {
  border-radius: var(--kb-radius-lg);
  border: 1px solid var(--kb-highlight-border);
  background: color-mix(in srgb, var(--kb-card) 82%, transparent);
  backdrop-filter: blur(14px) saturate(1.2);
  -webkit-backdrop-filter: blur(14px) saturate(1.2);
  box-shadow: var(--shadow-card);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dr-summary {
  margin: 0;
  font-size: 14px;
  line-height: 1.75;
  color: var(--kb-foreground);
}
.dr-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dr-feedback {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--kb-card-foreground);
}
.dr-encourage {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--kb-radius-md);
  background: color-mix(in srgb, var(--kb-highlight) 10%, transparent);
  font-size: 14px;
  font-weight: 600;
  color: var(--kb-foreground);
}
.dr-loading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--kb-muted-foreground);
}
.dr-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.dr-tip {
  margin: 0;
  font-size: 12px;
  color: var(--kb-muted-foreground);
}

@keyframes dr-pop {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (min-width: 720px) {
  .dr-grid { grid-template-columns: repeat(4, 1fr); }
}
</style>
