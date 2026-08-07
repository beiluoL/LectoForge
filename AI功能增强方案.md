# KnowFlow 学习工作台（桌面端）AI 能力 · 技术方案（已落地版）

> 版本：v2.0 ｜ 更新日期：2026-08-07 ｜ 适用范围：基于当前 `desktopApp` 实际代码逐文件核对后产出
> 技术栈：Tauri 2 + Node 侧车（Fastify / TS，端口 8787）+ Vue3 / Vite / Pinia / lucide-vue-next
> 本文档是 **v1（2026-08-06 规划稿）的落地复盘与现状对齐**——原规划的 P0~P3 现已全部交付，这里把"方案"转为"已建成能力的技术规格 + 后续演进候选"。

---

## 0. 现状速览（结论先行）

| 维度 | 现状 |
|------|------|
| 架构 | Rust 壳(Tauri) + Node 侧车(Fastify/TS) + Vue3 前端，三端打包进 `.app`；同源托管 `/api/*`，零 CORS |
| 数据 | SQLite(WAL) + Drizzle ORM，单用户 `CURRENT_USER=1`，数据目录经 `--data-dir`/`KNOWFLOW_DATA_DIR` 可配 |
| **AI 现状** | **已完整落地**：21 个 `/api/ai` 端点全部实现，覆盖配置中心 / 内容加工 / 评估洞察 / 向量检索 / 思维导图生成 |
| LLM 调用 | 纯 Node 22 原生 `fetch` 调 OpenAI 兼容 `/v1/chat/completions`，**不引入任何 LLM SDK**；配置 `ai-config.json` 落盘 `chmod 600` |
| 向量检索 | `wb_embedding` 表存 JSON 向量 + 应用层 JS 余弦；`/embeddings/sync` 按 `content_hash` 增量重建，`/associate` 查关联 |
| 前端增强 | 已引入 **Pinia 4**（记忆宫殿 store 持久化）、**lucide-vue-next**（Icon.vue 包装器）；各模块「✨ AI」按钮 + loading + 可编辑回填 |
| 优雅降级 | 未配置 Key / 网络失败 → `LlmError(aiCode)` → 前端提示或返回 mock（思维导图），主流程零阻塞 |

**一句话**：从"零 AI"到"全模块 AI 增强"已在当前代码库闭环，原方案 100% 交付；本文档记录已建成能力的规格，并给出下一阶段（P4）候选方向。

---

## 1. 模块级 AI 机会与交付对照

> 原 §1 的痛点分析仍然成立，这里仅在每条末尾补「交付状态」。

### 模块一：收集箱（Captures）
- 痛点：长文难提炼、标签几乎为空、长期停在 INBOX。
- AI 机会：A1 提炼要点、A2 标签+分类、A3 起草笔记。
- **交付状态：✅ 已实现** —— `/capture/summarize`、`/tags`、`/capture/draft-note`。
- **入口迁移**：收集箱前端页面已从 `/workbench/capture` 迁移至 `/inbox`（旧路径 301 重定向），后端新增 `/api/inbox/*` 共 10 个端点（复用 `wb_capture` 表，状态机 `INBOX/ARCHIVED/TRASHED` ↔ `unprocessed/archived/trashed`），「5 大体验升级」再补充：B 网页元数据 `GET/POST /api/inbox/metadata`、C 多目标沉淀 `PUT /api/inbox/:id/process` 支持 `palace|story`、D `GET /api/dashboard/stats` 新增 `inboxOverdueCount`；旧 `/api/workbench/captures` 保留为遗留接口。

### 模块二：康奈尔笔记（Notes）
- 痛点：线索栏问题 / 总结栏最易被跳过，建复习卡费时。
- AI 机会：B1 线索栏问题、B2 总结栏、B4 批量复习卡。
- **交付状态：✅ 已实现** —— `/note/generate`（线索+总结）、`/note/flashcards`（批量建卡自动入库 `wb_review_card`，`next_review_time=now` 立即进复习队列）。前端 `generateNoteQuiz` 返回 `NoteQuizResult`。
- **UI 升级（2026-08-07）**：列表页网格卡片/紧凑列表双模式 + 掌握度进度条 + 到期「需复习」徽章；编辑页倒 T 形三栏比例可拖拽（持久化）+ 划词悬浮工具栏（转线索）+ 自动保存竞态保护；全局 ⌘/Ctrl+Shift+F 极速新建笔记（`QuickCreateNote`）。

### 模块三：间隔重复（Review，SM-2）
- 痛点：建卡费时；复习只有 quality，无"为什么错/怎么补"。
- AI 机会：C1/C2 批量卡 + 薄弱点诊断、C3 错题讲解。
- **交付状态：✅ 已实现（C1/C2）** —— `/note/flashcards` 批量建卡、`/weakness/diagnose`、`/review/recommend`；C3 错题讲解为 P4 候选。

### 模块四：主动回忆（Recall，三轮闭卷）
- 痛点：重叠率评分严重失准（换说法即低分、抄写得高分）。
- AI 机会：D1 语义评分替换重叠率、D2 三轮改进建议。
- **交付状态：✅ 已实现** —— `/recall/score`（语义分+遗漏点+规则分对照）、`/recall/advice`。

### 模块五：费曼故事（Stories）
- 痛点：`clarity_score` / `gap_note` 字段已留位却从未填充。
- AI 机会：E1 清晰度评分、E2 盲点提取、E3 自动起草。
- **交付状态：✅ 已实现** —— `/story/clarity`（回填两字段）、`/story/draft`（受众化初稿+比喻）。

### 模块六：记忆宫殿（Palaces + Loci）
- 痛点：建位点枯燥，抽象概念难具象化。
- AI 机会：F1 自动生成位点、F2 抽象→具象比喻。
- **交付状态：✅ 已实现** —— `/palace/loci`、`/palace/loci/image-hint`。

### 跨模块：智能推荐 & 学习分析
- G1 学习周报、G2 智能复习推荐、G3 内容关联/向量检索。
- **交付状态：✅ 已实现** —— `/insight/report`、`/review/recommend`、`/embeddings/sync` + `/associate`（G3 依赖 `wb_embedding`）。

---

## 2. 需求清单与交付状态

> 原 §2 的 F/V 评估仍作历史参考；新增「交付状态」列。

| 编号 | 需求 | 类型 | 可行性 | 价值 | 优先级 | 落点（实际端点/字段） | 交付状态 |
|------|------|------|:---:|:---:|---|------|:---:|
| H1 | 本地 LLM 配置中心 | 基础设施 | 5 | 5 | P0 | `GET/PUT /api/ai/config` + `POST /api/ai/test` + `GET /api/ai/status` + `ai-config.json` | ✅ 已落地 |
| B1 | 笔记栏→线索栏问题 | 自动化 | 5 | 5 | P1 | `POST /api/ai/note/generate` | ✅ 已落地 |
| B2 | 笔记栏→总结栏 | 自动化 | 5 | 4 | P1 | `POST /api/ai/note/generate` | ✅ 已落地 |
| E1 | 费曼清晰度评分回填 | 数据升级 | 5 | 5 | P1 | `POST /api/ai/story/clarity` → `clarity_score` | ✅ 已落地 |
| E2 | 费曼盲点提取回填 | 智能推荐 | 5 | 4 | P1 | `POST /api/ai/story/clarity` → `gap_note` | ✅ 已落地 |
| D1 | 主动回忆语义评分 | 数据升级 | 4 | 5 | P1 | `POST /api/ai/recall/score` | ✅ 已落地 |
| A1 | 收集箱提炼要点 | 自动化 | 5 | 4 | P1 | `POST /api/ai/capture/summarize` | ✅ 已落地 |
| A2 | 自动标签+分类 | 智能推荐 | 5 | 4 | P1 | `POST /api/ai/tags` | ✅ 已落地 |
| B4 | 笔记→批量复习卡 | 自动化 | 5 | 4 | P2 | `POST /api/ai/note/flashcards` | ✅ 已落地 |
| C1 | 收集箱/笔记→批量卡 | 自动化 | 5 | 4 | P2 | 同上（来源可选） | ✅ 已落地 |
| G1 | 学习周报/洞察 | 数据分析 | 4 | 4 | P2 | `POST /api/ai/insight/report` | ✅ 已落地 |
| C2 | 薄弱点诊断 | 数据分析 | 4 | 4 | P2 | `POST /api/ai/weakness/diagnose` | ✅ 已落地 |
| A3 | 收集箱→自动起草笔记 | 自动化 | 4 | 3 | P2 | `POST /api/ai/capture/draft-note` | ✅ 已落地 |
| E3 | 费曼自动起草初稿 | 自动化 | 4 | 3 | P2 | `POST /api/ai/story/draft` | ✅ 已落地 |
| D2 | 三轮改进建议 | 智能推荐 | 4 | 3 | P3 | `POST /api/ai/recall/advice` | ✅ 已落地 |
| F1 | 宫殿位点自动生成 | 自动化 | 4 | 3 | P3 | `POST /api/ai/palace/loci` | ✅ 已落地 |
| F2 | 抽象→具象比喻锚点 | 智能推荐 | 4 | 3 | P3 | `POST /api/ai/palace/loci/image-hint` | ✅ 已落地 |
| G2 | 智能复习推荐 | 智能推荐 | 3 | 4 | P3 | `POST /api/ai/review/recommend` | ✅ 已落地 |
| G3 | 内容关联/学习路径 | 智能推荐 | 2 | 3 | P3 | `POST /api/ai/embeddings/sync` + `/api/ai/associate` | ✅ 已落地 |
| — | 思维导图 AI 生成 | 自动化 | 4 | 4 | P2 | `POST /api/ai/generate-mindmap`（挂在 `/api/ai` 下） | ✅ 已落地 |

**结论**：原规划 P0~P3 共 20 项需求 **100% 交付**，无遗留未实现项。

---

## 3. 已实现的技术接入

### 3.1 整体架构（AI 调用点）

```
┌─────────────── Tauri 窗口 (WKWebView) ───────────────┐
│  Vue3 前端 (src-ui)                                   │
│   - 各模块页面「✨ AI」按钮（加载态 + 可编辑回填）      │
│   - Pinia store（记忆宫殿）+ lucide 图标              │
│   - 调用同源 /api/ai/*（无 CORS，经 8787 回环）        │
└───────────────────────┬──────────────────────────────┘
                         │ HTTP（同源）
┌───────────────────────▼──────────────────────────────┐
│  Node 侧车 (src-api, Fastify)                         │
│   routes/ai.ts (21 端点) ──► lib/llm.ts                │
│      │                    │ 读 ai-config.json          │
│      │                    ▼                            │
│      │             fetch → LLM API (HTTPS)             │
│      │                DeepSeek / OpenAI / 自定义        │
│      ▼                                                │
│   db (Drizzle/SQLite) 写回 clarity_score / gap_note /  │
│   tags / cueColumn / summaryColumn / loci ...          │
│   wb_embedding 存向量（/associate 检索）               │
└───────────────────────────────────────────────────────┘
       关键原则：API Key 只存在于 Node 侧车，永不下发到渲染进程
```

### 3.2 配置中心（P0，已实现）
- **存储**：`resolveDataDir()` 下的 `ai-config.json`（落盘后 `chmod 600`），与 `workbench.db` 同级；不入库。
- **端点**：`GET/PUT /api/ai/config`（PUT 接收 `{ provider, baseURL, apiKey, model }`；GET 脱敏为 `****`）、`POST /api/ai/test`（连通性）、`GET /api/ai/status`（各能力可用态）。
- **前端**：`/settings/ai`（AiSettings.vue）填写 provider/Key/模型/温度/超时；向量化服务（SiliconFlow BAAI/bge-m3、OpenAI text-embedding-3-small、自定义）独立配置。未配置时各 AI 按钮置灰 + 提示。
- **首次引导也可配**：`/onboarding` 引导页填的 AI 参数经 `POST /api/config/init` → `lib/llm.ts` 的 `saveConfig` 落入同一份 `ai-config.json`，与 `/settings/ai` 完全等价（详见《技术架构与功能手册.md》§7.15）。`/api/config` 初始化时一并返回 AI 公共视图（Key 仅掩码），供引导页预填。
- **预设**：`PROVIDER_PRESETS`（deepseek / openai / custom）、`EMBEDDING_PRESETS`；默认 DeepSeek `https://api.deepseek.com/v1` + `deepseek-chat`。
- **环境变量** `KNOWFLOW_AI_KEY` / `KNOWFLOW_AI_MODEL` / `KNOWFLOW_AI_BASE_URL` 优先级最高。

### 3.3 LLM 调用库（`src-api/src/lib/llm.ts`，438 行）
- 纯 Node 22 原生 `fetch` 调 OpenAI 兼容 `/v1/chat/completions`，**不引入任何 LLM SDK**。
- 关键函数：`chat(messages, { json?, signal? })`、`chatJson<T>()`（强约束 JSON + 解析泛型）、`embed()`（向量生成）、`ping()`、`readConfig/saveConfig`、`isReady/embeddingsReady/assertReady`、`maskKey`、`truncate`、`stripHtml`。
- **统一异常** `LlmError`（带 `status` + `aiCode`：`AI_DISABLED` / `AI_NOT_CONFIGURED` / `AI_TIMEOUT` / `AI_UPSTREAM_ERROR` / `AI_BAD_RESPONSE`），前端据 `aiCode` 决定是否引导去设置页。
- **输出规整**：`normalizeScore`（0~100 整数）、`normalizeList` 等兜底，防止模型格式漂移把前端搞崩。

### 3.4 路由设计（`src-api/src/routes/ai.ts`，21 端点，前缀 `/api/ai`）
每个端点"取数据 → 拼 prompt → 调 LLM → 校验 → 写回 DB → 返回"：
- **配置与探针（4）**：`GET/PUT /config`、`POST /test`、`GET /status`
- **内容加工（9）**：`/capture/summarize`、`/tags`、`/capture/draft-note`、`/note/generate`、`/note/flashcards`、`/story/draft`、`/story/clarity`、`/palace/loci`、`/palace/loci/image-hint`
- **评估与洞察（5）**：`/recall/score`、`/recall/advice`、`/insight/report`、`/weakness/diagnose`、`/review/recommend`
- **向量检索（2）**：`/embeddings/sync`、`/associate`
- **思维导图（1）**：`POST /generate-mindmap`（由 `mindmapAiRoutes` 注册在 `/api/ai` 下；CRUD 5 端点另在 `/api/mindmaps`）

> Prompt 模板集中在 `src-api/src/lib/prompts.ts`（**882 行，15 组** `buildXxxPrompt`，如 `buildStoryClarityPrompt` / `buildRecallScorePrompt` / `buildMindMapPrompt`），各组配套 TS 输出类型，前后端类型闭环。

### 3.5 前端接入（Pinia + lucide + AI 按钮）
- 路由 19 条（17 个业务视图）含 `/onboarding`、`/settings`、`/settings/ai`、`/insights/ai`；`main.ts` 已 `createPinia()` + `pinia-plugin-persistedstate`。
- `Icon.vue` 重构为 **lucide-vue-next 包装器**，新代码统一用 lucide 图标名（如 `sparkles`/`brain`）。
- 各 view 工具栏「✨ AI 生成」按钮：loading → 填充对应字段 → 用户可编辑后随既有自动保存落库（AI 建议、人终校）。
- `AiAssociatePanel`（右侧）承载 `/embeddings/sync` + `/associate` 的内容关联；`AiInsights.vue` 承载周报/诊断/推荐。

### 3.6 安全与隐私（已实现）
- Key 只在 Node 侧车内存 / 本地 `ai-config.json`（`chmod 600`），渲染进程永远拿不到 → 防 XSS 泄 Key。
- 调用走 HTTPS；不上传用户笔记到 LLM 之外的任何第三方。
- 配置存于 `resolveDataDir()`（用户数据目录，重装不丢）。

---

## 4. 实施记录与后续演进

### 4.1 已交付里程碑（P0→P3 全部落地）
1. **P0 配置中心**：`lib/llm.ts` + `ai-config.json` 读写 + 4 配置/探针端点 + 设置页。
2. **P1 快速高回报**：费曼评分/盲点（E1/E2）、主动回忆语义评分（D1）、笔记线索/总结（B1/B2）、收集箱提炼/标签（A1/A2）。
3. **P2 增强体验**：批量复习卡（B4/C1）、周报+薄弱点（G1/C2）、自动起草笔记/费曼（A3/E3）、思维导图 AI 生成。
4. **P3 进阶**：宫殿自动生成（F1/F2）、三轮改进建议（D2）、智能复习推荐（G2）、内容关联/向量检索（G3，`wb_embedding`）。

### 4.2 后续演进候选（P4，非必须）
- **流式输出（SSE）**：长文本生成（A1/E3/故事）改流式逐字渲染，贴合已验证的 ai-chat-vue 套路。
- **语义检索进文档库**：把 `wb_embedding` + cosine 复用到 `/library` 全文/双链检索，实现"相似笔记"推荐。
- **错题讲解（C3）**：基于 `wb_review_log` 卡片生成针对性解析。
- **多 embedding 提供商 / 批量重建**：大库 `embeddings/sync` 分页并发 + 进度回调。
- **AI 复习节奏微调（谨慎）**：仅作"建议"展示，绝不改动 SM-2 的 `nextReviewTime` 计算（算法漂移风险）。
- **Keychain / tauri-plugin-store 加固**：密钥进一步脱离明文 `ai-config.json`（进阶）。

---

## 5. 风险与注意事项（更新）

1. **密钥安全**：Key 隔离在 Node 侧车 + 本地 `ai-config.json`（`chmod 600`），不进前端 bundle / git。✅ 已实现。
2. **网络依赖**：LLM 需联网；离线场景按钮禁用 + 提示，不阻塞核心学习流程。✅ 已实现降级。
3. **成本控制**：单条 prompt 几 KB，建议对长文 `stripHtml` 后截断（当前上限 6000 字符）。
4. **结果可编辑**：AI 产出一律作"建议"，用户可改后保存，避免错误内容写死。✅ 已落地。
5. **SM-2 不可被 AI 覆盖**：复习排程是确定性算法，AI 只做"建卡/诊断/建议"，不改动 `nextReviewTime`。
6. **统一信封契约**：所有 `/api/ai/*` 返回 `{code:200,data}`，前端 `request.ts` 解包。

---

## 附：与现有契约/记忆一致性

- 21 个新增端点全部走 `/api/ai` 前缀，**不改动**任何 `/api/workbench/*` 端点（共 43 个），契约与 Web 端逐字段对齐，迁移/回环兼容。
- 复用「Node 侧车 + 同源托管 + 回环地址」部署模型，Tauri 打包无需额外改动（资源清单见《技术架构与功能手册.md》§10.3）。
- 服务端代码位于 `src-api/src/{routes/ai.ts, lib/llm.ts, lib/prompts.ts}`；前端位于 `src-ui/src/{views/AiSettings.vue, views/AiInsights.vue, store/memoryPalace.ts, components/ui/Icon.vue}`。
- 端点总量以《技术架构与功能手册.md》§4.1 为准（应用合计 103 个，其中 AI 21 个；v1.1.0 新增 6 个非 AI 端点为间隔复习 2 / 搜索 1 / 看板 1 / 配置 2，本次新增 收集箱 `/api/inbox` 10 个、其「5 大体验升级」再增 metadata 2 个）。
