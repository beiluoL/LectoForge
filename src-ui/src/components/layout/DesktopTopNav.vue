<template>
  <!-- 无边框沉浸式顶栏（2026-08-10）：窗口 decorations:false 后，这一条就是窗口的顶边框本身。
       - data-tauri-drag-region="deep"：整条顶栏（含子元素间的空隙）都能按住拖动窗口，
         双击则最大化/还原。⚠️ 必须写 "deep" 而不是裸属性——Tauri 2.11 的注入脚本里，
         裸属性语义是「只有直接点中该元素本身才算拖拽区」（`return el === composedPath[0]`），
         而 header 的可点面积几乎全被子元素占满，写裸属性等于只有几像素边缘能拖。
       - 子树中的可交互分区标 ="false" 显式让位给点击。另外该脚本会把 A/BUTTON/INPUT 等
         标签视为天然阻断点，所以 router-link 与各按钮即便不标也点得动，="false" 是双保险。
       - 横向不再有 px-4/sm:px-6 的对称内距：左侧改为 20px（macOS 交通灯的标准左边距），
         背景由 inset-x-0 铺满窗口整宽，视觉上再无左侧/顶部的留白间隙。 -->
  <header
    ref="rootEl"
    data-tauri-drag-region="deep"
    class="kb-topnav fixed inset-x-0 top-0 z-50 flex h-14 w-full items-center pl-5 pr-3 sm:pr-4 rounded-t-[20px]"
    @keydown.esc="closeMenus"
  >
    <!-- 自绘 macOS 红黄绿：顶掉被 decorations:false 移除的系统窗口按钮 -->
    <WindowControls class="mr-4 shrink-0" />

    <!-- Left: Logo（原「知识库」文字入口已彻底移除，仅保留产品名 LectoForge + 图标，点击回工作台驾驶舱） -->
    <router-link
      to="/workbench"
      class="flex items-center shrink-0 gap-2"
      data-tauri-drag-region="false"
      style="color: var(--kb-primary)"
    >
      <Icon name="brain" size="xl" />
      <span
        class="hidden sm:inline font-semibold tracking-tight"
        :style="{ fontSize: 'var(--kb-logo-text-fs)', color: 'var(--kb-foreground)' }"
      >LectoForge</span>
    </router-link>

    <!-- ============================================================
         主导航（单套模板同时服务桌面与窄窗）
         - lg+   ：8 个入口全部平铺
         - <lg   ：collapse 项（复习 / 费曼故事 / 思维导图 / 规划）隐藏，收进右侧「更多」
         为什么只写一套：原实现把「桌面 nav」和「窄窗 nav」各抄了一遍下拉模板，
         新增一个下拉就要改两处，极易漏改；这里改用 `hidden lg:flex` 做响应式裁剪。
         ============================================================ -->
    <nav class="flex items-center min-w-0 ml-4 lg:ml-8" data-tauri-drag-region="false" aria-label="主导航">
      <!-- 横向滚动条只包住「平铺项」：窄窗下 collapse 项已隐藏，
           因此滚动容器内不存在任何下拉，彻底避开 overflow 裁切下拉面板的老问题。 -->
      <div class="flex items-center gap-1 min-w-0 py-2 overflow-x-auto lg:overflow-visible no-scrollbar">
        <div
          v-for="it in navItems"
          :key="it.key"
          class="items-center shrink-0"
          :class="it.collapse ? 'hidden lg:flex' : 'flex'"
        >
          <!-- 视觉分组细竖线：文档库之前（整理组）、费曼故事之前（输出组）、规划之前（规划组） -->
          <span
            v-if="it.dividerBefore"
            class="self-center h-5 w-px mx-1"
            :style="{ background: 'var(--kb-border)' }"
          ></span>

          <!-- 父级下拉（复习 / 规划）：macOS 原生风毛玻璃面板 -->
          <div
            v-if="it.kind === 'group'"
            class="relative"
            @mouseenter="openKey = it.key"
            @mouseleave="openKey = null"
          >
            <button
              type="button"
              class="nav-item"
              :class="{ 'is-active': isActive(it) }"
              aria-haspopup="menu"
              :aria-expanded="openKey === it.key"
              @click="onGroupClick(it)"
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
              <Icon name="chevron-down" size="xs" class="opacity-50" />
            </button>

            <Transition name="dropdown">
              <div v-if="openKey === it.key" class="absolute left-0 top-full z-50 pt-2">
                <div
                  class="w-52 rounded-xl border border-white/20 bg-white/80 p-2 shadow-2xl backdrop-blur-xl
                         dark:border-neutral-700/20 dark:bg-neutral-900/80"
                  role="menu"
                >
                  <router-link
                    v-for="c in it.children"
                    :key="c.path"
                    :to="c.path"
                    role="menuitem"
                    class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors
                           hover:bg-black/5 dark:hover:bg-white/10"
                    :class="childActive(c) ? 'bg-black/5 text-[var(--kb-primary)] dark:bg-white/10' : 'text-[var(--kb-foreground)]'"
                    @click="closeMenus"
                  >
                    <Icon :name="c.icon" size="sm" />
                    <span>{{ c.label }}</span>
                  </router-link>
                </div>
              </div>
            </Transition>
          </div>

          <!-- 叶子入口（含带角标的 工作台 / 收集箱） -->
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
        </div>
      </div>

      <!-- 更多（仅窄窗）：承接被折叠的入口；刻意放在滚动容器之外，下拉面板才不会被裁切 -->
      <div class="relative shrink-0 lg:hidden" @mouseleave="moreOpen = false">
        <button
          type="button"
          class="nav-item"
          aria-haspopup="menu"
          :aria-expanded="moreOpen"
          @click="moreOpen = !moreOpen"
        >
          <Icon name="more-horizontal" size="md" />
          <span>更多</span>
        </button>
        <Transition name="dropdown">
          <div v-if="moreOpen" class="absolute left-0 top-full z-50 pt-2">
            <div
              class="w-52 rounded-xl border border-white/20 bg-white/80 p-2 shadow-2xl backdrop-blur-xl
                     dark:border-neutral-700/20 dark:bg-neutral-900/80"
              role="menu"
            >
              <template v-for="it in moreItems" :key="it.key">
                <!-- 折叠项若本身是父级下拉（复习 / 规划），窄窗里摊平成「分组标题 + 子项」 -->
                <template v-if="it.kind === 'group'">
                  <div
                    class="px-3 pt-2 pb-1 text-[11px] font-medium"
                    :style="{ color: 'var(--kb-muted-foreground)' }"
                  >{{ it.label }}</div>
                  <router-link
                    v-for="c in it.children"
                    :key="c.path"
                    :to="c.path"
                    role="menuitem"
                    class="flex items-center gap-2 rounded-lg py-2 pl-5 pr-3 text-sm transition-colors
                           hover:bg-black/5 dark:hover:bg-white/10"
                    :class="childActive(c) ? 'bg-black/5 text-[var(--kb-primary)] dark:bg-white/10' : 'text-[var(--kb-foreground)]'"
                    @click="closeMenus"
                  >
                    <Icon :name="c.icon" size="sm" />
                    <span>{{ c.label }}</span>
                  </router-link>
                </template>

                <router-link
                  v-else
                  :to="it.path"
                  role="menuitem"
                  class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors
                         hover:bg-black/5 dark:hover:bg-white/10"
                  :class="isActive(it) ? 'bg-black/5 text-[var(--kb-primary)] dark:bg-white/10' : 'text-[var(--kb-foreground)]'"
                  @click="closeMenus"
                >
                  <Icon :name="it.icon" size="sm" />
                  <span>{{ it.label }}</span>
                </router-link>
              </template>
            </div>
          </div>
        </Transition>
      </div>
    </nav>

    <!-- 中间空白：顶栏面积最大的可拖拽区域，由 header 的 "deep" 覆盖，无需再标属性。
         self-stretch 让它撑满 56px 全高，拖拽热区不至于只有中间一条细线。 -->
    <div class="flex-1 self-stretch"></div>

    <!-- Right: 工具栏组（搜索 / 番茄钟 / 设置 / 检查更新 / 计时胶囊）
         番茄钟从主导航移到这里：它是「随时可用的工具」而非学习闭环里的一环，
         和搜索、设置同属常驻工具，放右侧既减轻左侧拥挤度，也和 TimerCapsule 就近成组。 -->
    <div class="flex items-center gap-2" data-tauri-drag-region="false">
      <button type="button" class="wb-icon-btn wb-search-trigger" title="搜索 (⌘K)" @click="openSearch">
        <Icon name="search" size="md" />
        <kbd class="wb-kbd">⌘K</kbd>
      </button>
      <router-link
        v-for="t in toolItems"
        :key="t.key"
        :to="t.path"
        class="wb-icon-btn"
        :class="{ 'is-active': isActive(t) }"
        :title="t.label"
        :aria-label="t.label"
        @click="closeMenus"
      >
        <Icon :name="t.icon" size="md" />
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
// 桌面端顶部导航（2026-08-09「顶栏精简」重构；2026-08-10 移除「工作台」单列入口与「本地离线」徽标）
// 学习闭环：采集 → 内化 → 巩固 → 输出，外挂「规划」与常驻工具。
//   首页「工作台」经左上角 Logo 进入，不再占主导航一格；
//   收集箱(input) / 笔记·文档库(整理) / 复习(巩固·父级)
//   / 费曼故事·思维导图(输出) / 规划(父级：日程计划·四象限·习惯打卡)
//   右侧工具栏：搜索 · 番茄钟 · 设置 · 检查更新 · 计时胶囊
//
// 本次改动要点：
//   1. 原先平铺的「日程计划 / 四象限 / 习惯打卡」三个独立入口，合并为父级下拉「规划」；
//      该父级**不挂路由**（router/index.ts 里没有也不需要 /plan），纯粹是下拉容器。
//   2. 番茄钟从主导航移入右侧工具栏（图标按钮），主导航由 11 项降到 8 项。
//   3. 桌面/窄窗两套重复模板合并成一套，靠 `hidden lg:flex` 做响应式裁剪。
//
// 关键约束：Vue3 <script setup lang="ts"> + Pinia(storeToRefs) + Tailwind + --kb-* token + lucide(Icon) + vue-router。
// 注意：番茄钟（2026-08-08 起）不再走 pomodoro_popup 弹窗，就是普通路由跳转 /pomodoro。
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { onClickOutside } from '@vueuse/core';
import Icon from '@/components/ui/Icon.vue';
import TimerCapsule from '@/components/layout/TimerCapsule.vue';
// 无边框窗口的自绘红黄绿；非 Tauri 宿主（浏览器预览）下组件内部自行隐藏
import WindowControls from '@/components/layout/WindowControls.vue';
import { notify } from '@/utils/toast';
import { useSearchStore } from '@/store/search-store';
import { useDashboardStore } from '@/store/dashboard-store';
import { useReviewStore } from '@/store/review-store';
import { storeToRefs } from 'pinia';
// 顶层静态导入 Tauri API：与 App.vue / pomodoroStore 一致，避免 build 模式动态 import chunk 静默失败。
import { invoke } from '@tauri-apps/api/core';

const route = useRoute();
const rootEl = ref<HTMLElement | null>(null);
/** 当前展开的父级下拉 key（复习 / 规划互斥，同一时刻最多开一个） */
const openKey = ref<string | null>(null);
/** 「更多」下拉（仅窄窗） */
const moreOpen = ref(false);
const updating = ref(false);
const searchStore = useSearchStore();

// 悬停已能开合下拉，但点击父级（规划）也会锁定展开态，
// 因此需要 onClickOutside 兜底：点顶栏之外的任意位置一律收起。
onClickOutside(rootEl, () => closeMenus());

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
/** 角标数据源，取值对应下方 badgeValue() 里的两个派生量 */
type BadgeSource = 'pendingCaptures' | 'dueReviews';

/** 下拉子项：一定是可跳转的具体路由 */
interface NavChild {
  path: string;
  label: string;
  icon: string;
}

interface NavBase {
  /**
   * 唯一键。不能拿 path 当 key —— 「规划」是纯下拉容器，压根没有 path，
   * v-for key 与下拉开合标识都依赖这个字段。
   */
  key: string;
  label: string;
  icon: string;
  /**
   * 高亮匹配前缀白名单。缺省时退化为 `[path]`，即「只有自己这条路径（及其子路径）会高亮」。
   *
   * 为什么需要它：顶栏是**功能分组**视图，而路由表是**扁平**的——同一个业务域的页面
   * 因为历史原因散落在不同前缀下（详见 router/index.ts 的注释：/library、/mindmap、
   * /inbox、/schedule、/habits、/quadrant 都刻意没挂进 /workbench，
   * 否则会和「工作台」用 startsWith 互相误高亮）。
   * 于是「一个顶栏项 ↔ 一条路由前缀」的假设不成立，必须显式声明它代表哪几段路由。
   *
   * 两个典型场景：
   *   复习：/workbench/review（父级自身，点击落这里）、/review（间隔复习，含别名
   *         /review/flashcard）、/workbench/palace（记忆宫殿）、/workbench/recall（主动回忆）。
   *   规划：/schedule（日程计划）、/quadrant（四象限）、/habits（习惯打卡）——
   *         父级没有自己的路由，match 是它唯一的高亮依据，缺了它进任何子页面顶栏都会整个熄灭。
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
  badge?: BadgeSource;
  /** 视觉分组细竖线（位于该项之前） */
  dividerBefore?: boolean;
  /** 窄窗（<lg）时从主栏隐藏、收进「更多」下拉 */
  collapse?: boolean;
}

/** 叶子入口：点击直接跳路由，path 必填 */
interface NavLeaf extends NavBase {
  kind: 'leaf';
  path: string;
  children?: never;
}

/**
 * 父级下拉：children 必填；path **可选**——
 *   有 path（复习）：点父级跳「驾驶舱」页；
 *   无 path（规划）：纯容器，点父级只切换下拉开合。
 */
interface NavGroup extends NavBase {
  kind: 'group';
  path?: string;
  children: NavChild[];
}

/** 判别联合：kind 字段让模板里的 v-if/v-else 能安全收窄出 path，杜绝 any / 非空断言 */
type NavItem = NavLeaf | NavGroup;

const navItems: NavItem[] = [
  /* ---- 核心闭环：采集 → 整理（首页「工作台」经 Logo 进入，不再单列导航项） ---- */
  { kind: 'leaf', key: 'inbox', path: '/inbox', label: '收集箱', icon: 'inbox', badge: 'pendingCaptures' },
  { kind: 'leaf', key: 'notes', path: '/workbench/notes', label: '笔记', icon: 'file-edit' },
  { kind: 'leaf', key: 'library', path: '/library', label: '文档库', icon: 'library', dividerBefore: true },

  /* ---- 巩固：复习（父级下拉，点父级落复习驾驶舱） ---- */
  {
    kind: 'group',
    key: 'review',
    path: '/workbench/review',
    label: '复习',
    icon: 'refresh-ccw',
    match: ['/workbench/review', '/review', '/workbench/palace', '/workbench/recall'],
    badge: 'dueReviews',
    collapse: true,
    children: [
      { path: '/review', label: '间隔复习', icon: 'brain-circuit' },
      { path: '/workbench/palace', label: '记忆宫殿', icon: 'map-pin' },
      { path: '/workbench/recall', label: '主动回忆', icon: 'pen-tool' },
    ],
  },

  /* ---- 输出 ---- */
  { kind: 'leaf', key: 'story', path: '/workbench/story', label: '费曼故事', icon: 'pen-line', dividerBefore: true, collapse: true },
  // 思维导图沿用 share-2：lucide 没有 mindmap 这个图标名，写了会 fallback 成空 SVG。
  { kind: 'leaf', key: 'mindmap', path: '/mindmap', label: '思维导图', icon: 'share-2', collapse: true },

  /* ---- 规划（合并项）：日程计划 / 四象限 / 习惯打卡 三个旧入口收拢于此 ----
   * 无 path = 纯下拉容器，router/index.ts 无需（也不应）为 /plan 建路由。
   * 高亮完全靠 match，进入任一子页面父级都保持点亮。 */
  {
    kind: 'group',
    key: 'plan',
    label: '规划',
    icon: 'calendar-days',
    /* /schedule 仍留在 match 里：它已重定向到 /tasks，但重定向发生在导航守卫之后、
     * 期间 route.path 可能短暂等于 /schedule，留着它能避免顶栏在跳转瞬间闪一下熄灭。 */
    match: ['/tasks', '/schedule', '/quadrant', '/habits', '/calendar'],
    dividerBefore: true,
    collapse: true,
    children: [
      { path: '/tasks', label: '任务清单', icon: 'list-checks' },
      { path: '/calendar', label: '日历', icon: 'calendar' },
      { path: '/quadrant', label: '四象限', icon: 'layout-grid' },
      { path: '/habits', label: '习惯打卡', icon: 'check-circle-2' },
    ],
  },
];

/**
 * 右侧常驻工具（图标按钮形态，不参与主导航排版）。
 * 番茄钟原先占着主导航一格，但它和搜索/设置一样是「随时呼出的工具」，
 * 不属于学习闭环，故与设置一起编组到右侧，紧邻 TimerCapsule。
 */
const toolItems: NavLeaf[] = [
  { kind: 'leaf', key: 'pomodoro', path: '/pomodoro', label: '番茄钟', icon: 'timer', match: ['/pomodoro'] },
  { kind: 'leaf', key: 'settings', path: '/settings', label: '设置', icon: 'settings' },
];

/** 窄窗「更多」里承接的折叠入口（与主栏 hidden lg:flex 的判定同源，避免两处手写下标切片走偏） */
const moreItems = computed<NavItem[]>(() => navItems.filter((it) => it.collapse));

/* ---------------- 高亮 / 角标 ---------------- */
/** 取该项代表的路由前缀集合；纯下拉容器（无 path 且无 match）返回空数组，永不高亮 */
function navPrefixes(it: NavItem): string[] {
  if (it.match) return it.match;
  return it.path ? [it.path] : [];
}

/**
 * 判断顶栏项是否处于激活态。
 *
 * 规则：按 `match ?? [path]` 做前缀匹配（`route.path === p || route.path.startsWith(p)`）。
 * 首页「工作台」经 Logo 进入、不再单列导航项，故不再需要精确匹配特判。
 *
 * @param it 顶栏项配置，其 `match` 字段的完整语义见 NavBase 类型定义
 * @returns true 表示当前路由属于该项代表的业务域，应渲染 is-active 样式
 */
function isActive(it: NavItem): boolean {
  return navPrefixes(it).some((p) => route.path === p || route.path.startsWith(p));
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

/* ---------------- 交互：父级跳转 / 子项独立路由 ---------------- */
const router = useRouter();

/** 仅当不在当前路由时跳转，避免重复压栈 */
function navigateTo(path: string) {
  if (route.path !== path) router.push(path);
}

/**
 * 父级下拉的点击行为，按有无 path 分流：
 *   复习（有 path）→ 跳复习驾驶舱并收起下拉，保持既有手感；
 *   规划（无 path）→ 只切换展开态（触屏 / 键盘用户没有 hover，必须能点开）。
 */
function onGroupClick(it: NavGroup) {
  if (it.path) {
    closeMenus();
    navigateTo(it.path);
    return;
  }
  openKey.value = openKey.value === it.key ? null : it.key;
}

/**
 * 收起全部下拉（父级下拉 + 窄窗「更多」）。跳转本身交给 router-link。
 * 历史包袱说明：这里原先还负责拦截番茄钟项去呼出 pomodoro_popup 弹窗，
 * 弹窗形态已于 2026-08-08 移除，拦截逻辑随之删干净，番茄钟回归普通路由。
 */
function closeMenus() {
  moreOpen.value = false;
  openKey.value = null;
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
/* 顶栏外壳：窗口无边框后，这一条同时承担「应用顶栏」和「窗口标题栏」两个身份。
 *
 * 背景刻意用 --kb-card 派生的半透明色 + 毛玻璃，而不是写死 bg-white/90：
 * 本项目 tailwind.config.js 没有 darkMode 键（默认 media = 跟随 OS），
 * 而应用主题走的是 documentElement[data-theme]，两者不同源——
 * 写 dark: 变体会在「OS 浅色 + 应用深色」时露出白条。明暗一律交给 token。
 *
 * 半透明是有实际意义的：内容区滚动时会从顶栏下方穿过，毛玻璃能透出下面的色块流动，
 * 这正是 macOS 原生应用顶栏的观感；不透明的话顶栏会像一块贴上去的补丁。
 */
.kb-topnav {
  background: color-mix(in srgb, var(--kb-card) 82%, transparent);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid color-mix(in srgb, var(--kb-border) 85%, transparent);
  /* 拖拽区内禁止文本选中：否则按住顶栏拖窗口会顺手把「LectoForge」选蓝一片 */
  user-select: none;
  -webkit-user-select: none;
}

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

/* 右侧工具栏图标按钮的激活态：番茄钟 / 设置 处于当前路由时与主导航同色 */
.wb-icon-btn.is-active {
  color: var(--kb-primary);
  background: var(--kb-muted);
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
