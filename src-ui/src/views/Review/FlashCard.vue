<template>
  <!-- 3D 翻转卡：外层 perspective，内层 preserve-3d，按 side 决定 rotateY。
       点击卡片任意处触发 flip（由父级控制 side）。
       飞出动画由父级传入的 fly 状态驱动（困难→左飞 / 轻松·完美→右飞），动画结束后 emit flyEnd。 -->
  <div
    class="fc-perspective"
    :class="flyClass"
    @click="$emit('flip')"
    @animationend="onAnimEnd"
  >
    <div class="fc-inner" :class="{ 'is-back': side === 'back' }">
      <!-- 卡型分类徽章（右上角） -->
      <span v-if="badge" class="fc-badge" :class="badge.cls">{{ badge.text }}</span>

      <!-- 正面：回忆提示（线索 / 位点名） -->
      <div class="fc-face fc-front">
        <span class="fc-tag">{{ card.sourceType === 'note' ? '康奈尔笔记' : '记忆宫殿' }}</span>
        <div class="fc-front-body">
          <Icon name="lightbulb" :size="22" class="fc-front-ic" />
          <p class="fc-front-text">{{ card.front }}</p>
        </div>
        <p class="fc-hint">
          <Icon name="hand" :size="13" /> 点击卡片或按 <kbd>空格</kbd> 看答案
        </p>
      </div>

      <!-- 反面：知识点详情（Markdown 渲染） -->
      <div class="fc-face fc-back">
        <span class="fc-tag fc-tag--ans">答案</span>
        <div class="fc-back-md" v-html="backHtml"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import { renderMarkdown } from '@/lib/markdown';
import type { ReviewCard } from '@/api/review';

const props = defineProps<{
  card: ReviewCard;
  side: 'front' | 'back';
  /** 飞出动画状态：active 触发、dir 决定方向（left/right） */
  fly?: { active: boolean; dir: 'left' | 'right' };
}>();

const emit = defineEmits<{ (e: 'flip'): void; (e: 'flyEnd'): void }>();

const backHtml = computed(() => renderMarkdown(props.card.back || '_（暂无内容）_'));

/** 卡型分类：易忘卡优先 > 新卡 > 复习卡 */
const badge = computed(() => {
  const c = props.card;
  if (c.lapseCount > 2) return { text: '⚠️ 易忘卡', cls: 'fc-badge--risk' };
  if (c.repetitions === 0) return { text: '💡 新卡', cls: 'fc-badge--new' };
  return { text: '🔄 复习卡', cls: 'fc-badge--review' };
});

const flyClass = computed(() => {
  const f = props.fly;
  if (!f || !f.active) return '';
  return f.dir === 'left' ? 'fc-fly-left' : 'fc-fly-right';
});

// 仅飞出动画（fc-fly-*）结束时通知父级执行真正的移除，避免翻转/进入动画误触发
function onAnimEnd(e: AnimationEvent) {
  if (e.animationName === 'fc-fly-out') emit('flyEnd');
}
</script>

<style scoped>
.fc-perspective {
  perspective: 1600px;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  cursor: pointer;
  /* 让点击区域占满可用高度，翻面手感稳 */
  min-height: 320px;
  display: flex;
}
.fc-inner {
  position: relative;
  width: 100%;
  min-height: 320px;
  transform-style: preserve-3d;
  transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
}
.fc-inner.is-back {
  transform: rotateY(180deg);
}
.fc-face {
  position: absolute;
  inset: 0;
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  border-radius: var(--kb-radius-lg);
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
  box-shadow: var(--shadow-lg);
  padding: 28px 30px;
  display: flex;
  flex-direction: column;
}
.fc-front {
  align-items: center;
  justify-content: center;
  text-align: center;
}
.fc-back {
  transform: rotateY(180deg);
  overflow-y: auto;
}
.fc-tag {
  position: absolute;
  top: 16px;
  left: 16px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 3px 9px;
  border-radius: 999px;
  color: var(--kb-primary);
  background: color-mix(in srgb, var(--kb-primary) 12%, transparent);
}
.fc-tag--ans {
  color: var(--kb-highlight);
  background: color-mix(in srgb, var(--kb-highlight) 14%, transparent);
}
/* 卡型分类徽章（右上角） */
.fc-badge {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  white-space: nowrap;
}
.fc-badge--new {
  color: color-mix(in srgb, var(--kb-accent) 85%, black);
  background: color-mix(in srgb, var(--kb-accent) 16%, transparent);
}
.fc-badge--review {
  color: color-mix(in srgb, var(--kb-warning) 85%, black);
  background: color-mix(in srgb, var(--kb-warning) 18%, transparent);
}
.fc-badge--risk {
  color: var(--kb-destructive);
  background: color-mix(in srgb, var(--kb-destructive) 14%, transparent);
}
.fc-front-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  max-width: 90%;
}
.fc-front-ic {
  color: var(--kb-primary);
}
.fc-front-text {
  font-size: clamp(20px, 3.4vw, 28px);
  font-weight: 700;
  line-height: 1.5;
  color: var(--kb-foreground);
  margin: 0;
  word-break: break-word;
}
.fc-hint {
  position: absolute;
  bottom: 16px;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.fc-hint kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid var(--kb-border);
  background: var(--kb-muted);
}

/* 反面 Markdown 轻量排版（不套全局 .prose，避免 white-space 撑破布局） */
.fc-back-md {
  font-size: 15px;
  line-height: 1.7;
  color: var(--kb-foreground);
}
.fc-back-md :deep(h1),
.fc-back-md :deep(h2),
.fc-back-md :deep(h3),
.fc-back-md :deep(h4) {
  font-weight: 700;
  line-height: 1.35;
  margin: 0.8em 0 0.4em;
  color: var(--kb-foreground);
}
.fc-back-md :deep(h1) { font-size: 20px; }
.fc-back-md :deep(h2) { font-size: 18px; }
.fc-back-md :deep(h3) { font-size: 16px; }
.fc-back-md :deep(p) { margin: 0.5em 0; }
.fc-back-md :deep(ul),
.fc-back-md :deep(ol) { padding-left: 1.3em; margin: 0.5em 0; }
.fc-back-md :deep(li) { margin: 0.25em 0; }
.fc-back-md :deep(a) { color: var(--kb-primary); }
.fc-back-md :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.88em;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--kb-muted);
  color: var(--kb-foreground);
}
.fc-back-md :deep(pre) {
  background: #1a1d23;
  border-radius: 10px;
  padding: 12px 14px;
  overflow-x: auto;
  margin: 0.6em 0;
}
.fc-back-md :deep(pre code) {
  background: transparent;
  padding: 0;
  color: #e6e6e6;
}
.fc-back-md :deep(blockquote) {
  border-left: 3px solid var(--kb-primary);
  margin: 0.6em 0;
  padding-left: 12px;
  color: var(--kb-muted-foreground);
}
.fc-back-md :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.6em 0;
}
.fc-back-md :deep(th),
.fc-back-md :deep(td) {
  border: 1px solid var(--kb-border);
  padding: 6px 10px;
  font-size: 13px;
}
.fc-back-md :deep(img) {
  max-width: 100%;
  border-radius: 8px;
}

/* 飞出动画：困难→向左旋转飞出；轻松/完美→向右旋转飞出。
   仅改 transform/opacity，不触碰 v-show 与队列索引，下一张由父级 splice 后自然补位。 */
.fc-fly-left {
  animation: fc-fly-out 0.42s cubic-bezier(0.55, 0, 0.55, 0.2) forwards;
  transform-origin: center;
}
.fc-fly-right {
  animation: fc-fly-out 0.42s cubic-bezier(0.55, 0, 0.55, 0.2) forwards;
  transform-origin: center;
}
@keyframes fc-fly-out {
  0% {
    opacity: 1;
    transform: translateX(0) rotate(0deg);
  }
  60% {
    opacity: 0.85;
  }
  100% {
    opacity: 0;
    transform: translateX(var(--fc-fly-x, 130%)) rotate(var(--fc-fly-rot, 22deg));
  }
}
/* translateX 用百分比 → 相对卡片自身宽度，任何屏宽都能完整飞出视口 */
.fc-fly-left {
  --fc-fly-x: -130%;
  --fc-fly-rot: -22deg;
}
.fc-fly-right {
  --fc-fly-x: 130%;
  --fc-fly-rot: 22deg;
}
</style>
