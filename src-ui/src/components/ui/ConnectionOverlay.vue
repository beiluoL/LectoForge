<template>
  <transition name="conn-fade">
    <div
      v-if="connectionState.status === 'reconnecting'"
      class="conn-mask"
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
    >
      <div class="conn-card">
        <div class="conn-spinner" aria-hidden="true">
          <Icon name="loader-2" :size="28" />
        </div>

        <h3 class="conn-title">知识引擎断连，正在尝试重连…</h3>
        <p class="conn-desc">
          本地服务可能正在重启，数据不会丢失。恢复后会自动继续刚才的操作。
        </p>

        <div class="conn-meta">
          <span>第 {{ connectionState.attempt }} 次尝试</span>
          <span class="conn-dot" aria-hidden="true">·</span>
          <span>已断开 {{ offlineSeconds }} 秒</span>
        </div>

        <!-- 前几次静默等待即可；久不恢复才给用户干预入口，避免一断线就吓人 -->
        <div v-if="connectionState.attempt >= 4" class="conn-actions">
          <button type="button" class="kb-btn kb-btn-sm" @click="retryNow">
            <Icon name="refresh-cw" :size="14" />
            立即重试
          </button>
          <button type="button" class="kb-btn kb-btn-sm kb-btn-primary" @click="onRestart">
            <Icon name="zap" :size="14" />
            重启知识引擎
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
/**
 * 全局断线遮罩：由 api/request.ts 的响应拦截器间接驱动
 * （拦截器捕获网络错误 → connection.ts 置为 reconnecting → 本组件显形）。
 * 恢复后自动隐藏，并给一条成功提示，用户无需任何操作。
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import { connectionState, restartEngine, retryNow } from '@/utils/connection';
import { notify } from '@/utils/toast';

const now = ref(Date.now());
let ticker: number | null = null;

const offlineSeconds = computed(() => {
  if (!connectionState.offlineSince) return 0;
  return Math.max(0, Math.round((now.value - connectionState.offlineSince) / 1000));
});

watch(
  () => connectionState.status,
  (status, prev) => {
    if (status === 'reconnecting') {
      now.value = Date.now();
      ticker = window.setInterval(() => {
        now.value = Date.now();
      }, 1000);
      return;
    }
    if (ticker) {
      window.clearInterval(ticker);
      ticker = null;
    }
    // 只有真正经历过断线才提示，首次进入应用不打扰
    if (prev === 'reconnecting') {
      notify(
        connectionState.backendRestarted ? '知识引擎已重启并恢复连接' : '已重新连接到知识引擎',
        'success',
      );
    }
  },
);

async function onRestart() {
  await restartEngine();
}

onUnmounted(() => {
  if (ticker) window.clearInterval(ticker);
});
</script>

<style scoped>
.conn-mask {
  position: fixed;
  inset: 0;
  z-index: 90; /* 高于 toast(50) 与 confirm(60)：断线时任何交互都无意义 */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.32);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

.conn-card {
  width: 100%;
  max-width: 380px;
  padding: 28px 24px 24px;
  text-align: center;
  background: var(--kb-card);
  color: var(--kb-card-foreground);
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-lg);
  box-shadow: var(--shadow-lg);
}

.conn-spinner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin-bottom: 14px;
  color: var(--kb-primary);
  border-radius: 50%;
  background: color-mix(in srgb, var(--kb-primary) 10%, transparent);
  animation: conn-spin 1s linear infinite;
}

@keyframes conn-spin {
  to {
    transform: rotate(360deg);
  }
}

.conn-title {
  margin: 0 0 8px;
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--kb-foreground);
}

.conn-desc {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--kb-muted-foreground);
}

.conn-meta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--kb-muted-foreground);
}

.conn-dot {
  opacity: 0.6;
}

.conn-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 18px;
}

.conn-fade-enter-active,
.conn-fade-leave-active {
  transition: opacity 0.18s ease;
}

.conn-fade-enter-from,
.conn-fade-leave-to {
  opacity: 0;
}

/* 尊重系统「减少动态效果」设置 */
@media (prefers-reduced-motion: reduce) {
  .conn-spinner {
    animation: none;
  }
}
</style>
