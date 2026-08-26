<template>
  <div class="mp-tour-mask">
    <!-- ============ 顶部工具条 ============ -->
    <header class="mp-tour-top">
      <button class="kb-btn" @click="$emit('exit', currentIndex)">
        <Icon name="arrow-left" :size="'sm'" /> 退出漫游
      </button>
      <div class="mp-tour-counter">
        <span class="mp-tour-counter-cur">{{ currentIndex + 1 }}</span>
        <span class="mp-tour-counter-sep">/</span>
        <span class="mp-tour-counter-total">{{ sortedLoci.length }}</span>
      </div>
      <div class="mp-tour-meta">
        <span class="mp-tour-meta-name">{{ current?.name }}</span>
        <span v-if="current?.knowledgePoint" class="mp-tour-meta-kp">
          · {{ current.knowledgePoint }}
        </span>
      </div>
    </header>

    <!-- ============ 中央舞台 ============ -->
    <section class="mp-tour-stage">
      <!-- 位点大圆（带脉冲） -->
      <div class="mp-tour-pin-wrap" :key="current?.id">
        <div class="mp-tour-pin-pulse"></div>
        <div class="mp-tour-pin">
          <Icon :name="current?.icon || 'map-pin'" :size="'56px'" />
        </div>
        <div class="mp-tour-pin-num">{{ currentIndex + 1 }}</div>
      </div>

      <!-- 知识卡片 -->
      <transition name="mp-tour-fade">
        <div v-if="current" class="mp-tour-card" :key="current.id">
          <h2 class="mp-tour-title">{{ current.name }}</h2>
          <div v-if="current.knowledgePoint" class="mp-tour-kp">
            <Icon name="book-open" :size="'sm'" />
            <span>{{ current.knowledgePoint }}</span>
          </div>
          <div v-if="current.imageHint" class="mp-tour-hint">
            <Icon name="sparkles" :size="'sm'" />
            <span>联想图像：{{ current.imageHint }}</span>
          </div>
        </div>
      </transition>
    </section>

    <!-- ============ 底部控制条 ============ -->
    <footer class="mp-tour-controls">
      <button class="kb-btn" :disabled="sortedLoci.length === 0" @click="prev">
        <Icon name="skip-back" :size="'sm'" /> 上一步
      </button>

      <button
        class="kb-btn"
        :class="{ 'kb-btn-primary': autoPlay }"
        :disabled="sortedLoci.length === 0"
        @click="toggleAuto"
      >
        <Icon :name="autoPlay ? 'pause' : 'play'" :size="'sm'" />
        {{ autoPlay ? '暂停自动' : '自动循环' }}
      </button>

      <button class="kb-btn" :disabled="sortedLoci.length === 0" @click="next">
        下一步 <Icon name="skip-forward" :size="'sm'" />
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import type { WbPalaceLoci } from '@/api/types'

const props = defineProps<{
  loci: WbPalaceLoci[]
  initialIndex?: number
}>()

defineEmits<{
  (e: 'exit', index: number): void
}>()

const sortedLoci = computed(() => [...props.loci].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)))
const currentIndex = ref(Math.max(0, Math.min(sortedLoci.value.length - 1, props.initialIndex ?? 0)))
const autoPlay = ref(false)
let timer: number | null = null

const current = computed(() => sortedLoci.value[currentIndex.value] || null)

function prev() {
  if (!sortedLoci.value.length) return
  currentIndex.value = (currentIndex.value - 1 + sortedLoci.value.length) % sortedLoci.value.length
}
function next() {
  if (!sortedLoci.value.length) return
  currentIndex.value = (currentIndex.value + 1) % sortedLoci.value.length
}
function toggleAuto() {
  autoPlay.value = !autoPlay.value
  if (autoPlay.value) {
    timer = window.setInterval(() => {
      next()
    }, 3500)
  } else if (timer != null) {
    clearInterval(timer)
    timer = null
  }
}

onBeforeUnmount(() => {
  if (timer != null) clearInterval(timer)
})
</script>

<style scoped>
.mp-tour-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: radial-gradient(ellipse at center, color-mix(in srgb, var(--kb-primary) 8%, var(--kb-background)) 0%, var(--kb-background) 70%);
  backdrop-filter: blur(2px);
}

/* Top bar */
.mp-tour-top {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--kb-border);
  background: color-mix(in srgb, var(--kb-card) 80%, transparent);
}
.mp-tour-counter {
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--kb-muted-foreground);
}
.mp-tour-counter-cur {
  color: var(--kb-primary);
  font-weight: 700;
  font-size: 18px;
  margin-right: 4px;
}
.mp-tour-counter-sep { margin: 0 4px; }
.mp-tour-meta {
  flex: 1;
  font-size: 13px;
  color: var(--kb-muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-tour-meta-name { color: var(--kb-foreground); font-weight: 600; }

/* Stage */
.mp-tour-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 36px;
  padding: 24px;
}
.mp-tour-pin-wrap {
  position: relative;
  width: 160px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mp-tour-pin-pulse {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--kb-primary) 28%, transparent);
  animation: mp-tour-pulse 2.4s ease-out infinite;
}
@keyframes mp-tour-pulse {
  0%   { transform: scale(0.7); opacity: 0.9; }
  70%  { transform: scale(1.2); opacity: 0; }
  100% { transform: scale(1.2); opacity: 0; }
}
.mp-tour-pin {
  position: relative;
  z-index: 1;
  width: 100px; height: 100px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--kb-primary);
  color: #fff;
  box-shadow: 0 12px 32px color-mix(in srgb, var(--kb-primary) 30%, transparent);
}
.mp-tour-pin-num {
  position: absolute;
  bottom: -10px;
  right: -8px;
  width: 36px; height: 36px;
  border-radius: 50%;
  background: var(--kb-card);
  color: var(--kb-primary);
  border: 2px solid var(--kb-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-family: var(--font-mono);
}

/* Card */
.mp-tour-card {
  max-width: 540px;
  width: 100%;
  padding: 24px 24px;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-card);
  text-align: center;
}
.mp-tour-title {
  margin: 0 0 12px;
  font-family: var(--font-serif);
  font-size: 22px;
  font-weight: 700;
  color: var(--kb-foreground);
}
.mp-tour-kp,
.mp-tour-hint {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: var(--kb-radius-sm);
  font-size: 13px;
  line-height: 1.6;
}
.mp-tour-kp {
  background: color-mix(in srgb, var(--kb-primary) 10%, transparent);
  color: var(--kb-primary);
}
.mp-tour-hint {
  background: color-mix(in srgb, var(--kb-highlight) 12%, transparent);
  color: var(--kb-highlight);
}

.mp-tour-fade-enter-active,
.mp-tour-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.mp-tour-fade-enter-from,
.mp-tour-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/* Controls */
.mp-tour-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--kb-border);
  background: color-mix(in srgb, var(--kb-card) 80%, transparent);
}
</style>