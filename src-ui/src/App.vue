<template>
  <!-- 与 Web 端 CLayout（route.meta.layout === 'c'）结构一致：
       顶部 56px 固定导航 + pt-14 内容区；工作台页为 fullscreen，取消 max-w-7xl 居中限制。 -->
  <div class="kb-app-shell min-h-screen" :style="{ background: 'var(--kb-background)' }">
    <DesktopTopNav v-if="!route.meta.standalone" />
    <main :class="route.meta.standalone ? '' : 'pt-14'" class="kb-region-content">
      <!-- 独立全屏页（onboarding / settings）：不套 max-w-7xl 居中框，直接铺满 -->
      <template v-if="route.meta.standalone">
        <router-view v-slot="{ Component }">
          <component :is="Component" :key="route.path" />
        </router-view>
      </template>
      <template v-else-if="route.meta.fullscreen">
        <div class="w-full px-4 sm:px-6 py-6">
          <router-view v-slot="{ Component }">
            <component :is="Component" :key="route.path" />
          </router-view>
        </div>
      </template>
      <div v-else class="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <router-view v-slot="{ Component }">
          <component :is="Component" :key="route.path" />
        </router-view>
      </div>
    </main>
  </div>
  <ToastHost />
  <!-- 侧车断线遮罩：宿主重启后端期间挂起界面，恢复后自动隐藏并重放失败请求 -->
  <ConnectionOverlay />
  <!-- 全局命令面板（Cmd/Ctrl+K）：始终挂载，由 store.isOpen 控制显隐 -->
  <CommandPalette />
  <!-- 全局速记弹窗（Cmd/Ctrl+Shift+I）：任意页面「想到就记下」，不必先跳收集箱；开关收敛到收集箱 store -->
  <QuickCaptureModal v-model:open="quickOpen" />
  <!-- 极速新建笔记（Cmd/Ctrl+Shift+F）：始终挂载，由 noteStore.quickCreateOpen 控制显隐 -->
  <QuickCreateNote />
</template>

<script setup lang="ts">
// 桌面端应用根组件：等价于 Web 端 App.vue + CLayout 的组合（去掉登录态恢复与番茄钟等 Web 专属逻辑）。
import { onMounted, onUnmounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import DesktopTopNav from '@/components/layout/DesktopTopNav.vue';
import ToastHost from '@/components/ui/ToastHost.vue';
import ConnectionOverlay from '@/components/ui/ConnectionOverlay.vue';
import CommandPalette from '@/components/CommandPalette.vue';
import QuickCaptureModal from '@/components/QuickCaptureModal.vue';
import QuickCreateNote from '@/components/QuickCreateNote.vue';
import { useSearchStore } from '@/stores/searchStore';
import { useInboxStore } from '@/stores/inboxStore';
import { useNoteStore } from '@/store/noteStore';
import { initBackendHealth } from '@/utils/connection';

const route = useRoute();
const router = useRouter();
const searchStore = useSearchStore();
const inboxStore = useInboxStore();
const noteStore = useNoteStore();
/** 全局速记弹窗开关（Cmd/Ctrl+Shift+I）—— 收敛到收集箱 store，与页面内状态同源 */
const { quickOpen } = storeToRefs(inboxStore);

/** 三个全局弹层互斥：新开一个就把其余的收起来，避免遮罩叠遮罩 */
function closeAllOverlays() {
  inboxStore.closeQuickCapture();
  searchStore.closePalette();
  noteStore.closeQuickCreate();
}

// 全局快捷键：Cmd/Ctrl+K 命令面板，Cmd/Ctrl+Shift+I 速记，Cmd/Ctrl+Shift+F 极速新建笔记，Esc 关闭。
// 不论在哪个页面（含 standalone 全屏页），keydown 都挂在 window 上，始终可用。
function handleKeydown(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey;

  // 带 Shift 的组合要先于命令面板判断：Shift 会让 e.key 在部分布局下变大写，统一转小写比较
  if (mod && e.shiftKey && e.key.toLowerCase() === 'i') {
    e.preventDefault(); // 阻止 Chromium 系把 Ctrl+Shift+I 吃掉去开 DevTools
    const next = !inboxStore.quickOpen;
    closeAllOverlays();
    if (next) inboxStore.openQuickCapture();
    return;
  }

  // 极速新建笔记：Cmd/Ctrl+Shift+F（F = File/新笔记），与浏览器查找 Cmd+F 不冲突
  if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    const next = !noteStore.quickCreateOpen;
    closeAllOverlays();
    if (next) noteStore.openQuickCreate();
    return;
  }

  if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') {
    e.preventDefault(); // 阻止浏览器把焦点跳到地址栏
    if (searchStore.isOpen) searchStore.closePalette();
    else {
      closeAllOverlays();
      searchStore.openPalette();
    }
    return;
  }

  if (e.key === 'Escape') closeAllOverlays();
}

// 启动即探测一次后端健康，建立 bootId 基线（用于后续识别侧车是否被宿主重启过）。
onMounted(() => {
  void initBackendHealth();
  window.addEventListener('keydown', handleKeydown);
  // 原生菜单项（去学习复习 / 番茄钟）点击后由 Rust 侧 emit("navigate", path)，
  // 此处统一接管路由跳转；浏览器预览态下 @tauri-apps/api 不存在，静默跳过。
  void (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      await listen('navigate', (e: { payload: unknown }) => {
        if (typeof e.payload === 'string') router.push(e.payload);
      });
    } catch {
      /* 非桌面宿主，忽略 */
    }
  })();
});
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>
