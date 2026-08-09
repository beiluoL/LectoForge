<template>
  <header
    class="kb-topnav fixed top-0 left-0 right-0 z-50 h-14 flex items-center px-4 sm:px-6 border-b"
    :style="{ background: 'var(--kb-card)', borderColor: 'var(--kb-border)' }"
  >
    <!-- Left: Logo（原「知识库」文字入口已彻底移除，仅保留产品名 LectoForge + 图标，点击回工作台驾驶舱） -->
    <router-link
      to="/workbench"
      class="flex items-center shrink-0 gap-2"
      style="color: var(--kb-primary)"
    >
      <Icon name="brain" size="xl" />
      <span
        class="hidden sm:inline font-semibold tracking-tight"
        :style="{ fontSize: 'var(--kb-logo-text-fs)', color: 'var(--kb-foreground)' }"
      >LectoForge</span>
    </router-link>

    <!-- ============ 桌面端（lg+）：完整 8 入口 ============ -->
    <nav class="hidden lg:flex items-center gap-1 ml-6 lg:ml-8">
      <template v-for="it in navItems" :key="it.path">
        <!-- 视觉分组细竖线：笔记↔文档库、复习↔费曼故事 -->
        <span
          v-if="it.dividerBefore"
          class="self-center h-5 w-px mx-1"
          :style="{ background: 'var(--kb-border)' }"
        ></span>

        <!-- 入口 5：复习（父级，带 macOS 原生存毛玻璃下拉） -->
        <div
          v-if="it.children?.length"
          class="relative"
          @mouseenter="reviewOpen = true"
          @mouseleave="reviewOpen = false"
        >
          <button type="button" class="nav-item" :class="{ 'is-active': isActive(it) }" @click="goTo(it)">
            <span class="relative inline-flex">
              <Icon :name="it.icon" size="md" />
              <span
                v-if="badgeValue(it)"
                class="nav-badge"
                :style="{ background: badgeTone(it) === 'danger' ? 'var(--kb-destructive)' : 'var(--kb-warning)' }"
              >{{ badgeValue(it) }}</span>
            </span>
            <span>{{ it.label }}</span>
            <Icon name="chevron-down" size="xs" class="opacity-50" />
          </button>

          <Transition name="dropdown">
            <div v-if="reviewOpen" class="absolute left-0 top-full z-50 pt-2">
              <div
                class="w-52 rounded-xl border border-white/20 bg-white/80 p-2 shadow-2xl backdrop-blur-xl
                       dark:border-neutral-700/20 dark:bg-neutral-900/80"
              >
                <router-link
                  v-for="c in it.children"
                  :key="c.path"
                  :to="c.path"
                  class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors
                         hover:bg-black/5 dark:hover:bg-white/10"
                  :class="childActive(c) ? 'bg-black/5 text-[var(--kb-primary)] dark:bg-white/10' : 'text-[var(--kb-foreground)]'"
                  @click="reviewOpen = false"
                >
                  <Icon :name="c.icon" size="sm" />
                  <span>{{ c.label }}</span>
                </router-link>
              </div>
            </div>
          </Transition>
        </div>

        <!-- 普通入口（含带角标的 工作台 / 收集箱） -->
        <router-link
          v-else
          :to="it.path"
          class="nav-item"
          :class="{ 'is-active': isActive(it) }"
          @click="closeMenus"
        >
          <span class="relative inline-flex">
            <Icon :name="it.icon" size="md" />
            <span
              v-if="badgeValue(it)"
              class="nav-badge"
              :style="{ background: badgeTone(it) === 'danger' ? 'var(--kb-destructive)' : 'var(--kb-warning)' }"
            >{{ badgeValue(it) }}</span>
          </span>
          <span>{{ it.label }}</span>
        </router-link>
      </template>
    </nav>

    <!-- ============ 窄窗（<lg）：保留 1-5 入口，6-8 收进「更多」 ============ -->
    <nav class="flex lg:hidden items-center gap-1 ml-4 overflow-x-auto no-scrollbar">
      <template v-for="it in primaryItems" :key="it.path">
        <span
          v-if="it.dividerBefore"
          class="self-center h-5 w-px mx-1"
          :style="{ background: 'var(--kb-border)' }"
        ></span>

        <div
          v-if="it.children?.length"
          class="relative"
          @mouseenter="reviewOpen = true"
          @mouseleave="reviewOpen = false"
        >
          <button type="button" class="nav-item" :class="{ 'is-active': isActive(it) }" @click="goTo(it)">
            <span class="relative inline-flex">
              <Icon :name="it.icon" size="md" />
              <span
                v-if="badgeValue(it)"
                class="nav-badge"
                :style="{ background: badgeTone(it) === 'danger' ? 'var(--kb-destructive)' : 'var(--kb-warning)' }"
              >{{ badgeValue(it) }}</span>
            </span>
            <span>{{ it.label }}</span>
            <Icon name="chevron-down" size="xs" class="opacity-50" />
          </button>

          <Transition name="dropdown">
            <div v-if="reviewOpen" class="absolute left-0 top-full z-50 pt-2">
              <div
                class="w-52 rounded-xl border border-white/20 bg-white/80 p-2 shadow-2xl backdrop-blur-xl
                       dark:border-neutral-700/20 dark:bg-neutral-900/80"
              >
                <router-link
                  v-for="c in it.children"
                  :key="c.path"
                  :to="c.path"
                  class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors
                         hover:bg-black/5 dark:hover:bg-white/10"
                  :class="childActive(c) ? 'bg-black/5 text-[var(--kb-primary)] dark:bg-white/10' : 'text-[var(--kb-foreground)]'"
                  @click="reviewOpen = false"
                >
                  <Icon :name="c.icon" size="sm" />
                  <span>{{ c.label }}</span>
                </router-link>
              </div>
            </div>
          </Transition>
        </div>

        <router-link
          v-else
          :to="it.path"
          class="nav-item"
          :class="{ 'is-active': isActive(it) }"
          @click="closeMenus"
        >
          <span class="relative inline-flex">
            <Icon :name="it.icon" size="md" />
            <span
              v-if="badgeValue(it)"
              class="nav-badge"
              :style="{ background: badgeTone(it) === 'danger' ? 'var(--kb-destructive)' : 'var(--kb-warning)' }"
            >{{ badgeValue(it) }}</span>
          </span>
          <span>{{ it.label }}</span>
        </router-link>
      </template>

      <!-- 更多：费曼故事 / 思维导图 / 番茄钟 -->
      <div class="relative" @mouseleave="moreOpen = false">
        <button type="button" class="nav-item" @click="moreOpen = !moreOpen">
          <Icon name="more-horizontal" size="md" />
          <span>更多</span>
        </button>
        <Transition name="dropdown">
          <div v-if="moreOpen" class="absolute right-0 top-full z-50 pt-2">
            <div
              class="w-44 rounded-xl border border-white/20 bg-white/80 p-2 shadow-2xl backdrop-blur-xl
                     dark:border-neutral-700/20 dark:bg-neutral-900/80"
            >
              <router-link
                v-for="it in moreItems"
                :key="it.path"
                :to="it.path"
                class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors
                       hover:bg-black/5 dark:hover:bg-white/10"
                :class="isActive(it) ? 'bg-black/5 text-[var(--kb-primary)] dark:bg-white/10' : 'text-[var(--kb-foreground)]'"
                @click="closeMenus"
              >
                <Icon :name="it.icon" size="sm" />
                <span>{{ it.label }}</span>
              </router-link>
            </div>
          </div>
        </Transition>
      </div>
    </nav>

    <div class="flex-1"></div>

    <!-- Right: 桌面端专属操作（沿用原逻辑） -->
    <div class="flex items-center gap-2">
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
      <router-link to="/settings" class="wb-icon-btn" title="设置">
        <Icon name="settings" size="md" />
      </router-link>
      <button type="button" class="wb-icon-btn" title="检查更新" @click="checkUpdate">
        <Icon name="refresh-cw" size="md" :class="updating ? 'animate-spin' : ''" />
      </button>
      <!-- 顶栏最右：番茄钟胶囊（状态点 + MM:SS + 开始/暂停/重置），取代原菜单栏弹窗 -->
      <TimerCapsule />
    </div>
  </header>
</template>

<script setup lang="ts">
// 桌面端顶部导航重构（2026-08-08）
// 学习闭环：采集 → 内化 → 巩固 → 输出
//   工作台(hub) / 收集箱(input) / 笔记·文档库(整理) / 复习(巩固·父级含间隔复习·记忆宫殿·主动回忆) /
//   费曼故事·思维导图(输出) / 番茄钟(工具)
// 关键约束：Vue3 <script setup lang="ts"> + Pinia(storeToRefs) + Tailwind + --kb-* token + lucide(Icon) + vue-router。
// 注意：原「知识库」菜单入口已彻底删除；番茄钟（2026-08-08 起）不再走 pomodoro_popup 弹窗，
// 菜单项就是普通路由跳转 /pomodoro，日常控制交给右侧内嵌的 TimerCapsule 胶囊。
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Icon from '@/components/ui/Icon.vue';
import TimerCapsule from '@/components/layout/TimerCapsule.vue';
import { notify } from '@/utils/toast';
import { useSearchStore } from '@/store/search-store';
import { useDashboardStore } from '@/store/dashboard-store';
import { useReviewStore } from '@/store/review-store';
import { storeToRefs } from 'pinia';
// 顶层静态导入 Tauri API：与 App.vue / pomodoroStore 一致，避免 build 模式动态 import chunk 静默失败。
import { invoke } from '@tauri-apps/api/core';

const route = useRoute();
const reviewOpen = ref(false); // 复习下拉（桌面 + 窄窗共用）
const moreOpen = ref(false);   // 更多下拉（窄窗）
const updating = ref(false);
const searchStore = useSearchStore();

/* ---------------- Pinia 状态（storeToRefs 解构） ---------------- */
const dashboardStore = useDashboardStore();
const reviewStore = useReviewStore();
// dashboardStore：pendingCaptures（待处理碎片）、dueReviews（新系统待复习）
// reviewStore：legacyDueCount（旧系统传统卡组待复习）
const { stats, loaded } = storeToRefs(dashboardStore);
const { legacyDueCount } = storeToRefs(reviewStore);

const pendingCaptures = computed(() => stats.value?.pendingCaptures ?? 0);
const dueReviews = computed(() => (stats.value?.dueReviews ?? 0) + (legacyDueCount.value ?? 0));

function openSearch() {
  searchStore.openPalette();
}

onMounted(async () => {
  // 拉取实时状态，驱动角标（仅首屏未拉取时补一次，避免重复请求）
  if (!loaded.value) dashboardStore.fetchStats();
  reviewStore.loadLegacyDueCount();
});

/* ---------------- 导航数据 ---------------- */
type NavChild = { path: string; label: string; icon: string };
type NavItem = {
  path: string;
  label: string;
  icon: string;
  /**
   * 高亮匹配前缀白名单。缺省时退化为 `[path]`，即「只有自己这条路径（及其子路径）会高亮」。
   *
   * 为什么需要它：顶栏是**功能分组**视图，而路由表是**扁平**的——同一个业务域的页面
   * 因为历史原因散落在不同前缀下（详见 router/index.ts 的注释：/library、/mindmap、
   * /inbox 都刻意没挂进 /workbench，否则会和「工作台」用 startsWith 互相误高亮）。
   * 于是「一个顶栏项 ↔ 一条路由前缀」的假设不成立，必须显式声明它代表哪几段路由。
   *
   * 典型场景是「复习」这一项，它同时代表四条不同前缀的路由：
   *   /workbench/review  旧复习驾驶舱（父级自身 path，点击后落这里）
   *   /review            间隔重复闪卡（含别名 /review/flashcard，靠前缀吞掉）
   *   /workbench/palace  记忆宫殿
   *   /workbench/recall  主动回忆
   * 这四者在产品语义上同属「巩固」，用户从任意一个进去都应看到「复习」高亮；
   * 若不写 match，只有停在 /workbench/review 时才亮，点进「间隔复习」顶栏就整个熄灭，
   * 用户会以为自己跳出了当前模块。
   *
   * 匹配方式为 `route.path === p || route.path.startsWith(p)`（见 isActive），
   * 因此前缀会连带吃掉全部子路由（/review → /review/flashcard 一并高亮）。
   * ⚠️ 正因为是前缀匹配，新增前缀时要确认它不会误吞别的顶栏项：
   * 例如给「番茄钟」写死 match: ['/pomodoro'] 而非留空，是为了明确它同时覆盖
   * /pomodoro/stats；而「工作台」在 isActive 里被特判为**精确匹配**，
   * 否则 '/workbench' 前缀会把 notes / review / palace 等全部子路由一起点亮。
   */
  match?: string[];
  /** 角标数据源 */
  badge?: 'pendingCaptures' | 'dueReviews';
  /** 视觉分组细竖线（位于该项之前） */
  dividerBefore?: boolean;
  /** 子菜单（仅复习父级） */
  children?: NavChild[];
};

const navItems: NavItem[] = [
  // 1. 枢纽
  { path: '/workbench', label: '工作台', icon: 'layout-dashboard', badge: 'pendingCaptures' },
  // 2. 输入
  { path: '/inbox', label: '收集箱', icon: 'inbox', badge: 'pendingCaptures' },
  // 3. 整理
  { path: '/workbench/notes', label: '笔记', icon: 'file-edit' },
  // 4. 整理（前加分组竖线）
  { path: '/library', label: '文档库', icon: 'library', dividerBefore: true },
  // 5. 巩固（父级，含三个复习子项；match 覆盖全部复习子路由）
  {
    path: '/workbench/review',
    label: '复习',
    icon: 'refresh-ccw',
    match: ['/workbench/review', '/review', '/workbench/palace', '/workbench/recall'],
    badge: 'dueReviews',
    children: [
      { path: '/review', label: '间隔复习', icon: 'brain-circuit' },
      { path: '/workbench/palace', label: '记忆宫殿', icon: 'map-pin' },
      { path: '/workbench/recall', label: '主动回忆', icon: 'pen-tool' },
    ],
  },
  // 6. 输出（前加分组竖线）
  { path: '/workbench/story', label: '费曼故事', icon: 'pen-line', dividerBefore: true },
  // 7. 输出
  { path: '/mindmap', label: '思维导图', icon: 'share-2' },
  // 8. 工具（普通路由：番茄钟完整页，日常控制在顶栏胶囊里）
  { path: '/pomodoro', label: '番茄钟', icon: 'timer', match: ['/pomodoro'] },
  // 9. 计划（独立路由 /schedule，解决「今天要做什么」；match 覆盖自身避免被 /workbench 误吞）
  { path: '/schedule', label: '日程计划', icon: 'calendar-days', match: ['/schedule'], dividerBefore: true },
];

// 窄窗常驻入口（1-5）与「更多」折叠入口（6-8）
const primaryItems = navItems.slice(0, 5);
const moreItems = navItems.slice(5);

/* ---------------- 高亮 / 角标 ---------------- */
/**
 * 判断顶栏项是否处于激活态。
 *
 * 规则：`/workbench`（工作台）**精确匹配**，其余项按 `match ?? [path]` 做前缀匹配。
 * 工作台必须特判，因为它的 path 是所有 /workbench/* 子路由的公共前缀，
 * 走 startsWith 会导致打开「笔记」「复习」时工作台跟着一起亮（双高亮）。
 *
 * @param it 顶栏项配置，其 `match` 字段的完整语义见 NavItem 类型定义
 * @returns true 表示当前路由属于该项代表的业务域，应渲染 is-active 样式
 */
function isActive(it: NavItem): boolean {
  if (it.path === '/workbench') return route.path === '/workbench'; // 工作台精确匹配，避免误吞子路由
  const prefixes = it.match ?? [it.path];
  return prefixes.some((p) => route.path === p || route.path.startsWith(p));
}

function childActive(c: NavChild): boolean {
  return route.path === c.path || route.path.startsWith(c.path);
}

function badgeValue(it: NavItem): number {
  if (it.badge === 'pendingCaptures') return pendingCaptures.value;
  if (it.badge === 'dueReviews') return dueReviews.value;
  return 0;
}

function badgeTone(it: NavItem): 'danger' | 'warning' {
  return it.badge === 'dueReviews' ? 'danger' : 'warning';
}

/* ---------------- 交互：父级跳转驾驶舱 / 子项独立路由 ---------------- */
const router = useRouter();

/** 仅当不在当前路由时跳转，避免重复压栈 */
function navigateTo(path: string) {
  if (route.path !== path) router.push(path);
}

/** 父级（复习）点击 → 跳转复习驾驶舱（/workbench/review） */
function goTo(it: NavItem) {
  reviewOpen.value = false;
  moreOpen.value = false;
  navigateTo(it.path);
}

/**
 * 普通导航项点击：仅收起两个下拉（复习 / 更多），跳转本身交给 router-link。
 * 历史包袱说明：这里原先还负责拦截番茄钟项去呼出 pomodoro_popup 弹窗，
 * 弹窗形态已于 2026-08-08 移除，拦截逻辑随之删干净，番茄钟回归普通路由。
 */
function closeMenus() {
  moreOpen.value = false;
  reviewOpen.value = false;
}

async function checkUpdate() {
  if (updating.value) return;
  updating.value = true;
  try {
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
/* 导航项基础样式（使用 --kb-* token，hover/active 由 class 控制） */
.nav-item {
  display: inline-flex;
  align-items: center;
  gap: var(--kb-nav-gap);
  padding: 6px 8px;
  border-radius: 8px;
  font-size: var(--kb-nav-text-fs);
  font-weight: var(--kb-nav-text-fw);
  color: var(--kb-muted-foreground);
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s ease, opacity 0.15s ease, background 0.15s ease;
}
.nav-item:hover {
  opacity: 0.8;
  background: var(--kb-muted);
}
.nav-item.is-active {
  color: var(--kb-primary);
  font-weight: 600;
}

/* 图标右上角数字角标 */
.nav-badge {
  position: absolute;
  top: -6px;
  right: -8px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 9999px;
  font-size: 10px;
  line-height: 16px;
  font-weight: 600;
  color: #fff;
  text-align: center;
  box-shadow: 0 0 0 2px var(--kb-card);
}

/* 下拉淡入动画（<Transition name="dropdown">） */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* 窄窗横向滚动隐藏滚动条 */
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

/* 顶栏搜索触发按钮：图标 + ⌘K kbd 横向排布 */
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
