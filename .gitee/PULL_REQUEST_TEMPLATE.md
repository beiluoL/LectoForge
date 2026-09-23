<!--
Gitee 的 PR 模板。完整版（含详细自检清单）见 .github/PULL_REQUEST_TEMPLATE.md。
-->

## 改了什么

<!-- 按模块或文件列出 -->

-

## 为什么这么改

<!-- 写根因，不要只描述现象 -->

## 关联 Issue

Closes #

## 类型

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
- [ ] 构建与脚本
- [ ] 文档
- [ ] 数据表结构变更（**如勾选请说明迁移方式**）

## 验收结果

<!-- 必填。贴出实际命令与输出，不要只写「已测试」 -->

```bash
cd src-ui  && ./node_modules/.bin/vue-tsc --noEmit && ./node_modules/.bin/vite build
cd src-api && ./node_modules/.bin/tsc -p tsconfig.json --noEmit
cd src-tauri && cargo check --release   # 改了 src-tauri 才需要
```

```
（粘贴输出）
```

重构类改动请额外验证行为零退化：

```bash
bash scripts/api-snapshot.sh before
# ... 改动 ...
bash scripts/api-snapshot.sh after
diff -r .refactor-baseline/before .refactor-baseline/after   # 必须为空
```

- [ ] `diff -r` 输出为空
- [ ] 不适用（非重构类改动）

## 截图 / 录屏

<!-- 涉及 UI 改动时必填，请遮盖隐私信息 -->

## 风险与回滚

- **风险**：
- **回滚方式**：

## 自检清单

- [ ] 符合三层架构边界（Route 无 SQL、Controller 无 SQL、Service 无 Fastify 类型）
- [ ] 未手写 `{ code, data }` 信封
- [ ] 新增 list 端点已分页（`.limit().offset()`）
- [ ] 无 `db.transaction(async ...)` 等同步 API 的异步包装
- [ ] 前端未硬编码色值/字号/圆角/间距（走 `--kb-*` 令牌）
- [ ] 未使用 Tailwind `dark:` 变体
- [ ] 未修改已发布的 Pinia store ID
- [ ] 提交信息符合 Conventional Commits，不含凭据或个人信息
- [ ] 文档与代码一致（端点数 / 表数 / 路由数 / 目录结构）
