<template>
  <header
    class="kb-topnav fixed top-0 left-0 right-0 z-50 h-14 flex items-center px-4 sm:px-6 border-b"
    :style="{ background: 'var(--kb-card)', borderColor: 'var(--kb-border)' }"
  >
    <!-- Left: Logo -->
    <router-link
      to="/workbench"
      class="flex items-center shrink-0"
      style="color: var(--kb-primary); gap: var(--kb-nav-gap);"
    >
      <Icon name="brain" size="xl" />
      <span
        class="hidden sm:inline"
        :style="{ fontSize: 'var(--kb-logo-text-fs)', fontWeight: 'var(--kb-logo-text-fw)' }"
      >知识库</span>
    </router-link>

    <!-- Center: 学习闭环导航 -->
    <nav class="hidden lg:flex items-center gap-6 ml-8">
      <router-link
        v-for="it in navItems"
        :key="it.path"
        :to="it.path"
        class="flex items-center gap-2 transition-colors"
        :class="isActive(it) ? '' : 'hover:opacity-80'"
        :style="{
          color: isActive(it) ? 'var(--kb-primary)' : 'var(--kb-muted-foreground)',
          fontSize: 'var(--kb-nav-text-fs)',
          fontWeight: isActive(it) ? 600 : 'var(--kb-nav-text-fw)',
        }"
        @click="onNavClick(it, $event)"
      >
        <Icon :name="it.icon" size="md" />
        <span>{{ it.label }}</span>
      </router-link>
    </nav>

    <!-- 移动/窄窗：折叠为下拉 -->
    <div class="relative lg:hidden ml-6">
      <button
        type="button"
        class="flex items-center gap-2"
        :style="{ color: 'var(--kb-muted-foreground)', fontSize: 'var(--kb-nav-text-fs)', fontWeight: 'var(--kb-nav-text-fw)' }"
        @click="menuOpen = !menuOpen"
      >
        <Icon name="menu" size="md" />
        <span>{{ currentLabel }}</span>
        <Icon name="chevron-down" size="sm" />
      </button>
      <div class="nav-dropdown" :class="{ 'is-open': menuOpen }" role="menu">
        <router-link
          v-for="it in navItems"
          :key="it.path"
          :to="it.path"
          class="flex items-center gap-2 px-3 py-2"
          :style="{ fontSize: 'var(--kb-dropdown-text-fs)' }"
          @click="onNavClick(it, $event)"
        >
          <Icon :name="it.icon" size="md" style="color: var(--kb-muted-foreground);" />
          {{ it.label }}
        </router-link>
      </div>
    </div>

    <div class="flex-1"></div>

    <!-- Right: 桌面端专属操作 -->
    <div class="flex items-center gap-2">
      <!-- 全局搜索触发（Cmd/Ctrl+K 同款动作，提升命令面板可发现性） -->
      <button type="button" class="wb-icon-btn wb-search-trigger" title="搜索 (⌘K)" @click="openSearch">
        <Icon name="search" size="md" />
        <kbd class="wb-kbd">⌘K</kbd>
      </button>
      <span
        class="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
        :style="{
          background: 'var(--kb-muted)',
          color: 'var(--kb-muted-foreground)',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
        }"
      >
        <Icon name="hard-drive" size="xs" />
        本地离线
      </span>
      <!-- 通用设置中心入口：数据目录 / AI 服务 / 关于 -->
      <router-link to="/settings" class="wb-icon-btn" title="设置">
        <Icon name="settings" size="md" />
      </router-link>
      <!-- AI 设置入口：就绪时以高光色点亮，未配置时保持中性灰 -->
      <router-link
        to="/settings/ai"
        class="wb-icon-btn"
        title="AI 设置"
        :style="aiReady ? { color: 'var(--kb-highlight)' } : undefined"
      >
        <Icon name="ai-sparkle" size="md" />
      </router-link>
      <button type="button" class="wb-icon-btn" title="检查更新" @click="checkUpdate">
        <Icon name="refresh-cw" size="md" :class="updating ? 'animate-spin' : ''" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
// 桌面端顶部导航：沿用 Web 端 CTopNav 的视觉语言（56px 固定栏、--kb-nav-* 令牌、
// 同款 Icon + 文字排布），导航项收敛为学习闭环六模块，右侧换成桌面专属的更新入口。
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import Icon from '@/components/ui/Icon.vue';
import { notify } from '@/utils/toast';
import { getAiStatus } from '@/api/ai';
import { useSearchStore } from '@/stores/searchStore';

const route = useRoute();
const menuOpen = ref(false);
const updating = ref(false);
/** AI 是否已配置就绪，仅用于点亮顶栏入口图标，失败静默（不打扰主流程） */
const aiReady = ref(false);
/** 全局搜索面板 store（顶栏搜索按钮与 Cmd/Ctrl+K 共用同一入口） */
const searchStore = useSearchStore();

function openSearch() {
  searchStore.openPalette();
}

onMounted(async () => {
  try {
    aiReady.value = (await getAiStatus()).ready;
  } catch {
    aiReady.value = false;
  }
});

type NavItem = { path: string; label: string; icon: string; match?: string[]; popup?: boolean };
const navItems: NavItem[] = [
  { path: '/workbench', label: '工作台', icon: 'brain' },
  { path: '/inbox', label: '收集箱', icon: 'inbox' },
  { path: '/workbench/notes', label: '笔记', icon: 'notebook-pen' },
  { path: '/library', label: '文档库', icon: 'library' },
  // 复习模块 2026-08-07 收敛后，新旧两套复习系统（/workbench/review 驾驶舱 + /review 闪卡）统一归属「复习」菜单，
  // match 让处在 /review、/review/flashcard 闪卡页时顶栏「复习」也保持高亮。
  { path: '/workbench/review', label: '复习', icon: 'repeat', match: ['/workbench/review', '/review'] },
  { path: '/workbench/palace', label: '记忆宫殿', icon: 'map-pin' },
  { path: '/workbench/recall', label: '主动回忆', icon: 'edit-2' },
  { path: '/workbench/story', label: '费曼故事', icon: 'wand-2' },
  { path: '/mindmap', label: '思维导图', icon: 'list-tree' },
  // 番茄钟 2026-08-07 新增：菜单栏应用形态下，点击不跳主窗口，而是「呼出」毛玻璃弹窗
  // （popup: true → onNavClick 拦截默认跳转，show + focus pomodoro_popup 并隐藏主窗口）。
  { path: '/pomodoro', label: '番茄钟', icon: 'timer', match: ['/pomodoro'], popup: true },
];

/**
 * 番茄钟菜单项拦截：popup 项不跳主窗口路由，改为呼出菜单栏弹窗（pomodoro_popup 窗口），
 * 实现「从主应用进入番茄钟 = 直接打开状态栏弹窗」的无缝过渡。
 */
async function onNavClick(it: NavItem, e: MouseEvent) {
  if (!it.popup) return;
  e.preventDefault();
  menuOpen.value = false;
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    // @tauri-apps/api 2.x：getByLabel 是 async（之前同步返回的版本已弃用）
    const popup = await WebviewWindow.getByLabel('pomodoro_popup');
    if (popup) {
      await popup.show();
      await popup.setFocus();
      await getCurrentWindow().hide(); // 隐藏主窗口，纯粹进入菜单栏弹窗形态
    }
  } catch {
    /* 浏览器预览态：@tauri-apps/api 不存在，忽略 */
  }
}

function isActive(item: NavItem) {
  if (item.path === '/workbench') return route.path === '/workbench';
  const prefixes = item.match ?? [item.path];
  return prefixes.some((p) => route.path.startsWith(p));
}

const currentLabel = computed(
  () => navItems.find((it) => isActive(it))?.label ?? '工作台',
);

async function checkUpdate() {
  if (updating.value) return;
  updating.value = true;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const msg = await invoke<string>('check_for_update');
    notify(msg || '已是最新版本', 'success');
  } catch {
    notify('当前处于浏览器预览模式，更新检查仅在桌面应用内可用', 'info');
  } finally {
    updating.value = false;
  }
}
</script>

<style scoped>
/* 下拉面板：与 Web 端 CTopNav 的 .nav-dropdown 保持一致 */
.nav-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  min-width: 168px;
  padding: 6px;
  border-radius: var(--kb-radius-md);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-lg);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-4px);
  transition: all 0.16s ease;
  z-index: 60;
}
.nav-dropdown.is-open {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}
.nav-dropdown a {
  border-radius: var(--kb-radius-sm);
  color: var(--kb-foreground);
}
.nav-dropdown a:hover {
  background: var(--kb-muted);
}

/* 顶栏搜索触发按钮（与 .wb-icon-btn 叠加）：图标 + ⌘K kbd 横向排布 */
.wb-search-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.wb-kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 5px;
  border: 1px solid var(--kb-border);
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
}
</style>
