# views/archive —— 已下线页面存档

这里放**已从路由表摘除、不再参与产品流程**的旧页面组件。保留源码而非直接删除，
是为了在新页面出问题时能快速对照旧实现（交互细节、AI 联想面板用法等）。

> 归档组件不被任何路由或组件 import，Vite 打包时会被 tree-shaking 摘掉，
> 不进产物；但仍会被 `vue-tsc` 类型检查覆盖，所以改动公共 API 时别忘了同步它们，
> 或者确认无用后彻底删除。

| 文件 | 下线时间 | 原路由 | 替代者 |
| --- | --- | --- | --- |
| `WorkbenchCapture.vue` | 2026-08-07 | `/workbench/capture` | `views/Inbox/index.vue`（`/inbox`） |

## WorkbenchCapture.vue

旧版收集箱。走 `/api/workbench/captures` 老接口（大写状态 + 分类树 + AI 联想面板），
新版收集箱改走 `/api/inbox/*`（小写三态 + 网页剪藏 + 一键沉淀），两套接口共用
`wb_capture` 一张表，因此**数据是通的**，旧页面里存的条目在新收集箱里照样能看到。

旧路径 `/workbench/capture` 已在 `router/index.ts` 配置 `redirect: '/inbox'`，
历史链接与外部书签不会 404。
