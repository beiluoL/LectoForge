# LectoForge 桌面端 UI 设计审查与功能增强建议

> **审查日期**：2026-08-26
> **审查范围**：`src-ui/src` 全部 120 个 `.vue` 组件 / 6 个共享 CSS（`style.css` + 各模块 CSS）/ 31 个视图入口 / 20 个 Pinia store
> **基线文档**：`.workbuddy/artifacts/UI优化文档.md`（2026-08-25，本报告在其基础上做了代码复核与运行时实测）
> **审查方法**：
> 1. 静态扫描：`rg` 检索 `dark:` 变体、硬编码色值、`var(--kb-x,#hex)` 回退、未定义令牌、离梯字号、缩水控件；
> 2. 运行时实测：启动 `npm run dev:all`（Vite 5173 + Fastify 8787），用 Playwright 无头 Chrome（系统 Chrome，`channel:'chrome'`）按 1280×800 与 960×800 实测计算样式；
> 3. 对比度计算：按 WCAG 2.1 相对亮度公式（sRGB 非线性化）逐对计算。
> **窗口基线**：1200×800，最小 960×640（`src-tauri/src/lib.rs:735`）
> **主题机制**：`documentElement[data-theme='dark']` 切换；`tailwind.config.js` 未配置 `darkMode`（默认 `media`），**`dark:` 变体跟随 OS 而非应用内主题** —— 这是本次审查中最大一类问题的根因。

---

## 一、执行摘要

### 1.1 总体评价

项目的**设计令牌体系是明显亮点**：`style.css` 定义了完整且规范的 `--kb-*` 令牌（颜色、字号阶梯、图标阶梯、4px 间距网格、圆角、阴影、交互反馈令牌），全项目有 **3,569 处** `var(--kb-*)` 引用，双主题（`data-theme`）覆盖大部分常规组件；全局 `:focus-visible` 焦点环（`style.css:434-441`）与 `prefers-reduced-motion` 守护（`style.css:1200`）已存在。

但存在**系统性的「令牌穿透」**：硬编码色值 **465 处**、`dark:` 变体 **23 处**、`var(--kb-x,#hex)` 回退 **252 处**、未定义令牌 4 类。主题在「OS 浅色 + 应用深色」组合下大面积失效，对比度存在多处不达标，控件尺寸整体低于 32px 可用性下限。

### 1.2 严重度统计（基线 + 本次实测）

| 严重度 | 数量 | 一句话结论 |
|---|---|---|
| **P0（深色主题下视觉错误/不可用）** | 9 | `dark:` 变体 + 硬编码白底在「OS 浅色 + 应用深色」时必然失效（已实测坐实 3 项）；未定义 CSS 变量导致样式静默失效 |
| **P1（明显不一致/对比度不足/交互缺失）** | 24 | 19+ 处 JS 硬编码色值、控件尺寸混乱、hover-only 交互键盘不可达、字号突破阶梯 |
| **P2（轻微/规范漂移）** | 16 | 魔法数字、遮罩写死、图标尺寸分裂、加载态缺失 |

### 1.3 三大根因

1. **主题机制错位**：顶栏下拉面板使用 `dark:` 变体 + `bg-white/80`，与项目「明暗一律走 token」铁律冲突（`DesktopTopNav.vue:525` 注释已自我警告，代码仍违反）；Tailwind `dark:` 默认走 `media`，在「OS 浅色 + 应用深色」下必然失效。
2. **业务组件绕过令牌**：首页、记忆宫殿、日历、图表等组件直接写死色值，深色主题大面积失效。
3. **控件尺寸缩水**：文件树、AI 侧栏、图表工具栏等控件缩到 22–28px，低于 32px 桌面可用性下限（Apple HIG / Fluent 均 ≥ 32px；本项目 `.kb-btn-icon` 已是正确的 34×34 标杆）。

### 1.4 核心实测证据（摘录）

| # | 实测项 | 结果 | 判定 |
|---|---|---|---|
| E1 | 顶栏下拉面板背景（应用深色 + OS 浅色） | `rgba(255,255,255,0.8)`，菜单文字 `rgb(230,232,236)` | ❌ 对比度 ≈ **1.18:1**（白底浅字） |
| E2 | 首页 `.wb-hero` 背景（应用深色） | 仍为 `rgb(245,247,255)→rgb(255,255,255)→rgb(255,243,236)` 浅色渐变，前景 `rgb(230,232,236)` | ❌ 浅字浅底 |
| E3 | 闭环导航 `.wb-loop-nav` 背景 | `rgba(255,255,255,0.72)` 硬编码（代码确认） | ❌ 深色下白条 |
| E4 | 全站 `<32px` 控件 | 每页 3 个 18×18（番茄钟胶囊）、3–4 个 30×30（图标钮）；文档库 35 个 22×22、四象限 5 个 22×22、日历 2 个 26×26 等 | ❌ 大量低于 32px |
| E5 | `<12px` 字号 | 导航角标 10px、闭环步骤 10px、⌘K 10px、日历 tab 10.5px、空态提示 10.5px、周几表头 11px、复习「新卡」11.5px | ❌ 突破 11px 阶梯下限 |
| E6 | 事件色白字对比度 | 橙 `#F59E0B` 2.15:1、绿 `#10B981` 2.54:1、深色主色 `#4F86F9` 3.44:1、红 `#EF4444` 3.76:1、高亮橙 `#FF6B35` 2.84:1 | ❌ 均 < 4.5:1 |
| E7 | 主色白字对比度 | `#3B6FE0` + 白 = 4.63:1 | ✅ 刚好 AA |

> 截图证据见 `docs/ui-review-assets/`：`home-light.png`（浅色首页）、`home-dark-app-light-os.png`（深色首页，Hero 浅底浅字）、`nav-dropdown-dark-app-light-os.png`（深色应用 + OS 浅色下拉白底浅字）、`nav-dropdown-light.png`（对照）、`home-960.png`（960px 窄窗）、`calendar-light.png`、`quadrant-light.png`、`library-light.png`、`diagram-light.png`。

---

## 二、维度 1：配色

### 2.1 现状亮点

- 令牌单一来源（F-07）：`style.css:root` 是全项目唯一颜色定义处，`tailwind.config.js` 色板与之一致（主色 `#3B6FE0` 家族 + signature 高亮橙 `#FF6B35`）。
- 语义色完整：primary / accent（绿）/ destructive（红）/ warning（橙）/ highlight（橙红）均有双主题定义；深色下主色提亮为 `#4F86F9`、前景 `#E6E8EC`。
- 80/20 主辅色关系（主蓝 + 高亮橙）设计意图清晰，且有 `--kb-highlight-soft/border` 软背景配套。

### 2.2 主要问题

| 编号 | 位置 | 问题 | 优先级 |
|---|---|---|---|
| C-01 | `DesktopTopNav.vue:84-95,142-174` | 4 个下拉面板 `dark:` 变体 + `bg-white/80`；实测「应用深色 + OS 浅色」白底浅字 ≈1.18:1 | 🔴 高 |
| C-02 | `Workbench.vue:347,361-374` | Hero 硬编码浅色渐变 + 固定光斑/网格线，深色下浅字浅底、网格线消失 | 🔴 高 |
| C-03 | `workbench-shared.css:17,34-37,105` + `Inbox/index.vue:156` | `.wb-loop-nav` 白底毛玻璃 `rgba(255,255,255,0.72)`、渐变基色 `#F5F7FF`、网格线写死 | 🔴 高 |
| C-04 | `OcrModal.vue:310-346` 等 | 20+ 处 `var(--kb-x,#hex)` 回退；`--kb-surface`/`--kb-text-muted` 为不存在的令牌；回退值即硬编码 | 🔴 高 |
| C-05 | `doc-library.css:852,872,929`、`Interview.vue:484-485` | `var(--kb-fs-sm)`、`var(--kb-fs-body)` 未定义（应为 `--kb-fs-caption` / `--kb-fs-body-md`），样式静默回退 | 🔴 高 |
| C-06 | `Diagram/x6/DiagramToolbar.vue:179,183,198,241,256` 等 | 脚本注入 `#FFFFFF/#475569/#00000033/#0F172A` 写死色值；`:global(.dark)` 死选择器（应 `:root[data-theme='dark']`） | 🔴 高 |
| C-07 | `components/ui/ToastHost.vue:9-57,123-147` | `bg-white text-gray-800`、`bg-primary-500` 等硬编码，靠 `style.css:240-259` 的 `!important` 兜底存活，脆弱 | 🟠 中 |
| C-08 | `Workbench.vue:220-295`、`MemoryPalace/*`、日历事件色、`MindmapRenderer:88` | 19+ 处 JS 写死色值，深色不跟随主题 | 🟠 中 |
| C-09 | `nav-badge`（`DesktopTopNav.vue:570-580`） | 角标文字固定 `#fff`，落在 `--kb-warning` 上（浅色 2.15:1、深色 `#FBBF24`+白 1.64:1） | 🟠 中 |

### 2.3 改进建议

1. **顶栏下拉面板令牌化（修复 C-01，🔴 高）**：去掉 `dark:` 变体，改用
   `background: color-mix(in srgb, var(--kb-popover) 86%, transparent)`、`border-color: var(--kb-border)`；
   菜单 hover 用 `var(--kb-muted)`，激活项用 `color: var(--kb-primary)` + `background: color-mix(in srgb, var(--kb-primary) 10%, transparent)`。
   验收：`rg "dark:" src-ui/src` 清零（含注释仅留说明）。
2. **Hero / 闭环导航令牌化（修复 C-02/C-03，🔴 高）**：
   ```css
   .wb-hero {
     background: linear-gradient(135deg,
       color-mix(in srgb, var(--kb-primary) 7%, var(--kb-card)) 0%,
       var(--kb-card) 55%,
       color-mix(in srgb, var(--kb-highlight) 6%, var(--kb-card)) 100%);
   }
   .wb-loop-nav { background: color-mix(in srgb, var(--kb-card) 72%, transparent); }
   ```
3. **回退值清理（修复 C-04/C-05/C-06，🔴 高）**：`var(--kb-surface,#fff)` → `var(--kb-card)`；`var(--kb-text-muted,#6b7280)` → `var(--kb-muted-foreground)`；`var(--kb-fs-sm)` → `var(--kb-fs-caption)`；`var(--kb-fs-body,.9rem)` → `var(--kb-fs-body-md)`；`var(--kb-radius-lg,14px)` → `var(--kb-radius-lg)`。脚本注入色值改经 `getComputedStyle` 读取令牌。验收命令见 §七。
4. **角标文字令牌化（修复 C-09，🟠 中）**：`.nav-badge` 的 `#fff` 改为 `var(--kb-warning-foreground)`（深色下自动变深色文字）。
5. **JS 色值收口（修复 C-08，🟠 中）**：图表/日历/记忆宫殿的数据色板改为 `'var(--kb-primary)'` 等令牌字符串；确实需要实色的场景用 `getComputedStyle(document.documentElement).getPropertyValue('--kb-x')` 读取。

---

## 三、维度 2：布局

### 3.1 现状亮点

- 布局区域语义化（`.kb-region-topbar/sidebar/content/accent`）已建立「侧栏 → 顶栏 → 内容 → 强调」的层级语言。
- 主内容区 `max-w-7xl` 居中、卡片网格、弹窗/抽屉等模式基本成型。

### 3.2 主要问题

| 编号 | 位置 | 问题 | 优先级 |
|---|---|---|---|
| L-01 | `Workbench.vue` 全页 | 首页 6 大区块并列（Hero + 今日聚焦 + 数据看板 + 模块网格 + 方法网格 + 闭环导航），「今日聚焦」与看板数字同源重复，主次难分 | 🟠 中 |
| L-02 | `Review/index.vue` 顶栏 | 同时承载番茄钟胶囊 + 返回 + 徽章 + 进度 + 3 个操作按钮，信息密集 | 🟠 中 |
| L-03 | `Diagram/components/DiagramToolbar.vue`、`x6/DiagramToolbar.vue` | 48px 条内 5 组约 20 个控件 / 25+ 平级控件，全部同款 `kb-btn-sm`，无分组无主次 | 🟠 中 |
| L-04 | `QuadrantCard.vue:15-49` | 卡片头部 7 元素挤一行（图标+标题+进度+优先级+菜单+勾选） | 🟡 低 |
| L-05 | `CalendarMonthView.vue` | 42 格内事件 11px 字号 + `+N` 10px，周末底色深色下与卡片几乎同色 | 🟠 中 |
| L-06 | 全站 | 间距魔法数字批量（`gap:7px/5px/9px/6px`、`padding:14px 10px` 等，见基线 S-01~S-06），违反 4px 网格 | 🟡 低 |
| L-07 | **断点冲突（新发现）** | 窗口最小 960px（`lib.rs:735`），Tailwind `lg`=1024px → **960–1024px 区间导航全部折叠进「更多」**，出现「缩一点窗口导航就跳没」的灰色地带（实测 `home-960.png`） | 🟠 中 |
| L-08 | 全站弹窗 | 弹窗宽度无统一规格（表单/确认/复杂编辑各自为政） | 🟡 低 |

### 3.3 改进建议

1. **断点对齐（修复 L-07，🟠 中，改动一行零风险）**：`tailwind.config.js` 加 `screens: { lg: '992px' }`，使折叠边界 < 最小窗口宽；或 `lib.rs` 最小宽度提到 1024px（推荐前者）。
2. **首页重构（修复 L-01，🟠 中）**：Hero 收窄；「今日聚焦 + 数据看板」合并为顶部 4 宫格速览；主内容双栏 = 学习闭环模块（4 宫格）+ 侧栏（复习进度 + 快捷入口）；闭环导航改底部横向胶囊条。
3. **复习页收敛（修复 L-02，🟠 中）**：次要操作收进「更多」菜单或次级工具栏，顶栏只留 1 个主操作。
4. **图表工具栏分组（修复 L-03，🟠 中）**：按「画布操作 / 样式 / 排列 / 导出」分组，次要组收进图标抽屉。
5. **间距规范化（修复 L-06，🟡 低）**：按基线 §1.2 清单逐处收敛到 4/8/12/16/24/32px。
6. **弹窗规格统一（修复 L-08，🟡 低）**：表单 480px、确认 360px、复杂编辑 640px，统一 `max-h-[85vh] overflow-y-auto`。
7. **日历月视图（修复 L-05，🟠 中）**：事件改「圆点/细条指示 + 选中展开」形态，字号升到 11px 以上。

---

## 四、维度 3：字体

### 4.1 现状亮点

- 完整字号阶梯已定义：40/32/24/20/16/14/13/12/11px（`--kb-fs-h1 … --kb-fs-xs`），行高 1.2–1.6，字重语义化。
- 字体三件套定位清晰：Noto Sans SC（正文）+ Noto Serif SC（展示标题/Hero）+ JetBrains Mono（代码/数字），并做了国内镜像（fonts.loli.net）。

### 4.2 主要问题

| 编号 | 位置 | 问题 | 优先级 |
|---|---|---|---|
| F-01 | 导航角标、闭环步骤、⌘K | 实测 **10px**（`nav-badge` 10px、`.wb-loop-step` 序号 10px、命令面板 ⌘K 10px），突破 11px 下限 | 🟡 低 |
| F-02 | `CalendarMonthView.vue:42,52`、`CalendarTimeGridView.vue:23,39,66,100` | 事件 11px、`+N` 10px、tab 10.5px、空态提示 10.5px（实测） | 🟠 中 |
| F-03 | `Review/index.vue`、`Quadrant/*`、`Habits/*`、`FlashCard.vue` 等 | 离梯字号批量（11.5/12.5/10.5/13.5px，见基线 F-03 全清单） | 🟡 低 |
| F-04 | `SpaceCanvas.vue`、`LociList.vue`、`OutlineEditor.vue` | `text-[11px]/[12px]` 任意写法、`depth*22px` 魔法缩放 | 🟡 低 |
| F-05 | 字体加载 | 依赖远程字体（fonts.loli.net），离线/内网启动时首帧字体闪变（FOUT），且非中文场景下衬线标题辨识度需抽查 | 🟡 低 |

### 4.3 改进建议

1. **角标/最小字号达标（修复 F-01/F-02，🟠 中）**：全站最小字号收敛到 11px（`--kb-fs-xs`）；日历 tab/空态提示升到 11–12px；`+N` 指示器可用色块替代纯文字。
2. **离梯字号收敛（修复 F-03/F-04，🟡 低）**：按基线 §1.3 清单逐处改为语义类（`text-xs/sm/base`）或 `--kb-fs-*`；`OutlineEditor` 缩进改 4px 网格倍率。
3. **字体加载策略（🟡 低）**：把三套字体下载到 `public/fonts/` 自托管，用 `font-display: swap` 并在 `style.css` 预载关键字体；中文字体体积大，可只在 Hero/H1–H3 用衬线，正文一律系统无衬线回退。

---

## 五、维度 4：图标

### 5.1 现状亮点

- 全项目统一 `lucide-vue-next` + `Icon.vue` 封装，绝大多数区域图标风格一致、语义直观。
- 图标尺寸阶梯（10/12/14/16/18/20/24/32px）与导航间距令牌（`--kb-nav-gap` 8px / `--kb-sidebar-gap` 12px）已定义。

### 5.2 主要问题

| 编号 | 位置 | 问题 | 优先级 |
|---|---|---|---|
| I-01 | `Diagram/x6/DiagramToolbar.vue:4-103`、`DiagramLayersPanel.vue:10-19`、`DiagramOutlineTreeItem.vue:29` | **emoji/字符当图标**（`↶ 🗑 🖼 ▢ ✏ 🕘 👁 🚫 🔒 ▲ ✕`），脱离 Icon 体系，跨平台渲染为豆腐块 | 🔴 高 |
| I-02 | `AiSettings.vue`、`AiInsights.vue`、`Habits/index.vue`、`Pomodoro/*`、`Workbench.vue` | `:size="22/24/26/15/28/30"` 等裸数字 8+ 档，不在图标阶梯内 | 🟡 低 |
| I-03 | `Workbench.vue`、`Review/*` | 图标-文字间距 4/5/6/8px 混用 | 🟡 低 |
| I-04 | `ToastHost.vue` | 关闭按钮用文本 `×` 而非 Icon | 🟡 低 |

### 5.3 改进建议

1. **图表模块图标化（修复 I-01，🔴 高）**：emoji/字符全部替换为 `Icon.vue`（需先补 `undo/trash/image/square/pen-tool/clock/eye/eye-off/lock/unlock/chevron-up/x` 等图标映射），并补 `:aria-label`。
2. **图标尺寸语义化（修复 I-02，🟡 低）**：模板统一 `size="xxs|xs|sm|md|lg|xl|2xl|3xl"`，禁止裸数字（阶梯外需评审）。
3. **间距统一（修复 I-03，🟡 低）**：导航 8px、按钮 6px、列表行 12px。
4. **Toast 关闭钮（修复 I-04，🟡 低）**：`×` → `Icon name="x"`，并保证 32px+ 热区。

---

## 六、维度 5：层次

### 6.1 现状亮点

- 顶部导航、命令面板、侧栏有明确的 `aria-label/aria-haspopup` 等语义；页面级「主标题 → 区块 → 卡片」的语义标签基本齐备。
- Hero 使用衬线大标题 + 主 CTA，品牌记忆点明确。

### 6.2 主要问题

| 编号 | 位置 | 问题 | 优先级 |
|---|---|---|---|
| V-01 | `Workbench.vue` | 6 区块并列、同源数字重复，「第一眼该看什么」不明确（见 L-01） | 🟠 中 |
| V-02 | `Review/index.vue` 顶栏 | 主操作与辅助操作视觉权重相同 | 🟠 中 |
| V-03 | 图表工具栏 | 25+ 平级控件无主次（见 L-03） | 🟠 中 |
| V-04 | `QuadrantCard.vue:15-49` | 卡片头部 7 元素同权重 | 🟡 低 |
| V-05 | `CalendarMonthView.vue` | 事件信息过载（见 L-05） | 🟠 中 |
| V-06 | `Habits/index.vue:70-101` | 62px 进度环（无标签）与打卡胶囊并置，双主视觉抢注意力 | 🟡 低 |

### 6.3 改进建议

1. **每屏一个主 CTA（🔴 高，横切原则）**：首页主 CTA 唯一（快速记录），其余降为次级；复习页主 CTA 唯一（开始复习），其余进次级工具栏。
2. **注意力引导（🟠 中）**：用「留白分组」而非边框区分区块；主数字用 `--kb-primary`/`--kb-highlight` 强调（高亮橙只用于少数高光数字），灰度承担大部分层级。
3. **习惯卡片（修复 V-06，🟡 低）**：进度环缩小并下沉为辅助元素，打卡按钮提升为主视觉。

---

## 七、维度 6：交互

### 7.1 现状亮点

- 全局 `:focus-visible` 焦点环、`prefers-reduced-motion` 守护、`--kb-press-y` 按压位移已建立统一语言。
- 乐观更新 + 失败回滚 + toast 的套路已在任务/习惯/四象限等模块贯彻。

### 7.2 主要问题

| 编号 | 位置 | 问题 | 优先级 |
|---|---|---|---|
| X-01 | `AiSidebar.vue:325-332` | 「更多」按钮 `opacity:0` 仅 hover 浮现，**键盘不可达**（无 `:focus-within`） | 🔴 高 |
| X-02 | `AiChatView.vue:505-524` | 气泡操作栏 hover-only；流式输出无光标/加载指示 | 🔴 高 |
| X-03 | `doc-library.css:321-331` | 文件树双操作钮 hover-only，触摸/键盘不可发现 | 🔴 高 |
| X-04 | `DocLibrary/EditorArea.vue`、`MindMap/*` | ⌘S 保存仅靠 11px 小胶囊状态文字，无 toast 确认 | 🟠 中 |
| X-05 | `Settings/sections/*` | 测试/保存/检查更新/清除重置均无 loading/disabled 态 | 🟠 中 |
| X-06 | `MemoryPalace/components/ReviewSession.vue:185` | `grade()` 无 busy 锁，可连点重复提交 | 🟠 中 |
| X-07 | `Habits/components/HabitDetailDrawer.vue:48,68` | `loadingStats` 已计算但未接入模板，加载中显示「暂无数据」假空态 | 🟠 中 |
| X-08 | `Calendar/components/AddEventModal.vue:26-45` | 两栏 tab 无 hover 态 | 🟡 低 |
| X-09 | `ReviewHeatmap.vue:179`、`HabitDetailDrawer` | 热力格无 hover 提示/tooltip | 🟡 低 |
| X-10 | `CalendarMonthView`/`CalendarTimeGridView` | 事件条无 hover 态、日列空白区不可点 | 🟡 低 |
| X-11 | `QuadrantCard.vue:27` | 菜单按钮无 `aria-expanded` | 🟡 低 |
| X-12 | `Pomodoro/index.vue:172` | `.pm-switch` 无 `:focus-visible` | 🟡 低 |

### 7.3 改进建议

1. **hover-only 一律补 `:focus-within`（修复 X-01/02/03，🔴 高）**；删除类操作必须常显（22→34px 后不占空间）。
2. **流式光标 + 停止生成（修复 X-02，🔴 高）**：流式中显示 3px 宽 `--kb-primary` 呼吸光标（`@keyframes blink 1s`），并给「停止生成」按钮。
3. **保存双反馈（修复 X-04，🟠 中）**：编辑器/导图/设置统一「toast + disabled」双反馈，复用 `notify()`。
4. **loading/防重复（修复 X-05/X-06，🟠 中）**：设置页按钮统一 busy 标志 + `:disabled`；复习 `grade()` 加 busy 锁。
5. **假空态修复（修复 X-07，🟠 中）**：抽屉模板接入 `v-if="loadingStats"` 骨架。
6. **可访问细节（修复 X-08~X-12，🟡 低）**：tab 补 hover、热力格补 tooltip（`title` 或自定义）、菜单补 `aria-expanded`、switch 补 `:focus-visible`。

---

## 八、维度 7：控件尺寸

### 8.1 现状亮点

- 全局 `.kb-btn`（34px）/`.kb-btn-icon`（34×34）/`.kb-btn-sm`（28px）/`.kb-input`/`.kb-select`（38px）已定义三档规格，是正确的标杆。

### 8.2 主要问题（实测 bounding box）

| 位置 | 控件 | 实测尺寸 | 优先级 |
|---|---|---|---|
| `TimerCapsule.vue:150-151` | 番茄钟胶囊开始/暂停/重置（每页 3 个） | **18×18** | 🔴 高 |
| `workbench-shared.css:358` | `.wb-icon-btn`（每页 3–4 个） | 30×30 | 🟠 中 |
| `doc-library.css:328-331` | 文件树行内操作钮 | **22×22（×35）** | 🔴 高 |
| `doc-library.css:199-204` | `.dl-icon-btn` 工具栏 | 26×26 | 🟠 中 |
| `QuadrantCard.vue:308-333` | 卡片操作钮 / `qd-tiny` | 24×24 / **22×22（×5）** | 🟠 中 |
| `QuadrantCard.vue:411-412` | 勾选框 | 26×18 | 🟠 中 |
| `CalendarHeader.vue:112-113` | 月切换按钮 | 26×26 | 🟠 中 |
| `Review/index.vue` | 返回钮 `rv-back` / 番茄钟链接 `rv-pomo-link` | 30×30 / 60×18 | 🟠 中 |
| `MindMap/mind-map.css:41,129-134` | 工具栏钮 / `mm-seg-item` | 26×26 / 24px 高 | 🟠 中 |
| `WorkbenchNotes.vue` | `notes-view-btn` | 30×26 | 🟡 低 |
| `AiSidebar.vue:325`、`AiChatView.vue:529` | 「更多」/ 气泡操作钮 | 26×26 / 28×28 | 🟠 中 |
| `Inbox/index.vue` | `qc-tag` / `qc-mic` | 26px 高 / 28px 高 | 🟡 低 |

### 8.3 改进建议

1. **全站收敛为三档（🔴 高）**：S 紧凑 28px（`.kb-btn-sm`）、M 标准 34px（`.kb-btn`/`.kb-btn-icon`）、L 大 38px（输入/下拉/主操作）。所有 22/24/26/30px 自造控件并入三档，删除各模块自造的 `.dl-icon-btn`/`.mm-icon-btn`/`.rv-back`/`.rql-icon-btn` 等散落定义。
2. **番茄钟胶囊（🔴 高）**：18×18 纯图标按钮外层加 32px 容器（`p-1.5`），热区 32×32，视觉保持紧凑。
3. **纯图标按钮统一 `.kb-btn-icon`（34×34）**；S 档图标钮用 `.kb-btn-sm.kb-btn-icon`（28×28），不再出现 22/24/26px。

---

## 九、维度 8：对比度（WCAG AA）

### 9.1 实测对比度表（WCAG 相对亮度计算）

| 前景/背景组合 | 对比度 | 判定（正文需 ≥4.5:1） |
|---|---|---|
| `#3B6FE0`（主色）+ 白 | 4.63:1 | ✅ 刚好达标 |
| 深色主色 `#4F86F9` + 白 | 3.44:1 | ❌ 仅大号字（≥18.66px 粗 / 24px）可达 3:1 |
| 橙 `#F59E0B` + 白 | 2.15:1 | ❌ |
| 橙 600 `#D97706` + 白 | 3.19:1 | ❌（大号字可达） |
| 绿 `#10B981` + 白 | 2.54:1 | ❌ |
| 绿 600 `#059669` + 白 | 3.77:1 | ❌（大号字可达） |
| 红 `#EF4444` + 白 | 3.76:1 | ❌ |
| 高亮 `#FF6B35` + 白 | 2.84:1 | ❌ |
| 灰 400 `#9CA3AF` + 白 | 2.54:1 | ❌（muted 辅助文字过浅） |
| 深色 `--kb-warning` `#FBBF24` + 白（nav-badge） | 1.64:1 | ❌ |
| 深色 muted-foreground `#9AA1AC` + 深色卡片 `#1A1D23` | 6.49:1 | ✅ |

### 9.2 高风险场景（代码确认）

| 场景 | 坐标 | 问题 |
|---|---|---|
| 日历事件白字 + 橙/绿事件底色 | `CalendarMonthView.vue:165`、`CalendarTimeGridView.vue:99` | 2.15–2.54:1，深色下更差 |
| 日历今日格白字 + 深色主色 | `CalendarMonthView.vue:134` | ≈3.44:1，仅大号字豁免 |
| 首页警告徽章白字 + `--kb-warning` | `Workbench.vue:490` | 2.15:1 |
| 顶栏角标白字 + warning 底 | `DesktopTopNav.vue:570-580` | 深色 1.64:1 |
| 事件圆点 `#b0b0b0` | `CalendarMonthView.vue:207`、`TimeGrid.vue:276` | 深色格上对比不足 |
| 空状态图标 `text-gray-300` | `TaskView.vue:88` | 「OS 深色 + 应用浅色」或深色下随主题漂移 |
| 代码块固定 `#1a1d23/#e6e6e6` | `FlashCard.vue:358,367` | 不随主题 |

> macOS 交通灯 `#ff5f57/#febc2e/#28c840` 属系统标准色，豁免；建议仅加注释说明。

### 9.3 改进建议（🔴 高，均为小改动）

1. **事件色加深一档或改深色字**：橙 → `#D97706`、绿 → `#059669` 仍差 0.7 左右，建议事件底色用 `color-mix(in srgb, var(--kb-*) 85%, #000)` 再压一档，或直接用深色文字（`--kb-foreground`/`--kb-card`）替代白字。
2. **今日格/徽章/角标**：白字改 `var(--kb-*-foreground)`（深色主题下这些令牌已自动转为深色文字）；`--kb-warning` 上的文字必须用 `--kb-warning-foreground`。
3. **muted 文字**：`text-gray-400`（2.54:1）统一换 `--kb-muted-foreground` 或加深一档 `#6B7280`（4.83:1 ✅）。
4. **代码块/事件圆点**：改 `--kb-immersive-*` / `color-mix(in srgb, var(--kb-muted-foreground) 65%, transparent)`。
5. **验收**：对日历、复习、首页、任务空态做 axe-core 扫描（`npx @axe-core/cli http://localhost:5173/calendar`），对比度项清零。

---

## 十、功能增强建议

> 优先级口径：🔴 高 = 影响正确性/可用性/无障碍，建议 1–2 周内；🟠 中 = 明显体验提升；🟡 低 = 锦上添花。

### 10.1 暗色模式完善（主线）

| # | 建议 | 优先级 | 理由 |
|---|---|---|---|
| D1 | 全量令牌化大修（P0-1~P0-7，约 15+ 文件） | 🔴 高 | 直接消除「OS 浅色 + 应用深色」白底白字/浅字浅底；纯替换，风险低 |
| D2 | 深色兜底映射回归测试（`style.css:240-259`） | 🟠 中 | 防止 `!important` 兜底被误删导致连锁失效；令牌化完成后可逐步移除兜底 |
| D3 | 主题切换即时生效 + 持久化记忆 | 🟠 中 | 设置页改主题需立即生效并记住（当前依赖 OS 与 `data-theme` 双通道，易混淆） |
| D4 | 自定义强调色换肤（基于 `--kb-*` 双主题联动） | 🟡 低 | 个性化；需先完成 D1 才能低成本落地 |

### 10.2 响应式适配优化

| # | 建议 | 优先级 | 理由 |
|---|---|---|---|
| R1 | `lg` 断点 1024→992px | 🔴 高 | 修复 960–1024 灰色地带（导航突变为「更多」），一行配置零风险 |
| R2 | 日历时间列 `sticky left-0` | 🟡 低 | 横向滚动时保留时间参照 |
| R3 | 弹窗统一宽度规格 + `max-h-[85vh]` | 🟡 低 | 多分辨率下行为可预期 |
| R4 | 全局「紧凑模式」密度档位（设置页已有开关，扩展到日历/文件树） | 🟡 低 | 信息密度按偏好调节 |

### 10.3 无障碍支持

| # | 建议 | 优先级 | 理由 |
|---|---|---|---|
| A1 | hover-only 补 `:focus-within`（AI 侧栏/文件树/气泡操作栏） | 🔴 高 | 纯键盘用户目前无法触达关键操作 |
| A2 | 对比度批量修复（§九） | 🔴 高 | WCAG AA 是底线；8+ 处不达标 |
| A3 | 触控目标收敛 ≥32px（§八） | 🔴 高 | 消除误触与命中率问题 |
| A4 | 语义/ARIA 补齐（`aria-expanded`、emoji 图标换 Icon + `aria-label`） | 🟠 中 | 屏幕阅读器体验 |
| A5 | 热力格/事件条 hover tooltip | 🟡 低 | 信息可达性 |

### 10.4 动效优化

| # | 建议 | 优先级 | 理由 |
|---|---|---|---|
| M1 | AI 流式输出光标 + 停止生成按钮 | 🟠 中 | 明确生成中状态，可中断长回复 |
| M2 | 首页骨架屏（复用 `reveal-stagger`，补加载期占位） | 🟠 中 | 消除加载抖动与布局跳变 |
| M3 | 统一动效词汇表（fade + 微位移 100–200ms，面板 200–350ms） | 🟡 低 | 减少「各组件各跳各的」 |
| M4 | 事件条 hover/选中过渡（`max-height` 展开） | 🟡 低 | 日历状态转换更清晰 |

### 10.5 数据可视化升级

| # | 建议 | 优先级 | 理由 |
|---|---|---|---|
| V1 | 学习日报 30 日趋势折线（复习量/打卡量/收集量） | 🟠 中 | 学习闭环最缺「趋势」视角 |
| V2 | 复习热力图 tooltip + 图例 | 🟡 低 | 提升热力图可读性 |
| V3 | 首页看板与今日聚焦数据去重合并（避免同源数字并列） | 🟠 中 | 消除信息重复（V-01） |
| V4 | 成就/里程碑面板（已有 `highlight-badge`/`particle-burst` 资产） | 🟡 低 | 激励持续学习 |

### 10.6 其他体验增强

| # | 建议 | 优先级 | 理由 |
|---|---|---|---|
| E1 | 保存双反馈（编辑器/导图/设置） | 🟠 中 | 消除「不知道存没存上」 |
| E2 | 文件树拖拽排序/移动（`.is-drop` 样式已是死代码，补齐 `draggable`+`@drop`） | 🟠 中 | 兑现既有设计，文档组织效率大幅提升 |
| E3 | 日历事件拖拽改期 | 🟡 低 | 直接拖比弹窗改时间快 |
| E4 | 复习批量操作（多选 → 已掌握/延后/导出） | 🟡 低 | 积压复习的处理效率 |
| E5 | 窗口尺寸/位置记忆 + 启动恢复 | 🟡 低 | 桌面质感 |
| E6 | 数据导出（复习记录/打卡 CSV/JSON） | 🟡 低 | 数据所有权 |
| E7 | 全局搜索联想 + 最近笔记（⌘K） | 🟡 低 | 高频入口提效 |

---

## 十一、最终改进清单

### 11.1 🔴 高优先级（先修正确性/可用性/无障碍）

| # | 改进项 | 涉及文件（示例） | 预估 |
|---|---|---|---|
| 1 | 顶栏下拉/空状态 `dark:` 变体清零，走令牌 | `DesktopTopNav.vue`、`TaskView.vue` | 0.5 天 |
| 2 | 首页 Hero / 闭环导航 / Inbox 毛玻璃令牌化 | `Workbench.vue`、`workbench-shared.css`、`Inbox/index.vue` | 0.5 天 |
| 3 | `var(--kb-x,#hex)` 回退与未定义令牌清理（252 处 → 0） | `OcrModal.vue`、`Interview.vue`、`doc-library.css`、`Diagram/x6/*` | 1 天 |
| 4 | 图表模块 emoji 图标 → `Icon.vue`、`:global(.dark)` → `[data-theme]` | `Diagram/x6/*`、`DiagramToolbar.vue` | 0.5 天 |
| 5 | 对比度批量修复（事件色/徽章/角标/muted/代码块） | `CalendarMonthView.vue`、`TimeGrid.vue`、`DesktopTopNav.vue`、`FlashCard.vue` | 0.5 天 |
| 6 | 控件尺寸收敛 ≥32px（18/22/24/26/30px 批量并入三档） | `TimerCapsule.vue`、`doc-library.css`、`QuadrantCard.vue`、`CalendarHeader.vue`、`mind-map.css` | 1 天 |
| 7 | hover-only 补 `:focus-within` + 删除类操作常显 | `AiSidebar.vue`、`AiChatView.vue`、`doc-library.css` | 0.5 天 |
| 8 | 断点 lg→992px | `tailwind.config.js` | 0.1 天 |

### 11.2 🟠 中优先级（体验提升）

| # | 改进项 |
|---|---|
| 9 | 设置页 loading/disabled 态、复习防重复、HabitDetailDrawer 假空态修复 |
| 10 | 编辑器/导图保存 toast 反馈 |
| 11 | AI 流式光标 + 停止生成 |
| 12 | 首页布局重构（6 区块 → 速览 + 双栏） |
| 13 | 复习页顶栏收敛、图表工具栏分组抽屉 |
| 14 | 日历月视图事件形态（点/条 + 选中展开） |
| 15 | JS 数据色值令牌化（Workbench/MemoryPalace/Calendar/MindmapRenderer） |
| 16 | 深色兜底回归测试、主题切换即时生效 |
| 17 | 学习日报 30 日趋势折线、首页看板去重 |
| 18 | 文件树拖拽排序/移动 |

### 11.3 🟡 低优先级（锦上添花）

| # | 改进项 |
|---|---|
| 19 | 字号/间距/图标尺寸按阶梯全面收敛（离梯值清零） |
| 20 | 字体自托管 + FOUT 优化 |
| 21 | 弹窗宽度规格统一、日历时间列 sticky |
| 22 | 热力图/事件条 tooltip、日历事件拖拽改期 |
| 23 | 复习批量操作、⌘K 搜索联想 |
| 24 | 窗口尺寸记忆、数据导出、成就面板、自定义强调色、紧凑模式 |

---

## 十二、验收门禁（每次合入前）

```bash
# 1. 硬编码色值清零（允许 var(--kb-*) 与 color-mix 引用令牌）
rg -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(" src-ui/src/views src-ui/src/components -g '*.vue' -g '*.css' \
  | rg -v "var\(--kb-|color-mix|//|/\*" | head -50

# 2. dark: 变体清零
rg -n "dark:" src-ui/src -g '*.vue' -g '*.css' | rg -v "//|注释|说明" | head -20

# 3. 未定义令牌清零
rg -nE "var\(--kb-(fs-sm|fs-body[^m]|text-muted|surface)\b" src-ui/src | head

# 4. 最小字号达标（不应再出现 <11px 的可见文本）
rg -nE "text-\[(10|10\.5|11\.5|12\.5|13\.5)px\]|font-size:\s*(10|10\.5|11\.5|12\.5|13\.5)px" src-ui/src -g '*.vue' -g '*.css' | head -30

# 5. 构建与类型检查
cd src-ui && node_modules/.bin/vue-tsc --noEmit && node_modules/.bin/vite build
```

### 回归风险提示

- Sprint 1 改动面大但均为**等值替换**（`dark:` → 令牌语义等价），建议 git 分支 + 每文件提交粒度。
- `style.css` 深色兜底（:240-259）**暂不删除**，待 ToastHost/工作台全令牌化后再评估。
- 图表 x6 模块需在 `tauri dev` 真机验收，浏览器预览无法覆盖 X6 运行时交互。

---

## 附录 A：本次实测数据

### A.1 控件尺寸（1280×800，无头 Chrome 实测 bounding box）

| 页面 | 小控件清单（<32px） |
|---|---|
| 全站（每页） | 番茄钟胶囊按钮 18×18 ×3；`.wb-icon-btn` 30×30 ×3–4 |
| `/inbox` | `qc-tag` 26px 高 ×7、`qc-mic` 28px 高、`wb-loop-step` 28px 高 ×4 |
| `/review` | `rv-back` 30×30、`rv-pomo-link` 60×18、`fc-mnemo-act` 27px 高 |
| `/calendar` | `cal-nav-btn` 26×26 ×2、tab 28×21 |
| `/habits` | 无额外（胶囊/图标钮除外） |
| `/quadrant` | `qd-icon-btn` 24×24 ×8、`qd-tiny` 22×22 ×5、`qd-check` 26×18 ×5 |
| `/mindmap` | `mm-seg-item` 24px 高 ×3、`mm-title-input` 28px 高 |
| `/library` | `dl-icon-btn` 26×26 ×5、**22×22 ×35**、`dl-segment` 26px 高 |
| `/diagram` | 输入框 26×26 ×2（含 13×13 颜色输入）、`kb-btn-sm` 28px 高 |
| `/workbench/notes` | `notes-view-btn` 30×26 ×2 |

### A.2 字号（<12px）

| 页面 | 采样 |
|---|---|
| `/` | 导航角标 10px、闭环步骤 10px、⌘K 10px |
| `/calendar` | tab 月/周/日 10.5px、空态提示 10.5px、周几表头 11px |
| `/review` | 「💡 新卡」11.5px |

### A.3 截图索引（`docs/ui-review-assets/`）

| 文件 | 内容 |
|---|---|
| `home-light.png` | 首页浅色整体 |
| `home-dark-app-light-os.png` | 首页「应用深色 + OS 浅色」：Hero 浅底浅字 |
| `nav-dropdown-dark-app-light-os.png` | 顶栏下拉「应用深色 + OS 浅色」：白底浅字 ≈1.18:1 |
| `nav-dropdown-light.png` | 同面板浅色对照 |
| `home-960.png` | 960px 窄窗（断点灰色地带） |
| `calendar-light.png` / `quadrant-light.png` / `library-light.png` / `diagram-light.png` | 各模块浅色现状 |

---

> 本报告问题编号（C-/L-/F-/I-/V-/X-）为本文档内部编号；与基线文档《.workbuddy/artifacts/UI优化文档.md》的 P0/P1/P2、S-*/F-*/I-*/V-*/X-* 编号映射关系见各节表格。修复顺序建议：先 §十一 高优先级 8 项（约 4–5 人日），再进入中优先级批次。
