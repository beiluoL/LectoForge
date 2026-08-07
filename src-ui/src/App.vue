<template>
  <!-- 与 Web 端 CLayout（route.meta.layout === 'c'）结构一致：
       顶部 56px 固定导航 + pt-14 内容区；工作台页为 fullscreen，取消 max-w-7xl 居中限制。 -->
  <div class="min-h-screen" :style="{ background: 'var(--kb-background)' }">
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
</template>

<script setup lang="ts">
// 桌面端应用根组件：等价于 Web 端 App.vue + CLayout 的组合（去掉登录态恢复与番茄钟等 Web 专属逻辑）。
import { onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import DesktopTopNav from '@/components/layout/DesktopTopNav.vue';
import ToastHost from '@/components/ui/ToastHost.vue';
import ConnectionOverlay from '@/components/ui/ConnectionOverlay.vue';
import CommandPalette from '@/components/CommandPalette.vue';
import { useSearchStore } from '@/stores/searchStore';
import { initBackendHealth } from '@/utils/connection';

const route = useRoute();
const searchStore = useSearchStore();

// 全局快捷键：Cmd/Ctrl+K 切换命令面板，Esc 关闭。
// 不论在哪个页面（含 standalone 全屏页），keydown 都挂在 window 上，始终可用。
function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault(); // 阻止浏览器把焦点跳到地址栏
    if (searchStore.isOpen) searchStore.closePalette();
    else searchStore.openPalette();
  }
  if (e.key === 'Escape' && searchStore.isOpen) {
    searchStore.closePalette();
  }
}

// 启动即探测一次后端健康，建立 bootId 基线（用于后续识别侧车是否被宿主重启过）。
onMounted(() => {
  void initBackendHealth();
  window.addEventListener('keydown', handleKeydown);
});
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>
