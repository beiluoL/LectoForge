<!--
提交 PR 前请确认：
  1. 已阅读 CONTRIBUTING.md（三层架构红线 + 前端设计令牌约束）
  2. 已跑通「验收清单」并把结果贴在下面对应位置
  3. 一个 PR 只做一件事（避免格式化与功能改动混在一起）
  4. 改动波及端点/表/路由数量或目录结构时，已同步更新 README.md 与 docs/
-->

## 改了什么

<!-- 按模块或文件列出。示例：
- src-api/src/services/notesService.ts：拆出 backlinks 查询，删除 Controller 内的 SQL
- src-ui/src/views/WorkbenchNotes.vue：新增反向引用面板入口
-->

-

## 为什么这么改

<!-- 写根因，不要只描述现象。示例：
现象是笔记页加载慢；根因是 GET /notes 未分页，一次拉全量后在前端 filter。改为 SQL 层分页。
-->

## 关联 Issue

<!-- 用 Closes / Fixes 关联，合并后会自动关闭对应 Issue -->

Closes #

## 类型

<!-- 勾选一项；与 PR 标题的 Conventional Commits 前缀保持一致 -->

- [ ] `feat` 新功能
- [ ] `fix` 缺陷修复
- [ ] `refactor` 重构（行为零退化）
- [ ] `perf` 性能优化
- [ ] `docs` 文档
- [ ] `style` / `chore` / `test` 其他

## 影响范围

- [ ] 后端（`src-api/`）
- [ ] 前端（`src-ui/`）
- [ ] 桌面外壳（`src-tauri/`）
- [ ] 构建与脚本（`scripts/`、`package.json`、`tauri.conf.json`）
- [ ] 文档（README / docs / CHANGELOG）
- [ ] 数据表结构变更（**如勾选，请在下方说明迁移方式**）

## 验收结果

<!-- 必填。贴出实际命令与输出，不要只写「已测试」 -->

```bash
# 前端类型检查 + 真实打包
cd src-ui && ./node_modules/.bin/vue-tsc --noEmit && ./node_modules/.bin/vite build

# 后端类型检查
cd src-api && ./node_modules/.bin/tsc -p tsconfig.json --noEmit

# Rust（改了 src-tauri 才需要；注意 release profile）
cd src-tauri && cargo check --release
```

<!-- 粘贴输出 -->

```
（此处粘贴输出）
```

### 行为零退化验证（重构类改动必做）

```bash
bash scripts/api-snapshot.sh before
# ... 改动 ...

bash scripts/api-snapshot.sh after
diff -r .refactor-baseline/before .refactor-baseline/after
```

- [ ] `diff -r` 输出为空（重构未改变任何只读端点的响应）
- [ ] 不适用（本次非重构类改动）

## 截图 / 录屏

<!-- 涉及 UI 改动时必填。前后对比更佳 -->
<!-- ⚠️ 请先遮盖个人路径、笔记标题、API Key 等隐私信息 -->

| 改动前 | 改动后 |
|--------|--------|
|        |        |

## 风险与回滚

<!-- 必填。写清楚：最坏情况会发生什么？出问题怎么退回去？ -->

- **风险**：
- **回滚方式**：

## 自检清单

- [ ] 代码符合三层架构边界（Route 无 SQL、Controller 无 SQL、Service 无 Fastify 类型）
- [ ] 未手写 `{ code, data }` 信封（由 `onSend` 统一包装）
- [ ] 新增 list 端点已分页（`.limit().offset()`）
- [ ] 无 `db.transaction(async ...)` 等同步 API 的异步包装
- [ ] 前端未硬编码色值/字号/圆角/间距（走 `--kb-*` 令牌）
- [ ] 未使用 Tailwind `dark:` 变体（主题走 `data-theme` + `color-mix`）
- [ ] 未修改已发布的 Pinia store ID
- [ ] 提交信息符合 Conventional Commits，且**不含**凭据或个人信息
- [ ] 文档与代码一致（端点数 / 表数 / 路由数 / 目录结构）
