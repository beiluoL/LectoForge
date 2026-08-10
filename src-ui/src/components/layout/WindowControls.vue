<template>
  <!-- 自绘 macOS 交通灯（2026-08-10 无边框沉浸式窗口改造）
       窗口开了 decorations:false，系统红黄绿随原生标题栏一起没了，这里把它补回来。

       为什么整组和每颗灯都写 data-tauri-drag-region="false"：
       外层顶栏是拖拽区，Tauri 注入的 drag 脚本会在 mousedown 时判断事件目标是否属于拖拽区，
       命中就调 start_dragging，此时点击事件不再派发给按钮 —— 表现为「按钮点不动」。
       标成 false 等于在这一小块区域里把拖拽让位给点击。 -->
  <div
    v-if="native"
    class="lf-traffic flex items-center gap-2"
    :class="{ 'is-blurred': !focused }"
    data-tauri-drag-region="false"
    role="group"
    aria-label="窗口控制"
  >
    <button
      type="button"
      class="lf-light lf-close w-3 h-3 rounded-full"
      title="关闭"
      aria-label="关闭窗口"
      data-tauri-drag-region="false"
      @click="run('close')"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3.6 3.6l4.8 4.8M8.4 3.6l-4.8 4.8" />
      </svg>
    </button>

    <button
      type="button"
      class="lf-light lf-min w-3 h-3 rounded-full"
      title="最小化"
      aria-label="最小化窗口"
      data-tauri-drag-region="false"
      @click="run('minimize')"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3 6h6" />
      </svg>
    </button>

    <button
      type="button"
      class="lf-light lf-max w-3 h-3 rounded-full"
      title="最大化 / 还原"
      aria-label="最大化或还原窗口"
      data-tauri-drag-region="false"
      @click="run('toggleMaximize')"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 3v6M3 6h6" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 窗口控制按钮组（无边框窗口专用）。
 *
 * 依赖的 ACL：`core:window` 的 `allow-close` / `allow-minimize` / `allow-toggle-maximize`
 * 三条**不在** `core:default` 里（core:window:default 只给只读能力），必须在
 * `src-tauri/capabilities/default.json` 显式声明，否则 dev 正常、打包后点按钮静默无反应
 * ——本项目远程来源（127.0.0.1:8787）下的经典 ACL 坑。
 */
import { onMounted, onUnmounted, ref } from 'vue';
// 顶层静态导入：build 模式页面由 8787 侧车静态托管，动态 import @tauri-apps/api/* 的 chunk
// 会静默失败（项目既有约定，见 App.vue / pomodoroStore 注释）。
import { getCurrentWindow } from '@tauri-apps/api/window';

/** 浏览器预览态（npm run dev 直接开 5173 看页面）下没有 Tauri 宿主，整组隐藏而不是渲染出一排点不动的假灯。 */
const native = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** 窗口是否聚焦：macOS 原生行为是失焦时三颗灯统一褪成灰点，不跟着做会很出戏。 */
const focused = ref(true);
let stopFocusWatch: (() => void) | null = null;

onMounted(async () => {
  if (!native) return;
  try {
    const win = getCurrentWindow();
    focused.value = await win.isFocused();
    stopFocusWatch = await win.onFocusChanged(({ payload }) => {
      focused.value = payload;
    });
  } catch {
    /* 非桌面宿主或权限未放行：保持彩色常亮，不影响按钮可用性 */
  }
});

onUnmounted(() => {
  stopFocusWatch?.();
  stopFocusWatch = null;
});

/**
 * 统一执行窗口动作。三个动作签名一致，用键名索引避免写三份同构的 try/catch。
 * @param action close=关闭（本应用会被 CloseRequested 拦下改为隐藏进托盘）、
 *               minimize=最小化、toggleMaximize=最大化/还原互切
 */
async function run(action: 'close' | 'minimize' | 'toggleMaximize') {
  try {
    await getCurrentWindow()[action]();
  } catch (err) {
    // 唯一可能的原因是 capability 漏配；打到控制台便于定位，不打扰用户。
    console.warn(`[WindowControls] ${action} 执行失败，请检查 capabilities 中的 core:window 权限`, err);
  }
}
</script>

<style scoped>
.lf-traffic {
  /* 拖拽区里的一块「点击孤岛」，光标保持默认箭头，别让它看起来像可拖动的手柄 */
  cursor: default;
}

.lf-light {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  /* 灯珠内缘一圈极淡描边：纯色圆点在浅色顶栏上会显得发飘，原生灯是有轮廓的 */
  box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 14%);
  cursor: default;
  transition: background-color 0.15s ease, filter 0.15s ease;
}

.lf-close { background-color: #ff5f57; }
.lf-min { background-color: #febc2e; }
.lf-max { background-color: #28c840; }

.lf-light:hover { filter: brightness(0.92); }
.lf-light:active { filter: brightness(0.78); }

/* 字形（× − ＋）：整组 hover 时三个一起浮现，与 macOS 一致；
   单独 hover 只亮一颗是常见的仿制品破绽。 */
.lf-light svg {
  width: 8px;
  height: 8px;
  fill: none;
  stroke: rgb(0 0 0 / 58%);
  stroke-width: 1.4;
  stroke-linecap: round;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.lf-traffic:hover .lf-light svg { opacity: 1; }

/* 失焦：褪成中性灰点。用 --kb-* token 派生，深浅色主题下都不会突兀
   （项目铁律：明暗一律走 token + color-mix，禁用 Tailwind 的 dark: 变体）。 */
.lf-traffic.is-blurred .lf-light {
  background-color: color-mix(in srgb, var(--kb-muted-foreground) 38%, transparent);
}
/* 失焦窗口上悬停仍会亮回彩色 —— 这也是原生行为 */
.lf-traffic.is-blurred:hover .lf-close { background-color: #ff5f57; }
.lf-traffic.is-blurred:hover .lf-min { background-color: #febc2e; }
.lf-traffic.is-blurred:hover .lf-max { background-color: #28c840; }
</style>
