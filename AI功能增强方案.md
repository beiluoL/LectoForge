# KnowFlow 学习工作台（桌面端）AI 功能增强方案

> 分析日期：2026-08-06
> 范围：基于现有 `desktopApp`（Tauri 2 + Node/Fastify + better-sqlite3 + Drizzle + Vue3/Vite）代码逐文件梳理后产出
> 目标：识别可接入的 AI 需求、评估可行性与价值、给出贴合技术栈的接入方案与优先级

---

## 0. 现状速览（结论先行）

| 维度 | 现状 |
|------|------|
| 架构 | Rust 壳(Tauri) + Node 侧车(Fastify/TS, 端口 8787) + Vue3 前端，三端打包进 `.app` |
| 数据 | SQLite(WAL) + Drizzle ORM，单用户 `CURRENT_USER=1`，数据目录经 `--data-dir`/`KNOWFLOW_DATA_DIR` 可配 |
| **AI 现状** | **零 AI**。无任何 LLM/embedding 调用，无 HTTP 客户端依赖 |
| 现有"类 AI"逻辑 | 全是规则/启发式：`gradeCard`(SM-2 公式)、`scoreRecall`(中文字+英文词≥2 的重叠率)、`calcWords`(字数统计) |
| 已埋但未用的字段 | `wb_story.clarity_score`、`wb_story.gap_note`、`wb_note.mastery`、`wb_capture.tags` —— **schema 已为 AI 留位，后端从未填充** |
| 调用 LLM 的能力 | Node 22 原生 `fetch` 可用；用户已用 DeepSeek/SiliconFlow(OpenAI 兼容) 跑通过 ai-chat-vue；**能力 100% 具备** |

**一句话**：这是一个"学习闭环"应用（收集→笔记→复习→回忆→费曼→宫殿），每个环节目前都靠用户手工完成，而 LLM 最擅长的事恰恰是"把一段文本变成结构化产物"。接入成本极低、收益极直接。

---

## 1. 模块级 AI 机会梳理

按业务闭环逐模块拆解，标出"当前痛点 → AI 能力 → 对应需求类型（智能推荐 / 自动化处理 / 数据分析预测）"。

### 模块一：收集箱（Captures）—— 信息入口
- 现状：`title/content/sourceType/tags/status/starred`，全靠手动录入与整理，`tags` 几乎为空。
- 痛点：用户把文章/灵感丢进收集箱后，往往长时间停在 `INBOX` 不处理。
- AI 机会：
  - **A1 一键提炼要点**：长文 → 3~5 条要点摘要（自动化处理）。
  - **A2 自动标签 + 建议分类**：LLM 抽关键词打 `tags`、建议 `categoryId`（智能推荐）。
  - **A3 自动起草康奈尔笔记**：从收集箱内容直接生成含 cue/summary 的笔记草稿（自动化处理）。

### 模块二：康奈尔笔记（Notes）—— 核心加工环节
- 现状：三栏 `cueColumn`(线索/问题) / `noteColumn`(主体) / `summaryColumn`(总结) 全手工填，`mastery` 是 0~100 滑块。
- 痛点：写笔记栏容易，**写"线索栏问题"和"总结栏一句话"最难、最易被跳过**；这正是主动回忆的燃料。
- AI 机会（**高价值区**）：
  - **B1 由笔记栏自动生成线索栏问题**：把知识点转成可自测的问题（自动化 + 提升回忆质量）。
  - **B2 自动生成总结栏**：一句话概括（自动化处理）。
  - **B3 自动抽标签/关键词**。
  - **B4 知识点拆分 → 自动生成复习卡片**：把笔记拆成 front/back 问答卡（自动化 + 智能推荐）。

### 模块三：间隔重复（Review Cards，SM-2）—— 复习调度
- 现状：`front/back` 手工建卡，SM-2 公式驱动 `nextReviewTime`；`/reviews/forgetting-curve` 已能聚合遗忘率。
- 痛点：建卡费时；复习只记录 `quality`(0~3)，没有"为什么错/怎么补"的诊断。
- AI 机会：
  - **C1 批量生成间隔重复卡片**（cloze 填空 / QA），来源可选笔记或收集箱（自动化处理）。
  - **C2 薄弱点诊断**：基于 `wb_review_log` 的 lapse 聚类，LLM 生成自然语言"你常在 X 类上遗忘，建议重学 Y"（数据分析预测 + 智能推荐）。
  - **C3 错题讲解**：对某张卡生成针对性解析（自动化处理）。

### 模块四：主动回忆（Recall，三轮闭卷）—— 当前评分最弱
- 现状：`scoreRecall` 是**字符/词重叠率**，三轮 `round1/2/3_text/score`，`improvementPct` 看进步。
- 痛点：重叠率评分严重失准——换种说法就判低分、抄写废话也能高分。**评分是整套系统最该被 AI 替换的地方**。
- AI 机会（**高价值 + 低 hanging fruit**）：
  - **D1 语义评分替换重叠率**：LLM 比对 `sourceText` 与默写，给出 0~100 语义分 + 遗漏点/错误点反馈（数据质量升级）。
  - **D2 三轮趋势改进建议**：根据三轮走向给复习策略建议（智能推荐）。

### 模块五：费曼故事（Stories）—— 已留 AI 位却空着
- 现状：`audience`(如 CHILD) / `metaphor` / `content` / `gap_note` / `clarity_score` / `word_count`；后端只算 `word_count`，**`clarity_score` 与 `gap_note` 从未填充**。
- 痛点：费曼法的精髓是"能否让外行听懂"，目前没有任何自动评估。
- AI 机会（**最低成本、最高契合，字段已就绪**）：
  - **E1 费曼清晰度评分**：LLM 按指定受众(小孩/外行)评估 `content` 是否通俗易懂，回填 `clarity_score`（数据分析 + 自动化）。
  - **E2 知识盲点提取**：LLM 找出"讲不清/跳跃/术语堆砌"处，回填 `gap_note`（智能推荐）。
  - **E3 自动起草初稿**：根据笔记生成受众化的费曼故事 + 比喻 `metaphor`（自动化）。

### 模块六：记忆宫殿（Palaces + Loci）—— 小众但可增强
- 现状：`palace`(主题 ROOM/STREET/CAMPUS) + `loci`(名称/知识点/imageHint/坐标)。
- 痛点：建宫殿位点枯燥，抽象概念难具象化。
- AI 机会：
  - **F1 自动生成宫殿位点**：把一组知识点铺成有序 loci + `imageHint` 助记意象（自动化）。
  - **F2 抽象→具象比喻**：为知识点生成易记的视觉锚点（智能推荐）。

### 跨模块：智能推荐 & 学习分析（全局层）
- **G1 学习周报/洞察**：基于 overview + forgetting-curve 数据，LLM 生成自然语言周报与薄弱模块诊断（数据分析预测）。
- **G2 智能复习推荐**：结合 SM-2 排程 + lapse 聚类，推荐"现在最该复习什么、用什么方式"（智能推荐）。
- **G3 关联串联**：把相关 captures/notes 聚成"学习路径"（智能推荐，需 embedding，见 §4）。

---

## 2. 需求清单与可行性/价值评估

评分说明：可行性(F)与价值(V)均 1~5 分（5 最高）；优先级 P0=必须先做的基础设施，P1=快速高回报，P2=增强体验，P3=进阶/可选。

| 编号 | 需求 | 类型 | 可行性 F | 价值 V | 优先级 | 落点（现有字段/端点） |
|------|------|------|:---:|:---:|:---:|------|
| H1 | **本地 LLM 配置中心**（provider/key/model/baseURL，存 data dir） | 基础设施 | 5 | 5 | **P0** | 新增 `settings` 表/`config.json` + `/api/settings` + 设置页 |
| B1 | 笔记栏→线索栏问题自动生成 | 自动化 | 5 | 5 | **P1** | `PATCH /api/workbench/notes/:id` 或新 `/api/ai/note/cue` |
| B2 | 笔记栏→总结栏自动生成 | 自动化 | 5 | 4 | **P1** | `/api/ai/note/summary` |
| E1 | 费曼清晰度评分回填 `clarity_score` | 数据升级 | 5 | 5 | **P1** | 已有字段，仅需 `/api/ai/story/clarity` 写回 |
| E2 | 费曼盲点提取回填 `gap_note` | 智能推荐 | 5 | 4 | **P1** | 已有字段 |
| D1 | 主动回忆语义评分替换重叠率 | 数据升级 | 4 | 5 | **P1** | 替换 `scoreRecall`，`/api/ai/recall/score` |
| A1 | 收集箱一键提炼要点 | 自动化 | 5 | 4 | **P1** | `/api/ai/capture/summarize` |
| A2 | 自动标签 + 建议分类 | 智能推荐 | 5 | 4 | **P1** | 回填 `tags`/`categoryId` |
| B4 | 笔记→批量复习卡片 | 自动化 | 5 | 4 | **P2** | `POST /api/workbench/reviews` 批量 |
| C1 | 收集箱/笔记→批量复习卡 | 自动化 | 5 | 4 | **P2** | 同上 |
| G1 | 学习周报/洞察 | 数据分析 | 4 | 4 | **P2** | 聚合 overview + forgetting-curve |
| C2 | 薄弱点诊断 | 数据分析 | 4 | 4 | **P2** | 读 `wb_review_log` |
| A3 | 收集箱→自动起草笔记 | 自动化 | 4 | 3 | **P2** | `POST /api/workbench/notes` |
| E3 | 费曼自动起草初稿 | 自动化 | 4 | 3 | **P2** | `POST /api/workbench/stories` |
| D2 | 三轮改进建议 | 智能推荐 | 4 | 3 | **P3** | 读 `wb_recall_session` |
| F1 | 宫殿位点自动生成 | 自动化 | 4 | 3 | **P3** | `POST /api/workbench/loci` 批量 |
| F2 | 抽象→具象比喻锚点 | 智能推荐 | 4 | 3 | **P3** | `image_hint` |
| G2 | 智能复习推荐引擎 | 智能推荐 | 3 | 4 | **P3** | 结合 SM-2 + lapse |
| G3 | 内容关联/学习路径 | 智能推荐 | 2 | 3 | **P3** | 需 embedding + 向量检索 |

**关键洞察**：
- **E1/E2/D1 是"零 schema 改动"的纯增量**——数据库字段已存在，只需新增调用与写回，风险最低、回报最快。
- **B1/B2 是体验杠杆最大**——直接解决"用户最不愿意手写的栏"。
- 你已验证过的技术（DeepSeek/SiliconFlow + SSE 流式）可 100% 平移，无新学习成本。

---

## 3. 技术栈接入方案

### 3.1 整体架构（AI 调用点）

```
┌─────────────── Tauri 窗口 (WKWebView) ───────────────┐
│  Vue3 前端 (src-ui)                                   │
│   - 各模块页面新增 "AI 生成" 按钮                      │
│   - 调用同源 /api/ai/*（无 CORS，经 8787 回环）        │
└───────────────────────┬──────────────────────────────┘
                         │ HTTP (同源)
┌───────────────────────▼──────────────────────────────┐
│  Node 侧车 (src-api, Fastify)                         │
│   routes/ai.ts  ──► lib/llm.ts                        │
│      │                    │ 读 config (data dir)        │
│      │                    ▼                            │
│      │             fetch → LLM API (HTTPS)             │
│      │                DeepSeek / SiliconFlow           │
│      ▼                                                │
│   db (Drizzle/SQLite) 写回 clarity_score / gap_note /  │
│   tags / cueColumn / summaryColumn / loci ...          │
└───────────────────────────────────────────────────────┘
       关键原则：API Key 只存在于 Node 侧车，永不下发到渲染进程
```

### 3.2 基础设施：配置中心（P0，必须先做）
- **存储**：在 `resolveDataDir()` 下新增 `config.json`（如不存在则创建，落盘后 `chmod 600`），或新增一张 `settings(key TEXT PRIMARY KEY, value TEXT)` 表。前者实现更简单、便于用户手动改。
- **端点**：`GET/PUT /api/settings`（PUT 接收 `{ provider, baseURL, apiKey, model }`；apiKey 写盘时不回显，GET 返回时脱敏为 `****`）。
- **前端**：新增"设置 / AI 配置"页（路由 `/settings`），输入 provider、Key、模型；未配置时各 AI 按钮置灰并提示"请先配置 AI"。
- **默认 provider**：DeepSeek（`https://api.deepseek.com/v1`，模型 `deepseek-chat`）或 SiliconFlow（OpenAI 兼容），两者你都已用过，零适配成本。

### 3.3 LLM 调用库（`src-api/src/lib/llm.ts`）
- 用 Node 22 原生 `fetch` 调 OpenAI 兼容的 `/v1/chat/completions`。
- 统一函数：`chat(messages, { json?: boolean, signal? })` → 返回文本或解析后的 JSON（用 `response_format: { type: 'json_object' }` 保证结构化输出，便于写回字段）。
- **优雅降级**：无 Key/网络失败时抛特定错误，路由返回 `{ code: 425, message: 'AI 未配置/暂不可用' }`，前端提示而非崩溃。
- 可选：支持 `stream`，用于 E3/A1 等长文本生成时逐字渲染（你 ai-chat-vue 已实践 SSE，套路一致）。

### 3.4 路由设计（`src-api/src/routes/ai.ts`，挂载 `/api/ai`）
每个能力一个小端点，内部做"取数据 → 拼 prompt → 调 LLM → 校验 → 写回 DB → 返回"：
- `POST /ai/capture/summarize` `{ captureId }` → 摘要 + 标签 + 建议分类
- `POST /ai/note/cue` `{ noteId }` → 线索栏问题数组（回填 `cueColumn`）
- `POST /ai/note/summary` `{ noteId }` → 总结栏文本（回填 `summaryColumn`）
- `POST /ai/note/flashcards` `{ noteId }` → 一组 `{front,back}`（批量建卡）
- `POST /ai/recall/score` `{ sessionId, round, sourceText, userText }` → `{ score, missed[], wrong[] }`（替换前端当前重叠率）
- `POST /ai/story/clarity` `{ storyId }` → `{ clarityScore, gapNote }`（回填 `wb_story` 两字段）
- `POST /ai/story/draft` `{ noteId, audience }` → 故事初稿 + `metaphor`
- `POST /ai/palace/loci` `{ palaceId, points[] }` → loci 列表（含 `imageHint`）
- `POST /ai/insight/report` `{ days }` → 周报文本（聚合 overview + forgetting-curve）

### 3.5 前端接入点（`src-ui`）
- 复用现有 `api/request.ts`（统一解包 `{code:200,data}` 信封）。
- 各 view 在工具栏新增"✨ AI 生成"按钮（如 `WorkbenchNoteEdit.vue` 的线索栏/总结栏旁、`WorkbenchStory.vue` 的评分按钮、`WorkbenchRecall.vue` 的提交后评分）。
- 交互：点击 → loading 态 → 把结果填充进对应 textarea/字段 → 用户可编辑后随现有自动保存落库。保持"AI 建议、人终校"的协作模式。

### 3.6 安全与隐私（桌面端尤其重要）
- Key 只在 Node 侧车内存/本地文件，渲染进程永远拿不到 → 避免 XSS 泄 Key。
- `config.json` 存于 `resolveDataDir()`（用户数据目录，非应用包内，重装不丢）。
- 调用走 HTTPS；不代理、不上传用户笔记到第三方除 LLM 外的任何服务。
- 可选项：后续用 Tauri 的 `tauri-plugin-store` 或 Keychain 进一步加固（进阶，非 MVP 必需）。

---

## 4. 实施路线图与优先级建议

### 阶段 P0 — 打通管线（约 0.5~1 天）
1. `lib/llm.ts` + `config.json` 读写 + `GET/PUT /api/settings` + 设置页。
2. 一个 Hello 端点 `POST /ai/ping`（回声测试）验证 Key 可用。
> 完成即可在 UI 看到"AI 已就绪"，是后续一切的开关。

### 阶段 P1 — 快速高回报（约 2~3 天，强烈建议先做）
按"零 schema 改动优先"原则：
1. **E1/E2 费曼评分+盲点**（填回 `clarity_score`/`gap_note`，字段已就绪）。
2. **D1 主动回忆语义评分**（替换 `scoreRecall`，质量跃升）。
3. **B1/B2 笔记线索栏+总结栏生成**（体验杠杆最大）。
4. **A1/A2 收集箱提炼+标签**。
> 这 6 项都只需"调 LLM + 写回已有字段"，不碰表结构，风险最低、即时可见价值。

### 阶段 P2 — 增强体验（约 2~3 天）
1. **B4/C1 批量生成复习卡片**（自动化建卡，直接喂给 SM-2）。
2. **G1 学习周报/洞察 + C2 薄弱点诊断**（把已有的 forgetting-curve 数据用 LLM 讲成人话）。
3. **A3/E3 自动起草笔记/费曼初稿**。

### 阶段 P3 — 进阶/可选（按需）
1. **F1/F2 记忆宫殿自动生成 + 文生图**（若引入图像模型，`image_hint`→图）。
2. **D2 三轮改进建议**。
3. **G2 智能复习推荐引擎 / G3 内容关联**（需 embedding + 向量检索；better-sqlite3 + drizzle 已含 vector 类型支持，可在本地做轻量语义检索，无需外部向量库）。

### 推荐落地顺序（一句话）
**先 P0 配置中心 → 再 P1 的 E1/D1/B1 三个"零改动高回报"点 → 验证手感后铺开 P1 其余 → P2 → P3**。

---

## 5. 风险与注意事项
1. **密钥安全**：Key 绝不能进前端 bundle 或 git；本方案已隔离在 Node 侧车与本地文件。
2. **网络依赖**：LLM 调用需联网；桌面端离线场景要优雅降级（按钮禁用 + 提示），不能阻塞核心学习流程。
3. **成本控制**：单条笔记/卡片 prompt 几 KB，DeepSeek 极便宜；建议对长文做截断（如前 4000 字），避免超 token。
4. **结果可编辑**：AI 产出一律作为"建议"，用户可改后保存，避免错误内容写死。
5. **SM-2 不可被 AI 覆盖**：复习排程是确定性算法（记忆里标注的"算法漂移 R2 风险"），AI 只做"建卡/诊断/建议"，不改动 `nextReviewTime` 计算逻辑。
6. **统一信封契约**：所有 `/api/ai/*` 返回同样包 `{code:200,data}`，前端 request.ts 已能解包，无需改动。

---

## 附：与现有记忆/契约的一致性
- 本方案新增端点均走 `/api/ai/*` 前缀，**不改动**现有 `/api/workbench/*`（与 Web 端契约对齐的 14 个端点原样保留），保证迁移/回环兼容。
- 复用已验证的"Node 侧车 + 同源托管 + 回环地址"部署模型（见 `.workbuddy/memory/2026-08-06.md`），AI 调用自然落在 8787 侧车内，Tauri 打包无需额外改动。
- 用户已具备 DeepSeek/SiliconFlow 接入经验（ai-chat-vue 项目），本方案无新技术栈风险。
