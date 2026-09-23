# 功能详解

> 本文承接 [`README.md`](../README.md) 的「功能总览」，逐模块记录**技术取舍、实现要点与踩坑记录**。
> 架构层面的分层边界与数据流见 [`ARCHITECTURE.md`](ARCHITECTURE.md)；
> 更细的接口清单见 [`桌面端技术架构与功能手册.md`](桌面端技术架构与功能手册.md)。

## 目录

**学习闭环**
- [1. 收集箱 `/inbox`](#1-收集箱-inbox)
- [2. 康奈尔笔记 `/workbench/notes`](#2-康奈尔笔记-workbenchnotes)
- [3. 记忆宫殿与主动回忆](#3-记忆宫殿与主动回忆)
- [4. 费曼故事 `/workbench/story`](#4-费曼故事-workbenchstory)
- [5. 间隔重复 `/review`](#5-间隔重复-review)

**资料与创作**
- [6. 文档库 `/library`](#6-文档库-library)
- [7. 思维导图 `/mindmap`](#7-思维导图-mindmap)
- [8. 绘图工具 `/diagram`](#8-绘图工具-diagram)

**规划与执行**
- [9. 任务清单 `/tasks`](#9-任务清单-tasks)
- [10. 四象限 `/quadrant`](#10-四象限-quadrant)
- [11. 日历 `/calendar`](#11-日历-calendar)
- [12. 习惯打卡 `/habits`](#12-习惯打卡-habits)
- [13. 番茄钟 `/pomodoro`](#13-番茄钟-pomodoro)

**AI 与语音**
- [14. AI 助手与知识库问答](#14-ai-助手与知识库问答)
- [15. 学习日报 `/daily-report`](#15-学习日报-daily-report)
- [16. 模拟面试与题库](#16-模拟面试与题库)

**平台能力**
- [17. 数据备份](#17-数据备份)
- [18. 原生集成（菜单 / 托盘 / 通知 / 更新）](#18-原生集成菜单--托盘--通知--更新)
- [19. 端点明细](#19-端点明细)

---

## 1. 收集箱 `/inbox`

**入口定位**：一切输入的漏斗。先无压力积累，事后再整理——避免「想到就整理」导致的记录中断。

**五种输入方式**：速记 / 网页剪藏（粘贴 URL 自动解析标题与正文）/ 语音（录音转文字）/
截图（离线 OCR 识字）/ 附件上传。

**整理动作**：打标签、批量处理、去重检测、一键「沉淀」为康奈尔笔记或记忆宫殿地点。

**实现要点**

- 剪藏用 `cheerio` 解析，`iconv-lite` 处理 GBK 等非 UTF-8 编码页面。
- 附件 / 录音走 `@fastify/multipart` 落盘到 `<dataDir>/uploads/`，由 `@fastify/static` 按同源路径回传。
- 去重检测用 `fastest-levenshtein` 算标题相似度，避免同一篇文章反复入库。
- 端点数最多（14 个）的模块之一——因为「输入体验」的细节最碎（metadata 升级、批量、语音上传、
  附件、去重、挂起、热力图、遗忘曲线）。

> ⚠️ **路由前缀坑**：`captures` / `notes` / `stories` / `reviews` / `overview` / `palaces` /
> `recall` / `migration` 这 8 个模块注册在 **`/api/workbench`** 前缀下（为与 Web 端契约对齐），
> 其余模块注册在 `/api`。所以收集箱的旧接口是 `/api/workbench/captures`，
> 而新接口是 `/api/inbox`。写调用代码前先确认前缀。

---

## 2. 康奈尔笔记 `/workbench/notes`

**入口定位**：把收集箱的碎片变成有结构的知识。左侧线索栏（问题）、右侧笔记栏（内容）、
下方总结栏（复述）——这个结构本身就是为**主动回忆**设计的。

**基础能力**：三栏编辑、自动保存、划词工具栏、PDF 导出。

**v1.2.0 五大增强**

| # | 能力 | 实现 |
|---|------|------|
| ① | **沉浸阅读 & 反向引用** | `⛶ 全屏阅读` 隐藏 chrome 只留 Markdown 渲染；`[[笔记标题]]` 双链 + `GET /api/workbench/notes/backlinks/:id` 反向引用面板 |
| ② | **AI 续写 & 自测题** | `POST /api/ai/note/extend` 浮动对比窗（新段落插入 / 光标处追加）；`POST /api/ai/note/flashcards` 支持 `choice` / `fill` / `mixed` 题型 |
| ③ | **一键生成导图** | `POST /api/ai/note/generate-mindmap`（只算不存）→ 复用导图模块 `POST /api/mindmaps` → 跳 `/mindmap?id=` |
| ④ | **标签聚合 & 智慧筛选** | `GET /api/workbench/notes/tags` 标签云 + 掌握度 ≤30% / 未写总结智能筛选，**全部下推 SQL** |
| ⑤ | **页面级 PDF 导出** | `exportPDF()` 分页算法重写，阅读模式内单页 A4 压缩导出 |

**实现要点**

- **SRS 列下沉**：`dueDate` / `easeFactor` / `masteredLevel` 直接挂在 `wb_note` 表上，
  不另建卡表——笔记本身就是复习对象。
- **筛选下推**：掌握度与总结状态是 SQL 条件而非前端 filter，避免拉全量到内存再筛选。

---

## 3. 记忆宫殿与主动回忆

**记忆宫殿 `/workbench/palace`**：把一段知识编码成一串「地点」（loci），
借助空间记忆的天然强度来承载抽象内容。

- 每个宫殿含多个地点，地点可挂图片提示（`POST /api/ai/palace/loci/image-hint`）。
- 与笔记同理，SRS 列直接下沉到 `wb_palace_loci`。

**主动回忆 `/workbench/recall`**：巡检式回忆打卡——不看答案先复述，再对照检查。
`POST /api/ai/recall/score` 给复述质量打分，`POST /api/ai/recall/advice` 给改进建议。

---

## 4. 费曼故事 `/workbench/story`

**入口定位**：闭环的出口。**讲不清就是没懂**——逼自己用大白话把知识讲成一个故事。

- `POST /api/ai/story/draft` AI 起草初稿；`POST /api/ai/story/clarity` 清晰度评分。
- 思维导图可一键转为费曼故事（`POST /api/ai/mindmap/convert-to-story`）。

---

## 5. 间隔重复 `/review`

**入口定位**：把「学过」变成「记住」的机制。核心是 SM-2 算法。

**交互**：翻卡 → 看答案 → 评四档（困难 / 良好 / 轻松 / 完美）→ 系统算出下次到期时间。

**实现要点**

- **SM-2 必须与 Web 端 `lectoforge_mobile/utils/sm2.dart` 逐位一致**——跨端数据互导后
  排期才不会错乱。这是硬约束。
- **排期易错点**：下次到期时间 = **上次复习时间 + interval**，**不是**当前时间 + interval。
  后者会让多次延迟复习把间隔不断后推，卡片永远不到期。
- **复习记录统一落 `wb_review_log`**，而 SRS 状态列留在源表（`wb_note` / `wb_palace_loci`）。
- 附带：遗忘曲线、复习热力图、卡组挂起（snooze 24h）、番茄钟状态条内嵌。

**两套复习系统**：`/workbench/review`（复习驾驶舱，分流入口）与 `/review`（基于 SM-2 的
间隔复习闪卡）。顶栏「间隔复习」已并入「复习」，统一从驾驶舱分流。

---

## 6. 文档库 `/library`

**入口定位**：Obsidian 式本地 Markdown 工作台。**文件即数据**——不导入数据库，
直接读写你磁盘上的原文件。

**能力**

- 左目录树（可折叠，收起后内容区自动占满）+ 中源码/分栏/预览 + 右大纲三栏。
- **兼容 Obsidian 语法**：双链 `[[笔记]]` / `[[笔记#标题]]` / `[[笔记|别名]]`、
  嵌入块 `![[笔记]]`、图片 `![[图片]]` / `![[图片|WxH]]`；点击双链直接跳转。
- 全库搜索走后端；图片与资源经同源 `/api/library/asset` 流式返回。
- 待办扫描 `/api/library/notes/todos`：汇总全库未完成项。

**实现要点与坑**

- **vault 白名单**：`lib/vault.ts` 限定 vault 根目录必须落在 HOME 或外接卷内，
  否则返回 403「该位置不允许浏览」。用 `/tmp` 做 demo vault 会被拒。
- **Markdown 渲染唯一来源**是 `src-ui/src/lib/markdown.ts`——文档库、笔记、AI 回答共用它，
  保证样式与安全策略一致。
- **AI 来源锚点直达**：RAG 回答的来源药丸带 `anchor`（形如 `L3-L7`），
  点击 `router.push('/library?doc=<relId>&highlight=<anchor>')`，编辑器滚动到对应行区间并高亮 3 秒淡出。
  这条链路依赖 `markdown.ts` 给每行打的 `data-line-start` / `data-line-end` 属性。

---

## 7. 思维导图 `/mindmap`

**能力**：同一份文档三视图——**极简大纲**（Tab / Shift+Tab 缩进）/ **markmap 导图**
（SVG 可导出）/ **流程图**（形状编辑器）。

- 支持 AI 生成（未配 Key 时返回 mock，优雅降级）。
- 导图可一键转为费曼故事。

> ⚠️ **数据结构坑**：大纲节点是**嵌套结构**
> `{ id, text, collapsed?, children: OutlineNode[] }`，**不是** `parent` 扁平结构。
> 写入 `parent` 字段会导致渲染成扁平列表（所有节点同级）。

---

## 8. 绘图工具 `/diagram`

**入口定位**：类 ProcessOn / draw.io 的本地白板，整图存库、防抖自动保存。

**前端三栏**

- 左「图形库」：基础形状 / 流程图 / UML 共 11 种，支持拖入画布与点击添加。
- 顶「工具栏」：新建 / 保存 / 导出 PNG·SVG / 连线样式 / 排版色 / 撤销重做 / 删除 / 图文件切换。
- 中「画布」：`@vue-flow/core` + background + controls，`ConnectionMode.Loose` 四向互联，双击编辑。
- 右「属性面板」：节点 X/Y/宽/高/文本/填充/描边/文字色；连线线宽/虚线/箭头/线色。

**状态层**（`store/diagram-store.ts`）

- `nodes` / `edges` / `viewport` 直接绑 VueFlow `v-model`，2000ms 防抖自动保存。
- **快照式撤销/重做**（VueFlow core 无内建 history）。
- PNG（html2canvas）/ SVG 导出；编辑文字时屏蔽 Delete / Backspace 防误删。
- **多页结构**：整图序列化为 `{ currentPageId, pages: [{ id, name, nodes, edges, viewport, ... }] }`，
  切换/新增/重命名/拖拽排序都基于它。

**后端**（`/api/diagram`，5 端点）：`GET /` 列表、`POST /` 新建空白画布、`GET /:id` 详情、
`PUT /:id` 保存、`DELETE /:id` 删除。数据落 `wb_diagram` 表（`data` 列存整图 JSON，**不拆子表**）。

写接口时注意：`PUT /:id` 收到的 body 是 **`{ name?, data? }`**——整图必须包在 `data` 键里。
另外 `sanitizeData` 只保留业务白名单字段（`label` / `fill` / `stroke` / `textColor` /
`width` / `height` / `path` / `points` / `strokeWidth` / `pathColor`），
vue-flow 混进来的运行时字段会被剔除——所以**别指望通过 `data` 透传自定义字段**。
列表接口只回 `nodeCount`，不回 `data`。

**存储层**：`data` 用 JSON 字符串存整图，损坏的 JSON 由 `parseData` 兜底回退空白画布，
**绝不抛错**导致详情页打不开。

**旧实现**：此前基于 Vue Flow 的版本未删除但已取消引用；现行实现对标的 draw.io 能力约 80%。

---

## 9. 任务清单 `/tasks`

**入口定位**：把「日程计划」与「待办事项」彻底融合为**单一任务管理系统**，对标 Things 3。

**结构**

- **五个智能列表**：收件箱 / 今天 / 计划 / 某天 / 日志本。
- **自定义清单树**：领域（area）→ 项目（project）→ 清单（list），area 可含子清单。
- **子任务**（Checklist）：`parent_task_id` 自引用。
- **目标日 / 截止日** + 日历联动。

**路由红线**

- `/tasks` **主路由名固定，任何情况不得更名**。
- 旧 `/schedule` 在 router 中重定向到 `/tasks` 且 **query 透传**，外部书签与日历深链不丢。

**实现要点**

- **单表承载**：`wb_task` 一张表装全部任务——`status` 决定所属智能列表，
  `list_id` 归属自定义清单，`parent_task_id` 挂子任务；`wb_task_list` 承载清单树。
- **树在 Service 层拼装**：`GET /tasks` 只用**两条 SQL**（父任务 + 一条 `IN` 查子任务），
  Service 层 O(n) 分组挂树。**前端禁止**再自己 filter 组树。
  `TaskNode.children` 是自引用 `TaskNode[]`，**叶节点也保证 `children: []`**，
  这样递归组件在类型与运行时都自洽。
- **过期上浮 + 当天保留已完成**：每次读列表前把过期未完成的 `upcoming` 批量挪进 `today`；
  「今天」视图保留当天已完成项（进度条真实可用、撤销不丢目标）。
- **乐观交互**：勾选 / 删除乐观翻面 + 失败回滚；新建按当前视图自动归位
  （在「今天」里建就落在今天）。store ID 固定 `defineStore('tasks')`。
- **侧边栏徽标**来自 `GET /tasks/counters` 一次聚合，不逐个列表查。

**端点**：`/api/tasks` 7 个（列表 / 新建 / `:id` PUT·DELETE / `:id/complete` / `counters` /
`clear-logbook`）+ `/api/lists` 4 个（树 / POST / `:id` PUT·DELETE）。

---

## 10. 四象限 `/quadrant`

**入口定位**：把「紧急 × 重要」二维决策可视化（艾森豪威尔矩阵）。

- **2×2 网格**：`qd-grid` 两列自适应（≤860px 退化单列），每象限含色条
  （借用 `--kb-destructive` / `--kb-warning` / `--kb-primary` / `--kb-accent` 四个令牌，
  **无硬编码色值**）、序号徽章、未完成计数、`...` 菜单与添加按钮。
- **拖拽换象限**：**原生 HTML5 Drag and Drop**（不引入拖拽库），
  `dragstart` 写 `dataTransfer` 任务 id，`drop` 触发 `store.moveTask` 乐观搬桶 + 失败回滚。
- **勾选**用原生 `type=checkbox`（`:checked` + `@change`），避免 0/1 数字被写成布尔。
- 已完成项默认折叠进折叠区。

**列表性能红线（后端）**：`GET /api/quadrant/tasks` **单次 SQL** 取出全量
（按 `completed → sort_order → created_at` 排序），Service 层 `groupTasks()` **单趟 O(n)** 分桶成
`urgent_important` / `not_urgent_important` / `urgent_not_important` / `not_urgent_not_important`。
**前端严禁循环 filter**，直接消费四分组。
字段的连字符形式（`urgent-important`）与响应下划线键的映射，在 Service 的 `QUADRANT_KEYS`
与 Store 的 `GROUP_OF` 两处收口。

---

## 11. 日历 `/calendar`

**入口定位**：类 TickTick 的月 / 周 / 日日历，把任务与事件放进同一张时间网格。

- **月视图**：固定 42 格 CSS Grid（6×7），非当月补位格浅灰不可交互，今天高亮环；
  全天事件显示「📌 全天：XXX」，定时事件显示时刻 + 标题；每格最多 3 条、余下「+N 更多」。
- **周 / 日视图**：左侧小时刻度（00–23）+ 多日列时间轴；全天事件置顶条，
  定时事件按「当日可见区间」绝对定位（跨天事件在多列各自截断显示）；
  点击空白时间格以落点时刻为起点新建。
- **视图只从 `eventsByDate` 派生读取**（按本地日键索引），避免 42 格各自 filter。

**🔴 性能红线（后端）**：`GET /api/calendar/events` **必须**带 `start_date` / `end_date`
范围参数，**不提供任何「拉全量」形态**。范围命中用「**区间重叠**」而非「开始时间落在范围内」，
否则跨月长事件会在某个月份消失。

时间口径统一用 **UTC ISO**，展示时按本地时区转换。

---

## 12. 习惯打卡 `/habits`

**入口定位**：轻量「每日微习惯」追踪——定义习惯 → 每天一键打卡 → 用连续天数与年热力图看见坚持。

- **习惯卡片**：左侧苹果表风格彩色进度环显示**当前连续天数**（30 天满环），
  中间图标 + 名称 + 描述，右侧打卡按钮（带 `active:scale-95` 反馈）。
- **详情抽屉**：右侧滑出，GitHub 风格 7×N 年热力图（5 级绿按「连续天数」深浅，点击格子可**补卡/取消**）
  + 连续天数 / 最长连续 / 累计打卡 / 本月打卡率四张指标。
- **新建 / 编辑弹窗**：名称 + 描述 + 8 色 macOS 色板 + 16 图标选择器。

**N+1 防御（后端）**：`GET /api/habits` 用**单条 `LEFT JOIN wb_habit_log`** 算 `todayStatus`，
另一条聚合查询在内存按 habit 分组算 `streak`——**全程仅 2 条 SQL**，绝不随习惯数线性增长。

**事务级联**：`DELETE /api/habits/:id` 用 better-sqlite3 **同步事务**级联删除该习惯全部打卡记录。

---

## 13. 番茄钟 `/pomodoro`

**入口定位**：专注计时，且**不侵入**其他页面。

**计时引擎**（Pinia `pomodoroStore`，常驻）

- 基于 `Date.now()` **时间戳差值**：`accumulatedMs + (now - runStartedAt)`。
- `setInterval` 仅 250ms 刷新进度环——**后台节流或系统休眠都不会掉秒**。
- 常驻 store 意味着**切到任意页面计时都不中断**。

**主页面 `/pomodoro`**：conic-gradient 圆形进度环 + 四参数配置（专注 / 小憩 / 长休息 / 每组番茄数）
+ 开始 / 暂停 / 重置 / 跳过 / 退出；白噪音 Mini 播放器（雨声 / 溪流 / 咖啡馆，
Howler 播放 `public/audio/white-noise/*.mp3`，**资源缺失自动降级为 Web Audio 合成**）；
提示音设置（Web Audio 实时合成 ding / tick / alarm）。

**统计页 `/pomodoro/stats`**：vue-chartjs 柱状图（蓝 = 专注 / 橙 = 休息，按天聚合）
+ 累计专注时长 / 日均专注 / 完成番茄数三张总结卡。

**顶栏胶囊 `TimerCapsule.vue`**：阶段状态点（专注红 / 休息绿，运行中呼吸动画）
+ 等宽 `MM:SS` 倒计时（`tabular-nums` 防抖动）+ 三个 18px 无边框按钮；点击数字跳完整页。

**状态栏托盘（只读指示器）**

- 把「阶段色圆点 + MM:SS」实时烤进托盘**图标位图**（`set_icon`）。
- **为什么用 `set_icon` 而不是 `set_title`**：Tauri 2 在部分 macOS 版本上运行时
  `set_title` **不触发状态栏重绘**（标题卡死初值），而 `set_icon` 必然触发
  `NSStatusItem` 重绘，是最可靠的逐秒刷新方案。这是踩坑后的结论。
- 左键点击托盘 → `focus_main_window()` **激活并前置主工作台**，不弹小窗；
  右键 → 原生菜单（显示主窗口 / 退出）。
- 阶段自然结束时经 `trigger_notification` 弹**原生系统通知**（主窗口隐藏时也照常提醒）。

**关闭窗口 ≠ 退出**：`WindowEvent::CloseRequested` 被拦截并改为 `hide()`，
计时继续后台运行（隐藏的 WebView 仍在跑 JS）。`activationPolicy` 保持 `Regular`
（有 Dock 图标、显示应用主菜单——`⌘C/⌘V` 依赖的原生「编辑」菜单才在响应链上）。

**配置持久化**：偏好落盘 `<dataDir>/pomodoro-config.json`，前端防抖保存。

**复习页集成**：`/review` 顶部嵌入番茄钟状态条（阶段 + 剩余时间 + 暂停/继续），专注刷题不被打断。

---

## 14. AI 助手与知识库问答

### AI 助手 `/ai-assistant`（多轮对话）

对标 DeepSeek 网页端体验：会话管理（新建 / 重命名 / 删除 / 置顶）、**SSE 流式输出**、
Markdown 渲染（含表格与代码高亮）、消息点赞/点踩反馈、悬浮大纲。

- 历史轮数上限 `HISTORY_LIMIT = 10`；单条正文读取上限 `CAP = 16000` 字符。
- 会话/消息落本地表 `wb_ai_conversation` / `wb_ai_message`。
- RAG 检索结果作为「参考上下文」注入多轮对话，**但不强制模型输出 JSON**
  （这是它与 `askRag` 的关键区别）——多轮对话需要的是自然表述。

### 知识库问答 `/ai-chat`（RAG）

基于本地文档库（`.md`）与康奈尔笔记做检索增强生成。**AI 只回答知识库中有的内容，
未检索到时会如实告知**，不编造。

**检索链（两级）**

1. **向量检索优先**：query 向量化 → 与 `wb_embedding` 全表算余弦相似度 → 取 Top-N。
2. **关键词检索降级**：遍历 vault 内 `.md`，对命中行抽取片段**与精确行号区间**。

命中后组装上下文 → 注入 prompt → `chatJson()` 强制 JSON 输出 → 校验来源链接真实可跳转后才返回。

**回答带来源与锚点**：来源药丸显示文档标题 + 行号区间（如 `间隔重复原理 L3-L7`），
点击跳 `/library?doc=<relId>&highlight=<anchor>`，原文滚动到该行区间并高亮 3 秒淡出。

**多模态（OCR）**：支持上传图片，前端用离线 `tesseract.js` 提取图中文字后作为 `imageText`
与问题一并提交。当前 Node 侧无 OCR 端点，这是最稳定的多模态落地方式。

> ⚠️ **已知缺陷**：关键词降级路径的 `tokenize()` **只按空格与标点切分**。
> 无空格的中文长问句（如「间隔重复的复习间隔应该怎么算？」）会被当成一个超长词条，
> **检索命中率为 0**，最终返回「知识库中未找到相关内容」。
> 标点或空格分隔后（如「间隔重复 复习间隔 怎么算」）即可命中。
> 配了 embeddings 模型走向量检索则不受影响。详见 [`ARCHITECTURE.md` §11](ARCHITECTURE.md#11-已知技术债)。

### Provider 配置

| provider | baseUrl | 备注 |
|----------|---------|------|
| `deepseek` | `https://api.deepseek.com/v1` | 默认 |
| `openai` | 官方端点 | 兼容 |
| `local` | `http://localhost:11434/v1` | Ollama；**放宽 apiKey 强校验**（本地模型无 Key） |

**优雅降级是硬要求**：未配置 Key 时 AI 功能给出清晰提示或 mock 骨架，
**不允许**抛错崩页，**也不允许**伪造成功结果。

**API Key 安全**：仅存本地 `<dataDir>/ai-config.json`，不进代码、不进日志、不进版本控制。

---

## 15. 学习日报 `/daily-report`

**入口定位**：AI 从「被动答疑」升级为「主动复盘」。

**四维聚合**（口径为**昨日本地时区 0:00–24:00**）

1. 昨日新收集箱流入量
2. 昨日复习次数
3. 昨日薄弱知识点 Top3（`wb_review_log.quality` 偏低的错题，按 `front` 分组）
4. 近 7 天「收集箱 → 笔记」转化率

**🔴 时区红线**：所有「昨日」过滤统一用
`date(col,'localtime') = date('now','-1 day','localtime')`，**不是裸 UTC**——
否则东八区用户会看到错位一天的日报。

**闪卡联动**：`POST /api/insight/daily-report/generate-cards` 把薄弱点转为强化复习卡，
复用既有 `generateFlashcards({ autoSave: true })`，新卡写入 `wb_review_card`，
`next_review_time = now` **立即进复习队列**。若昨日无薄弱点，返回「昨日表现完美」且**不调 LLM**。

**AI 文案缓存**：`POST .../generate` 的结果按 `YYYY-MM-DD` 在内存 `Map` 缓存 1 小时。

**清晨定时推送**：宿主拉起后端后，每小时检查本地 08:00，触发 `runMorningPush` →
生成日报并落盘 `<dataDir>/last-daily-report.json`；用「当日日期」标记防同小时/重启重复生成。
**仅宿主拉起时启用**——`npm run dev:api` 不触发。

---

## 16. 模拟面试与题库

### 模拟面试 `/interview`

对标豆包「模拟面试」：与 AI 面试官**语音对话**式模拟面试，题目取自**本地题库**，
答完自动打分与追问。全链路可离线。

**闭环**

```
录音（useVoiceRecorder）
  → POST /api/interview/transcribe  → 本地 whisper-server(:8080) 转文字
  → POST /api/interview/answer      → recallService 关键词命中率打分
                                    + chatStream() 生成口语化点评/追问
  → SSE 回推 evaluation → question|end
  → 前端边收边用 window.speechSynthesis 朗读
```

> ⚠️ 这两个 SSE 端点是「响应信封由 `onSend` 唯一负责」约定的**唯一例外**（直写 `reply.raw`）。
> 前端必须用 `postSSE()`（基于 `fetch` + `ReadableStream`），
> **不能用原生 `EventSource`**——它只支持 GET，无法携带请求体。
>
> ⚠️ 面试会话状态存 `interviewService` 内存 `Map`，**进程重启即失**；不做持久化。

### 题库管理 `/interview-bank`

`wb_qa_bank` 是**统一题库层**，三来源汇入：

1. 手动导入面经（Markdown / 纯文本，`Q:`/`A:` 或 `## ` 分隔）
2. PDF 导入（`pdf-parse`）
3. **一键从复习卡与笔记导入**——`wb_review_card`（front=问 / back=答）与
   `wb_note`（cue=问 / note=答）

**端点**：`/api/interview` 3 个（含 2 个 SSE）+ `/api/qa-bank` 7 个。

**Whisper 侧车**：Rust `WhisperSidecar` 镜像既有 `SidecarManager` 的监督/退避模式，
仅 release 编译；路径经 `WHISPER_BIN` / `WHISPER_MODEL` 解析，
**缺二进制或模型则静默跳过不崩窗**；**刻意不进 `externalBin`** 以免开发者机器
（未装模型）执行 `tauri build` 时断裂。dev 手动启动：`bash scripts/run-whisper.sh`。
不新增任何 invoke 命令，因此 `capabilities` 无需改动。

---

## 17. 数据备份

**入口定位**：「所有数据都在你自己电脑上」的另一面是「电脑坏了就全没了」。

- **入口**：设置中心 `/settings` 的「关于」卡片 → 选择备份目录（原生目录选择器）→
  「立即备份」→ 显示 zip 文件名；「打开目录」在访达中定位；
  「每日自动备份」开关 + 时刻选择；下方列出该目录最近的备份（名称 / 体积 / 时间）。
- **备份内容**：`db/`（SQLite 主库 + `-wal`/`-shm`）、`uploads/`（录音/图片/附件）、
  `config/`（`config.json` + `ai-config.json`）、`mindmaps/`，
  外加 `backup-meta.json` 记录来源路径便于恢复。
  文件名 `lectoforge-backup-YYYYMMDD-HHmmss.zip`（**本地时间**）。
- **一致性保障**：打包前后端先执行 `PRAGMA wal_checkpoint(TRUNCATE)`，
  把 WAL 中未落盘的事务刷进主库，保证 zip 里的 `.db` 单文件就是**完整快照**。
- **执行链路**：前端 `invoke('create_backup')` → Rust `ureq` 调 `POST /api/backup`
  → Node 侧车 `child_process.spawn` 拉起 `src-api/backup.js`（`archiver` 压缩）
  → 返回 zip 绝对路径。**Rust 只做调度编排，不碰文件**。
- **每日调度**：`tauri::async_runtime::spawn` + `tokio::time::sleep` 长驻循环，
  每轮**重新读计划**（改开关/改时刻**即时生效，无需重启**），到点二次确认后触发，
  成功弹原生通知并 `emit("backup:done")`。

**端点**：`POST /api/backup`、`GET /api/backup/schedule`、`PUT /api/backup/schedule`；
计划落 `<dataDir>/backup-config.json`。

**权限**：`tauri-plugin-fs`（scope 限 `$APPDATA` / `$APPCONFIG` / `$HOME`）+ 5 条自定义命令 ACL；
「打开目录」复用 `tauri-plugin-shell` 的 `command("open")`。

> ⚠️ 打包前务必确认 `tauri.conf.json` 的 resources 含
> `"../src-api/backup.js": "api/backup.js"`，且 `archiver` 已随 `scripts/prepare-bin.sh`
> 进 `.prod-modules/node_modules`。

---

## 18. 原生集成（菜单 / 托盘 / 通知 / 更新）

### 原生菜单

macOS 标准菜单栏：

- **LectoForge（App 菜单）**：关于 / 检查更新… / 去学习复习 / 复习提醒（可切换）/
  番茄钟（常驻倒计时，点击回工作台番茄钟页）/ 退出
- **视图**：重新加载页面

「去学习复习」与点击复习提醒通知向渲染进程发 `navigate` 事件
（`App.vue` 统一监听并 `router.push`）；「番茄钟」菜单项 = `focus_main_window()` +
`emit("navigate", "/pomodoro")`。

### 复习提醒（后台轮询）

- 后台独立线程每 **30 分钟**轮询 `GET /api/workbench/reviews/due-count`。
- 有待复习卡片时弹 **macOS 原生通知**（标题/正文含卡片样例）。
- 点击通知聚焦窗口并跳转复习页。
- 菜单「复习提醒：开/关」可随时开关，状态由共享 `Arc<Mutex<bool>>` 维护。

> 轮询走 `ureq`（纯 Rust HTTP，无 OpenSSL 依赖），只请求计数端点，开销极小。

### 自动更新

集成 `tauri-plugin-updater`，菜单「检查更新…」与前端侧边栏按钮共用 `check_for_update` 命令。

> ⚠️ **当前 `tauri.conf.json` 中 `updater.active = false`**：
> 自动更新需要你自己的 ed25519 签名密钥与发布端点（属个人密钥，不能提交到仓库）。

启用步骤：

```bash
# 1. 生成签名密钥对（私钥 tauri.key 务必离线保管）
npx tauri signer generate

# 2. 把输出的公钥粘贴到 src-tauri/tauri.conf.json 的 plugins.updater.pubkey
#    并把 "active": false 改为 true

# 3. 用 CI（tauri-action）发布 Release 时生成 latest.json + 签名文件，
#    并把 endpoints 改成你的仓库地址：
#    "endpoints": ["https://github.com/<你>/<仓库>/releases/latest/download/latest.json"]
```

### 侧车自愈与数据目录

- **自愈重启**：`SidecarManager` 在独立线程阻塞 `child.wait()`，侧车异常退出后按
  2s→30s 退避**无限重启**；存活满 30s 自动重置退避；退出码 0（含孤儿自检）不重启。
  应用退出时 `shutdown()` 发 `SIGTERM`，2s 未退则 `SIGKILL`。
- **数据目录注入**：宿主用 `BaseDirectory::AppData` 解析
  `~/Library/Application Support/com.lectoforge.desktop/`，以 `LECTOFORGE_DATA_DIR`
  环境变量 + `--data-dir` 注入侧车；同时把 `cwd` 设为数据目录，
  防止任何库按相对路径落盘到只读的 `.app` 内。
- 连接遮罩上的「重启服务」按钮调用 `restart_sidecar` 命令，
  对当前 pid 发 `SIGTERM`，由监控线程接管自愈。

---

## 19. 端点明细

> 口径：**2026-08-26 脚本审计**。34 个路由模块内共 **216** 个端点；
> 另有 `index.ts` 直挂 2 个（`GET /api/health`、`GET /`），后端 HTTP 路由合计 **218**。

| 模块 | 端点数 | 模块 | 端点数 |
|------|-------:|------|-------:|
| `ai` | 25 | `quadrant` | 6 |
| `library` | 17 | `ttsVoices` | 6 |
| `inbox` | 14 | `diagram` | 5 |
| `palaces` | 10 | `models` | 5 |
| `notes` | 9 | `pomodoro` | 5 |
| `review` | 9 | `recall` | 5 |
| `reviews` | 9 | `stories` | 5 |
| `ai-assistant` | 8 | `insight` | 4 |
| `calendar` | 8 | `lists` | 4 |
| `schedule` | 8 | `backup` | 3 |
| `tasks` | 8 | `export` | 3 |
| `captures` | 7 | `interview` | 3 |
| `habits` | 7 | `categories` | 2 |
| `mindmap` | 7 | `config` | 2 |
| `qaBank` | 7 | `ai-diagram` | 1 |
| | | `dashboard` | 1 |
| | | `migration` | 1 |
| | | `overview` | 1 |
| | | `search` | 1 |

**合计 216**（34 模块）。

### 路由前缀分布

| 前缀 | 模块 |
|------|------|
| `/api/workbench` | `overview`、`captures`、`notes`、`reviews`、`palaces`、`recall`、`stories`、`migration` |
| `/api/ai` | `ai`、`ai-diagram`、`mindmap` 的 AI 子路由 |
| `/api/insight` | `insight` |
| `/api/export` | `export` |
| `/api/library` | `library` |
| `/api/mindmaps` | `mindmap` |
| `/api/ai-assistant` | `ai-assistant` |
| `/api/categories` | `categories` |
| `/api` | 其余全部 |

> ⚠️ 这个前缀差异是历史原因（为与 Web 端契约对齐），**不是笔误**。
> 新增模块默认挂 `/api`；只有明确要复用 Web 端契约时才挂 `/api/workbench`。

---

*本文档随代码演进同步维护。若你的改动涉及模块行为、接口契约或新增模块，请一并更新本文与 `README.md`。*
