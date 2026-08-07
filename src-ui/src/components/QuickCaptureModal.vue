<template>
  <!-- 全局速记弹窗：挂到 body，任意页面 Ctrl/⌘ + Shift + I 都能唤起 -->
  <Teleport to="body">
    <Transition name="qcm">
      <div v-if="open" class="qcm-overlay" @click.self="close">
        <div class="qcm-card" role="dialog" aria-modal="true" aria-label="快速收集">
          <header class="qcm-head">
            <span class="qcm-title">
              <Icon name="inbox" :size="16" />
              快速收集
            </span>
            <span class="qcm-hint">先积累，再沉淀</span>
            <button class="qcm-close" title="关闭 (Esc)" @click="close">
              <Icon name="x" :size="15" />
            </button>
          </header>

          <div class="qcm-body">
            <!-- key 强制每次打开都重建，清空上次残留的输入与剪藏预览 -->
            <QuickCapture
              :key="sessionKey"
              autofocus
              placeholder="记下这一刻的念头，或粘贴网址自动剪藏…"
              @created="onCreated"
            />
          </div>

          <footer class="qcm-foot">
            <span class="qcm-kbd-tip">
              <kbd>⌘/Ctrl</kbd> + <kbd>Enter</kbd> 收集 · <kbd>Esc</kbd> 关闭
            </span>
            <router-link v-if="route.path !== '/inbox'" to="/inbox" class="qcm-link" @click="close">
              打开收集箱
              <Icon name="arrow-right" :size="12" />
            </router-link>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 全局速记弹窗（Ctrl/⌘ + Shift + I）。
 *
 * 收集箱的核心价值是「想到就记下」，所以入口不能只在 /inbox 页面内。
 * 这里复用 QuickCapture 组件本体，只额外套一层遮罩 + 键位提示，
 * 保证弹窗里的剪藏、标签、提交行为与页面内完全一致。
 */
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import Icon from '@/components/ui/Icon.vue';
import QuickCapture from '@/views/Inbox/components/QuickCapture.vue';
import { useInboxStore } from '@/stores/inboxStore';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>();

const route = useRoute();
const store = useInboxStore();

/** 每次打开自增，用作 QuickCapture 的 key 以重置其内部状态 */
const sessionKey = ref(0);

watch(
  () => props.open,
  (v) => {
    if (v) sessionKey.value += 1;
  },
);

function close() {
  emit('update:open', false);
}

/**
 * 收集成功后自动关闭，让用户回到原来的事情上——这正是「极速输入」的意义。
 * 若当前不在收集箱页，store 里的列表其实是空的（没 load 过），
 * 下次进 /inbox 会重新拉取，所以这里无需额外同步。
 */
function onCreated() {
  if (route.path !== '/inbox') store.items = [];
  close();
}
</script>

<style scoped>
.qcm-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 16vh;
  background: rgba(15, 18, 24, 0.45);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.qcm-card {
  width: 620px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  border-radius: var(--kb-radius-lg);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.qcm-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--kb-border);
}
.qcm-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-serif);
  font-size: var(--kb-fs-body-md);
  font-weight: 700;
  color: var(--kb-foreground);
}
.qcm-hint {
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
}
.qcm-close {
  margin-left: auto;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--kb-radius-sm);
  background: transparent;
  color: var(--kb-muted-foreground);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.qcm-close:hover {
  background: var(--kb-muted);
  color: var(--kb-foreground);
}

.qcm-body {
  padding: 14px;
}

.qcm-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 14px;
  border-top: 1px solid var(--kb-border);
  background: var(--kb-background);
}
.qcm-kbd-tip {
  font-size: var(--kb-fs-xs);
  color: var(--kb-muted-foreground);
}
.qcm-kbd-tip kbd {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--kb-border);
  background: var(--kb-card);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--kb-foreground);
}
.qcm-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--kb-fs-xs);
  font-weight: 600;
  color: var(--kb-primary);
  text-decoration: none;
}
.qcm-link:hover {
  text-decoration: underline;
}

/* 入场/出场：与命令面板同款节奏，保持全局弹层观感一致 */
.qcm-enter-active,
.qcm-leave-active {
  transition: opacity 0.18s ease;
}
.qcm-enter-active .qcm-card,
.qcm-leave-active .qcm-card {
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}
.qcm-enter-from,
.qcm-leave-to {
  opacity: 0;
}
.qcm-enter-from .qcm-card,
.qcm-leave-to .qcm-card {
  transform: scale(0.96);
  opacity: 0;
}
</style>
