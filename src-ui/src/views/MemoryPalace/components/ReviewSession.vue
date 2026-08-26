<template>
  <div class="mp-review">
    <!-- ============ Header / Mode Switch ============ -->
    <header class="mp-review-head">
      <button class="kb-btn" @click="$emit('exit')">
        <Icon name="arrow-left" :size="'sm'" /> 返回编辑
      </button>

      <div class="mp-review-tabs">
        <button
          class="mp-review-tab"
          :class="{ 'is-active': mode === 'sequential' }"
          @click="switchMode('sequential')"
        >
          <Icon name="list-ordered" :size="'sm'" /> 顺序回忆
        </button>
        <button
          class="mp-review-tab"
          :class="{ 'is-active': mode === 'reverse' }"
          @click="switchMode('reverse')"
        >
          <Icon name="rotate-ccw" :size="'sm'" /> 反向回忆
        </button>
      </div>

      <div class="mp-review-progress">
        <span class="mp-review-counter">{{ progress.current + 1 }} / {{ progress.total }}</span>
        <span class="mp-review-progress-bar"><span :style="{ width: progress.pct + '%' }"></span></span>
      </div>
    </header>

    <!-- ============ Empty ============ -->
    <div v-if="loci.length === 0" class="mp-review-empty">
      <Icon name="inbox" :size="'40px'" />
      <p>当前宫殿还没有位点，无法复习。</p>
    </div>

    <!-- ============ Question Card ============ -->
    <section v-else-if="current" class="mp-review-card">
      <div class="mp-review-question">
        <span class="mp-review-q-label">{{ mode === 'sequential' ? '顺序回忆' : '反向回忆' }}</span>

        <!-- 顺序回忆：只显示位置编号 -->
        <template v-if="mode === 'sequential'">
          <p class="mp-review-q-prompt">
            位置 <span class="mp-review-q-num">{{ current.index + 1 }}</span>（{{ current.loci.name }}）绑定的知识是什么？
          </p>
          <p class="mp-review-q-hint">在心中默念答案，再点揭晓。</p>
        </template>

        <!-- 反向回忆：显示知识点 -->
        <template v-else>
          <p class="mp-review-q-prompt">
            <span class="mp-review-q-kp">{{ current.loci.knowledgePoint || '（空）' }}</span>
            <br />
            这个知识点挂在哪个位点？
          </p>
          <p class="mp-review-q-hint">在心中默念位点名，再点揭晓。</p>
        </template>

        <button v-if="!revealed" class="kb-btn kb-btn-primary mp-review-reveal" @click="revealed = true">
          <Icon name="eye" :size="'sm'" /> 揭晓答案
        </button>
      </div>

      <!-- 揭晓后 -->
      <div v-if="revealed" class="mp-review-answer">
        <div class="mp-review-answer-grid">
          <div>
            <span class="mp-review-a-label">位点名</span>
            <p class="mp-review-a-text">{{ current.loci.name }}</p>
          </div>
          <div>
            <span class="mp-review-a-label">知识点</span>
            <p class="mp-review-a-text">{{ current.loci.knowledgePoint || '（空）' }}</p>
          </div>
          <div class="mp-review-answer-hint-col">
            <span class="mp-review-a-label">联想图像</span>
            <p class="mp-review-a-hint">{{ current.loci.imageHint || '（空）' }}</p>
          </div>
        </div>

        <p class="mp-review-grade-title">你记得多少？</p>
        <div class="mp-review-grade-grid">
          <button class="mp-review-grade-btn" style="--gc: var(--kb-destructive)" :disabled="grading" @click="grade(0)">
            <Icon name="x-circle" size="md" />
            <span class="mp-review-grade-label">忘了</span>
            <span class="mp-review-grade-hint">重置熟练度</span>
          </button>
          <button class="mp-review-grade-btn" style="--gc: var(--kb-warning)" :disabled="grading" @click="grade(2)">
            <Icon name="thumbs-down" size="md" />
            <span class="mp-review-grade-label">模糊</span>
            <span class="mp-review-grade-hint">熟练度 +0</span>
          </button>
          <button class="mp-review-grade-btn" style="--gc: var(--kb-accent)" :disabled="grading" @click="grade(4)">
            <Icon name="thumbs-up" size="md" />
            <span class="mp-review-grade-label">记住</span>
            <span class="mp-review-grade-hint">熟练度 +1</span>
          </button>
        </div>
      </div>
    </section>

    <!-- ============ 完成 ============ -->
    <div v-else-if="finished" class="mp-review-finished">
      <Icon name="trophy" :size="'48px'" />
      <h3>本轮复习完成</h3>
      <p>共复习 {{ progress.total }} 个位点，已记录熟练度。</p>
      <button class="kb-btn kb-btn-primary" @click="restart">
        <Icon name="rotate-ccw" :size="'sm'" /> 再来一轮
      </button>
      <button class="kb-btn" @click="$emit('exit')">返回</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import type { WbPalaceLoci } from '@/api/types'

const props = defineProps<{
  loci: WbPalaceLoci[]
  /** 父组件传入的熟练度 map，用于回显本次复习结果 */
  masterLevels?: Record<number, number>
}>()

const emit = defineEmits<{
  (e: 'exit'): void
  /** 用户完成一题后的事件；父组件把熟练度持久化到 store / 后端 */
  (e: 'grade', lociId: number, level: number): void
}>()

type Mode = 'sequential' | 'reverse'
const mode = ref<Mode>('sequential')
const queue = ref<WbPalaceLoci[]>([])
const index = ref(0)
const revealed = ref(false)
/** 评分提交忙锁：防止同一题连点重复提交 */
const grading = ref(false)
const finished = computed(() => !current.value && queue.value.length > 0 && index.value >= queue.value.length)

const sortedLoci = computed(() => [...props.loci].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)))

interface CurrentItem {
  loci: WbPalaceLoci
  index: number
}

const current = computed<CurrentItem | null>(() => {
  const loci = queue.value[index.value]
  if (!loci) return null
  return { loci, index: index.value }
})

const progress = computed(() => {
  const total = queue.value.length || 0
  const done = Math.min(index.value, total)
  return {
    current: done,
    total,
    pct: total > 0 ? Math.round((done / total) * 100) : 0,
  }
})

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function buildQueue() {
  queue.value = shuffle(sortedLoci.value)
  index.value = 0
  revealed.value = false
}

function switchMode(m: Mode) {
  if (m === mode.value) return
  mode.value = m
  buildQueue()
}

function grade(targetLevel: number) {
  if (!current.value || grading.value) return
  grading.value = true
  emit('grade', current.value.loci.id, targetLevel)
  // 前进到下一题
  if (index.value + 1 < queue.value.length) {
    index.value += 1
    revealed.value = false
  } else {
    index.value = queue.value.length // 触发 finished
  }
  // 下一题渲染后解锁（同题重复提交由 current.value 变化 + 短暂锁双重防护）
  requestAnimationFrame(() => {
    grading.value = false
  })
}

function restart() {
  buildQueue()
}

watch(
  () => props.loci,
  () => buildQueue(),
  { immediate: true },
)
</script>

<style scoped>
.mp-review {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  min-height: 480px;
}
.mp-review-head {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.mp-review-tabs {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
}
.mp-review-tab {
  padding: 8px 16px;
  border-radius: var(--kb-radius-sm);
  background: transparent;
  color: var(--kb-muted-foreground);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.mp-review-tab.is-active {
  background: var(--kb-primary);
  color: #fff;
}
.mp-review-progress {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 160px;
}
.mp-review-counter {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--kb-muted-foreground);
  white-space: nowrap;
}
.mp-review-progress-bar {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--kb-muted);
  overflow: hidden;
}
.mp-review-progress-bar > span {
  display: block;
  height: 100%;
  background: var(--kb-primary);
  transition: width 0.3s ease;
}

.mp-review-empty,
.mp-review-finished {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 24px;
  color: var(--kb-muted-foreground);
}
.mp-review-finished h3 {
  font-family: var(--font-serif);
  font-size: 22px;
  color: var(--kb-foreground);
  margin: 4px 0 0;
}
.mp-review-card {
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-lg);
  padding: 28px;
}
.mp-review-question {
  text-align: center;
}
.mp-review-q-label {
  display: inline-block;
  padding: 2px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
  color: var(--kb-primary);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
}
.mp-review-q-prompt {
  font-family: var(--font-serif);
  font-size: 22px;
  line-height: 1.55;
  color: var(--kb-foreground);
  margin: 16px 0 8px;
  font-weight: 600;
}
.mp-review-q-num {
  color: var(--kb-primary);
  font-weight: 700;
  font-size: 28px;
}
.mp-review-q-kp {
  color: var(--kb-primary);
}
.mp-review-q-hint {
  color: var(--kb-muted-foreground);
  font-size: 12px;
  margin: 0 0 16px;
}
.mp-review-reveal {
  margin-top: 8px;
}

.mp-review-answer {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px dashed var(--kb-border);
}
.mp-review-answer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
  margin-bottom: 16px;
}
.mp-review-answer-hint-col {
  grid-column: 1 / -1;
}
.mp-review-a-label {
  display: block;
  font-size: 11px;
  color: var(--kb-muted-foreground);
  font-family: var(--font-mono);
  margin-bottom: 4px;
  letter-spacing: 0.05em;
}
.mp-review-a-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--kb-foreground);
  margin: 0;
  font-family: var(--font-serif);
}
.mp-review-a-hint {
  font-size: 13px;
  color: var(--kb-highlight);
  background: color-mix(in srgb, var(--kb-highlight) 8%, transparent);
  padding: 12px 16px;
  border-radius: var(--kb-radius-sm);
  margin: 0;
}
.mp-review-grade-title {
  font-size: 13px;
  color: var(--kb-muted-foreground);
  text-align: center;
  margin: 4px 0 12px;
}
.mp-review-grade-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.mp-review-grade-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 16px 8px;
  border-radius: var(--kb-radius-md);
  background: color-mix(in srgb, var(--gc) 12%, transparent);
  color: var(--gc);
  border: 1px solid color-mix(in srgb, var(--gc) 35%, transparent);
  cursor: pointer;
  transition: all 0.15s ease;
}
.mp-review-grade-btn:hover {
  transform: translateY(-2px);
  filter: brightness(0.96);
}
.mp-review-grade-btn:disabled {
  opacity: 0.55;
  cursor: default;
  transform: none;
  filter: none;
}
.mp-review-grade-label {
  font-size: 14px;
  font-weight: 600;
}
.mp-review-grade-hint {
  font-family: var(--font-mono);
  font-size: var(--kb-fs-xs);
  opacity: 0.7;
}

@media (max-width: 768px) {
  .mp-review-answer-grid { grid-template-columns: 1fr; }
  .mp-review-grade-grid { grid-template-columns: 1fr; }
}
</style>
