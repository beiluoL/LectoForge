# 贡献指南

感谢你对 LectoForge 的兴趣。本文档说明本地开发环境搭建、代码约定与提交规范。

LectoForge 是一个**本地优先（local-first）的 macOS 学习工作台**：数据全部留在用户自己的电脑上，没有账号体系、没有服务端。因此本项目对**离线可用性**与**数据可控性**的要求高于一般项目——任何新增功能都不允许引入「必须联网才能用」的硬依赖。

---

## 目录

- [行为准则](#行为准则)
- [环境准备](#环境准备)
- [启动开发环境](#启动开发环境)
- [项目结构](#项目结构)
- [代码约定（红线）](#代码约定红线)
- [提交规范](#提交规范)
- [验收清单](#验收清单)
- [分支与 Pull Request](#分支与-pull-request)
- [报告问题](#报告问题)

---

## 行为准则

- 尊重每一位贡献者，技术讨论对事不对人。
- 不提交任何形式的凭据（API Key、签名私钥、证书）到仓库。
- 不提交用户真实数据（个人笔记、简历、录音、截图中的真实目录名）。

---

## 环境准备

### 必需

| 项 | 版本 | 说明 |
|----|------|------|
| macOS | 12+ | 项目仅支持 macOS（依赖 WKWebView 与原生托盘 API） |
| Node.js | **24.16.0** | **强约束**，见下方说明 |
| Xcode Command Line Tools | 最新 | `xcode-select --install` |

### 仅打包时需要

| 项 | 版本 | 说明 |
|----|------|------|
| Rust | 1.97+ | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |

### ⚠️ Node 版本是硬约束，不是建议

后端依赖 `better-sqlite3`——一个**原生模块（Native Addon）**。原生模块在编译时会把 Node 的 **ABI 版本**烘焙进二进制，运行时版本不匹配就会直接崩：

```
Error: The module '.../better_sqlite3.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION 137. This version of Node.js requires NODE_MODULE_VERSION 127.
```

`NODE_MODULE_VERSION` 就是 ABI 号：Node 24.16.0 → **137**，Node 22.x → 127。因此：

> **在运行任何 `tauri dev` / `tauri build` / `npm rebuild better-sqlite3` / `bash scripts/prepare-bin.sh` 之前，必须先切到 Node 24.16.0。**

```bash
# 用 nvm 安装并切换
nvm install 24.16.0
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"

node -v          # 必须输出 v24.16.0
node -p "process.versions.modules"   # 必须输出 137
```

若确实需要换 Node 版本重建原生模块，从源码编译（预编译包常因镜像缺失而回退失败）：

```bash
export npm_config_disturl=https://registry.npmmirror.com/dist
npm rebuild better-sqlite3 --build-from-source
```

后端新增依赖后，还必须重新生成生产依赖快照（打包时会被塞进 `.app`）：

```bash
bash scripts/prepare-bin.sh
```

---

## 启动开发环境

### 纯前端 + 后端（日常开发，不需要 Rust）

```bash
npm --prefix src-api install
npm --prefix src-ui install

npm run dev:all
# 前端 http://localhost:5173（Vite 代理 /api → 127.0.0.1:8787）
```

### 完整桌面应用（需要 Rust）

```bash
npm install
bash scripts/prepare-bin.sh     # 生成 Node 侧车二进制
npm run tauri dev
```

`tauri dev` 由 Rust 宿主拉起 Node 侧车，数据目录由宿主注入 `LECTOFORGE_DATA_DIR`
（默认 `~/Library/Application Support/com.lectoforge.desktop/`）。

### 独立跑后端

```bash
npm --prefix src-api run dev
# 可指定数据目录，避免污染真实数据
LECTOFORGE_DATA_DIR=/tmp/lf-dev npm --prefix src-api run dev
```

> 💡 **调试时务必用 `LECTOFORGE_DATA_DIR` 指向临时目录**。真实数据目录里是用户的学习资产，误清空不可恢复。

### 打包

```bash
npm run tauri build
# 产物：src-tauri/target/release/bundle/macos/
```

---

## 项目结构

```
desktopApp/
├── src-ui/        Vue 3 前端（Vite + Pinia + vue-router + Tailwind）
│   ├── src/views/        业务页面
│   ├── src/components/   公共组件
│   ├── src/store/        Pinia store
│   ├── src/lib/          API 客户端、Markdown 渲染、SRS/OCR/STT 等
│   └── src/style.css     全局设计令牌（--kb-* 唯一来源）
├── src-api/       Node 后端（Fastify + better-sqlite3 + Drizzle）
│   ├── src/routes/       薄路由（只绑路径）
│   ├── src/controllers/  HTTP 层（参数 + 状态码）
│   ├── src/services/     业务层（SQL / 文件 IO / 外呼）
│   ├── src/types/        契约层（DTO / VO，禁运行时值）
│   ├── src/db/           schema + 建表 + WAL
│   └── backup.js         独立备份脚本（archiver 打 zip）
├── src-tauri/     Tauri 2 macOS 外壳（Rust：侧车托管、托盘、通知、备份调度）
├── scripts/       构建与验收脚本
└── docs/          架构文档与截图
```

---

## 代码约定（红线）

以下约定是**强制的**，PR 中违反会被要求修改。它们不是风格偏好，而是踩过坑之后固化的约束。

### 后端三层架构

调用链固定为 `routes/ → controllers/ → services/`：

| 层 | 可以做 | **禁止** |
|----|--------|----------|
| **Route** | 声明路径/方法、绑定 Controller | 出现 `db.` / `drizzle-orm` / `axios` / `fetch(` |
| **Controller** | 解析参数、调 Service、决定 HTTP 状态码 | 写 SQL |
| **Service** | Drizzle 查询、事务、文件 IO、外部调用 | 引用 `FastifyRequest` / `FastifyReply` |
| **types/** | 定义 DTO / VO / 判别联合 | 出现任何运行时值（常量、函数） |

### 响应信封

成功响应统一为 `{ code: 200, data }`，由 `src-api/src/index.ts` 的 `onSend` 钩子**唯一负责**包装。

- ✅ Controller 直接 `return 纯数据`
- ❌ Controller 手写 `reply.send({ code: 200, data: ... })`

**唯一例外**：两个 SSE 端点（`/api/interview/*`）需要直写 `reply.raw`，不走信封。

### better-sqlite3 是同步的

不要给同步 API 套 async：

```ts
// ❌ 事务会在第一个 await 处提前提交
db.transaction(async (tx) => { ... });

// ✅
db.transaction((tx) => { ... });
```

Service 层同理，禁止无意义的 `async/await` 包装。

### 列表查询必须分页

新增 list 端点必须带 `.limit().offset()`，统一走 `lib/pagination.ts` 的
`resolvePage()` / `pickPage()`（`DEFAULT_PAGE_SIZE = 200`，`MAX = 500`）。
**禁止提供任何「拉全量」形态的列表端点**，尤其是日历：`GET /api/calendar/events`
必须带 `start_date` / `end_date` 范围参数。

### 前端

- **设计令牌唯一来源**：`src-ui/src/style.css` 的 `--kb-*` 变量。**禁止硬编码色值、字号、圆角、间距**。
- **主题切换**走 `documentElement[data-theme='dark']` + `color-mix`。**禁止 Tailwind 的 `dark:` 变体**。
- **Markdown 渲染唯一来源**：`src-ui/src/lib/markdown.ts`。不要另起一套渲染器。
- **Pinia store ID 一旦发布不可更改**（`defineStore('tasks', ...)` 中的 `'tasks'`）——持久化插件按 ID 存盘，改了老用户数据就丢。
- **Tailwind 只用于布局**（flex/grid/spacing），按钮/输入框等外观走全局类 `.kb-btn` / `.kb-input` / `.kb-label`。

### 打包相关（改配置前必读）

- `src-ui/dist`、`binaries/server-<triple>`、`src-api/.prod-modules` 是 **tauri_build 编译期必需资源**，任何脚本都**不可删除**（`build.rs` 校验缺失即 panic）。
- `tauri.conf.json` 的 `bundle.resources` 必须包含 `../src-api/package.json`，否则打包后 GUI 白屏。
- Rust 代码若写在 `cfg(not(debug_assertions))` 内，普通 `cargo check` **不会编译它**——改完必须跑 `cargo check --release`。

---

## 提交规范

采用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>
```

常用 type：`feat` / `fix` / `refactor` / `perf` / `docs` / `style` / `chore` / `test`。

**scope 取模块名**，与目录/路由对应，例如：
`inbox` / `notes` / `review` / `library` / `mindmap` / `diagram` / `tasks` /
`habits` / `quadrant` / `calendar` / `pomodoro` / `ai` / `interview` / `settings` /
`tauri` / `api` / `ui`。

示例：

```
feat(diagram): 支持多页画布与页面拖拽排序
fix(ai): 修正 /associate 读取 entity_type 大小写导致标题恒空
refactor(api): notesService 拆出 backlinks 查询
docs(readme): 校正端点/表/路由计数为审计值
```

**提交信息用中文**（本项目现状，保持一致）。提交信息中不要出现真实姓名、公司、路径等隐私信息。

---

## 验收清单

提交 PR 前请**逐条**跑通，并在 PR 描述里贴出结果：

```bash
# 前端类型检查 + 真实打包（仅 vue-tsc 不够，必须真 build）
cd src-ui && ./node_modules/.bin/vue-tsc --noEmit && ./node_modules/.bin/vite build

# 后端类型检查
cd src-api && ./node_modules/.bin/tsc -p tsconfig.json --noEmit

# Rust（改了 src-tauri 才需要；注意 release profile）
cd src-tauri && cargo check --release

# 后端行为零退化（重构类改动必须做）
bash scripts/api-snapshot.sh before
# ... 改动 ...
bash scripts/api-snapshot.sh after
diff -r .refactor-baseline/before .refactor-baseline/after   # 必须为空
```

> ⚠️ 用 `node_modules/.bin/` 下的可执行文件，**不要用 `npx`**——`npx` 可能联网拉包，慢且会污染版本。
> ⚠️ `vite build` 才是真正的打包验证；`vue-tsc --noEmit` 只查类型，查不出打包期错误。

---

## 分支与 Pull Request

1. 从 `main` 切出分支：`feat/xxx`、`fix/xxx`、`refactor/xxx`。
2. 保持 **一个 PR 只做一件事**，避免把格式化与功能改动混在一起。
3. PR 描述请包含：
   - **改了什么**（按文件/模块列点）
   - **为什么这么改**（根因，而非现象）
   - **怎么验证的**（贴验收命令与输出）
   - **风险与回滚方式**（若有）
4. 若改动波及端点数量、数据表数量、路由数量、目录结构，**请同步更新 `README.md` 与 `docs/ARCHITECTURE.md`**——文档与代码必须长期一致。
5. 若改动涉及 UI，请附**改动前后截图**。

### 关于 Issue 与标签

本仓库使用多维度标签体系（类型 / 模块 / 优先级 / 状态），说明见
[`.github/labels.md`](.github/labels.md)。
新建 Issue 时请选择合适的模板，并尽量填全环境信息。

---

## 报告问题

- **Bug**：请用 Bug 报告模板，务必包含 macOS 版本、芯片（Intel / Apple Silicon）、应用版本、是开发模式还是打包后的 `.app`。
- **安全漏洞**：**请勿**公开开 Issue，通过 GitHub 仓库主页的邮箱私下联系维护者。
- **功能建议**：请用功能建议模板，重点说清「什么场景下遇到了什么问题」，而不是只给一个方案。

感谢你的贡献。
