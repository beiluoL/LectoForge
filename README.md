# LectoForge 学习工作台 · macOS 桌面应用

把 Web 项目中的「学习工作台」模块（收集箱 → 康奈尔笔记 → 间隔重复/记忆宫殿 → 费曼故事 四模块闭环）独立为 **macOS 专用**桌面应用，并扩展 **文档库（Obsidian 式本地 Markdown 工作台）** 与 **思维导图** 两大模块。

> 代码仓库：GitHub [`beiluoL/LectoForge`](https://github.com/beiluoL/LectoForge) ｜ Gitee [`beiluol/lecto-forge`](https://gitee.com/beiluol/lecto-forge)
>
> 完整技术架构与功能说明见仓库根目录《桌面端技术架构与功能手册.md》。

## 技术选型（均为各维度最推荐方案）

| 层 | 技术 | 说明 |
|----|------|------|
| 桌面外壳 | **Tauri 2** | Rust 极薄壳 + macOS 原生 WKWebView，体积小、内存省 |
| 后端 | **Node.js + TypeScript + Fastify** | 重写 Web 端 `WorkbenchController`，共 192 个端点（2026-08-13 审计值；2026-08-13 新增文档库待办扫描 `/api/library/notes/todos`、AI 导图转费曼故事 `/api/ai/mindmap/convert-to-story` 共 2 个；含 2026-08-13 新增学习日报 `/api/insight` 3 个；含番茄钟 `/api/pomodoro` 5 个、AI 25 个（v1.2 新增 `/api/ai/note/extend`、`/api/ai/note/flashcards` 增强、`/api/ai/note/generate-mindmap` 3 个）；其中收集箱 `/api/inbox` 14 个：剪藏/列表/沉淀 + 「5 大体验升级」metadata 2 个 + 「收集箱进阶」批量处理/语音上传/附件上传/去重检测 4 个 + 「间隔复习体验升级」snooze/heatmap/forgetting-curve 3 个）；v1.2 另在 `/api/workbench/notes` 下新增 `backlinks` / `tags` / `resolve` 3 个端点；2026-08-09 新增四象限任务 `/api/quadrant` 6 个：GET 列表 / POST 新建 / PUT 更新 / PUT 勾选切换 / DELETE 删除 / POST 清空已完成（详见《桌面端技术架构与功能手册.md》§7.3.1）；同日新增日历视图 `/api/calendar` 4 个：GET 按范围查询事件 / POST 新建 / PUT 更新 / DELETE 删除（详见《桌面端技术架构与功能手册.md》§7.20） |
| 数据 | **SQLite (better-sqlite3, WAL)** | 单文件本地库，离线优先、隐私可控 |
| 访问层 | **Drizzle ORM** | 类型安全 SQL，似 MyBatis |
| 前端 | **Vue 3 + Vite + vue-router** | 复用 `/workbench` 端点契约，history 路由 |

通信：Node 后端**同源托管** Vue `dist` 与 `/api/*`，窗口加载 `http://127.0.0.1:<port>`，
零 CORS、vue-router 保持 history 模式、无需 WebSocket。生产由 Tauri 启动 Node 侧车实现。

## 目录结构

```
desktopApp/
├── src-api/         # Node 后端（Fastify + SQLite + Drizzle），Route → Controller → Service 三层
│   ├── src/routes/      # 薄路由 30 模块 / 679 行：只绑定「路径 → Controller」，无任何 SQL（逐模块端点明细见《桌面端技术架构与功能手册.md》§4.1）
│   │                    # 共 192 个端点（2026-08-13 审计值）：AI /api/ai 25 + 文档库 16 + 收集箱 14 + 记忆宫殿 10 + 复习 reviews 9 + 笔记 9 + 日程 8 + 任务 8 + 思维导图 7 + 收集·剪藏 7 + 题库 7 + 四象限 6 + 习惯 7 + 故事 5 + 主动回忆 5 + 番茄钟 5 + 模拟面试 3 + 日历 4 + 数据备份 3 + 学习日报 insight 3 + 本地模型 5 + 其余（分类/配置/看板/搜索/概览/迁移/健康）若干
│   ├── src/controllers/ # 控制层 29 模块 / 2313 行：解析请求、调 Service、决定 HTTP 状态码
│   ├── src/services/    # 服务层 45 模块 / 9880 行：Drizzle 查询、文件 IO、axios 外呼
│   │   ├── sm2.ts       # SM-2 算法（与 Web 端逐位一致）+ 遗忘曲线
│   │   └── backupService.ts # child_process 拉起 backup.js 打包 + 每日备份计划持久化
│   ├── src/types/       # 契约层 26 模块 / 2043 行：DTO / VO / 结果判别联合
│   ├── src/db/          # schema + 建表 + WAL
│   └── backup.js        # 纯 JS 备份脚本（archiver 打 zip），被 Tauri 单独打进 api/backup.js
├── src-ui/          # Vue 3 前端（33 条路由 / 60 个 .vue 视图与组件 / 15 个 Pinia store：总览/收集箱(/inbox)/笔记/笔记编辑/复习驾驶舱(/workbench/review)/传统卡组(/workbench/review/card-list)/间隔复习闪卡(/review,/review/flashcard)/记忆宫殿/宫殿编辑/主动回忆/费曼故事/故事编辑/AI设置/AI洞察/文档库/思维导图/学习日报(/daily-report) + v1.1.0 新增 新手引导/设置中心/间隔复习 + 2026-08-07 新增 番茄钟(/pomodoro)/番茄钟统计(/pomodoro/stats) + 2026-08-09 新增 日程计划(/schedule)/习惯打卡(/habits)/四象限(/quadrant)/日历(/calendar)；旧 /workbench/capture 已重定向到 /inbox）；2026-08-07 复习模块收敛：顶栏「间隔复习」并入「复习」，新旧两套复习系统统一从复习驾驶舱分流；已引入 Pinia 4 状态管理（含 pomodoroStore 计时引擎、calendarStore 日历状态）+ lucide-vue-next 图标体系
├── src-tauri/       # Tauri 2 macOS 外壳（Rust 侧车启动 Node 后端）
├── scripts/         # prepare-bin.sh 生成 Node 侧车二进制
└── package.json     # 编排脚本
```

## 后端分层约定（2026-08-08 三层重构完成）

30 个路由模块已全量下沉为 **Route → Controller → Service**，新增代码必须遵守边界：

- **Route** 只声明路径、方法、参数 schema 并绑定 Controller，**禁止出现** `db.` / `drizzle-orm` / `axios` / `fetch(`。
- **Controller** 解析请求、调用 Service、决定 HTTP 状态码，**禁止写 SQL**。
- **Service** 承载 Drizzle 查询、事务、文件 IO、外部调用，**禁止引用** `FastifyRequest` / `FastifyReply`。
- 跨层错误用判别联合（如 `AiResult<T>`、`ImportOutcome`）传递，由 Controller 翻译成状态码。
- 响应信封由 `index.ts` 的 `onSend` 钩子唯一负责，Controller 直接 `return` 纯数据即可，不要手写 `{ code: 200, data }`。
- better-sqlite3 是同步的：`db.transaction((tx) => {...})` 回调**不得写成 async**，否则事务会在首个 `await` 处提前提交。

详细的层职责表、AI 模块的 `{ code, message, aiCode }` 例外契约见《桌面端技术架构与功能手册.md》§2.3.1。

## 快速开始（开发，无需 Rust）

```bash
# 1. 安装依赖
npm --prefix src-api install
npm --prefix src-ui install

# 2. 同时启动前端(5173)与后端(8787)，浏览器打开 http://localhost:5173
npm run dev:all
```
前端经 Vite 代理把 `/api` 转发到本地 Node 后端，即可完整使用四模块功能。

## 打包为 macOS .app（需 Rust 工具链）

```bash
# 1. 安装 Rust（一次性，约 1-2 分钟）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# 2. 安装 Tauri CLI（已写入根 package.json）
npm install

# 3. 生成 Node 侧车二进制（复制本机 node）
bash scripts/prepare-bin.sh

# 4. 生成应用图标（准备一张 1024x1024 png）
npm run tauri icon /path/to/icon.png

# 5. 构建 .app / .dmg
npm run tauri build
```
产物在 `src-tauri/target/release/bundle/macos/`。

## 与现有 Web 项目的数据交互

- 桌面端数据**本地优先**存于 `~/Library/Application Support/com.lectoforge.desktop/` 下 SQLite。
- 从 Web 迁移：在 Web 端导出 `workbench-export` JSON（新增只读端点即可），桌面端「导入」映射本地表。
- 分类：本地 `categories` 表（已预置 未分类/工作/学习/生活），也可从 Web 导入。

## 文档库与思维导图（新增模块）

除「学习工作台」四模块闭环外，桌面应用还内置两个面向「资料组织 / 知识结构化」的模块：

### 文档库（Obsidian 式本地 Markdown 工作台，`/library`）

- 选任意本地文件夹作为 vault，**直接读写原文件**（不导入数据库）；左目录树 + 中编辑/预览 + 右大纲三栏。
- Markdown 预览兼容 **Obsidian 语法**：双链 `[[笔记]]` / `[[笔记#标题]]` / `[[笔记|别名]]`、嵌入块 `![[笔记]]`、图片嵌入 `![[图片]]` / `![[图片|WxH]]`；点击双链可跳转对应笔记/资源。
- 左栏目录树支持**折叠/展开**（收起后内容区自动占满），搜索走后端全库检索；图片/资源经同源 `/api/library/asset` 流式返回。

### 思维导图（`/mindmap`）

- 同一文档三视图：**极简大纲**（Tab/Shift+Tab 缩进）/ **markmap 导图**（SVG 导出）/ **vue-flow 流程图**（5 种形状、双击编辑）。
- 支持 **AI 生成**思维导图（未配 Key 时返回 mock，优雅降级）。

> 两模块的前后端接口、关键技术取舍详见《桌面端技术架构与功能手册.md》§7.10 / §7.11。

## 番茄钟模块（2026-08-07 新增）

独立的专注计时模块，计时引擎常驻后台（Pinia `pomodoroStore`），切去任意页面都不会中断：

- **主页面 `/pomodoro`**：conic-gradient 圆形进度环 + 四参数配置（专注 / 小憩 / 长休息 / 每组番茄数）+ 开始 / 暂停 / 重置 / 跳过 / 退出 + 白噪音 Mini 播放器（雨声 / 溪流 / 咖啡馆，Howler 播放 `public/audio/white-noise/*.mp3`，资源缺失自动降级为 Web Audio 合成）+ 提示音设置（Web Audio 实时合成 ding / tick / alarm）。
- **统计页 `/pomodoro/stats`**：vue-chartjs 柱状图（蓝 = 专注 / 橙 = 休息，按天聚合）+ 累计专注时长 / 日均专注 / 完成番茄数三张总结卡。
- **计时精度**：基于 `Date.now()` 时间戳差值（`accumulatedMs + (now - runStartedAt)`），`setInterval` 仅 250ms 刷新进度环，后台节流 / 休眠不掉秒。
- **配置持久化**：偏好落盘 `<dataDir>/pomodoro-config.json`（后端 `GET` / `PUT /api/pomodoro/config`），前端防抖保存。
- **工作台嵌入式 + 菜单栏指示器形态（2026-08-08 重构，取代此前的独立菜单栏弹窗应用）**：番茄钟不再是一个独立的浮窗应用，而是沉浸在主工作台里的辅助工具：
  - **顶栏胶囊 `TimerCapsule.vue`**（`src-ui/src/components/layout/TimerCapsule.vue`，挂在 `DesktopTopNav` 最右侧）：胶囊底 + 阶段状态点（专注红 `#FF6B35` / 休息绿 `#34C759`，运行中呼吸动画）+ 等宽 `MM:SS` 倒计时（`tabular-nums` 防抖动）+ 三个 18px 无边框按钮（开始 / 暂停 / 重置）。状态经 `storeToRefs(usePomodoroStore())` 取 `timeLeft` / `phase` / `isRunning`，点击数字跳 `/pomodoro` 完整页。
  - **菜单栏只做只读指示器**：把「阶段色圆点 + MM:SS」实时烤进托盘**图标位图**（`set_icon`），前端每秒主用 `invoke('update_tray_title', { title })` 命令（emit `tray:update` 事件兜底），Rust `tray.rs::paint_tray_title` 渲染 5×7 点阵文字 + 阶段色圆点后 `set_icon`。**改用图标而非 `set_title` 文本：Tauri 2 在部分 macOS 版本上运行时 `set_title` 不触发状态栏重绘（标题卡死初值），而 `set_icon` 必然触发 NSStatusItem 重绘，是最可靠的逐秒刷新方案。**
  - 左键点击托盘倒计时 → `focus_main_window()`（`show()` + `unminimize()` + `set_focus()`）**激活并前置主工作台窗口**，不再弹任何小窗；右键托盘 → 原生菜单（显示主窗口 / 退出）。
  - 关闭主窗口仅隐藏、不退出（`WindowEvent::CloseRequested` 拦截 + `hide()`），计时继续后台运行（隐藏的 WebView 仍在跑 JS）；`activationPolicy` 保持默认 `Regular`（有 Dock 图标、显示应用主菜单，`⌘C/⌘V` 依赖的原生「编辑」菜单才在响应链上）。
  - 阶段自然结束前端 `invoke('trigger_notification', {title, body})` 命令，Rust 经 `tauri-plugin-notification` 弹原生系统通知（即便主窗口被隐藏也照常提醒）。
  - 顶栏「番茄钟」导航项回归普通路由跳转 `/pomodoro`；App 菜单「番茄钟」项 = 前置主窗口 + `emit("navigate", "/pomodoro")`。
- **复习页集成**：`/review` 顶部嵌入番茄钟状态条（阶段 + 剩余时间 + 暂停 / 继续），专注刷题中不被打断。

> 后端接口、表结构（`wb_pomodoro_log`）、计时引擎设计详见《桌面端技术架构与功能手册.md》番茄钟章节。

## 任务清单模块（对标 Things 3，2026-08-10 重构）

把「日程计划」与「待办事项」彻底融合为**单一任务管理系统**（对标 Things 3 桌面端）：智能列表（收件箱 / 今天 / 计划 / 某天 / 日志本）+ 自定义清单树（领域→项目→清单）+ 子任务（Checklist）+ 目标日 / 截止日 + 日历联动。

- **路由 `/tasks`**（**红线：主路由名固定，任何情况不得更名**）：独立入口（`meta:{layout:'c',fullscreen:true}`，顶栏「规划▾」下拉的「任务清单」用 `match:['/tasks','/schedule',...]` 高亮）。旧 `/schedule` 在 router 重定向到 `/tasks` 且 query 透传，外部书签 / 日历深链不丢。
- **五个智能列表 + 自定义清单树**：`wb_task` 单表承载全部任务（`status` 决定所属智能列表，`list_id` 归属自定义清单，`parent_task_id` 挂子任务）；`wb_task_list` 承载清单树（area/project/list 三类，area 可含子清单）。侧边栏徽标来自 `GET /tasks/counters` 一次聚合。
- **树在 JS 层拼装**：`GET /tasks` 仅两条 SQL（父任务 + 一条 `IN` 查子任务），Service 层 O(n) 分组挂树，前端**禁止**再自己 filter 组树；`TaskNode.children` 为自引用 `TaskNode[]`（叶节点也保证 `children:[]`），递归组件类型与运行时自洽。
- **过期上浮 + 当天保留已完成**：每次读列表前把过期未完成的 `upcoming` 批量挪进 `today`；「今天」视图保留当天已完成项（进度条真实可用、撤销不丢目标）。
- **乐观交互**：勾选 / 删除乐观翻面 + 失败回滚，store ID 固定 `defineStore('tasks')`；新建按当前视图自动归位（在「今天」里建就落在今天）。
- **日历联动**：任务清单的 `target_date` / `due_date` 进入日历（来源 `task` / `task_due`，配色 `TASK_COLOR` / `TASK_DUE_COLOR`），点击色块跳 `/tasks?date=&taskId=` 高亮定位。
- **后端端点**：`/api/tasks`（GET 列表 / POST 新建 / `:id` PUT·DELETE / `:id/complete` 勾选 / `counters` / `clear-logbook` = 7）+ `/api/lists`（GET 树 / POST / `:id` PUT·DELETE = 4），三层架构 `routes→controllers→services` 严守边界。

> 表结构（`wb_task` / `wb_task_list`）、状态机、树拼装、过期上浮详见《桌面端技术架构与功能手册.md》§7.21。旧 `wb_task_template` / `wb_daily_task`（原「日程计划」）作为迁移来源与日历读取来源保留，不再有独立前端入口。

## 习惯打卡模块（2026-08-09 新增）

轻量「每日微习惯」追踪：定义习惯 → 每天一键打卡 → 用连续天数与年热力图看见坚持。

- **路由 `/habits`**：独立入口（**前缀不加 `/workbench`**，顶栏「习惯打卡」用 `match:['/habits']` 独立高亮，避免与「工作台」互相误亮）。
- **习惯卡片**：左侧 Apple Watch 风格彩色进度环显示**当前连续天数**（30 天满环），中间图标 + 名称 + 描述，右侧打卡按钮（`◉ 点击打卡` / `✅ 已打卡`，`active:scale-95` 反馈）。
- **详情抽屉**：右侧滑出，GitHub 风格 7×N 年热力图（5 级绿按「连续天数」深浅，点击格子可补卡 / 取消）、连续天数 / 最长连续 / 累计打卡 / 本月打卡率四张指标。
- **新建 / 编辑弹窗**：名称 + 描述 + 8 色 macOS 色板 + 16 图标选择器。
- **乐观交互**：打卡 / 删除均乐观更新 + 失败回滚 + 轻量 toast（对齐 `schedule-store` 套路），store ID 固定 `defineStore('habits')`。
- **N+1 防御（后端）**：`GET /api/habits` 用单条 `LEFT JOIN wb_habit_log` 算 `todayStatus`，另一条聚合查询在内存按 habit 分组算 `streak`——全程仅 2 条 SQL，绝不随习惯数线性增长。
- **事务级联**：`DELETE /api/habits/:id` 用 better-sqlite3 同步事务级联删除该习惯全部打卡记录。

> 后端接口、表结构（`wb_habit` / `wb_habit_log`）、统计与热力图计算详见《桌面端技术架构与功能手册.md》§7.18。

## 四象限任务模块（2026-08-09 新增）

把「紧急 × 重要」二维决策可视化：2×2 网格（艾森豪威尔矩阵）把任务落到「重要且紧急 / 重要不紧急 / 紧急不重要 / 不重要不紧急」四个象限，支持勾选完成、拖拽换象限、增删改与「清空已完成」。

- **路由 `/quadrant`**：独立入口（**前缀不加 `/workbench`**，顶栏「四象限」用 `match:['/quadrant']` 独立高亮，避免与「工作台」互相误亮），`meta: { layout: 'c', fullscreen: true }`。
- **2×2 网格**：`qd-grid` 两列自适应（≤860px 退化为单列），每象限 `QuadrantCard` 含色条（借用 `--kb-destructive` / `--kb-warning` / `--kb-primary` / `--kb-accent` 四个 token，无硬编码色值）、序号徽章、图标、未完成计数、`...` 菜单与添加按钮。
- **任务卡片**：原生 `type=checkbox`（`:checked` + `@change`，避免 0/1 数字被写成布尔）+ 标题 + 时间（`formatScheduleTime`，逾期红字）+ tags 胶囊 + 编辑 / 删除 / 拖拽手柄；已完成项默认折叠进折叠区。
- **拖拽换象限**：原生 HTML5 Drag and Drop（不引入拖拽库），`dragstart` 写 `dataTransfer` 任务 id，`drop` 触发 `store.moveTask` 乐观搬桶 + 失败回滚。
- **乐观交互**：新建 / 更新 / 勾选 / 删除 / 移动 / 清空已完成均乐观更新 + 失败回滚 + 轻量 toast，store ID 固定 `defineStore('quadrant')`。
- **列表性能红线（后端）**：`GET /api/quadrant/tasks` **单次 SQL** 取出全量（按 `completed → sort_order → created_at` 排序），在 Service 层 `groupTasks()` 单趟 O(n) 分桶成 `urgent_important` / `not_urgent_important` / `urgent_not_important` / `not_urgent_not_important` 四个下划线键——前端**严禁循环 filter**，直接消费四分组；字段连字符 `quadrant` 与响应下划线键的映射在 Service `QUADRANT_KEYS` 与 Store `GROUP_OF` 收口。

> 后端接口、表结构（`wb_quadrant_task`）、分组与映射逻辑详见《桌面端技术架构与功能手册.md》§7.19。

## 日历视图模块（2026-08-09 新增）

类 TickTick 的月 / 周 / 日日历：把任务与事件放进时间网格，支持点选日期新建、点击事件看详情、拖拽无（当前为点选闭环）、按范围拉取避免全量。

- **路由 `/calendar`**：独立入口（**前缀不加 `/workbench`**，顶栏「日历」收进「规划▾」下拉，高亮由父级 `match:['/tasks','/schedule','/quadrant','/habits','/calendar']` 统一负责，避免与「工作台」互相误亮），`meta: { layout: 'c', fullscreen: true }`。
- **月视图**：固定 42 格 CSS Grid（6×7），非当月补位格浅灰且不可交互，今天高亮环；全天事件显示「📌 全天：XXX」，定时事件显示时刻 + 标题；每格最多 3 条、余下「+N 更多」。
- **周 / 日视图**：左侧小时刻度（00–23）+ 多日列时间轴，全天事件置顶条、定时事件按「当日可见区间」绝对定位（跨天事件在多列各自截断显示）；点击空白时间格以落点时刻为起点新建。
- **三态**：加载态（首屏骨架）/ 空态（该区间无事件 + 新建 CTA）/ 数据态，视图只从 `eventsByDate`（按本地日键索引的派生）读取，避免 42 格各自 filter。
- **🔴 性能红线（后端）**：`GET /api/calendar/events` **必须**带 `start_date` / `end_date` 范围参数，不提供任何「拉全量」形态；范围查询用「区间重叠」命中（非「开始时间落在范围内」），跨月长事件在两侧月份都出现。
- **乐观交互**：新建成功后重拉当前视图；更新 / 删除乐观更新 + 失败回滚 + 轻量 toast，store ID 固定 `defineStore('calendar')`。

> 后端接口、表结构（`wb_calendar_event`）、范围查询与 UTC ISO 时间口径详见《桌面端技术架构与功能手册.md》§7.20。

## 数据备份模块（2026-08-10 新增）

「所有数据都在你自己电脑上」的另一面是「电脑坏了就全没了」。设置中心 `/settings` 的**关于**卡片新增「数据备份」区，把学习资产一键打成可离线保管的 zip，并支持每日定时自动备份。

- **入口**：选择备份目录（原生目录选择器）→「立即备份」→ 结果直接显示 zip 文件名；「打开目录」在访达中定位；「每日自动备份」开关 + 时刻选择；下方列出该目录最近的备份（名称 / 体积 / 时间）。
- **备份内容**：`db/`（SQLite 主库 + `-wal`/`-shm`）、`uploads/`（录音 / 图片 / 附件）、`config/`（`config.json` + `ai-config.json`）、`mindmaps/`，外加 `backup-meta.json` 记录来源路径便于恢复。文件名 `lectoforge-backup-YYYYMMDD-HHmmss.zip`（**本地时间**）。
- **一致性**：打包前后端先执行 `PRAGMA wal_checkpoint(TRUNCATE)`，把 WAL 里的未落盘事务刷进主库，保证 zip 里的 `.db` 单文件就是完整快照。
- **执行链路**：前端 `invoke('create_backup')` → Rust `ureq` 调 `POST /api/backup` → Node 侧车 `child_process.spawn` 拉起 `src-api/backup.js`（`archiver` 压缩）→ 返回 zip 绝对路径。Rust 只做调度与编排，不碰文件。
- **每日调度**：`tauri::async_runtime::spawn` + `tokio::time::sleep` 长驻循环，每轮重新读计划（改开关 / 改时刻**即时生效，无需重启**），到点二次确认后触发，成功弹原生通知并 `emit("backup:done")`。
- **后端端点（3 个）**：`POST /api/backup`、`GET /api/backup/schedule`、`PUT /api/backup/schedule`；计划落 `<dataDir>/backup-config.json`。
- **权限**：新增 `tauri-plugin-fs`（scope 限 `$APPDATA`/`$APPCONFIG`/`$HOME`）+ 5 条自定义命令 ACL；「打开目录」复用 `tauri-plugin-shell` 的 `command("open")`。

> ⚠️ 打包前务必确认 `tauri.conf.json` resources 含 `"../src-api/backup.js": "api/backup.js"`，且 `archiver` 已随 `scripts/prepare-bin.sh` 进 `.prod-modules/node_modules`。详见《桌面端技术架构与功能手册.md》§7.22 / §9.2.1。

## 离线模拟面试 / 语音通话模块（2026-08-12 新增）

对标豆包「模拟面试」：与 AI 面试官**语音对话**式模拟面试，题目取自**本地题库**，答完自动打分与追问。全链路可离线（语音识别本地 Whisper、语音合成 macOS 系统嗓音），LLM 先走现有云端 provider 跑通、架构 provider 无关，后续改 `baseUrl` 指本地 Ollama 即完全离线。

- **路由（+2 视图 / +2 条路由）**：`/interview`（通话式面试：对话气泡 + 大「开始通话/结束」按钮 + 实时字幕）、`/interview-bank`（题库管理），均 `meta:{layout:'c',fullscreen:true}`；顶栏新增「模拟面试」入口。
- **闭环**：录音（复用 `useVoiceRecorder`）→ `POST /api/interview/transcribe` → 本地 `whisper-server`(:8080) 转文字 → `POST /api/interview/answer` → `recallService` 关键词命中率打分 + `chatStream()` 生成口语化点评/追问 → **SSE** 回推 `evaluation → question|end`，前端边收边用 `window.speechSynthesis` 朗读。
- **题库 `wb_qa_bank`（统一题库层）**：三来源汇入——① 手动导入面经（Markdown/纯文本 `Q:`/`A:` 或 `## ` 分隔）；② PDF 导入（`pdf-parse`）；③ 一键从复习卡 `wb_review_card`（front=问/back=答）与康奈尔笔记 `wb_note`（cue=问/note=答）导入。
- **后端端点（+10 个）**：`/api/interview` 3 个（`transcribe` / `start` / `answer`，后两者为 **SSE 流**）+ `/api/qa-bank` 7 个（列表 / 取单条 / 随机抽题 / `import-md` / `import-pdf` / `import-from-review-cards` / `import-from-notes`）。
- **LLM 层**：`lib/llm.ts` 新增 `local` provider 预设（Ollama `http://localhost:11434/v1`）+ `chatStream()` 流式生成器；`assertReady` 对 `local` 放宽 apiKey 强校验（本地模型无 Key）。
- **Whisper 侧车**：Rust `WhisperSidecar` 镜像既有 `SidecarManager` 监督/退避模式，仅 release 编译；路径经 `WHISPER_BIN` / `WHISPER_MODEL` 解析，**缺二进制或模型则静默跳过不崩窗**；**刻意不进 `externalBin`** 以免开发者机器 `tauri build` 断裂；dev 手动起用 `scripts/run-whisper.sh`。不新增任何 invoke 命令 → `capabilities` 无需改动。

> ⚠️ 两个 SSE 端点是「响应信封由 `index.ts` onSend 唯一负责」约定的**唯一例外**（控制器直写 `reply.raw`）。会话状态为 `interviewService` 内存 `Map`，进程重启即失。
> ⚠️ 离线语音识别需先备好 `whisper-server` 二进制 + `ggml-*.bin` 模型（当前 `resources/models/whisper/` 为空），否则面试语音输入不可用。详见《桌面端技术架构与功能手册.md》§7.24。

## 学习日报与知识闪卡联动模块（2026-08-13 新增，主动智能）

AI 从「被动答疑」升级为「主动复盘」：每天自动分析用户**昨日（本地时区 0:00–24:00）**的学习数据，生成精美日报，并据薄弱点一键生成强化复习卡推入间隔复习系统。

- **路由（+1 视图 / +1 条路由）**：`/daily-report`（Apple-Health 风格统计卡 + 磨砂玻璃 AI 面板 + 「🔁重新生成」「🧠一键生成 3 张复习闪卡」按钮），`meta:{layout:'c',fullscreen:true}`；顶栏「AI 助手」组（原含知识库问答 / 模拟面试 / 题库管理）新增「学习日报」子项，`match` 数组含 `/daily-report`。
- **四维聚合（本地时区红线）**：① 昨日新收集箱流入量 ② 昨日复习次数 ③ 昨日薄弱知识点 Top3（`wb_review_log.quality < 2` 错题，按 `front` 分组）④ 近 7 天「收集箱 → 笔记」转化率（`wb_capture.capture_id` → `wb_note` 闭环）。所有「昨日」过滤统一用 `date(col,'localtime') = date('now','-1 day','localtime')`，非裸 UTC。
- **后端端点（+3 个，前缀 `/api/insight`）**：`GET /daily-report`（只读聚合）、`POST /daily-report/generate`（AI 文案，严格只输出 JSON，结果按 `YYYY-MM-DD` 在内存 `Map` 缓存 1h）、`POST /daily-report/generate-cards`（薄弱点 → 复习卡，**空薄弱点返回「昨日表现完美」且不调 LLM**）。
- **闪卡联动（红线）**：`generate-cards` 复用既有 `generateFlashcards({ autoSave:true })`，新卡写入旧系统 `wb_review_card`，`next_review_time=now` 立即进复习队列（`/review/flashcard`）。
- **清晨定时推送**：宿主拉起后端后，每小时检查本地 08:00，触发 `runMorningPush` → 生成日报并落盘 `<dataDir>/last-daily-report.json`；用「当日日期」标记防同小时 / 重启重复生成。仅宿主拉起时启用，开发者 `npm run dev:api` 不触发。
- **分层**：`routes/insight.ts`（薄路由）→ 内联 `fail/replyResult` 翻译 `LlmError`/`AiResult`；`services/insightService.ts`（聚合 + 缓存 + 复用 `generateFlashcards`）；`buildDailyReportPrompt` 在 `lib/prompts.ts`。

> ⚠️ 不新增数据表（复用 `wb_capture` / `wb_review_log` / `wb_review_card` / `wb_note`），故《桌面端技术架构与功能手册.md》§3.2 的「15 张表」计数不变。详见《桌面端技术架构与功能手册.md》§7.26。

## v1.1.0 新增能力（本次更新）

在原有四模块闭环 + 文档库 + 思维导图之上，本次更新补齐了**稳定性基建**与**四个体验型功能**：

- **侧车自愈重启（Rust 宿主）**：`SidecarManager` 在独立线程监控 Node 侧车，异常退出后**无限退避重启**（2s 起翻倍、封顶 30s），应用退出时 `SIGTERM→SIGKILL` 回收，杜绝僵尸后端堆积。
- **前端断线重连**：网络抖动 / 侧车重启期间，连接状态机自动探测、用公共 `replayRequest` 重放进行中的请求，并弹出毛玻璃「重新连接」遮罩，恢复后无感续接。
- **数据目录注入**：宿主用 `BaseDirectory::AppData` 解析出可写目录 `~/Library/Application Support/com.lectoforge.desktop/`，以 `LECTOFORGE_DATA_DIR` 环境变量 + `--data-dir` 注入侧车，数据库/配置/日志全部落在可写区，绝不写进只读的 `.app` 包。
- **历史数据自动迁移**：产品由 KnowFlow 更名为 LectoForge 后 bundle identifier 随之改变，AppData 会指向全新空目录。宿主启动时若发现新目录尚无 `workbench.db`、而旧目录 `com.knowflow.desktop/` 中存在，则一次性递归复制历史数据（笔记库、思维导图、上传件、AI 配置）；**旧目录保留不删**，作为回滚安全网。已迁移过则自动跳过，幂等。
- **间隔复习系统 `/review`**（新）：基于 SM-2 的卡片复习，SRS 列下沉到 `wb_note` / `wb_palace_loci` 源表，首屏「待复习」直达此页。
- **命令面板 `⌘K`**：跨收集箱 / 笔记 / 故事三表的全局模糊搜索，回车直达对应条目。
- **首页动态化**：总览页双数据源（`/api/workbench/overview` 供 6 指标看板、`/api/dashboard/stats` 供「学习闭环四步」气泡 + 今日聚焦四卡）。
- **新手引导与设置中心**：首次启动走 `/onboarding` 引导（含 AI Key 配置），`/settings` 可改主题、重跑引导、选择数据目录。

## v1.2.0 新增能力（康奈尔笔记生态增强）

在康奈尔三栏编辑 / 自动保存 / 划词工具栏之上，补齐 **5 大跨模块联动 + AI 赋能**（详见《桌面端技术架构与功能手册.md》§7.3.1）：

- **① 沉浸阅读 & 反向引用**：`⛶ 全屏阅读` 隐藏 chrome 只留 Markdown 渲染；`[[笔记标题]]` 双链 + `GET /api/workbench/notes/backlinks/:id` 反向引用面板。
- **② AI 续写 & 自测题**：`POST /api/ai/note/extend` 浮动对比窗（新段落插入 / 光标处追加）；自测题 `POST /api/ai/note/flashcards` 支持 `choice` / `fill` / `mixed` 题型。
- **③ 一键生成导图**：`POST /api/ai/note/generate-mindmap`（只算不存）→ 复用导图模块 `POST /api/mindmaps` → 跳 `/mindmap?id=`。
- **④ 标签聚合 & 智慧筛选**：`GET /api/workbench/notes/tags` 标签云 + 掌握度≤30% / 未写总结智能筛选，全部下推 SQL。
- **⑤ 页面级 PDF 导出**：`exportPDF()` 重写分页算法，阅读模式内单页 A4 压缩导出。

> 新增 / 扩展后端端点共 **6 个**（`backlinks` / `tags` / `resolve` / `note/extend` / `note/flashcards` 增强 / `note/generate-mindmap`，及 `GET /notes` 的 `tag` / `mastery_lte` / `has_summary` 参数）。

> 详细接口、表结构、启动链路见《桌面端技术架构与功能手册.md》 §4.4 / §6.6 / §7.12–§7.15 / §9.4。

## 原生能力（Tauri，macOS）

桌面壳 `src-tauri/src/lib.rs` 在白屏壳基础上增加了以下原生能力，**业务代码零改动**：

### 1. 原生菜单 + 状态栏托盘
macOS 标准菜单栏：
- **LectoForge**（App 菜单）：关于 / 检查更新… / 去学习复习 / 复习提醒：开（可切换）/ 番茄钟（常驻倒计时，点击回工作台番茄钟页）/ 退出
- **视图**：重新加载页面（等效 `location.reload()`）

「去学习复习」与点击复习提醒通知向渲染进程发 `navigate` 事件（`App.vue` 统一监听并 `router.push`）；「番茄钟」菜单项 = `focus_main_window()` + `emit("navigate", "/pomodoro")`。

**状态栏托盘（菜单栏番茄钟指示器）**：`src-tauri/src/tray.rs` 用核心 `tauri::tray` 在顶部状态栏常驻图标（倒计时画进图标位图）。托盘是**只读指示器**：左键点击 = 激活并前置主工作台窗口（`focus_main_window()`），右键 = 原生菜单（显示主窗口 / 退出）；倒计时由 `update_tray_title` 命令（emit `tray:update` 兜底）每秒刷新图标，结束经 `trigger_notification` 命令弹原生通知。关闭主窗口仅隐藏、不退出（`WindowEvent::CloseRequested` 拦截）。

### 2. 复习提醒通知（后台轮询）
- 后台独立线程每 **30 分钟** 轮询后端 `GET /api/workbench/reviews/due-count`。
- 有待复习卡片时弹 **macOS 原生通知**（标题/正文含卡片样例）。
- 点击通知：聚焦窗口并跳到复习页。
- 菜单「复习提醒：开/关」可随时开关，状态由共享 `Arc<Mutex<bool>>` 维护。

> 轮询走 `ureq`（纯 Rust HTTP，无 OpenSSL 依赖），只请求计数端点，开销极小。

### 3. 每日数据备份调度
- `tauri::async_runtime::spawn` + `tokio::time::sleep` 长驻循环，到点调 `POST /api/backup` 触发 Node 侧车打包。
- 每轮重新读取计划，设置中心改开关 / 改时刻**即时生效，无需重启**；成功后弹原生通知并 `emit("backup:done")`。
- 用到 `tauri-plugin-fs`（预建备份目录，scope 限 `$APPDATA`/`$APPCONFIG`/`$HOME`）与 `tauri-plugin-shell`（在访达中打开备份目录）。
- 详见上文「数据备份模块」。

### 4. 自动更新
- 集成 `tauri-plugin-updater`，菜单「检查更新…」与前端侧边栏「检查更新」按钮共用 `check_for_update` 命令。
- 检测到新版本自动下载并安装，完成后弹通知。
- **当前 `tauri.conf.json` 中 `updater.active=false`**：因自动更新需要你自己的 ed25519 签名密钥与发布端点（属个人密钥，不能提交到仓库）。激活步骤见下方「启用自动更新」。

## 启用自动更新（一次性，发布前做）

```bash
# 1. 生成签名密钥对（私钥 tauri.key 务必离线保管，公钥填回配置）
npx tauri signer generate

# 2. 把输出的「公钥」粘贴到 src-tauri/tauri.conf.json 的 plugins.updater.pubkey
#    并把 "active": false 改为 true

# 3. 用 CI（tauri-action）发布 GitHub Release 时，会生成 latest.json + 签名文件，
#    并把 endpoints 改成你的仓库地址：
#    "endpoints": ["https://github.com/<你>/<仓库>/releases/latest/download/latest.json"]
```

### 4. 侧车自愈重启与数据目录注入（v1.1.0）

- **自愈重启**：`SidecarManager` 在独立线程阻塞 `child.wait()`，侧车异常退出后按 2s→30s 退避无限重启；存活满 30s 自动重置退避；退出码 0（含孤儿自检）不重启。应用退出时 `shutdown()` 发 `SIGTERM`、2s 未退则 `SIGKILL`。
- **数据目录注入**：宿主用 `BaseDirectory::AppData` 解析 `~/Library/Application Support/com.lectoforge.desktop/`，以 `LECTOFORGE_DATA_DIR` 环境变量 + `--data-dir` 注入侧车；同时 `cwd` 设为数据目录，防止任何库按相对路径落盘到只读 `.app`。
- 连接遮罩上的「重启服务」按钮调用 `restart_sidecar` 命令，对当前 pid 发 `SIGTERM`，由监控线程接管自愈。

## 已知说明

- 生产由 Rust 宿主协商端口后传给侧车，**宿主模式下端口恒定不漂移**（已加载页面的断线重连依赖恒定 origin）；独立开发模式 `npm run dev:api` 才保留 +1 漂移，仅绑 `127.0.0.1`。Tauri 单实例锁避免重复启动。
- macOS 分发需 Apple Developer ID 签名 + 公证（`notarytool`），否则 Gatekeeper 拦截；本仓库未包含证书。
- Mac App Store 暂不推荐（本地 SQLite + 文件访问受沙箱限制）。

## 运行打包后的 .app（未公证）

本机构建产物是 **ad-hoc 签名**（主程序）；侧车 `server` 复用 Node.js 官方的 Developer ID 签名。
在**本机或同机**直接双击通常即可打开；若被 Gatekeeper 拦截，执行：

```bash
xattr -cr "src-tauri/target/release/bundle/macos/LectoForge 学习工作台.app"
open "src-tauri/target/release/bundle/macos/LectoForge 学习工作台.app"
```

若要分发给他人，必须先做 Apple Developer ID 签名 + `notarytool` 公证（见上方「启用自动更新」附近的签名说明）。

## 构建验证记录（2026-08-06，arm64 macOS）

`tauri build` 已在本机（Rust 1.97.1 + Xcode）跑通，产出
`src-tauri/target/release/bundle/macos/LectoForge 学习工作台.app`（arm64，约 220MB）。

验证点到为止（GUI 窗口需真实显示环境，以下为后端+资源链路实测）：

- 用打包内的 `server` 侧车 + `Resources/api/index.js` + `Resources/web` 真实拉起后端；
- `GET /api/workbench/overview` 返回真实 JSON；
- 同源首页 `GET /` 返回 `index.html`（http 200）；
- `POST /api/inbox/` 建卡成功并计入总览（旧 `/api/workbench/captures` 仍可用，属遗留接口）。
- 因后端依赖 `better-sqlite3`（原生模块），`tauri.conf.json` 的 `bundle.resources`
  已额外包含 `../src-api/node_modules → api/node_modules`，否则打包后 `require` 会失败。

### 实现注意点（与原先预期的差异）

1. **通知点击不会自动跳转复习页**：`tauri-plugin-notification` 2.3.x 桌面端 builder
   无 `on_click` 回调，点击通知仅由系统原生聚焦应用到前台。跳转复习页请走菜单
   「去学习复习」或侧边栏导航。（代码已改用 `app.notification().builder()...` 写法。）
2. **`download_and_install` 需两个闭包**：updater 2.10.1 签名为
   `download_and_install(on_chunk, on_download_finish)`，已修正。
3. 菜单「关于」`PredefinedMenuItem::about` 需第三个 `AboutMetadata` 参数（传 `None`）。

### 故障复盘：双击 .app 无任何界面（2026-08-06）

**现象**：双击 `LectoForge 学习工作台.app` 后 Dock 图标弹一下即消失，完全没有窗口。

**根因**：`src-tauri/tauri.conf.json` 的 `plugins.shell` 配置里写了非法字段 `execute`
（以及 `sidecar`）。当前 `tauri-plugin-shell` 2.3.5 的 Config 结构体**仅有一个 `open` 字段**
（`#[serde(deny_unknown_fields)]` 会拒绝未知字段）。该错误在插件初始化阶段就 panic：

```
PluginInitialization("shell", "Error deserializing 'plugins.shell' within your Tauri configuration: unknown field `execute`, expected `open`")
```

由于 panic 发生在任何窗口创建之前，所以**根本不会渲染 GUI**，与「白屏/错误页」是两回事。

**修复**：`plugins.shell` 只保留 `"open": false`（侧车启用不靠这里，而是靠
`bundle.externalBin` + 能力权限 `shell:allow-spawn`）。改完后重新 `tauri build` 即恢复。

**排查方法（Mac 上若再遇「启动即退出」）**：在终端直接运行主程序即可看到 panic 堆栈：

```bash
"/Applications/LectoForge 学习工作台.app/Contents/MacOS/lectoforge-desktop"
# 或本地路径：
"src-tauri/target/release/bundle/macos/LectoForge 学习工作台.app/Contents/MacOS/lectoforge-desktop"
```

**仍无界面时的二次排查**：若已越过插件初始化但仍空白，多半是后端侧车未就绪/崩溃。
检查：① 日志 `~/Library/Logs/LectoForge`（如有写入）；② 终端 `lsof -i:8787` 看端口是否监听；
③ 直接跑侧车验证：`Contents/MacOS/server Contents/Resources/api/index.js --port 8787
--web-dir Contents/Resources/web --data-dir /tmp/test`。


