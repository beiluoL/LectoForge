<template>
  <!-- 传统卡组（旧复习系统 wb_review_card）：手动建卡 + 抽查 + 卡组管理。
       2026-08-07 复习模块收敛后从 /workbench/review 下沉到 /workbench/review/card-list，
       遗忘曲线已上移到复习驾驶舱，本页只保留「刷卡 + 管卡」两件事。 -->
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
              Step 03 · 复习 · Custom Decks
            </span>
            <h1 class="wb-title">
              <Icon name="wallet-cards" :size="'28px'" class="wb-title-icon" />
              传统复习 · 自定义卡组
            </h1>
            <p class="wb-subtitle">
              手动创建或从笔记中摘录的卡片，<strong>独立于 SM-2 自动排期</strong>。
              适合公式、外语单词这类需要自己掌控节奏的硬记内容。
            </p>
          </div>
          <div class="wb-hero-actions">
            <router-link to="/workbench/review" class="kb-btn wb-ghost-btn">
              <Icon name="arrow-left" :size="'sm'" /> 返回复习中心
            </router-link>
            <button class="kb-btn kb-btn-primary wb-cta" @click="startReview">
              <Icon name="play" :size="'sm'" /> 开始抽查
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ============ 抽卡区 ============ -->
    <section v-if="active">
      <h2 class="wb-section-title">
        <Icon name="layers" :size="'lg'" style="color: var(--mc);" />
        抽查进行中
        <span class="wb-section-hint">第 {{ index + 1 }} / {{ queue.length }} 张</span>
      </h2>
      <div class="wb-quiz-card">
        <button class="wb-quiz-close" title="暂停" @click="active = false">
          <Icon name="pause" :size="'sm'" />
        </button>

        <div
          class="wb-quiz-face"
          :class="{ 'is-revealed': revealed }"
          @click="revealed = !revealed"
        >
          <div v-if="!revealed" class="wb-quiz-front">
            <span class="wb-quiz-label">问题</span>
            <p class="wb-quiz-text">{{ current.front }}</p>
            <span class="wb-quiz-hint"><Icon name="eye" :size="'sm'" /> 点击查看答案</span>
          </div>
          <div v-else class="wb-quiz-back">
            <span class="wb-quiz-label wb-quiz-label-back">答案</span>
            <p class="wb-quiz-text">{{ current.back }}</p>
          </div>
        </div>

        <div v-if="revealed" class="wb-quiz-grade">
          <p class="wb-quiz-grade-title">你记得多少？反馈以调整下次间隔</p>
          <div class="wb-quiz-grade-grid">
            <button class="wb-grade-btn wb-grade-forgot" @click="grade(0)">
              <Icon name="x-circle" :size="'md'" />
              <span class="wb-grade-label">忘了</span>
              <span class="wb-grade-hint">重置</span>
            </button>
            <button class="wb-grade-btn wb-grade-hard" @click="grade(1)">
              <Icon name="thumbs-down" :size="'md'" />
              <span class="wb-grade-label">困难</span>
              <span class="wb-grade-hint">+1d</span>
            </button>
            <button class="wb-grade-btn wb-grade-normal" @click="grade(2)">
              <Icon name="thumbs-up" :size="'md'" />
              <span class="wb-grade-label">一般</span>
              <span class="wb-grade-hint">×2.5</span>
            </button>
            <button class="wb-grade-btn wb-grade-easy" @click="grade(3)">
              <Icon name="check-circle" :size="'md'" />
              <span class="wb-grade-label">容易</span>
              <span class="wb-grade-hint">×4</span>
            </button>
          </div>
          <p v-if="lastResult" class="wb-quiz-result">
            <Icon name="calendar-check" :size="'sm'" />
            下次复习：{{ lastResult.intervalDay }} 天后
            <span v-if="lastResult.lapsed" class="wb-quiz-lapsed">（本次遗忘，间隔已重置）</span>
          </p>
        </div>
      </div>
    </section>

    <!-- ============ 空队列提示 ============ -->
    <section v-else-if="!loading && queue.length === 0" class="wb-empty">
      <div class="wb-empty-icon"><Icon name="calendar-check" :size="'40px'" /></div>
      <h3 class="wb-empty-title">暂无待复习卡片</h3>
      <p class="wb-empty-desc">新建复习卡，或把笔记转为卡片，让记忆开始流动。</p>
      <button class="kb-btn kb-btn-primary" @click="showCreate = true">
        <Icon name="plus" :size="'sm'" /> 新建复习卡
      </button>
    </section>

    <!-- ============ 卡片管理列表 ============ -->
    <section>
      <div class="wb-list-head">
        <h2 class="wb-section-title" style="margin: 0;">
          <Icon name="layers" :size="'lg'" style="color: var(--mc);" />
          全部复习卡
          <span class="wb-section-hint">{{ cards.length }} 张</span>
        </h2>
        <button class="kb-btn kb-btn-primary" @click="showCreate = true">
          <Icon name="plus" :size="'sm'" /> 新建
        </button>
      </div>

      <div v-if="cards.length === 0" class="wb-empty wb-empty-sm">
        <Icon name="layers" :size="'28px'" style="color: var(--kb-muted-foreground);" />
        <p class="wb-empty-desc" style="margin: 0;">还没有复习卡片</p>
      </div>
      <div v-else class="wb-card-rows">
        <div v-for="c in cards" :key="c.id" class="wb-card-row">
          <div class="wb-card-row-body">
            <p class="wb-card-row-front">{{ c.front }}</p>
            <div class="wb-card-row-meta">
              <span class="wb-chip wb-chip-mono">间隔 {{ c.intervalDay }}d</span>
              <span class="wb-chip wb-chip-mono">难度 {{ c.easeFactorDecimal?.toFixed(2) }}</span>
              <span class="wb-chip wb-chip-muted">{{ c.nextReviewHint }}</span>
              <span v-if="c.suspended" class="wb-chip wb-chip-warn">已暂停</span>
            </div>
          </div>
          <div class="wb-card-row-actions">
            <button class="wb-icon-btn" :title="c.suspended ? '恢复' : '暂停'" @click="suspend(c)">
              <Icon :name="c.suspended ? 'play' : 'pause'" :size="'sm'" />
            </button>
            <button class="wb-icon-btn" title="删除" @click="remove(c)">
              <Icon name="trash-2" :size="'sm'" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ============ 新建复习卡 Drawer ============ -->
    <div v-if="showCreate" class="wb-drawer-mask" @click.self="showCreate = false">
      <div class="wb-drawer">
        <header class="wb-drawer-head">
          <div>
            <span class="wb-eyebrow wb-eyebrow-sm">New Card</span>
            <h2 class="wb-drawer-title">新建复习卡</h2>
          </div>
          <button class="wb-icon-btn" @click="showCreate = false"><Icon name="x" :size="'lg'" /></button>
        </header>
        <div class="wb-drawer-body">
          <div class="wb-field">
            <label class="wb-label">正面（问题/线索）<span class="wb-req">*</span></label>
            <textarea v-model="cardForm.front" class="kb-input" rows="3" placeholder="问题…"></textarea>
          </div>
          <div class="wb-field">
            <label class="wb-label">背面（答案）<span class="wb-req">*</span></label>
            <textarea v-model="cardForm.back" class="kb-input" rows="3" placeholder="答案…"></textarea>
          </div>
          <div class="wb-field">
            <label class="wb-label">类型</label>
            <select v-model="cardForm.cardType" class="kb-input">
              <option value="BASIC">问答</option>
              <option value="CLOZE">挖空</option>
              <option value="RECALL">主动回忆</option>
            </select>
          </div>
        </div>
        <footer class="wb-drawer-foot">
          <button class="kb-btn" @click="showCreate = false">取消</button>
          <button class="kb-btn kb-btn-primary" @click="saveCard">
            <Icon name="check" :size="'sm'" /> 保存
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import { notify, confirmDialog, getApiError } from '@/utils/toast'
import './workbench-shared.css'
import {
  listReviews,
  drawReviews,
  createReview,
  deleteReview,
  gradeReview,
  toggleReviewSuspend,
} from '@/api/workbench'
import type { WbReviewCardVO, WbReviewGradeResult } from '@/api/types'

const route = useRoute()
/** 模块主题色沿用复习模块的琥珀色，与驾驶舱入口卡片保持同一视觉家族 */
const themeColor = 'var(--kb-warning)'

const cards = ref<WbReviewCardVO[]>([])
const queue = ref<WbReviewCardVO[]>([])
const loading = ref(true)
const active = ref(false)
const index = ref(0)
const revealed = ref(false)
const lastResult = ref<WbReviewGradeResult | null>(null)
const showCreate = ref(false)
const cardForm = reactive({ front: '', back: '', cardType: 'BASIC' })

const current = ref<WbReviewCardVO>({} as WbReviewCardVO)

async function load() {
  loading.value = true
  try {
    cards.value = await listReviews({})
  } catch (e) {
    notify(getApiError(e, '加载失败'), 'error')
  } finally {
    loading.value = false
  }
}

async function startReview() {
  lastResult.value = null
  try {
    const noteId = route.query.noteId ? Number(route.query.noteId) : undefined
    const data = await drawReviews(20)
    queue.value = noteId ? data.filter((d) => d.noteId === noteId) : data
    if (queue.value.length === 0) {
      notify('暂时没有到期的卡片', 'info')
      return
    }
    index.value = 0
    revealed.value = false
    current.value = queue.value[0]
    active.value = true
  } catch (e) {
    notify(getApiError(e, '开始失败'), 'error')
  }
}

async function grade(quality: number) {
  try {
    const res = await gradeReview(current.value.id, { quality })
    lastResult.value = res
    Object.assign(current.value, {
      intervalDay: res.intervalDay,
      easeFactorDecimal: res.easeFactor,
      suspended: 0,
    })
    await load()
    setTimeout(() => {
      if (index.value + 1 < queue.value.length) {
        index.value += 1
        current.value = queue.value[index.value]
        revealed.value = false
      } else {
        active.value = false
        notify('本轮复习完成！', 'success')
      }
    }, 900)
  } catch (e) {
    notify(getApiError(e, '评分失败'), 'error')
  }
}

async function suspend(c: WbReviewCardVO) {
  try {
    await toggleReviewSuspend(c.id)
    load()
  } catch (e) {
    notify(getApiError(e, '操作失败'), 'error')
  }
}
async function remove(c: WbReviewCardVO) {
  const ok = await confirmDialog('确认删除该复习卡？')
  if (!ok) return
  try {
    await deleteReview(c.id)
    notify('已删除', 'success')
    load()
  } catch (e) {
    notify(getApiError(e, '删除失败'), 'error')
  }
}
async function saveCard() {
  if (!cardForm.front.trim() || !cardForm.back.trim()) {
    notify('正反面均不能为空', 'warning')
    return
  }
  const noteId = route.query.noteId ? Number(route.query.noteId) : undefined
  try {
    await createReview({ ...cardForm, noteId: noteId as number | undefined })
    notify('已添加，进入今日队列', 'success')
    showCreate.value = false
    Object.assign(cardForm, { front: '', back: '', cardType: 'BASIC' })
    load()
  } catch (e) {
    notify(getApiError(e, '保存失败'), 'error')
  }
}

onMounted(() => {
  load()
  // 从笔记/收集箱「转为复习卡」跳入时带 front/back，直接预填新建表单
  if (route.query.front) cardForm.front = String(route.query.front)
  if (route.query.back) cardForm.back = String(route.query.back)
  if (route.query.front || route.query.back) showCreate.value = true
  // 支持 ?autostart=1 从驾驶舱入口卡片一键进入抽查
  if (route.query.autostart === '1') void startReview()
})
</script>

<style scoped>
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

/* ===== Quiz Card ===== */
.wb-quiz-card {
  position: relative;
  padding: 24px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-card);
}
.wb-quiz-close {
  position: absolute;
  top: 16px; right: 16px;
  width: 30px; height: 30px;
  border-radius: var(--kb-radius-sm);
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.wb-quiz-close:hover { background: var(--kb-muted); color: var(--kb-foreground); }
.wb-quiz-face {
  min-height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 28px 20px;
  border-radius: var(--kb-radius-md);
  background: linear-gradient(135deg, color-mix(in srgb, var(--mc) 5%, var(--kb-background)), var(--kb-background));
  border: 1px dashed var(--kb-border);
  cursor: pointer;
  transition: all 0.2s ease;
}
.wb-quiz-face:hover { border-color: var(--mc); }
.wb-quiz-face.is-revealed {
  background: linear-gradient(135deg, color-mix(in srgb, var(--kb-accent) 6%, var(--kb-background)), var(--kb-background));
  border-color: var(--kb-accent);
  border-style: solid;
}
.wb-quiz-front, .wb-quiz-back {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.wb-quiz-label {
  display: inline-block;
  padding: 2px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--mc) 14%, transparent);
  color: var(--mc);
  font-family: var(--font-mono);
  font-size: var(--kb-fs-xs);
  font-weight: 600;
  letter-spacing: 0.05em;
}
.wb-quiz-label-back {
  background: color-mix(in srgb, var(--kb-accent) 14%, transparent);
  color: var(--kb-accent);
}
.wb-quiz-text {
  font-family: var(--font-serif);
  font-size: 20px;
  font-weight: 600;
  color: var(--kb-foreground);
  line-height: 1.5;
  margin: 0;
  max-width: 560px;
}
.wb-quiz-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.wb-quiz-grade {
  margin-top: 16px;
  text-align: center;
}
.wb-quiz-grade-title {
  font-size: 13px;
  color: var(--kb-muted-foreground);
  margin: 0 0 12px;
}
.wb-quiz-grade-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
/* 四档评分按钮统一走 --kb-* 语义色（原先四个硬编码 hex 已收敛） */
.wb-grade-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 12px 8px;
  border-radius: var(--kb-radius-md);
  border: 1px solid color-mix(in srgb, var(--gc) 35%, transparent);
  background: color-mix(in srgb, var(--gc) 12%, transparent);
  color: var(--gc);
  cursor: pointer;
  transition: all 0.15s ease;
}
.wb-grade-btn:hover { transform: translateY(-2px); filter: brightness(0.96); }
.wb-grade-forgot { --gc: var(--kb-destructive); }
.wb-grade-hard { --gc: var(--kb-warning); }
.wb-grade-normal { --gc: var(--kb-primary); }
.wb-grade-easy { --gc: var(--kb-accent); }
.wb-grade-label {
  font-size: 13px;
  font-weight: 600;
}
.wb-grade-hint {
  font-family: var(--font-mono);
  font-size: var(--kb-fs-xs);
  opacity: 0.7;
}
.wb-quiz-result {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 16px;
  padding: 8px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--kb-accent) 10%, transparent);
  color: var(--kb-accent);
  font-size: 12px;
  font-weight: 600;
}
.wb-quiz-lapsed { color: var(--kb-warning); }

/* ===== Card rows ===== */
.wb-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.wb-card-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wb-card-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  transition: all 0.15s ease;
}
.wb-card-row:hover { border-color: color-mix(in srgb, var(--mc) 30%, var(--kb-border)); }
.wb-card-row-body { flex: 1; min-width: 0; }
.wb-card-row-front {
  font-size: 14px;
  font-weight: 500;
  color: var(--kb-foreground);
  margin: 0 0 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wb-card-row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.wb-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: var(--kb-radius-sm);
  font-size: var(--kb-fs-xs);
  font-weight: 500;
}
.wb-chip-mono {
  font-family: var(--font-mono);
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
}
.wb-chip-muted { background: var(--kb-muted); color: var(--kb-muted-foreground); }
.wb-chip-warn { background: color-mix(in srgb, var(--kb-warning) 14%, transparent); color: var(--kb-warning); }
.wb-card-row-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.wb-empty-sm { padding: 28px; }

@media (max-width: 768px) {
  .wb-quiz-grade-grid { grid-template-columns: repeat(2, 1fr); }
  .wb-quiz-text { font-size: 17px; }
}
</style>
