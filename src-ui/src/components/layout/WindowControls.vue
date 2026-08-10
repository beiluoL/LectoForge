<template>
  <!-- 自绘 macOS 交通灯（2026-08-10 无边框沉浸式窗口改造，2026-08-10 精细化打磨）
       窗口开了 decorations:false，系统红黄绿随原生标题栏一起没了，这里把它补回来。

       拖拽区语义（Tauri 2.11 注入脚本）：
       - 外层容器标裸 `data-tauri-drag-region` → 它是可拖拽区。左侧 pl-4 留白与三颗灯之间的
         gap 都属于这块区域，按住即可拖动窗口（父级 header 的 "deep" 也会兜底覆盖到这里）。
       - 三颗灯本身标 `data-tauri-drag-region="false"` → 命中即「让位给点击」，不会误触发拖拽，
         从而 close/minimize/maximize 点得动。
       - 注意：脚本还会把 <button> 当天然拖拽阻断点，但显式 ="false" 是双保险、也更可读。 -->
  <div
    v-if="native"
    class="lf-traffic group flex items-center gap-2 pl-4"
    data-tauri-drag-region
    role="group"
    aria-label="窗口控制"
  >
    <button
      type="button"
      class="lf-light lf-close w-3.5 h-3.5 rounded-full border border-[#e0443e]"
      title="关闭"
      aria-label="关闭窗口"
      data-tauri-drag-region="false"
      @click="run('close')"
    >
      <Icon
        name="x"
        class="lf-glyph w-2.5 h-2.5 text-black opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 pointer-events-none"
      />
    </button>

    <button
      type="button"
      class="lf-light lf-min w-3.5 h-3.5 rounded-full border border-[#dca22e]"
      title="最小化"
      aria-label="最小化窗口"
      data-tauri-drag-region="false"
      @click="run('minimize')"
    >
      <Icon
        name="minus"
        class="lf-glyph w-2.5 h-2.5 text-black opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 pointer-events-none"
      />
    </button>

    <button
      type="button"
      class="lf-light lf-max w-3.5 h-3.5 rounded-full border border-[#1f9e2e]"
      title="最大化 / 还原"
      aria-label="最大化或还原窗口"
      data-tauri-drag-region="false"
      @click="run('toggleMaximize')"
    >
      <Icon
        name="maximize"
        class="lf-glyph w-2.5 h-2.5 text-black opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 pointer-events-none"
      />
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
// 项目统一图标封装（lucide 包装器）：name="x"/"minus"/"plus" 即渲染对应矢量字形，
// 比手写 SVG / HTML 实体在 Retina 上更清晰，也契合项目「禁止 dark: 变体、走 token」的约定。
import Icon from '@/components/ui/Icon.vue';

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
  /* 拖拽区里的一块「点击 + 拖动」混合区，光标保持默认箭头。
     ⚠️ 不再给整组加悬停高亮胶囊：用户明确要求「纯圆点 + 区域悬停浮现图标」，
     不要亮色响应区。group 已上移到此容器（见模板），图标靠 group-hover 整组联动。 */
  cursor: default;
}

.lf-light {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  /* 灯珠内缘一圈极淡描边：纯色圆点在浅色顶栏上会显得发飘，原生灯是有轮廓的 */
  cursor: default;
  transition: background-color 0.15s ease, filter 0.15s ease, border-color 0.15s ease;
}

.lf-close { background-color: #ff5f57; }
.lf-min { background-color: #febc2e; }
.lf-max { background-color: #28c840; }

/* 悬停 / 按下时整颗灯「变深」：用 filter:brightness 而非 /80 透明度——窗口是 transparent 的，
   降透明度只会让灯更透（在毛玻璃顶栏上反而显亮），brightness 才是真正的压暗，贴近 macOS 手感。 */
.lf-light:hover { filter: brightness(0.9); }
.lf-light:active { filter: brightness(0.78); }

/* 字形（× − ⤢）：默认隐藏（纯圆点）；鼠标移到红黄绿整组（父容器 .lf-traffic.group）
   或键盘聚焦任一灯时，三颗图标同时浮现。颜色纯黑、矢量渲染，Retina 上始终锐利。 */
.lf-glyph {
  width: 10px;
  height: 10px;
  color: #000;
}

/* 失焦：褪成中性灰点。用 --kb-* token 派生，深浅色主题下都不会突兀
   （项目铁律：明暗一律走 token + color-mix，禁用 Tailwind 的 dark: 变体）。
   同时把可选的有色描边一并透明化——原生失焦灰点本就没有彩色边。 */
.lf-traffic.is-blurred .lf-light {
  background-color: color-mix(in srgb, var(--kb-muted-foreground) 38%, transparent);
  border-color: transparent;
}
/* 失焦窗口上悬停仍会亮回彩色 —— 这也是原生行为 */
.lf-traffic.is-blurred:hover .lf-close { background-color: #ff5f57; }
.lf-traffic.is-blurred:hover .lf-min { background-color: #febc2e; }
.lf-traffic.is-blurred:hover .lf-max { background-color: #28c840; }
</style>
