# 流程图 AntV X6 自研升级规格说明书（Spec）

> 对应方案 B。保持 Tauri 2 + Vue 3 + Pinia + Vite + SQLite 架构不变，仅将流程图内核从 `@vue-flow/core` 替换为 **AntV X6**，并补齐专业能力。
>
> 文档版本：v1.0 · 更新时间：2026-08-14
>
> ⚠️ **环境事实与决策修订（2026-08-14，P1-T1 启动时追加）**
> 1. **包管理器是 npm，不是 pnpm**：本仓库 `src-ui` 有独立 `package.json` + `package-lock.json` + `node_modules`，根目录用 `npm --prefix src-ui`。本文档及 tasks/checklist 中所有 `pnpm` / `pnpm -F src-ui` 命令一律替换为：进入 `src-ui/` 后执行 `npm <cmd>`（如 `npm install`、`npm run dev`、`npm run build`、`npm run typecheck`、`npm run lint`、`npm ls`）。
> 2. **X6 全家桶统一锁 2.x（core `^2.19.2`）**：npm registry 现默认拉取 **3.x**（core 3.1.x、vue-shape 3.0.x、clipboard 3.0.0），但其余 12 个插件仍停 2.x。**core 3 + 插件 2 主版本错配必炸**，故整条线钉死 2.x（已验证 13 个包均 dedupe 到 `@antv/x6@2.19.2`）。
> 3. **迁移时序采用「先加 X6、保留 Vue Flow」**：P1-T1.1 仅新增 X6 依赖与 `src/views/Diagram/x6/` 骨架 + 隐藏 playground 路由（`/diagram-x6-playground`），**不立即移除 `@vue-flow/*`**。原 spec/tasks 中标注「移除 @vue-flow/*」（如 ENV-03、tasks 多处）的动作**延后至 X6 达到功能对等（约 P1-T3 末）后再执行**，期间 `/diagram`（Vue Flow）保持可用、可并排回归。

---

## 1. 背景与目标

### 1.1 背景

当前项目（桌面应用）流程图模块基于 `@vue-flow/core 1.48` 实现，已具备基础的编辑/保存/导出/AI 能力，但：

1. **形状库匮乏**：仅 11 种基础形状，缺失 UML、ER、BPMN、AWS、网络设备等专业图形（对比 draw.io 数百种）；
2. **UML 非专业**：class/interface 仅有「带色条矩形」，无「类名/属性/方法」三段式与关系箭头；
3. **连线能力弱**：无手动 waypoint、无多路由/多箭头样式、标签位置不可调；
4. **无容器/泳道/分组**：节点平铺，无法画跨职能流程图；
5. **无图层/大纲/查找替换**：大图编辑体验差；
6. **富文本能力缺失**：纯文本 contenteditable，无加粗/斜体/字体/旋转/阴影/渐变/图片；
7. **性能瓶颈**：Vue Flow 纯 DOM 渲染，百节点以上明显掉帧；
8. **格式兼容性差**：仅 PNG/SVG 导出，无 .drawio/.vsdx/.pdf 导入导出。

### 1.2 目标

对标枫叶云笔记（draw.io 嵌入方案）的 80% 日常使用能力，在保持现有 Vue 生态统一的前提下，交付一个**专业级单机流程图编辑器**。

### 1.3 非目标（本次不做）

- ❌ 多人实时协作（单机版）
- ❌ Google Drive / OneDrive 云集成
- ❌ VSDX 格式导入导出（drawio XML 优先）
- ❌ MathJax 数学公式
- ❌ 插件/扩展市场
- ❌ BPMN 2.0 完整规范（仅支持常用流程符号）

---

## 2. 技术栈（保持 / 变更）

| 层 | 现有 | Phase 1 后 | 备注 |
|---|---|---|---|
| 桌面外壳 | Tauri 2（Rust） | 保持 | — |
| 后端 | Node.js + Fastify + drizzle-orm + SQLite | 保持 | 仅新增历史表 |
| 前端框架 | Vue 3 + Vite 5 + Pinia + Tailwind | 保持 | — |
| **流程图内核** | **@vue-flow/core 1.48** | **AntV X6 2.x** | **核心替换** |
| 节点 Vue 桥接 | CustomNode.vue（自管） | `@antv/x6-vue-shape` | — |
| 自动布局 | @dagrejs/dagre | 保持 | 切换对接 X6 JSON |
| 历史/撤销 | Pinia 手写快照 | `@antv/x6-plugin-history` | — |
| 复制粘贴 | Pinia 内存剪贴板 | `@antv/x6-plugin-clipboard` | — |
| 参考线/吸附 | 仅 8px 网格 | `@antv/x6-plugin-snapline` | — |
| 节点变换 | @vue-flow/node-resizer | `@antv/x6-plugin-transform` | — |
| 导出 | html2canvas + 自绘 SVG | `@antv/x6-plugin-export` | 新增 PDF |
| 键盘事件 | 自管 | `@antv/x6-plugin-keyboard` | — |
| 选择 | 自管 | `@antv/x6-plugin-selection` | — |
| 小地图 | @vue-flow/minimap | `@antv/x6-plugin-minimap` | — |
| 滚动画布 | 自管 | `@antv/x6-plugin-scroller` | — |
| 拖拽入库 | 自管 pointer 事件 | `@antv/x6-plugin-dnd` / `stencil` | — |

---

## 3. 范围

### 3.1 Phase 1：核心替换与能力补全（约 2 周）

交付一个**功能 ≥ 当前 Vue Flow 实现 + X6 原生优势**的可工作版本。

范围：
- P1-T1 工程改造：依赖迁移与 X6 初始化骨架
- P1-T2 节点与连线重写（11 种形状 + 3 线型 + waypoint + 多箭头）
- P1-T3 核心编辑能力（撤销重做 / 复制粘贴 / 对齐分布 / 自动布局 / 多页）
- P1-T4 工具栏与属性面板适配 + 富文本升级（旋转/阴影/渐变/草图）
- P1-T5 高级功能迁移（自由画笔 / 模板 / AI 生成 / PNG·SVG·PDF 导出 / 持久化）

### 3.2 Phase 2：专业能力补全（约 2–3 周）

交付一个**对标 draw.io 80% 日常需求**的产品级编辑器。

范围：
- P2-T1 专业形状库（50+ 形状：标准流程符号 / UML 三段式 / ER / AWS 20 / 网络基础 / 通用）
- P2-T2 容器 / 泳道 SwimLane / 分组 Group / 图层 Layers / 大纲面板
- P2-T3 持久化版本历史 / 查找替换 / Snapline 参考线
- P2-T4 draw.io XML 导入导出 + PDF 分页导出
- P2-T5 图片节点 / 超链接 / Tooltip

---

## 4. 关键架构约束

### 4.1 模块化与组合式（来自历史经验教训）

> **经验提醒**：禁止把 X6 Graph、业务状态、工具栏逻辑全部堆在 `index.vue` 或单个 SFC 中。必须按下面分层，UI 组件只负责事件转发。

```
src-ui/src/views/Diagram/
├── x6/                                    # X6 专属模块（不与业务耦合）
│   ├── useGraph.ts                        # composable：Graph 初始化/挂载/卸载
│   ├── graphConfig.ts                     # Graph options 配置常量
│   ├── vue-shapes.ts                      # Vue Shape 注册（x6-vue-shape 桥接）
│   ├── shapeFactory.ts                    # 11+种形状 SVG/Path 工厂
│   ├── edgeFactory.ts                     # 3 种连线 + waypoint + 箭头工厂
│   ├── useGraphHistory.ts                 # X6 history 与 Pinia 步数联动
│   ├── useGraphClipboard.ts               # 复制粘贴封装
│   ├── useGraphSelection.ts               # 多选/框选/属性联动
│   ├── useGraphExport.ts                  # 导出 PNG/SVG/PDF
│   └── useGraphPersistence.ts             # toJSON/fromJSON + 防抖保存
├── components/                            # UI（纯组件，不含 graph 实例持有）
│   ├── DiagramCanvas.vue                  # 容器，调用 useGraph
│   ├── DiagramToolbar.vue                 # 顶栏（按钮只 emit，不碰 graph）
│   ├── DiagramLibrary.vue                 # 左侧形状库（Stencil 或自研分组）
│   ├── DiagramProperties/
│   │   ├── CanvasSettings.vue             # 绘图 Tab（网格、页面尺寸、吸附等）
│   │   ├── NodeStyle.vue                  # 样式 Tab·节点（富文本/旋转/阴影）
│   │   └── EdgeStyle.vue                  # 样式 Tab·边（waypoint/箭头）
│   ├── DiagramBottomBar.vue               # 多页页签
│   ├── DiagramLayersPanel.vue             # P2：图层
│   ├── DiagramOutlinePanel.vue            # P2：大纲
│   ├── DiagramVersionHistory.vue          # P2：版本历史弹窗
│   ├── DiagramFindReplace.vue             # P2：查找替换浮窗
│   ├── DiagramContextMenu.vue             # 右键菜单
│   ├── DiagramAiModal.vue                 # AI 生成（保留，对接 X6 JSON）
│   ├── DiagramTemplateModal.vue           # 模板库
│   ├── nodes/
│   │   ├── X6CustomNode.vue               # 通用自定义节点（含富文本/Handle）
│   │   ├── X6ClassNode.vue                # UML 三段式类
│   │   ├── X6ER*.vue                      # ER 系列节点
│   │   ├── X6SwimLane.vue                 # 泳道
│   │   └── X6ImageNode.vue                # 图片
│   └── edges/
│       └── X6CustomEdge.vue               # 通用自定义边（按钮+标签）
├── shapeDefs.ts                           # 形状定义 JSON（50+）
├── templates.ts                           # 模板（保留，扩展 X6 JSON）
├── types.ts                               # 类型（对齐 X6 NodeConfig/EdgeConfig）
└── index.vue                              # 组合器：拼装三栏 + 底栏 + 浮层
```

后端增量：
- 新增 `wb_diagram_history` 表（版本历史）
- 现有 `wb_diagram.data` 列保持 JSON string（从 VueFlow JSON 格式切换到 X6 JSON，不拆子表）

### 4.2 数据兼容性策略

- **运行时**：全部用 X6 原生 JSON（`graph.toJSON()/fromJSON()`），禁止手写字段白名单；
- **历史数据迁移**：启动时检查 `data` 列是否为旧 VueFlow schema，若是则用一次性转换脚本（`src-api/src/lib/diagramLegacyConvert.ts`）转成 X6 JSON，保存时写回；
- **不提供**向后降级导出（旧 → X6 单向）。

### 4.3 依赖版本锁定

```jsonc
// package.json（示例，安装前验证 peer 范围）
{
  "@antv/x6": "~2.18.0",
  "@antv/x6-vue-shape": "~2.1.2",
  "@antv/x6-plugin-history": "~2.2.3",
  "@antv/x6-plugin-selection": "~2.2.1",
  "@antv/x6-plugin-keyboard": "~2.2.1",
  "@antv/x6-plugin-clipboard": "~2.2.1",
  "@antv/x6-plugin-export": "~2.2.4",
  "@antv/x6-plugin-transform": "~2.2.3",
  "@antv/x6-plugin-snapline": "~2.2.1",
  "@antv/x6-plugin-minimap": "~2.2.1",
  "@antv/x6-plugin-scroller": "~2.2.1",
  "@antv/x6-plugin-stencil": "~2.2.1",
  "@antv/x6-plugin-dnd": "~2.2.1"
}
```

---

## 5. 验收标准（分阶段）

### 5.1 Phase 1 验收（2 周末）

| # | 检查项 | 验证方法 |
|---|---|---|
| P1-A1 | 依赖树干净：package.json 中无任何 `@vue-flow/*` 残留 | `npm ls @vue-flow/core` 报 "Not found" |
| P1-A2 | Vite dev 启动后控制台无 X6 / 依赖错误 | 手工启动观察 1 min |
| P1-A3 | 11 种原有形状 + 3 种线型视觉差异 ≤ 2px | 并排截图对比 |
| P1-A4 | 所有快捷键功能一致（Ctrl+Z/Y/S/C/V、Delete、Esc） | 手工键盘测试脚本逐项执行 |
| P1-A5 | 撤销重做 50 步不丢不漏、不重复 | 录制 50 步动作后回滚检查 |
| P1-A6 | 自动布局 TB/LR 两方向无重叠 | 对 7 个模板各执行一次布局 |
| P1-A7 | 导出 PNG 2× 像素比清晰；SVG 独立浏览器打开视觉一致 | 导出后肉眼对比 |
| P1-A8 | 3 页多页切换 + 刷新后内容完整保留 | 手工回归脚本 |
| P1-A9 | AI "下单流程"示例 5s 内生成 nodes+edges 且布局无重叠 | 手工触发 |
| P1-A10 | 压力测试：500 节点 + 600 连线，5 分钟编辑（增/删/改/移动）期间 FPS ≥ 30 | Chrome Performance 面板 |

### 5.2 Phase 2 验收（2–3 周末）

| # | 检查项 | 验证方法 |
|---|---|---|
| P2-A1 | 形状库分组 ≥ 6 组，总形状 ≥ 50 个 | 分组逐一计数 |
| P2-A2 | UML 三段式 + 6 种关系箭头均可用 | 画最小样例图 |
| P2-A3 | ER 图实体/属性/关系/基数均可用 | 画最小样例图 |
| P2-A4 | AWS 20 个图标渲染清晰（矢量），可大小/颜色 | 每个拖拽一次 |
| P2-A5 | 横/纵泳道：节点不能跨 lane 边界 | 手工拖拽验证 |
| P2-A6 | Ctrl+G 分组 / Ctrl+Shift+G 解组正常 | 录制 3 节点组合操作 |
| P2-A7 | 图层：显隐 + 锁定 + 拖拽排序 | 新建 3 层逐一操作 |
| P2-A8 | 版本历史：10 步后可恢复任一步另存 | 面板回滚并重新保存 |
| P2-A9 | Ctrl+F 查找 + 逐个/全部替换 | 10 节点同名标签测试 |
| P2-A10 | PDF A4 分页导出，Preview.app 打开不糊 | 导出 PDF 打开验证 |
| P2-A11 | draw.io XML 导入：基础形状/连线/文字正确；复杂 shape 有 warning 列表 | 用 draw.io 官方 2 张 demo 图 |
| P2-A12 | 图片节点：粘贴/选择图片 → 保存刷新仍在 | 粘 JPG + 重启应用 |
| P2-A13 | 超链接 + Tooltip：hover 显示、Ctrl+点击系统浏览器打开 | 设 1 条 http 链接测试 |

---

## 6. 风险与回退

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| X6 + Vue3 桥接在 Tauri WKWebView 下 pointer 事件不兼容 | 中 | 高 | 保留旧 pointer overlay 方案（Vue Flow 已验证可用），用 X6 graphView 事件兜底 |
| X6 插件版本号不匹配导致安装失败 | 低 | 中 | 按 T1.1 锁定的版本，先在单独 sandbox 验证再合入 |
| 旧数据迁移脚本漏字段导致数据丢失 | 中 | 高 | 迁移前先做 SQLite 备份 + 转换结果断言（节点数一致），迁移失败回滚原始 JSON |
| 富文本 contenteditable 在 WKWebView 下 execCommand 行为异常 | 低 | 中 | 回退到 Tiptap 迷你编辑器（依赖 ~50KB，可接受） |
| draw.io XML 解析器覆盖场景不够导致丢失图形 | 中 | 低 | 每次解析记录 mapping miss 日志 + 给用户 warning 弹窗（"N 个图形降级为矩形"） |

**强制回退策略**：每个 Task 合入前必须在独立分支（`feature/x6-task-id`）通过 Phase 1 最小验收标准（P1-A1 ~ P1-A3），合并顺序严格按 tasks.md 的依赖关系，禁止跨依赖合入。

---

## 7. 交付文件（本规格对应的 3 份文档）

| 文件 | 说明 |
|---|---|
| `spec.md` | 本文件：目标 / 范围 / 架构约束 / 验收标准 / 风险 |
| `tasks.md` | 开发任务清单：ID / 子任务 / 具体内容 / 验收标准 / 依赖 / 工时估计 |
| `checklist.md` | 交付检查点：开发完成后逐项勾 |
