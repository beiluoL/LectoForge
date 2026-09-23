# 更新日志

本文件记录 LectoForge 桌面端的所有重要变更。

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> **关于版本号的说明**
>
> 本项目在 v1.2.0 之前**未打 git tag**，版本号主要记录在文档中。
> 本文件按代码演进的自然里程碑回溯整理，**v1.2.0 是首个正式打标的发布版本**。
> 由于 v1.1.0 之后持续快速迭代，v1.2.0 聚合了 v1.1.0 之后的全部工作，
> 因此它的变更条目显著多于常规版本——这是有意为之的诚实记录，而非版本规划失误。

---

## [未发布]

暂无。

### 计划中

- 引入中文分词，修复 RAG 关键词降级路径对无空格中文提问检索命中率为 0 的问题
- 向量检索迁移到 `sqlite-vec`，解决大规模知识库下的内存瓶颈
- 修复 `/api/ai/associate` 关联项标题恒空

详见 [`docs/ARCHITECTURE.md` §11 已知技术债](docs/ARCHITECTURE.md#11-已知技术债)。

---

## [1.2.0] - 2026-08-26

> **本版本是首个正式打标的发布版本**，聚合了 v1.1.0 之后的全部工作：
> 学习闭环深化、离线语音与 AI 全套能力、绘图工具、规划模块完善、
> 以及一次覆盖全站的 UI 设计体系收敛。

### 新增

#### 🎯 康奈尔笔记生态增强（5 大跨模块联动 + AI 赋能）

- **沉浸阅读 & 反向引用**：`⛶ 全屏阅读` 隐藏全部 chrome 只留 Markdown 渲染；
  新增 `[[笔记标题]]` 双链与反向引用面板（`GET /api/workbench/notes/backlinks/:id`）
- **AI 续写 & 自测题**：`POST /api/ai/note/extend` 提供浮动对比窗（插入新段落 / 光标处追加）；
  `POST /api/ai/note/flashcards` 支持 `choice` / `fill` / `mixed` 三种题型
- **一键生成导图**：`POST /api/ai/note/generate-mindmap`（只算不存）
  → 复用导图模块 `POST /api/mindmaps` → 自动跳转 `/mindmap?id=`
- **标签聚合 & 智慧筛选**：`GET /api/workbench/notes/tags` 标签云；
  「掌握度 ≤30%」「未写总结」智能筛选**全部下推 SQL**
- **页面级 PDF 导出**：`exportPDF()` 分页算法重写，阅读模式内单页 A4 压缩导出

#### 📥 收集箱进阶

- 批量处理、语音录入、附件上传、去重检测（`fastest-levenshtein` 算标题相似度）
- 深链剪藏：粘贴 URL 自动解析标题与正文（`cheerio` + `iconv-lite` 处理非 UTF-8 页面）
- 复习侧增强：卡组挂起（snooze 24h）、复习热力图、遗忘曲线

#### 🗂 规划与执行

- **习惯打卡**（`/habits`）：连续天数进度环（30 天满环）+ GitHub 风格年热力图（可补卡）；
  8 色 macOS 色板 + 16 图标选择器；后端用**固定 2 条 SQL** 规避 N+1
- **四象限**（`/quadrant`）：艾森豪威尔矩阵，**原生 HTML5 拖拽**换象限（不引入拖拽库），
  后端单次 SQL + Service 层单趟 O(n) 分桶
- **日历视图**（`/calendar`）：月 / 周 / 日三视图，任务与事件统一时间网格；
  支持拖拽改期；**强制范围查询**（区间重叠命中，不提供拉全量形态）
- **中国法定节假日 + 纪念日**：`festival.ts` 节日数据层 + `useCalendarFestivals`；
  纪念日支持 CRUD
- **任务清单重构**：融合「日程计划」与「待办事项」为单一系统，对标 Things 3——
  五个智能列表 + 自定义清单树（领域→项目→清单）+ 子任务 + 目标日/截止日 + 日历联动；
  树在 Service 层 O(n) 单趟拼装，前端不再 filter 组树
- **复习清单批量操作**：标记已掌握 / 挂起（`POST /api/reviews/batch`）

#### 🎨 创作工具

- **绘图工具 / 流程图模块**（`/diagram`，全新）：类 ProcessOn / draw.io 的本地白板
  - 11 种形状（基础形状 / 流程图 / UML），支持拖入画布与点击添加
  - `ConnectionMode.Loose` 四向互联、双击内联编辑、画布内直接操作
  - 多页画布与分组管理、批量对齐与分布工具、模板库
  - 快照式撤销/重做（VueFlow core 无内建 history）、2000ms 防抖自动保存
  - 导出 PNG（html2canvas）/ SVG；**AI 自然语言生成流程图**；自由画笔绘制
  - 后端 `/api/diagram` 5 端点，整图 JSON 存 `wb_diagram` 单列（不拆子表）
- **闭环联动**：文档库 → 任务清单；思维导图 → 费曼故事

#### 🤖 AI 与离线语音

- **AI 助手**（`/ai-assistant`，全新）：对标 DeepSeek 网页端体验的多轮对话
  - 会话管理（新建 / 重命名 / 删除 / 置顶）+ **SSE 流式输出**
  - Markdown 渲染（表格 / 代码高亮）+ 消息点赞点踩 + 悬浮大纲
  - 多服务商配置：DeepSeek / OpenAI / 本地 Ollama
  - 流式呼吸光标 + 停止生成（`AbortController`）
- **知识库问答 RAG**（`/ai-chat`）：向量语义检索 + **文档精准溯源高亮**
  - 回答返回来源清单，带**精确行号锚点**（如 `L3-L7`）
  - 点击来源药丸跳回文档库并滚动到对应行区间高亮 3 秒淡出
  - **多模态**：上传图片 → 离线 OCR 提取文字 → 与问题一并提交
- **学习日报**（`/daily-report`，主动智能）：昨日流入量 / 复习次数 / 薄弱点 Top3 /
  近 7 天转化率四维聚合；**一键把薄弱点转为强化闪卡**并立即进复习队列；
  新增 30 日趋势图（`/api/insight/trend` + vue-chartjs）
- **模拟面试**（`/interview`）：语音对话式面试，本地题库抽题，SSE 流式点评与智能追问
- **题库管理**（`/interview-bank`）：统一题库层 `wb_qa_bank`，支持面经 Markdown / PDF 导入，
  以及**从复习卡与笔记一键导入**
- **离线语音识别（STT）**：whisper.cpp 双轨——原生侧车 + WASM，
  由 `speech-config.runtime` 调度；模型支持按需下载（设置页可选模型与运行时）
- **本地神经网络 TTS**：Piper 侧车 + 嗓音选择 + 韵律微调（去人机感）
- **离线 OCR**：tesseract.js（WASM）中文优先，支持拍照 / 图片附件识字

#### 💻 平台与基础设施

- **无边框沉浸式窗口**：`.decorations(false).transparent(true).shadow(true)`，
  macOS 原生圆角与阴影（`window-shadows-v2`），自绘红黄绿交通灯
- **数据自动备份**：设置中心一键打包 zip（含 `PRAGMA wal_checkpoint(TRUNCATE)` 保证一致性）
  + Rust 每日定时调度（改计划即时生效，无需重启）
- **CSV 数据导出**（`/api/export/*`）+ 设置页入口
- **窗口尺寸记忆**：Rust 侧防抖写盘
- **文档库拖拽移动**（`POST /api/library/move`）
- **首页学习里程碑** + 布局重构（收窄 Hero + 今日速览 + 主区双栏 + 底部闭环胶囊条）
- **⌘K 命令面板增强**：新增「最近笔记」

#### 🎛 UI 设计体系与主题

- **设计令牌与主题系统**：`--kb-chart-1..6` 色板 + `palette.ts` 主题响应；
  设置中心外观分区（浅色 / 深色 / 跟随系统 + 6 档强调色 + 紧凑模式）；
  启动即应用 + 跟随 OS 切换；配套主题回归脚本 `npm run ui:theme-check`
- **字体自托管**：Noto Sans/Serif SC 拉丁子集 + JetBrains Mono 全量落 `public/fonts`；
  CJK 走 macOS 系统字体；`@font-face` + `font-display: swap` + Mono 预载
- **一致性收敛**（全站）：
  - 字号——75 处离梯值收敛到 `--kb-fs-*`（最小 11px）
  - 间距——335 处非 4px 网格值归位
  - 图标——474 处裸数字 `:size` 改为语义档 / px 字符串
  - 控件尺寸——收敛至三档（S28 / M34 / L38）
- **无障碍与对比度**：
  - WCAG AA 达标——日历事件条改深色字、今日格用 `primary/primary-foreground`、
    `--kb-warning-foreground` 改深字
  - 键盘可达与 ARIA——AI 侧栏更多钮 / 气泡操作栏补 `:focus-within`
    （气泡栏由 `display:none` 改为 `visibility + opacity` 以保持可聚焦）；
    四象限菜单补 `aria-expanded`
- **断点对齐**：Tailwind `lg` 由 1024px 调整为 992px，
  消除 960–1024px 窗口宽度下导航折叠的灰色地带
- **交互反馈增强**：编辑器 / 导图手动保存 toast 双反馈、
  记忆宫殿评分忙锁防重复、习惯抽屉统计加载骨架

### 变更

- **版本号统一**：`package.json`、`src-ui`、`src-api`、`tauri.conf.json`、`Cargo.toml`
  由 `1.0.0` 统一提升至 `1.2.0`
- **开源协议**：新增 MIT 许可证，并在各 `package.json` / `Cargo.toml` 中声明
- 设置页恢复三栏式布局（侧边栏 + 详情面板 + 分区组件）
- 顶栏 Logo 重构为双色拼接品牌字标 Wordmark（系统字体栈 semibold）
- 日历月视图默认显示 2 条事件，选中日期后展开
- 原生日期输入框替换为触发式按钮 + 定制日历弹窗
- 复习顶栏次要操作 icon 化，主 CTA 高亮

### 修复

- **主题令牌化大修**：顶栏下拉 / 空状态 `dark:` 变体清零；
  Hero / 闭环导航 / Inbox 毛玻璃令牌化；未定义令牌修复；新增 `--kb-info`；
  ToastHost 令牌化；清理 `var(--kb-x, fallback)` 回退写法
- **图表模块死选择器**：`:global(.dark)` 改为 `:root[data-theme='dark']`（11 处）
- **`fix(scripts)`**：修复测试脚本误删 `src-ui/dist` 导致 `build.rs` panic、
  打包后窗口不弹的问题
- **四象限菜单**、**复习键盘可达**、**InboxList 关闭按钮**（✕ 改 `Icon` 组件）等一批可达性修复
- **绘图工具**：修复中文 tooltip / 图形库拖拽 / 连线原生右键菜单共 8 项缺陷；
  图标渲染与排版统一、全屏布局修正
- **`fix(tauri)`**：修复 release 构建 `E0382`——`resource_dir` 移动后复用
- 复习队列卡死修复

### 已知问题

以下问题在本版本中**已知且未修复**，记录在此以免重复踩坑：

1. **RAG 关键词降级路径对无空格中文提问检索命中率为 0**
   `tokenize()` 只按空格与标点切分，无空格中文长问句会被当成一个超长词条，
   最终返回「知识库中未找到相关内容」。
   *临时规避*：提问时用空格分隔关键词，或配置 embeddings 模型走向量检索。
   *修复方向*：引入中文分词（`nodejieba` / `Intl.Segmenter`）。

2. **向量检索未规模化**
   `vectorRetrieve` 走「全表拉入 JS + JSON.parse + 余弦」的应用层计算，
   约 5k 篇文档时 JS 堆峰值接近 490MB。
   *触发门槛*：embedding 行数 > ~10k，或单查延迟 > 100ms，或堆峰值 > 300MB。
   *修复方向*：迁移到 `sqlite-vec` 的 `vec0` 虚拟表做原生 KNN。

3. **`/api/ai/associate` 关联项标题恒空**
   Service 读取 `e.entity_type` / `e.entity_id`，但 Drizzle 实返 camelCase
   （`entityType` / `entityId`），导致关联项标题查询恒为空。

4. **离线语音资源未随仓库分发**
   `resources/models/whisper/` 与 `resources/models/piper/` 默认为空（模型体积过大），
   语音输入输出**开箱不可用**，需先执行 `scripts/fetch-models.sh` 等脚本。
   应用已做优雅降级（缺资源时给明确提示，不崩窗）。

5. **模拟面试会话不持久化**
   面试会话状态存 Service 内存 `Map`，进程重启即失。

6. **macOS 分发未签名公证**
   构建产物为 ad-hoc 签名，首次打开需 `xattr -cr` 解除隔离。

> 完整技术债分析见 [`docs/ARCHITECTURE.md` §11](docs/ARCHITECTURE.md#11-已知技术债)。

---

## [1.1.0] - 2026-08-07

> 主题：**稳定性基建 + 四个体验型功能**。此前 v1.0.0 的功能在异常场景下容易「卡死无法恢复」，
> 本版本补齐了自愈与恢复链路。

### 新增

#### 稳定性基建

- **侧车自愈重启**：`SidecarManager` 在独立线程监控 Node 侧车，异常退出后
  **无限退避重启**（2s 起翻倍、封顶 30s）；存活满 30s 自动重置退避；
  退出码 0（含孤儿自检）不重启；应用退出时 `SIGTERM` → 2s 未退则 `SIGKILL`，
  杜绝僵尸后端堆积
- **前端断线重连**：网络抖动 / 侧车重启期间，连接状态机自动探测，
  用公共 `replayRequest` 重放进行中的请求，并弹出毛玻璃「重新连接」遮罩，
  恢复后无感续接；遮罩上的「重启服务」按钮调用 `restart_sidecar` 命令
- **数据目录注入**：宿主用 `BaseDirectory::AppData` 解析可写目录
  `~/Library/Application Support/com.lectoforge.desktop/`，
  以 `LECTOFORGE_DATA_DIR` 环境变量 + `--data-dir` 参数注入侧车；
  同时把 `cwd` 设为数据目录，防止任何库按相对路径落盘到只读的 `.app` 包内
- **历史数据自动迁移**：产品由 KnowFlow 更名为 LectoForge 后 bundle identifier
  随之改变，AppData 会指向全新空目录。宿主启动时若发现新目录尚无 `workbench.db`
  而旧目录 `com.knowflow.desktop/` 中存在数据，则一次性递归复制历史数据；
  **旧目录保留不删**作为回滚安全网；已迁移过则自动跳过，**幂等**

#### 体验型功能

- **间隔复习系统 `/review`**：基于 SM-2 的卡片复习，SRS 列（`dueDate` /
  `easeFactor` / `masteredLevel`）**下沉到 `wb_note` / `wb_palace_loci` 源表**，
  不另建卡表；首屏「待复习」直达此页
- **命令面板 `⌘K`**：跨收集箱 / 笔记 / 故事三表的全局模糊搜索，回车直达对应条目
- **首页动态化**：总览页双数据源——`/api/workbench/overview` 供 6 指标看板，
  `/api/dashboard/stats` 供「学习闭环四步」气泡 + 今日聚焦四卡
- **新手引导与设置中心**：首次启动走 `/onboarding` 引导（含 AI Key 配置）；
  `/settings` 可改主题、重跑引导、选择数据目录

### 变更

- 复习模块收敛：顶栏「间隔复习」并入「复习」，
  新旧两套复习系统统一从复习驾驶舱分流
- 旧路由 `/workbench/capture` 重定向到 `/inbox`

---

## [1.0.0] - 2026-08-07

首个版本。把 Web 端「学习工作台」模块独立为 macOS 专用桌面应用，
并扩展文档库与思维导图两大模块。

### 新增

- **技术底座**：Tauri 2（Rust 极薄壳）+ Node.js / TypeScript / Fastify 后端
  + SQLite（better-sqlite3，WAL）+ Drizzle ORM + Vue 3 / Vite / Pinia 前端；
  Node 后端**同源托管**前端 dist 与 `/api/*`，零 CORS、vue-router 保持 history 模式
- **后端三层重构**：34 个路由模块全量下沉为 `Route → Controller → Service`；
  响应信封由 `index.ts` 的 `onSend` 钩子唯一负责
- **学习闭环四模块**
  - 收集箱 `/inbox`：速记 / 剪藏 / 语音 / 截图 / 附件五种入口，一键沉淀
  - 康奈尔笔记：三栏编辑 + 自动保存 + 划词工具栏 + PDF 导出
  - 记忆宫殿：地点法编码 + 主动回忆巡检
  - 费曼故事：AI 起草 + 清晰度评分
- **文档库 `/library`**：Obsidian 式本地 Markdown 工作台，
  直接读写磁盘原文件（不导入数据库）；三栏布局；兼容 Obsidian 双链与嵌入块语法
- **思维导图 `/mindmap`**：同一文档三视图——极简大纲 / markmap 导图 / 流程图；
  支持 AI 生成（未配 Key 时返回 mock，优雅降级）
- **番茄钟 `/pomodoro`**：跨页面常驻计时引擎（基于 `Date.now()` 时间戳差值，
  后台节流不掉秒）；conic-gradient 进度环；白噪音播放器；Web Audio 合成提示音；
  统计页柱状图
- **macOS 菜单栏番茄钟指示器**：把「阶段色圆点 + MM:SS」实时烘进托盘**图标位图**
  （`set_icon`）——因 Tauri 2 在部分 macOS 版本上 `set_title` 不触发状态栏重绘
- **原生集成**：macOS 标准菜单栏、复习提醒通知（后台每 30 分钟轮询 `ureq`）、
  自动更新集成（`tauri-plugin-updater`，默认 `active=false`）
- **数据交互**：支持从 Web 端导入 `workbench-export` JSON；
  本地 `categories` 表预置「未分类 / 工作 / 学习 / 生活」

### 已知问题

- **通知点击不会自动跳转复习页**：`tauri-plugin-notification` 2.3.x 桌面端 builder
  无 `on_click` 回调，点击通知仅由系统原生聚焦应用到前台。
  跳转复习页请走菜单「去学习复习」或侧边栏导航。
- **自动更新默认关闭**：需要自备 ed25519 签名密钥与发布端点（属个人密钥，
  不应提交到仓库），启用步骤见 [`docs/FEATURES.md`](docs/FEATURES.md#18-原生集成菜单--托盘--通知--更新)。
- **Mac App Store 不推荐**：本地 SQLite + 任意文件夹访问受沙箱限制。
- **macOS 分发需签名公证**：否则 Gatekeeper 拦截。

---

## 版本对照

| 版本 | 日期 | 主题 | 主要新增 |
|------|------|------|----------|
| [1.2.0](#120---2026-08-26) | 2026-08-26 | 全能力到位 + 设计体系收敛 | 笔记生态增强、离线语音、AI 全套、绘图工具、规划完善、UI 主题体系 |
| [1.1.0](#110---2026-08-07) | 2026-08-07 | 稳定性基建 + 体验功能 | 侧车自愈、断线重连、数据目录注入、历史迁移、间隔复习、命令面板、引导与设置 |
| [1.0.0](#100---2026-08-07) | 2026-08-07 | 首个版本 | 学习闭环四模块、文档库、思维导图、番茄钟、原生集成 |

---

[未发布]: https://github.com/beiluoL/LectoForge/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/beiluoL/LectoForge/releases/tag/v1.2.0
[1.1.0]: https://github.com/beiluoL/LectoForge/releases/tag/v1.1.0
[1.0.0]: https://github.com/beiluoL/LectoForge/releases/tag/v1.0.0
