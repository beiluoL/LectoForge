<template>
  <!-- 与 Web 端 CLayout（route.meta.layout === 'c'）结构一致：
       顶部 56px 固定导航 + pt-14 内容区；工作台页为 fullscreen，取消 max-w-7xl 居中限制。
       番茄钟已回归顶栏内嵌胶囊（TimerCapsule），不再有 pomodoro_popup 透明弹窗窗口。 -->
  <!-- min-h-screen + 不透明底色：窗口开了 transparent:true，外壳必须自己兜住整屏背景，
       否则内容不足一屏时下半截会直接透出桌面。 -->
  <!-- rounded-[14px] + clip-path：无边框 + transparent 窗口下，Web 视图本身是矩形、内容会顶出直角；
       给外壳加 14px 圆角（接近 macOS 原生应用的圆润度），圆角外的区域透出窗口背后的桌面/底色。
       ⚠️        用 clip-path: inset(0 round 14px) 而非 overflow-hidden：border-radius 本身不裁剪后代溢出，
       滚到内部列表底部时滚动条/内容会戳穿圆角出现「直角漏底」；clip-path 会裁剪整棵子树（含滚动条）
       到圆角形，从根上消除漏边。关键：clip-path 不像 overflow:hidden 那样建立滚动容器，
       不会令设置页 lf-backbar（position:sticky）失效，也不像 mask-image 把整页淡成透明（vignette）。 -->
  <!-- h-screen + flex flex-col：窗口固定视口高度，不再随内容长高（这是消除全局滚动条的关键）。
       滚动统一收口到下方各内容容器自身的 overflow-y-auto。 -->
  <div
    class="kb-app-shell flex flex-col h-screen rounded-[14px]"
    :style="{ background: 'var(--kb-background)', clipPath: 'inset(0 round 14px)' }"
  >
    <DesktopTopNav v-if="!route.meta.standalone" />
    <!-- standalone 页（/onboarding、/settings）刻意不挂顶栏，但窗口已是无边框：
         没有这条兜底拖拽条，用户在这两个页面既拖不动窗口也关不掉窗口（只剩系统菜单栏可用）。
         高度 40px，下方 main 用 pt-10 让位，不会遮挡页面内容。 -->
    <div
      v-else
      data-tauri-drag-region="deep"
      class="lf-standalone-titlebar fixed inset-x-0 top-0 z-50 flex h-10 w-full items-center pl-5 rounded-t-[14px]"
    >
      <WindowControls />
    </div>
    <!-- fill 路由（仅任务清单 /tasks）：fixed 钉满顶栏下方，撑满高度、内部自管滚动，
         消除透明窗口底部间隙；fixed 脱离文档流，完全不影响其他页面的原生滚动 -->
    <main v-if="route.meta.fill" class="relative">
      <div class="fixed top-14 left-0 right-0 bottom-0 overflow-hidden rounded-b-[14px]">
        <router-view v-slot="{ Component }">
          <component :is="Component" :key="route.path" />
        </router-view>
      </div>
    </main>
    <!-- flex-1 min-h-0：在 flex 列布局下占满顶栏之外的剩余高度，且允许被内容容器压缩，
         让内部 overflow-y-auto 容器拿到确定高度（h-full 才能解析），从而把滚动限制在内容区内。 -->
    <main v-else class="flex-1 min-h-0" :class="mainClass">
      <template v-if="route.meta.standalone">
        <!-- standalone 页（/settings、/onboarding）此前直接挂在 main 下、靠文档滚动；
             改为固定高度内部滚动，设置页 lf-backbar 的 sticky 仍相对此容器生效。 -->
        <div class="h-full overflow-y-auto">
          <router-view v-slot="{ Component }">
            <component :is="Component" :key="route.path" />
          </router-view>
        </div>
      </template>
      <!-- fullscreen（除 /tasks）：铺满宽度、不居中；滚动收口到本容器的 overflow-y-auto，
           不再让整个窗口滚动（全局滚动条的另一个根因）。 -->
      <div v-else-if="route.meta.fullscreen" class="h-full w-full overflow-y-auto px-4 sm:px-6 py-6">
        <router-view v-slot="{ Component }">
          <component :is="Component" :key="route.path" />
        </router-view>
      </div>
      <div v-else class="h-full max-w-7xl mx-auto overflow-y-auto px-4 sm:px-6 py-6">
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
import { onMounted, onUnmounted, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import DesktopTopNav from '@/components/layout/DesktopTopNav.vue';
// 无边框窗口的自绘红黄绿：standalone 页没有顶栏，需要单独摆一组，否则窗口关不掉
import WindowControls from '@/components/layout/WindowControls.vue';
import ToastHost from '@/components/ui/ToastHost.vue';
import ConnectionOverlay from '@/components/ui/ConnectionOverlay.vue';
import CommandPalette from '@/components/CommandPalette.vue';
import QuickCaptureModal from '@/components/QuickCaptureModal.vue';
import QuickCreateNote from '@/components/QuickCreateNote.vue';
import { useSearchStore } from '@/store/search-store';
import { useInboxStore } from '@/store/inbox-store';
import { useNoteStore } from '@/store/note-store';
import { usePomodoroStore } from '@/store/pomodoro-store';
import { initBackendHealth } from '@/utils/connection';
// 顶层静态导入 Tauri API：避免 build 模式下从静态 dist（由 8787 侧车托管）动态加载
// @tauri-apps/api/* 的 chunk 时静默失败（被 catch 吞），导致原生菜单跳转、深链监听失效。
// dev 模式走 Vite dev server 不受影响；build 模式必须用静态导入才稳（pomodoroStore 已验证此路）。
import { listen } from '@tauri-apps/api/event';
// 顶层静态导入 invoke：build 模式页面由 8787 侧车静态托管，动态 import 的 chunk 会静默失败
// （与上面 listen 同理）。深链冷启动兜底需要从 Rust 取一次待消费剪藏，必须走静态导入。
import { invoke } from '@tauri-apps/api/core';

const route = useRoute();
const router = useRouter();
const searchStore = useSearchStore();
const inboxStore = useInboxStore();
const noteStore = useNoteStore();
/** 全局速记弹窗开关（Cmd/Ctrl+Shift+I）—— 收敛到收集箱 store，与页面内状态同源 */
const { quickOpen } = storeToRefs(inboxStore);

/**
 * 内容区上边距。
 *
 * ⚠️ `pt-14` 不能删：顶栏是 `fixed` 定位、脱离文档流，这 56px 是给它让出的位置，
 * 与「消除窗口留白间隙」是两码事——删掉只会让首屏内容被顶栏盖住。
 *
 * standalone 页（引导 / 设置）虽无顶栏，但无边框窗口下补了一条 40px 拖拽条，
 * 故改为 `pt-10`；`lf-standalone-main` 供 style.css 下沉页内 sticky 元素（如设置页返回条）。
 */
const mainClass = computed(() =>
  route.meta.standalone ? 'lf-standalone-main pt-10' : 'pt-14',
);

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
      await listen('navigate', (e: { payload: unknown }) => {
        if (typeof e.payload === 'string') router.push(e.payload);
      });
    } catch {
      /* 非桌面宿主，忽略 */
    }
  })();

  // 浏览器剪藏深链：外部以 lectoforge://capture?url=&title=&text= 拉起应用时，
  // Rust 侧解析后 emit("deep-link", payload)。此处唤起全局速记弹窗并预填剪藏内容。
  void (async () => {
    try {
      await listen(
        'deep-link',
        (e: { payload: { title?: string; content?: string; sourceUrl?: string } }) => {
          const p = e.payload;
          inboxStore.openQuickCapture({
            title: p.title,
            content: p.content,
            sourceUrl: p.sourceUrl,
          });
        },
      );
    } catch {
      /* 非桌面宿主，忽略 */
    }
  })();
  // 冷启动兜底：应用被 URL Scheme 拉起时，RunEvent::Opened 可能在前端 listen 注册前触发，
  // 直接 emit 会丢事件。注册监听后再取一次缓冲（take_pending_deep_link）双保险。
  void (async () => {
    try {
      const pending = await invoke<{
        title?: string;
        content?: string;
        sourceUrl?: string;
      } | null>('take_pending_deep_link');
      if (pending) {
        inboxStore.openQuickCapture({
          title: pending.title,
          content: pending.content,
          sourceUrl: pending.sourceUrl,
        });
      }
    } catch {
      /* 非桌面宿主，忽略 */
    }
  })();

  // 番茄钟全局常驻：计时引擎在应用级 store（主窗口内唯一一份），这里统一初始化——
  // 顶栏胶囊 TimerCapsule、/pomodoro 完整页、菜单栏倒计时图标三者都消费这同一份状态，
  // 即便用户从不打开番茄钟页，胶囊上点「开始」也照常驱动菜单栏倒计时。
  void usePomodoroStore().init();
});
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

