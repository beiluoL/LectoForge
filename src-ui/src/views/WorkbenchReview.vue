<template>
  <!-- 复习驾驶舱（/workbench/review）：复习模块唯一总入口。
       2026-08-07 架构收敛：顶栏「间隔复习」项已删除，新旧两套复习系统统一从这里分流——
       上半屏是「看数据」（双系统待办摘要 + 热力图 + 遗忘曲线），下半屏是「去刷题」（双入口卡片）。
       热力图与遗忘曲线直接复用新系统的 /api/reviews/heatmap 与 /api/reviews/forgetting-curve，后端零改动。 -->
  <div class="wb-page animate-fade-in" :style="{ '--mc': themeColor }">
    <!-- ============ Module Hero ============ -->
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
              Step 03 · 复习 · Review Cockpit
            </span>
            <h1 class="wb-title">
              <Icon name="repeat" :size="28" class="wb-title-icon" />
              复习中心
            </h1>
            <p class="wb-subtitle">
              基于 <strong>SM-2 遗忘曲线</strong>自动排程，按反馈动态拉长复习间隔。
              两条队列并行：自动排期负责「系统推给你」，自定义卡组负责「你自己安排」。
            </p>

            <!-- 双系统待复习摘要标签 -->
            <div class="rc-summary">
              <button
                class="rc-pill rc-pill--smart"
                :title="'点击进入间隔复习闪卡'"
                @click="goFlashcard"
              >
                <Icon name="zap" :size="13" />
                今日待复习（自动排期）
                <b>{{ smartDue }}</b> 张
              </button>
              <button
                class="rc-pill rc-pill--legacy"
                :title="'点击进入传统卡组'"
                @click="goLegacy()"
              >
                <Icon name="wallet-cards" :size="13" />
                待复习（传统卡组）
                <b>{{ legacyDueCount }}</b> 张
              </button>
              <span v-if="totalDue === 0" class="rc-pill rc-pill--calm">
                <Icon name="check-circle" :size="13" />
                今日任务已清空，去沉淀新知识吧
              </span>
            </div>
          </div>

          <div class="wb-hero-actions">
            <router-link to="/workbench/recall" class="kb-btn wb-ghost-btn">
              <Icon name="edit-2" :size="14" /> 主动回忆
            </router-link>
            <router-link to="/workbench/palace" class="kb-btn wb-ghost-btn">
              <Icon name="map-pin" :size="14" /> 记忆宫殿
            </router-link>
            <button class="kb-btn kb-btn-primary wb-cta" @click="goFlashcard">
              <Icon name="play" :size="14" /> 开始今日复习
            </button>
          </div>
        </div>

        <!-- 闭环导航条 -->
        <nav class="wb-loop-nav" aria-label="学习闭环">
          <router-link
            v-for="s in loopSteps"
            :key="s.key"
            :to="s.path"
            class="wb-loop-step"
            :class="{ 'is-current': s.key === 'review' }"
          >
            <span class="wb-loop-num">{{ s.num }}</span>
            <span class="wb-loop-name">{{ s.name }}</span>
          </router-link>
        </nav>
      </div>
    </section>

    <!-- ============ 数据区：热力图 + 遗忘曲线 ============ -->
    <section>
      <h2 class="wb-section-title">
        <Icon name="gauge" :size="18" style="color: var(--mc);" />
        记忆健康度
        <span class="wb-section-hint">
          全局复习行为统计 · 覆盖笔记与记忆宫殿两类卡源
        </span>
      </h2>

      <div class="rc-stats">
        <!-- 复习热力图（从原 /review 页面迁移而来，组件本身零改动） -->
        <ReviewHeatmap />

        <!-- 遗忘曲线折叠面板（懒加载：展开时才请求） -->
        <div class="rc-panel">
          <button class="rc-panel-head" @click="toggleCurve">
            <span class="rc-panel-title">
              <Icon name="trending-down" :size="15" />
              近 {{ curveDays }} 天遗忘趋势
            </span>
            <span class="rc-panel-meta">
              <template v-if="forgettingCurve">
                复习 {{ forgettingCurve.totalReviews }} 次 · 遗忘率
                {{ (forgettingCurve.overallLapseRate * 100).toFixed(1) }}%
              </template>
              <template v-else>展开查看记忆巩固走势</template>
              <Icon :name="curveOpen ? 'chevron-up' : 'chevron-down'" :size="16" />
            </span>
          </button>

          <div v-if="curveOpen" class="rc-panel-body">
            <div class="rc-curve-toolbar">
              <div class="rc-range">
                <button
                  v-for="d in CURVE_RANGES"
                  :key="d"
                  class="rc-range-btn"
                  :class="{ 'is-active': curveDays === d }"
                  @click="switchCurveDays(d)"
                >{{ d }}天</button>
              </div>
              <div v-if="forgettingCurve" class="rc-legend">
                <span class="rc-legend-item"><span class="rc-legend-bar"></span>每日复习量</span>
                <span class="rc-legend-item"><span class="rc-legend-line"></span>遗忘率</span>
              </div>
            </div>

            <div v-if="curveLoading" class="rc-curve-state">
              <Icon name="loader" :size="20" class="rc-spin" />
            </div>
            <div v-else-if="!forgettingCurve || forgettingCurve.points.length === 0" class="rc-curve-state">
              <Icon name="bar-chart-2" :size="28" style="opacity: 0.4;" />
              <p>暂无复习记录，完成复习后这里会呈现记忆巩固趋势</p>
            </div>
            <svg v-else :viewBox="`0 0 ${SVG_W} ${SVG_H}`" class="rc-curve-svg">
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
                rx="2" fill="var(--mc)" fill-opacity="0.28"
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
      </div>
    </section>

    <!-- ============ 入口区：两个大尺寸复习入口卡片 ============ -->
    <section>
      <h2 class="wb-section-title">
        <Icon name="layers" :size="18" style="color: var(--mc);" />
        选择复习方式
        <span class="wb-section-hint">两条队列互不干扰，可以随时切换</span>
      </h2>

      <div class="rc-entries">
        <!-- 卡片 1：SM-2 自动排期（核心） -->
        <article class="rc-entry rc-entry--smart" @click="goFlashcard">
          <span class="rc-entry-glow" aria-hidden="true"></span>
          <header class="rc-entry-head">
            <span class="rc-entry-icon"><Icon name="brain" :size="26" /></span>
            <span class="rc-entry-badge">推荐</span>
          </header>
          <h3 class="rc-entry-title">🧠 间隔复习 · SM-2 自动排期</h3>
          <p class="rc-entry-desc">
            由你的康奈尔笔记和记忆宫殿自动生成的卡片，根据遗忘曲线智能推送。
          </p>
          <ul class="rc-entry-feats">
            <li><Icon name="check" :size="13" /> 3D 翻转卡 + 键盘盲操打分</li>
            <li><Icon name="check" :size="13" /> 新卡 / 复习卡 / 易忘卡自动分型</li>
            <li><Icon name="check" :size="13" /> 全屏专注沉浸背书</li>
          </ul>
          <footer class="rc-entry-foot">
            <span class="rc-entry-count">
              待复习 <b>{{ smartDue }}</b> 张
            </span>
            <button class="kb-btn kb-btn-primary rc-entry-btn" @click.stop="goFlashcard">
              🚀 开始刷题
            </button>
          </footer>
        </article>

        <!-- 卡片 2：传统自定义卡组 -->
        <article class="rc-entry rc-entry--legacy" @click="goLegacy()">
          <span class="rc-entry-glow" aria-hidden="true"></span>
          <header class="rc-entry-head">
            <span class="rc-entry-icon"><Icon name="wallet-cards" :size="26" /></span>
          </header>
          <h3 class="rc-entry-title">🗂️ 传统复习 · 自定义卡组</h3>
          <p class="rc-entry-desc">
            手动创建或从笔记中摘录的卡片，独立于自动排期。
          </p>
          <ul class="rc-entry-feats">
            <li><Icon name="check" :size="13" /> 自建正反面，节奏自己掌控</li>
            <li><Icon name="check" :size="13" /> 支持暂停 / 恢复单张卡片</li>
            <li><Icon name="check" :size="13" /> 忘了 / 困难 / 一般 / 容易四档</li>
          </ul>
          <footer class="rc-entry-foot">
            <span class="rc-entry-count">
              待复习 <b>{{ legacyDueCount }}</b> 张
            </span>
            <button class="kb-btn rc-entry-btn rc-entry-btn--ghost" @click.stop="goLegacy(true)">
              📖 开始复习
            </button>
          </footer>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
// 复习驾驶舱：只做「看板 + 分流」，不承载任何刷卡交互。
// 刷卡分别下沉到 /review（新 SM-2 闪卡）与 /workbench/review/card-list（旧传统卡组）。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import Icon from '@/components/ui/Icon.vue'
import ReviewHeatmap from '@/components/ReviewHeatmap.vue'
import { useReviewStore } from '@/store/review-store'
import { useDashboardStore } from '@/store/dashboard-store'
import './workbench-shared.css'

const router = useRouter()

/** 模块主题色：复习模块统一用高光色，不硬编码 hex */
const themeColor = 'var(--kb-highlight)'

const reviewStore = useReviewStore()
const { forgettingCurve, curveLoading, curveDays, legacyDueCount } = storeToRefs(reviewStore)

// 新系统（notes + loci 的 SM-2 到期数）复用首页聚合统计，避免重复请求
const dashboardStore = useDashboardStore()
const { stats: dashboardStats } = storeToRefs(dashboardStore)
const smartDue = computed(() => dashboardStats.value.dueReviews)
const totalDue = computed(() => smartDue.value + legacyDueCount.value)

const loopSteps = [
  { key: 'input', num: '01', name: '输入', path: '/inbox' },
  { key: 'organize', num: '02', name: '整理', path: '/workbench/notes' },
  { key: 'review', num: '03', name: '复习', path: '/workbench/review' },
  { key: 'output', num: '04', name: '输出', path: '/workbench/story' },
]

/* ============ 入口分流 ============ */
/** 进入新系统闪卡专注模式；每次进入前清空上一轮会话残留 */
function goFlashcard() {
  reviewStore.resetSession()
  router.push('/review')
}
/** 进入旧系统传统卡组；autostart 时直接开抽查 */
function goLegacy(autostart = false) {
  router.push(autostart ? '/workbench/review/card-list?autostart=1' : '/workbench/review/card-list')
}

/* ============ 遗忘曲线折叠面板 ============ */
const CURVE_RANGES = [14, 30, 90]
const curveOpen = ref(false)
const SVG_W = 720
const SVG_H = 220
const PAD_L = 36
const PAD_R = 16
const PAD_T = 16
const PAD_B = 28

const chartPoints = computed(() => {
  const c = forgettingCurve.value
  if (!c) return []
  const pts = c.points
  const n = pts.length
  if (n === 0) return []
  const innerW = SVG_W - PAD_L - PAD_R
  const innerH = SVG_H - PAD_T - PAD_B
  const maxReviews = Math.max(1, ...pts.map((p) => p.reviews))
  const barW = Math.max(2, Math.min(14, innerW / n - 2))
  return pts.map((p, i) => {
    const x = PAD_L + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1))
    const barH = (p.reviews / maxReviews) * innerH
    return {
      x,
      barY: PAD_T + innerH - barH,
      barH,
      barW,
      lineY: PAD_T + innerH - p.lapseRate * innerH,
      dateLabel: p.date.slice(5),
    }
  })
})
const yTicks = [
  { y: PAD_T, label: '0%' },
  { y: PAD_T + (SVG_H - PAD_T - PAD_B) * 0.25, label: '25%' },
  { y: PAD_T + (SVG_H - PAD_T - PAD_B) * 0.5, label: '50%' },
  { y: PAD_T + (SVG_H - PAD_T - PAD_B) * 0.75, label: '75%' },
  { y: SVG_H - PAD_B, label: '100%' },
]
const xLabelStep = computed(() =>
  Math.max(1, Math.ceil((forgettingCurve.value?.points.length || 1) / 10)),
)

function toggleCurve() {
  curveOpen.value = !curveOpen.value
  if (curveOpen.value && !forgettingCurve.value) void reviewStore.loadForgettingCurve()
}
function switchCurveDays(d: number) {
  reviewStore.curveDays = d
  void reviewStore.loadForgettingCurve(d)
}

onMounted(() => {
  // 两条队列的待办数并行拉取：新系统走 dashboard 聚合，旧系统走 due-count
  void dashboardStore.fetchStats()
  void reviewStore.loadDashboard()
})
</script>

<style scoped>
/* ===== Hero 内的双系统摘要标签 ===== */
.rc-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
}
.rc-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
  color: var(--kb-muted-foreground);
  font-size: 12.5px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
}
.rc-pill:hover {
  transform: translateY(-1px);
}
.rc-pill b {
  color: var(--kb-foreground);
  font-variant-numeric: tabular-nums;
  font-size: 14px;
}
.rc-pill--smart:hover { border-color: var(--kb-primary); color: var(--kb-primary); }
.rc-pill--smart b { color: var(--kb-primary); }
.rc-pill--legacy:hover { border-color: var(--kb-warning); color: var(--kb-warning); }
.rc-pill--legacy b { color: var(--kb-warning); }
.rc-pill--calm {
  cursor: default;
  color: var(--kb-accent);
  border-color: color-mix(in srgb, var(--kb-accent) 35%, var(--kb-border));
  background: color-mix(in srgb, var(--kb-accent) 8%, var(--kb-card));
}
.rc-pill--calm:hover { transform: none; }

.wb-hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wb-ghost-btn {
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  color: var(--kb-foreground);
}
.wb-ghost-btn:hover { border-color: var(--mc); color: var(--mc); }

/* ===== 数据区 ===== */
.rc-stats {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rc-panel {
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  overflow: hidden;
}
.rc-panel-head {
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
.rc-panel-head:hover { background: var(--kb-muted); }
.rc-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 700;
}
.rc-panel-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.rc-panel-body {
  padding: 4px 18px 18px;
  border-top: 1px solid var(--kb-border);
}
.rc-curve-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 14px 0;
  flex-wrap: wrap;
}
.rc-range {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border-radius: var(--kb-radius-sm);
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
}
.rc-range-btn {
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
.rc-range-btn.is-active {
  background: var(--mc);
  color: var(--kb-primary-foreground, #fff);
  font-weight: 600;
}
.rc-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 11px;
  color: var(--kb-muted-foreground);
}
.rc-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.rc-legend-bar {
  width: 12px;
  height: 10px;
  border-radius: 2px;
  background: var(--mc);
  opacity: 0.28;
}
.rc-legend-line {
  width: 14px;
  height: 2px;
  background: var(--kb-destructive);
}
.rc-curve-svg {
  width: 100%;
  height: auto;
}
.rc-curve-state {
  height: 170px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
  color: var(--kb-muted-foreground);
}
.rc-spin {
  animation: rc-rotate 0.9s linear infinite;
  color: var(--mc);
}
@keyframes rc-rotate {
  to { transform: rotate(360deg); }
}

/* ===== 入口卡片 ===== */
.rc-entries {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.rc-entry {
  --ec: var(--kb-primary);
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 24px 26px 22px;
  border-radius: var(--kb-radius-lg);
  background:
    linear-gradient(150deg, color-mix(in srgb, var(--ec) 7%, var(--kb-card)), var(--kb-card) 62%);
  border: 1px solid color-mix(in srgb, var(--ec) 22%, var(--kb-border));
  box-shadow: var(--shadow-card);
  cursor: pointer;
  overflow: hidden;
  /* hover 缩放 + 阴影加深，提升点击欲望 */
  transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.2s ease, border-color 0.2s ease;
}
.rc-entry:hover {
  transform: scale(1.02);
  box-shadow: var(--shadow-lg);
  border-color: color-mix(in srgb, var(--ec) 46%, var(--kb-border));
}
.rc-entry:active { transform: scale(0.995); }
.rc-entry--smart { --ec: var(--kb-primary); }
.rc-entry--legacy { --ec: var(--kb-warning); }

/* 右上角柔光，纯装饰 */
.rc-entry-glow {
  position: absolute;
  top: -70px;
  right: -60px;
  width: 190px;
  height: 190px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--ec) 24%, transparent), transparent 70%);
  pointer-events: none;
}
.rc-entry-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.rc-entry-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 50px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--ec) 15%, transparent);
  color: var(--ec);
}
.rc-entry-badge {
  padding: 3px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ec) 16%, transparent);
  color: var(--ec);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.rc-entry-title {
  margin: 4px 0 0;
  font-size: var(--kb-fs-h4);
  font-weight: 800;
  line-height: 1.35;
  color: var(--kb-foreground);
}
.rc-entry-desc {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--kb-muted-foreground);
}
.rc-entry-feats {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.rc-entry-feats li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--kb-muted-foreground);
}
.rc-entry-feats li :deep(svg) { color: var(--ec); flex-shrink: 0; }
.rc-entry-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed var(--kb-border);
  flex-wrap: wrap;
}
.rc-entry-count {
  font-size: 12.5px;
  color: var(--kb-muted-foreground);
}
.rc-entry-count b {
  font-size: 20px;
  font-weight: 800;
  color: var(--ec);
  font-variant-numeric: tabular-nums;
  margin: 0 2px;
}
.rc-entry-btn {
  white-space: nowrap;
  font-weight: 700;
}
.rc-entry-btn--ghost {
  background: var(--kb-card);
  border: 1px solid color-mix(in srgb, var(--ec) 40%, var(--kb-border));
  color: var(--ec);
}
.rc-entry-btn--ghost:hover {
  background: color-mix(in srgb, var(--ec) 10%, var(--kb-card));
}

@media (max-width: 900px) {
  .rc-entries { grid-template-columns: minmax(0, 1fr); }
}
</style>
