# 流程图 AntV X6 自研升级 — 开发任务清单（Tasks）

> 文档版本：v1.0 · 关联规格：[spec.md](./spec.md) · 检查清单：[checklist.md](./checklist.md)
>
> 代码组织强制规则：每个任务对应分支名 `feature/x6-<TaskID>`（如 `feature/x6-P1-T1`）；一个 PR 只包含一个任务的变更；每个任务合入前必须跑 checklist 中相关项。

---

## 任务勾选状态（实时同步 · 最后更新 2026-08-14）

> 本区块为各子任务的勾选总览，详细验收标准见下方各任务表。代码分支与提交见文末「进度记录」。
> 图例：✅ 已实现（typecheck + build 绿，待 `tauri dev` 真机验收）/ ⬜ 未开始。

### Phase 1
- [x] **P1-T1** 工程改造：依赖迁移与 X6 初始化骨架（`48ccf57`）
  - [x] P1-T1.1 移除 VueFlow 全家桶、安装 X6 及 12 插件（锁 2.x）
  - [x] P1-T1.2 `useGraph` composable 封装 new Graph
  - [x] P1-T1.3 `graphConfig.ts` 默认插件配置
  - [x] P1-T1.4 `vue-shapes.ts` 最小 test-vue-node
- [x] **P1-T2** 节点与连线重写（保留 shapeDefs 视觉）（`0741235`）
  - [x] P1-T2.1 `shapeFactory.ts` 11 形状注册
  - [x] P1-T2.2 自定义节点 contenteditable + 四向 ports + resizer
  - [x] P1-T2.3 `edgeFactory.ts` 3 线型 + 命中区 24px
  - [x] P1-T2.4 连线升级 waypoint + 6 箭头 + 锚点吸附
- [x] **P1-T3** 核心编辑能力对齐（`45db0ce`）
  - [x] P1-T3.1 撤销重做（x6-plugin-history）
  - [x] P1-T3.2 复制粘贴（x6-plugin-clipboard）
  - [x] P1-T3.3 批量对齐与分布（batchUpdate 1 步）
  - [x] P1-T3.4 自动布局（@dagrejs/dagre TB/LR）
  - [x] P1-T3.5 多页系统迁移（fromJSON 切换）
- [x] **P1-T4** 工具栏与属性面板适配 + 富文本升级（本次提交）
  - [x] P1-T4.1 顶栏 `DiagramToolbar.vue`（按钮改调 graph/composable，选中态 disabled 联动）
  - [x] P1-T4.2 右侧「绘图」面板（网格/页面/背景/连接点/参考线）
  - [x] P1-T4.3 右侧「样式·节点」面板（富文本 + 填充/描边/圆角/旋转/阴影/渐变/草图）
  - [x] P1-T4.4 右侧「样式·连线」面板（线型/线宽/虚线/箭头/线色/标签位置）
- [x] **P1-T5** 高级功能迁移
  - [x] P1-T5.1 自由画笔（方案 B 文档级监听器）
  - [x] P1-T5.2 模板迁移为 X6 cells
  - [x] P1-T5.3 AI 生成对接（X6 cells + type guard）
  - [x] P1-T5.4 导出升级 PNG/SVG/PDF
  - [x] P1-T5.5 序列化/持久化重写 + 旧数据迁移

### Phase 2
- [x] **P2-T1** 专业形状库扩展（50+ 形状）（本提交）
  - [x] P2-T1.1 分组图形库面板（手风琴 + 搜索 + 宽度拖拽 + x6-plugin-dnd 拖拽落点）
  - [x] P2-T1.2 流程图/BPMN 17 种（圆柱/文档/梯形/沙漏/五角/双线矩形 等）
  - [x] P2-T1.3 UML 类三段式 + 6 种关系边（继承/实现/聚合/组合/关联/依赖，点两节点连边）
  - [x] P2-T1.4 ER 9 种（实体/弱实体/属性/多值/键/关系/弱关系）
  - [x] P2-T1.5 AWS 20（自绘矢量徽标，非官方版权素材）
  - [x] P2-T1.6 网络/通用 13 种（服务器/路由/交换/防火墙/负载均衡/云/用户/设备/邮件 等）
- [x] **P2-T2** 容器/泳道/分组/图层/大纲（本提交）
  - [x] P2-T2.1 容器节点（embedding parent-child + 边界夹紧 + 工具栏「容器」）
  - [x] P2-T2.2 泳道 SwimLane（结构父节点 + 边界夹紧；多 lane 嵌套为后续增强）
  - [x] P2-T2.3 分组 Group（Ctrl+G / Ctrl+Shift+G + 工具栏「分组」按钮）
  - [x] P2-T2.4 图层面板（DiagramLayersPanel：显隐/锁定/排序/新建/重命名/删除/指派选中）
  - [x] P2-T2.5 大纲面板（DiagramOutlinePanel：结构树 + 点选滚动居中 + 高亮闪烁 + 搜索过滤）
- [x] **P2-T3** 版本历史 + 查找替换 + 参考线（本提交）
  - [x] P2-T3.1 版本历史：后端 `wb_diagram_history` 表 + `diagramHistoryService`/`Controller`/`routes`（`POST /diagram/:id/history` 记录、`GET .../history` 列表、`POST .../restore/:historyId` 恢复、`GET .../:historyId/download` 下载）；前端 `useGraphPersistence` 30s 节流自动快照 + Ctrl+S「手动保存」快照 + `DiagramVersionHistory.vue` 抽屉（列表/恢复/下载，恢复前自动备份安全快照）
  - [x] P2-T3.2 查找替换：`DiagramFindReplace.vue`（Ctrl+F 唤起），实时高亮 + 上/下个 + 替换/全部替换，Case Sensitive / Whole Word；节点改 `attr('label/text')`+`data.label`，连线改 `setLabels`+`data.label`，全部替换 1 步 history
  - [x] P2-T3.3 参考线：Snapline `tolerance:10` + `sharp:true`，线色/线宽经全局 CSS 覆盖为粉色 #FF5C93 / 2px（X6 snapline 无 stroke/label 选项，对齐文字 label 非原生能力，已用 sharp 提升吸附精度替代）
- [ ] **P2-T4** draw.io XML 导入导出 + PDF 完善
- [ ] **P2-T5** 图片节点 + 超链接 + Tooltip

---

## 进度记录（提交哈希 · 均未推送）

| 任务 | 分支 | 提交 | 状态 |
|---|---|---|---|
| P1-T1 | feature/x6-P1-T1 | `48ccf57` | ✅ 已本地提交 |
| P1-T2 | feature/x6-P1-T1 | `0741235` | ✅ 已本地提交 |
| P1-T3 | feature/x6-P1-T1 | `45db0ce` | ✅ 已本地提交 |
| 自由画笔方案 B 决策 | feature/x6-P1-T1 | `36a685a` | ✅ docs only |
| P1-T4 | feature/x6-P1-T1 | `c26e48b` | ✅ 已本地提交 |
| P1-T5 | feature/x6-P1-T1 | `8c757de` | ✅ 已本地提交 |
| P2-T1 | feature/x6-P2 | `30c0039` | ✅ 已本地提交 |
| P2-T2 | feature/x6-P2 | `34e9444` | ✅ 已本地提交 |
| P2-T3 | feature/x6-P2 | （待提交） | 🟡 已实现待提交 |

---

## 总览：工期与依赖总览

```
Week 1  ┌─ P1-T1（依赖）──── P1-T2.1 ──┬── P1-T2.3
        │       (0.5d)       (1.5d)   │    (1d)
        │                    P1-T2.2 ──┘    P1-T2.4
        │                      (1d)         (1d)
Week 2  ├─ P1-T3.1~3.5（依赖 T2.4） ── P1-T4 ── P1-T5
        │       合计 4d                        3d
        │                                ├ 并行 P1-T5.3（AI）
Week 3  └ PHASE 1 验证 + P2-T1（并行 3 子任务：T1.2/T1.3-4/T1.5-6）
                      4d 形状库

Week 4  P2-T2.1 容器 → P2-T2.2 泳道 → P2-T2.3 分组 → P2-T2.4 图层 → P2-T2.5 大纲
        P2-T3.1 版本历史 / P2-T3.2 查找替换 / P2-T3.3 参考线（可并行）

Week 5  P2-T4 导入导出 + P2-T5 图片/链接 + 集成测试与 Bugfix
```

---

## Phase 1：核心替换与能力补全（约 10 人日）

---

### P1-T1 工程改造：依赖迁移与 X6 初始化骨架

| 项目 | 内容 |
|---|---|
| **工时估计** | 0.5 人日 |
| **优先级** | P0 — 第一个完成的任务 |
| **依赖** | 无 |
| **关联文件（新建/修改）** | `src-ui/package.json`（删 VueFlow 加 X6 全家桶）、`src-ui/src/views/Diagram/x6/useGraph.ts`（新建）、`x6/graphConfig.ts`（新建）、`x6/vue-shapes.ts`（新建占位） |

#### 子任务

| ID | 具体内容 | 验收标准 | 依赖 |
|---|---|---|---|
| P1-T1.1 | 移除 `@vue-flow/core`、`@vue-flow/background`、`@vue-flow/controls`、`@vue-flow/minimap`、`@vue-flow/node-resizer` 全家桶；按 spec §4.3 锁定版本安装 X6 及其 12 个插件（`history/selection/keyboard/clipboard/export/transform/snapline/minimap/scroller/stencil/dnd` + `x6-vue-shape`） | ① `npm install` 无冲突 exit 0 ② `npm ls @vue-flow/core` 报 "Not found" ③ 12 个插件的主版本号均等于 X6 主版本（如 2.x.x） | — |
| P1-T1.2 | 新建 composable `x6/useGraph.ts`：① 入参 `{ containerRef, pageConfig }` ② 内部 `new Graph(options)`，从 `graphConfig.ts` 读配置 ③ `onMounted` 绑定容器、`onUnmounted` 调 `graph.dispose()` ④ 对外暴露 `{ graph, graphReady, useX6Plugin(name, options?) }` 钩子；**graph 实例严禁直接 export**，必须经 composable 返回（防多处共享导致副作用） | ① 在 test playground 用 composable 渲染一个 400×300 画布，用 `graph.addNode({ shape:'rect' })` 能看到矩形 ② 组件销毁后 DevTools Memory 快照中无 Graph/Event 残留引用 | P1-T1.1 |
| P1-T1.3 | 新建 `x6/graphConfig.ts`：默认启用 grid(8×8)、history(undoable:true, maxStack:50)、keyboard、clipboard、snapline、transform（节点 resizer/rotater）、minimap（右下小地图）、scroller（无限画布 + pannable）、selection（框选 + 多选）；**所有配置用 TypeScript 类型标注** | ① 开启 snapline，拖两矩形接近能看到粉色虚线吸附 ② minimap 右下角能看到缩略图 ③ 框选两个节点同时选中 | P1-T1.2 |
| P1-T1.4 | 新建 `x6/vue-shapes.ts`：用 `@antv/x6-vue-shape` 注册一个最小 `test-vue-node`（内部渲染 `<div style="color:red">{{ props.text }}</div>`），给后续 shapeFactory 扩展做接口预留 | ① `graph.addNode({ shape:'test-vue-node', data:{text:'hello'} })` → 画布显示红色 hello 文字 ② 节点大小按 Vue 组件 slot 计算正确 | P1-T1.2 |

---

### P1-T2 节点与连线重写（保留 shapeDefs 视觉）

| 项目 | 内容 |
|---|---|
| **工时估计** | 4.5 人日（T2.1~T2.4） |
| **优先级** | P0 |
| **依赖** | P1-T1 |

| ID | 具体内容 | 验收标准 | 依赖 |
|---|---|---|---|
| P1-T2.1（1.5d） | 新建 `x6/shapeFactory.ts`：读取 `shapeDefs.ts`（11 种：rect/rounded/ellipse/diamond/hexagon/terminal/process/decision/class/interface/note），按 X6 Shape 注册方式生成每种形状（优先用原生 `Shape.Rect / Shape.Ellipse / Shape.Polygon / Shape.Polygon(custom)`，保持旧版 SVG path 不变）；属性映射：fill → `attrs.body.fill`、stroke → `attrs.body.stroke`、strokeWidth → `attrs.body.strokeWidth`、textColor → `attrs.label.fill`、fontSize → `attrs.label.fontSize`、padding → `text.attrs.textRefX/Y` | ① 每个 shape 调用一次 `graph.addNode({ shape: 'custom-rect', x, y, width, height, attrs })`，视觉与旧 Vue Flow 截图像素差 ≤ 2px ② label 位置（居中/垂直对齐）与旧版完全一致 | P1-T1.4 |
| P1-T2.2（1d） | 改造 `components/nodes/X6CustomNode.vue`（或复用旧 CustomNode.vue 改名包装为 x6-vue-shape）：① contenteditable 双击编辑文字，Enter 保存 Esc 取消（失焦自动保存） ② 四向锚点 ports（top/right/bottom/left），拖拽手柄可直接拉连线 ③ `@antv/x6-plugin-transform` 的 resizer 接节点：最小 60×36，松手触发 history（避免每像素一帧 undo） ④ 选中态 2px 加粗描边 + 外阴影；**所有文字修改走 `graph.batchUpdate`，确保一次操作只入一条 history** | ① 双击矩形进编辑态输入 "Process A"，回车后文字更新 ② 从矩形右侧 handle 拖出一条连线上另一节点 ③ resize 节点至 50×20 被阻止，≥ 60×36 正常 ④ Ctrl+Z 一次撤销 resize，不重复 | P1-T2.1 |
| P1-T2.3（1d） | 新建 `x6/edgeFactory.ts` + `components/edges/X6CustomEdge.vue`：① 注册 3 种 router：`smoothstep`（X6 `manhattan` + corner:8）、`bezier`（`rounded` router）、`straight`（normal） ② attrs：lineWidth / strokeDasharray（虚线 pattern: "6 4"）/ markerEnd 开关 / markerStart 开关 / label 文字 + 位置 ③ 边选中时显示 2 个操作按钮：文字编辑 icon + 删除 icon ④ 命中区 line.targetWidth 扩到 24px（防 WKWebView 细线点不中） | ① 切换边类型在属性面板下拉，折线/曲线/直线视觉各不同 ② 选边出现两个小按钮，点删除 icon → 边删除（undo 可回） ③ label 双击徽标直接改文字 | P1-T2.2 |
| P1-T2.4（1d） | **连线能力升级**（X6 原生）：① waypoint：边可拖动路径拐点手动调路径（X6 edge vertices，右键菜单「添加航点/删除航点」） ② 箭头样式：属性面板终点箭头下拉（open / closed / diamond / block / classic / ER 菱形）共 6 种；起点箭头也可选 ③ 锚点吸附配置：默认四向 anchor 可连；属性面板可切换「自由连接」vs「仅中心锚点」 ④ 连接完成事件入 history 一步 | ① 连一条折线边，拖中间生成新拐点；Ctrl+Z 撤销拐点 ② 属性面板把终点箭头从默认 closed → diamond，画布更新 ③ 节点 A 右 anchor → 节点 B 左 anchor 的连线端点贴边，不穿节点 | P1-T2.3 |

---

### P1-T3 核心编辑能力对齐（撤销/复制/对齐/自动布局/多页）

| 项目 | 内容 |
|---|---|
| **工时估计** | 4 人日 |
| **优先级** | P0 |
| **依赖** | P1-T2.4 |

| ID | 具体内容 | 验收标准 | 依赖 |
|---|---|---|---|
| P1-T3.1（0.5d） | **撤销重做系统**：移除 Pinia diagram-store 手写 JSON 快照历史；改用 `@antv/x6-plugin-history`；新建 composable `x6/useGraphHistory.ts`：① 暴露 `undo() / redo() / canUndo / canRedo / stackCount` ② 快捷键 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z 统一由 plugin-keyboard 接管 ③ Pinia 仅存步数 counter（用于顶栏 UI 展示）；history.maxStack 配 50 | ① 连续做 10 步（加节点/连线/移动/改色/文字），每步 Ctrl+Z 可逐一回 ② 10 步后撤销第 1 步不崩 ③ 空画布 undo/redo 按钮正确 disabled | P1-T2.4 |
| P1-T3.2（0.5d） | **复制粘贴系统**：移除 Pinia 内存剪贴板；新建 `x6/useGraphClipboard.ts` 封装 `graph.copy() / paste({ offset: {dx:24, dy:24} }) / cut()`；快捷键 Ctrl+C/V/X 给 keyboard plugin；支持跨文档复制（graph 对象复制到全局剪贴板 Map，再在另一 graph 粘贴） | ① 选 2 节点 + 1 边 → Ctrl+C → Ctrl+V → 新节点位置偏移 24,24 不重叠 ② 多页场景：Page A Ctrl+C → Page B Ctrl+V → 节点在 B 画布出现 | P1-T3.1 |
| P1-T3.3（1d） | **批量对齐与分布**：在 `diagramStore` 实现（或新建 composable `useGraphLayoutTools.ts`）：6 种对齐（left / right / top / bottom / hcenter / vcenter）+ 2 种分布（hspacing / vspacing）；计算时直接取 nodes bbox（x/y/width/height）；批量改动必须用 `graph.batchUpdate` 包裹，只产生 **1 条 history 记录**；不足节点时按钮 disabled（对齐 ≥2、分布 ≥3） | ① 选 3 个 x 不同的节点 → 「左对齐」 → 3 个节点的 `node.getBBox().x` 值相同 ② 选 3 个 x = 100/200/400 的节点 → 「水平等距」 → x 中心差值相等：150/250/350 → 每 100 等距 ③ Ctrl+Z 整体撤销 1 步 | P1-T3.1 |
| P1-T3.4（1d） | **自动布局集成**：保留 `@dagrejs/dagre`；新建 `x6/useDagreAutoLayout.ts`：把 X6 nodes + edges（`graph.toJSON().cells`）→ dagre graphData → run dagre → 回写 nodes 位置 + edges vertices（router 变 manhattan）；支持 direction `TB`（默认） / `LR`；**整体 1 步 history**；顶栏加「自动布局 → TB / LR」下拉 | ① 加载 UML 类图模板（默认乱） → 点「自动布局 → LR」→ 节点左右分层展开、边不交叉 ② Ctrl+Z 1 步回到布局前 ③ 布局后节点 label 不裁切（padding 20 预留） | P1-T3.3 |
| P1-T3.5（1d） | **多页系统迁移**：改造 `DiagramBottomBar.vue`；设计 ① 「共享 Graph 实例 + fromJSON 切换」方案（性能优先，内存单实例）vs ②「每页独立 Graph」（隔离优先），**最终用方案①切换**；pages[] 结构保留 `{ id, name, nodes, edges, viewport, createdAt, updatedAt }` 不变；Pinia 监听 `currentPageId` 变化：旧页 `graph.toJSON()` 写回 → 新页 `graph.fromJSON(pages[newId])`；**切换页面前先 flush 自动保存** | ① 新建 3 个页签（Page A/B/C），A 画 1 节点 B 画 2 节点 C 画 3 节点，来回切 10 次数据不混 ② Ctrl+S → 刷新 → 3 页节点数依然 1/2/3 ③ 切页时顶栏 undo stack 正确复位（不同页独立 history，若用单实例方案需调用 `history.reset()` 后重放） | P1-T3.1 |

---

### P1-T4 工具栏与属性面板适配 + 富文本升级

| 项目 | 内容 |
|---|---|
| **工时估计** | 3 人日 |
| **优先级** | P1 |
| **依赖** | P1-T3 |

| ID | 具体内容 | 验收标准 | 依赖 |
|---|---|---|---|
| P1-T4.1（1d） | 顶栏 `DiagramToolbar.vue` 改造：**所有按钮不再直接访问 Pinia.nodes/edges，而调 composable / 发送事件**，按钮映射表：撤销(`history.undo`)/重做(`history.redo`)/删除(`graph.removeCells`)/置前(`graph.cellToFront`)/置后(`graph.cellToBack`)/填充色(colorPicker→`attrs.body.fill`)/线条色→`attrs.body.stroke`/阴影(`attrs.body.filter`) / 连线样式→`edge router`切换 / 航点开关 / 插入文本 `graph.addNode(text shape)` / 插入表格（`graph.addNode + Table node shape`）/ 全屏（Fullscreen API）/ 格式面板切换（右侧 panel show/hide）。所有按钮 disabled 联动 Pinia.selection（无选中则 disabled） | ① 无选中时撤销/重做外的大部分按钮 disabled（包括填充色、删除） ② 有选中节点→改填充色 picker→节点变色；Ctrl+Z 回 ③ 全屏按钮切换后画布占满视口 | P1-T3.5 |
| P1-T4.2（0.5d） | **右侧「绘图」标签页**（全局面板）：① 网格 checkbox + 颜色 color + 字号输入 + 「更改」按钮（写 grid config）② 页面视图 checkbox（showPageBreaks）③ 背景 checkbox + 颜色 ④ 阴影全局开关（默认不开启）⑤ 连接箭头 / 连接点 / 参考线（snapline）3 个 checkbox ⑥ 页面尺寸 select（A0/A1/A2/A3/**A4**/A5/A6/A7/B4/B5/Letter/Legal/Tabloid/Executive/**16:9/16:10/4:3**/自定义）⑦ 竖向/横向 radio | ① 改网格颜色到红 → 画布网格即时变红，Ctrl+S 刷新后保存 ② 切换页面尺寸到 16:9 → 画布页边框变宽 ③ 竖向→横向 radio 切换，页面方向反转 | P1-T4.1 |
| P1-T4.3（1.2d） | **右侧「样式」标签页·节点选中面板（富文本）**：组件 `DiagramProperties/NodeStyle.vue` 实现：① **富文本工具栏**：字体 select + 字号 input + 加粗 B + 斜体 I + 下划线 U + 对齐（左/中/右）；内容用 `document.execCommand` + contenteditable 的 `innerHTML` 存储（不用 Tiptap，避免依赖膨胀）② 颜色三件套：填充色 / 描边色 / 描边宽 slider / 圆角 slider ③ **旋转**：角度滑块 0-360°（X6 `node.rotate(angle)`）④ 阴影：开关 + 偏移 X/Y + 模糊 + 颜色 ⑤ 渐变：线性/径向 select + 起止两色 ⑥ 草图/手绘风格（sketch）：开关 + roughness slider ⑦ 重置按钮（恢复节点默认 attrs）；**所有属性操作 graph.batchUpdate 每 1 控件值变化 → 1 步 history**，防止拖动滑块 50 步全写入 | ① 选 1 节点 → 旋转 45° + 阴影（偏移 10/10, blur 8, 灰色） + 线性渐变红蓝 → 画布视觉正确 ② Ctrl+Z 1 步只撤销最后 1 个控件变化（不是一捆撤销） ③ 内容改粗斜体，保存刷新后文字仍保留粗斜样式 | P1-T4.2 |
| P1-T4.4（0.3d） | **样式·边选中面板**：组件 `EdgeStyle.vue`：线型 select（3 种）+ 线宽 number + 虚线 checkbox / pattern input + 起点箭头 select + 终点箭头 select（6 种） + 线色 color + 标签位置（起点百分比 0-100） + 标签偏移 X/Y | 设置边为 虚线（pattern "6 4"） + 终点 Diamond 箭头 + 标签位于 70%，画布显示正确 | P1-T4.1 |

---

### P1-T5 高级功能迁移（画笔/模板/AI/导出/持久化）

| 项目 | 内容 |
|---|---|
| **工时估计** | 3 人日（含 P1-T5.3 AI 可并行） |
| **优先级** | P0 |
| **依赖** | P1-T4 |

| ID | 具体内容 | 验收标准 | 依赖 |
|---|---|---|---|
| P1-T5.1（0.5d） | **自由画笔节点迁移**：改造 `DrawingNode.vue` → `nodes/X6DrawingNode.vue`；**WKWebView 兼容层采用「方案 B：文档级监听器」**（见 spec 决策块第 4 点）：`penMode` 时渲染透明层盖于 X6 容器上方并 `graph.setInteracting(false)`，起笔 `mousedown`/`touchstart`、把 `mousemove`/`mouseup`/`touchmove`/`touchend` 挂 `document`（**不用 `setPointerCapture`**，规避 WKWebView 跨 DOM 边界丢捕获/误发 `pointercancel`），松手经 `graph.clientToLocal()` 转坐标写入 X6 `Shape.Path`；节点上支持改色、移动、缩放、描边宽；**画完 1 条只入 1 条 history**（画笔过程中 `history.freeze()`） | ① 画笔模式下按住拖拽可绘连续自由曲线 ② 松手后整条曲线作为 1 个节点，可整体拖动 ③ Ctrl+Z 撤销整条曲线（非一像素撤销） ④ 改颜色 picker → 曲线变色 ⑤ **Tauri macOS 真机构建回归**：快速跨 DOM 移动不断笔、不丢尾点 | P1-T4.1 |
| P1-T5.2（0.5d） | **模板迁移**：修改 `templates.ts`，每个 template 从旧 VueFlow 结构改写为**标准 X6 节点/边 JSON**（`{ cells: [{ shape, position, size, attrs:{body, label} }, { source, target, router, attrs }] }`）；7 个模板（基础流程/线性/判断分支/循环/组织架构/思维导图/UML 类图）；应用模板先清空 → `graph.fromJSON(template.cells)` → `graph.zoomToFit()`；**模板应用算 1 步 history** | ① 点「组织架构」模板 → 画布出现树状结构 ② 各模板加载后 edges 无断连、nodes 不重叠（zoomToFit 全显示） ③ Ctrl+Z 回到空画布 | P1-T3.5 |
| P1-T5.3（1d，可并行） | **AI 生成对接**：前端不变弹窗 UI；后端 `aiDiagramService` 让 LLM 输出的不是 VueFlow nodes/edges，而是**标准 X6 cells JSON**（schema 明确：cells[] 中 shape 必须为 shapeFactory 已注册名、position 字段、size 字段、attrs.body/fill/stroke、attrs.label/text、边用 source/target（node id）+ router 名）；未配置 key 时仍然返回 mock 骨架；前端接收 data → `graph.addCells(data.cells)` → 调 useDagreAutoLayout（direction TB）整体布局；写 **type guard** `isX6CellsResponse()` 做响应合法性校验（防 LLM 幻觉字段导致 graph.fromJSON 抛错），不合法时 toast 提示并重试 1 次 | ① 输入 "画电商下单流程" → 5s 内返回 nodes+edges ② 自动布局后节点无重叠 ③ 断网/无 key 情况仍返回 mock（不抛错）④ 故意喂脏数据（缺 shape 字段）→ type guard 报错但不崩 | P1-T3.4 + P1-T5.2 |
| P1-T5.4（0.5d） | **导出升级**：新建 `x6/useGraphExport.ts`：移除 html2canvas 和自绘 SVG；① `exportPNG({ pixelRatio: 2, padding: 20, background: '#fff' })`（x6-plugin-export）② `exportSVG()` ③ **PDF 导出**（先占坑位，Phase 2 再完善；MVP 采用「导出 SVG → Blob → Tauri sidecar puppeteer 渲染成 PDF」或纯前端 svg2pdf.js（yWorks/SVG2PDF.js ~100KB）；选其中 1 种）④ 顶栏「导出 → PNG/SVG/PDF」子菜单 | ① 导出 PNG → Preview.app 打开清晰无锯齿（2×） ② 导出 SVG → Safari 独立打开视觉与画布一致 ③ PDF MVP 能出文件（字体偶尔糊 Phase 2 修） | P1-T4.1 |
| P1-T5.5（0.5d） | **序列化/持久化重写**：改造 `src-api/src/services/diagramService.ts` + 前端 `x6/useGraphPersistence.ts`：① 前端序列化直接 `graph.toJSON()`（不再手动挑字段）；pages[] 数组结构保持 ② 旧数据迁移：`src-api/src/lib/diagramLegacyConvert.ts`（启动时检查 data 是否含 `vueflow` schema，若是则跑一次性转换脚本 → X6 JSON → 保存时覆盖 ③ 迁移前备份原始 JSON 到 `wb_diagram.data_backup` 临时列；保存成功 3 次后再清） ④ 自动保存继续用 2000ms 防抖 + 触发事件（cell:added / cell:removed / edge:connected / node:change:position 停止 / transform:changed 停止）⑤ Ctrl+S 立即 flush；**离开路由/关闭窗口前未保存先 flush 再关** | ① 打开旧版 VueFlow 存过的文档 → 节点自动显示在 X6 画布上（形状映射正确） ② 编辑 → 2s 自动保存 → SQLite data 列已更新 ③ 刷新后数据完整 ④ 未保存关窗 → Tauri `close_requested` 拦截保存（若有未保存变更先存） | P1-T3.5 |

---

## Phase 2：专业能力补全（约 12–15 人日）

---

### P2-T1 专业形状库扩展（50+ 形状）

| 项目 | 内容 |
|---|---|
| **工时估计** | 4 人日 |
| **优先级** | P0 |
| **依赖** | P1 所有任务完成 + 进入 P2 |

| ID | 具体内容 | 验收标准 | 依赖 |
|---|---|---|---|
| P2-T1.1（0.5d） | **左侧图形库分组重构**：重写 `DiagramLibrary.vue`：顶部搜索框 `input` + 折叠分组（手风琴 accordion），分组头 + 展开/收起箭头；分组数据结构 `[{ id: string, name: string, shapes: [{ id, name, thumbnail }] }]`；搜索时跨分组过滤，形状缩略图**用 SVG 小预览**（用 shapeFactory 生成 mini canvas，不要截图）；Stencil 插件可选，若 WKWebView 兼容性差则自研分组 UI 叠 `dnd` plugin | ① 分组折叠/展开有动效（≤ 200ms） ② 搜索「菱形」→ 所有分组含菱形的 shape 都出结果 ③ 左侧面板宽度可拖拽调整（200~420px） ④ 每个分组 20+ 形状滚动流畅 | P1-T5 |
| P2-T1.2（1d） | **标准 BPMN/流程图符号（17 种）**：添加：开始终止（圆/胶囊）、过程（矩形）、决策（菱形）、输入输出（平行四边形）、准备（六边形）、文档（卷角矩形）、多文档（双卷角）、卡片（圆角）、数据库（圆柱）、磁盘（堆叠盘）、延时（沙漏半椭圆）、预定义过程（带双线矩形）、并联（AND 条线）、循环边界/注释、页面引用（五角）、数据存储（梯形）、文件（文件角）。`shapeDefs.ts` 扩展定义 → `shapeFactory.ts` 注册。每个形状**必须画真实 SVG path**（不是只有矩形） | ① 每个形状从库拖拽到画布 → 正确显示 + 可四向连锚点 + label 可双击编辑 ② 数据库圆柱顶部椭圆弧度正确 ③ 决策菱形对角连线正确 | P2-T1.1 |
| P2-T1.3（1d） | **UML 类图（三段式） + 关系箭头（6 种）**：新建 `nodes/X6ClassNode.vue`：① 三栏：类名栏（加粗）+ 属性列表栏 + 方法列表栏；每栏高度按内容自适应（可 resize 整体） ② 双击类名栏/属性栏/方法栏都可行编辑；属性行格式 `+name: type = default`（+公开、-私有、#保护）；方法行格式 `+name(arg1:Type): ReturnType`；回车新增一行，Backspace 空行删除 ③ 6 种连接边：继承（Generalization，空心三角实线）/ 实现（Realization，空心三角虚线）/ 聚合（Aggregation，空心菱形实线）/ 组合（Composition，实心菱形实线）/ 关联（Association，带箭头实线）/ 依赖（Dependency，带箭头虚线）；在 edgeFactory 注册新 `router` / `attrs` 或用 `markers` + 线型。接口/枚举/注记节点另加 3 种 | ① 拖 ClassNode → 填类名 "User" → 属性行 3 → 方法行 2 → 高度自适应 ② 两个类之间连 "继承" → 空心三角箭头实线 ③ 连 "聚合" → 空心菱形 | P2-T1.2 |
| P2-T1.4（0.5d） | **ER 图符号（9 种 + 基数标注）**：实体（矩形）/弱实体（双框）/属性（椭圆）/多值属性（双椭圆）/键属性（带下划线椭圆）/关系（菱形）/弱关系（双菱形）/基数（边两端显示 N:M 标注，边属性可改 1/N/M/0..1/1..N） | 画最小 ER：`用户(N)` 连 `订单(1)` 连 `商品(N)`，基数正确；键属性文字带下划线 | P2-T1.3 |
| P2-T1.5（1d） | **AWS 常用图标（20 个）**：EC2、S3、RDS、Lambda、CloudFront、DynamoDB、SQS、SNS、ALB、API Gateway、CloudWatch、VPC、Subnet、IAM、Route53、KMS、EKS、ElastiCache、CloudTrail、Step Functions。**从官方 AWS Architecture Icons SVG 抽取 path 或直接 embed 小 SVG data URL**；颜色保持官方橙/蓝调色板，文字名在图标下方显示可编辑 | ① 每个 icon 拖拽到画布 → 矢量清晰（不依赖 PNG） ② 可改 fill color（保留描边原色） ③ 大小可调，图标和名字随 scale 同比例放大缩小 | P2-T1.1 |
| P2-T1.6（0.5d） | **通用/网络基础符号（13 种）**：服务器（机架）、路由器（圆环 + 箭头）、交换机（方 + 双箭头）、防火墙（带锯齿墙）、负载均衡（带交叉箭头）、数据库通用（圆柱）、存储桶（方桶）、用户（人形轮廓）、桌面 PC、手机、平板、笔记本电脑、邮件信封。SVG path 自绘 | 每种形状可拖拽 + 命名 + 改变颜色 + 连线 | P2-T1.1 |

---

### P2-T2 容器/泳道/分组/图层/大纲

| 项目 | 内容 |
|---|---|
| **工时估计** | 4 人日 |
| **优先级** | P1 |
| **依赖** | P2-T1 |

| ID | 具体内容 | 验收标准 | 依赖 |
|---|---|---|---|
| P2-T2.1（0.8d） | **容器节点（parent-child）**：X6 `embedding: { enabled:true, findParent(node) }`；容器形状（大矩形带标题栏）可作为 parent；`node.addChild(childNodeId)`；移动容器时 `children` 一起移动；容器可双击折叠标题栏（子节点 hidden，高度压缩到 36px）；展开/折叠记 history | ① 拖容器 A → 再拖节点 B 到 A 内部（高亮提示）→ B 的 parent = A ② 移动 A → B 随之移动 ③ 折叠 A → B 隐藏，仅显示标题栏 "Container A (1)" ④ Ctrl+Z 回折叠动作 | P1-T5.5 |
| P2-T2.2（1d） | **泳道 SwimLane**：用 X6 内置 `Shape.SwimLane` 或自绘；支持 ① pool（整个）/ lane（列或行）② 横/纵两个方向 ③ lane 名双击可编辑 ④ lane 宽度可拖拽（用 transform 插件）；**节点不可跨 lane 边界**（`node:change:position` 事件检测 bbox 与 lane 冲突则纠正位置）；跨 pool 可移动 | ① 新建横向泳道（2×2：2 行 × 2 列）→ 4 个 lane ② 把 Node 拖入 Lane 2 → 移动 Node 尝试越过到 Lane 3 → 被"吸附"停在 lane 边界内侧 1px 不越过 ③ Lane 宽可拖拽到 500px | P2-T2.1 |
| P2-T2.3（0.6d） | **分组 Group**：① Ctrl+G → 把选中 nodes+edges 组合成 group 节点（透明轮廓 + 组名标签上方） ② 移动 group 整体动（parent-child 关系） ③ 双击 group → 进入"组编辑"模式（其余变淡只编辑组内内容） ④ Ctrl+Shift+G 解组（解除 parent 关系）；快捷键在 keyboard plugin 注册 | ① 3 节点 Ctrl+G → 出现外框 + 组名（默认 Group 1） ② 移动外框 → 3 节点一起动 ③ Ctrl+Shift+G → 外框消失，节点仍保留原位置 | P2-T2.1 |
| P2-T2.4（0.8d） | **图层 Layers Panel**：新建 `DiagramLayersPanel.vue`（右侧 Tab 或抽屉）：① 树形列表形式展示 layers：名称 + 眼睛（显隐 checkbox）+ 锁（锁定 checkbox）+ 拖拽排序手柄（z-index） ② 选中节点右键「移到图层」/ 下拉选目标层 ③ 新建/重命名/删除图层按钮；删除时未删除节点（默认移到默认层）；每节点/边数据里存 layerId | ① 新建 3 层（Layer A/B/C）② 把 Node1/2 移到 Layer B → 点 Layer B 眼睛 → 两节点消失 ③ 锁 Layer C → 画布上该层节点不可选/编辑 ④ 拖拽把 Layer C 置顶 → 其节点 z-index 最上 ⑤ 保存刷新后图层信息仍保留 | P2-T1.1 |
| P2-T2.5（0.8d） | **大纲面板（Outliner）**：新建 `DiagramOutlinePanel.vue`：① 树形展示：容器 / 泳道 / Group → 子节点 / 边 ② 叶子名 = 节点 label（无 label 显示 shape 名）③ 点击树节点 → ① 自动选中对应 cell ② `graph.scrollCellToCenter(cell)` 滚到视图 ④ 高亮背景闪烁一次；树支持搜索过滤（顶部小 input） | ① 画 1 个泳道 + 2 个容器 + 各 3 子节点 → 大纲树结构正确（层级展开） ② 点某个叶子 → 画布自动滚到该节点并选中闪烁 ③ 搜 "User" → 大纲树过滤只剩匹配项 | P2-T2.2 + P2-T2.4 |

---

### P2-T3 版本历史 + 查找替换 + 参考线升级

| 项目 | 内容 |
|---|---|
| **工时估计** | 2 人日 |
| **优先级** | P1 |
| **依赖** | P2-T2 |

| ID | 具体内容 | 验收标准 | 依赖 |
|---|---|---|---|
| P2-T3.1（1d） | **持久化版本历史**：① 后端：drizzle schema 新增 `wb_diagram_history` 表（id, diagram_id FK, snapshot_json TEXT NOT NULL, action_label VARCHAR, created_at DATETIME DEFAULT now） ② 路由：`GET /api/diagram/:id/history`、`POST /api/diagram/:id/history/restore/:historyId`、`GET /api/diagram/:id/history/:historyId/download` ③ 前端：触发条件 =「每次有意义的 graph 变更且距上次快照 ≥ 30s 或 Ctrl+S 立即打」；snapshot = 当前 pages 全量 JSON；每文档保留最近 100 条（超了删最旧） ④ 顶栏「历史」按钮打开 `DiagramVersionHistory.vue` 抽屉：列表（action_label + relative time）→ 点任一记录 → 右侧「预览 diff」+「恢复到此版本」；恢复时 **不直接覆盖当前，先另存为「{filename} (恢复到 HH:MM)」草稿**，确认后用户可选择覆盖 | ① 做 10 步编辑（每步间隔 35s） → 历史列表有 10 条（如 "添加节点 / 连线 / 移动 Process-A"） ② 点击第 3 条 → 预览面板显示当时的缩略图（可用 export PNG 存）③ 点「恢复到此版本」→ 生成新草稿文档，不污染原文档 ④ 每文档上限 100 条：第 101 步后第 1 条被删 | P1-T5.5 |
| P2-T3.2（0.6d） | **查找替换浮窗**：新建 `DiagramFindReplace.vue`（快捷键 Ctrl+F）：① 查找输入 + 实时高亮（在 cell labels 上用 CSS outline 1px 橙色闪烁） ② 上一个/下一个快捷键（Enter / Shift+Enter）③ 替换输入 + 「替换」/「替换全部」按钮；支持 "Case Sensitive" checkbox；支持 "Match Whole Word" checkbox；不破坏 X6 history（批量替换 1 步，单独替换每步） | ① 画布 10 个节点，5 个 label 包含 "process" → Ctrl+F 搜 "process" → 5 个节点橙色闪烁，右侧结果计数 1/5 ② 点「替换全部为 Process」→ 5 个文字首字母大写，Ctrl+Z 1 步整体回 | P1-T4.3 |
| P2-T3.3（0.4d） | **Snapline 参考线强化**：x6-plugin-snapline 样式升级 ① 默认粉色 #FF5C93，粗细 2px ② 显示对齐文字 label（"对齐顶边" / "对齐中心" / "对齐右边"）在参考线端点 ③ 吸附灵敏度 adjust（默认 10px） ④ 与网格吸附不冲突（同时生效优先 snapline） | 拖矩形 B 到接近矩形 A → 顶部对齐参考线出现 + 右上角"顶对齐" 文字 → 松手自动吸附 | P1-T1.3 |

---

### P2-T4 draw.io XML 导入导出 + PDF 完善

| 项目 | 内容 |
|---|---|
| **工时估计** | 2 人日 |
| **优先级** | P2（有则锦上添花，可延期） |
| **依赖** | P2-T1（因为映射表依赖 shape id 齐全） |

| ID | 具体内容 | 验收标准 | 依赖 |
|---|---|---|---|
| P2-T4.1（0.8d） | **PDF 分页导出（完善 Phase 1 MVP）**：用方案① 或 ②（先评估包体积）① svg2pdf.js（纯前端，~100KB gzip，首选）：x6 exportSVG() → svg string → svg2pdf.js 渲染 + 按 A4 size 分页 ② Tauri sidecar 跑 puppeteer（~120MB 体积不划算，备选）；页面尺寸读取 P1-T4.2 中的「页面尺寸」下拉 + 横竖方向；多页图自动按页签分 PDF 页；页脚写 `{filename} · 第 {p} 页 / 共 {n} 页 · 导出时间`；字体用系统默认中文字体（macOS PingFang SC，确保中文不糊） | ① A4 纵向 + 2 页多页文档 → 导出 PDF → Preview 打开是 2 页 ② 中文字不缺失（无需嵌入字体，用系统 fallback）③ 内容不超出页边距（20mm 内边距） | P1-T4.2 |
| P2-T4.2（0.7d） | **draw.io XML 导入**：新建 `src-api/src/lib/drawioToX6.ts`（或前端同名）：解析 `<mxGraphModel>` → cells[] 映射规则表：基础 shape id（rect / roundedRect / ellipse / diamond / cylinder/database / parallelogram / hexagon / note / card / actor） → 我们的 shape id；edges 对应 router + markers；**非支持的图形 id（例如 AWS/Azure 复杂 stencil）降级为 generic rect 并收集 mapping miss warning**；warning 列表用弹窗给用户看「导入完成，N 个图形因无对应已降级为矩形」；完成后 `graph.addCells(cells)` + zoomToFit | ① 用 draw.io 官方 sample1（basic-flow-chart.drawio）导入 → 节点/连线/文字完全正确 ② 再用 AWS 复杂图导入 → 弹出警告"12 个 AWS 形状已降级为矩形" ③ 导入后无 orphan edges（source/target 找不到的边自动跳过并 warn） | P2-T1.2~T1.6（齐全的 shape 映射表） |
| P2-T4.3（0.5d） | **draw.io XML 导出**：逆向 `x6ToDrawio.ts`：X6 cells → `<mxGraphModel>`；映射规则反向（shape id、fill/stroke/text、edge router/markers、position/size）；至少覆盖 P1 + P2-T1 的全部 shape id；导出扩展名 `.drawio`（默认）或 `.xml`；导出内容可直接在 draw.io 官网 app.diagrams.net 打开（验证） | ① 用 P1-T5.2 模板「组织架构图」导出.drawio → 在 draw.io 官网打开后 95% 结构一致（shape/颜色/文字），连线正确 ② 导出文件大小合理（< 原图 JSON 的 3×） | P2-T4.2 |

---

### P2-T5 图片节点 + 超链接 + Tooltip

| 项目 | 内容 |
|---|---|
| **工时估计** | 1 人日 |
| **优先级** | P2 |
| **依赖** | P1-T4（属性面板有位置放控件） |

| ID | 具体内容 | 验收标准 | 依赖 |
|---|---|---|---|
| P2-T5.1（0.5d） | **图片节点**：新建 `nodes/X6ImageNode.vue`（`Shape.Image` 扩展 + 下方可编辑文字）：① 左侧图形库新增「图片」形状（默认 200×150 placeholder 图标） ② 双击 placeholder 打开 Tauri `dialog.open` 选择本地 JPG/PNG/SVG 或支持剪贴板粘贴（`window.addEventListener('paste')` 取 `clipboardData` 图片）；③ 图片以 base64 dataURL 存 node data（避免断链）④ NodeStyle 属性面板新增 "图片" Tab：替换/删除/裁剪比例（1:1 / 4:3 / 16:9 / 自适应）；SVG `<image preserveAspectRatio="xMidYMid meet">`；缩放时按比例锁定（可解锁自由拉伸） | ① 拖「图片」形状到画布 → 粘贴剪贴板 JPG → 图片节点立即显示真实内容 ② Ctrl+S 后刷新页面 → 图片仍在（没丢 dataURL） ③ 选图片节点 → 比例切换到 1:1 → 图片中心裁剪不拉伸 | P1-T4 + P1-T5.5 |
| P2-T5.2（0.5d） | **超链接 + Tooltip**：节点/边的 NodeStyle / EdgeStyle 面板各加两个字段 `href`（input，URL 校验 http/https/file/） + `tooltip`（textarea）；hover cell 时（鼠标停留 ≥ 500ms）显示 Tooltip 气泡（Tailwind 样式）；Ctrl + 点击超链接 cell → 调 Tauri `shell.open` 系统默认浏览器打开 | ① 设置节点 href = "https://example.com" + tooltip = "示例" ② 鼠标停留 600ms → 显示灰色气泡 "示例" ③ 按住 Ctrl + 点击节点 → 系统浏览器打开 example.com（或 dev 环境下 console 有 open url 日志，防弹窗） ④ 保存刷新后 href/tooltip 仍保留 | P1-T4.3 + P1-T4.4 |

---

## 建议实施顺序（每周计划）

```
Week 1 ──────────────────────────────────────────────────
  Day 1:  P1-T1.1 → T1.2 → T1.3 → T1.4（下午完成骨架）
  Day 2:  P1-T2.1（全天形状注册）
  Day 3:  P1-T2.2（自定义节点 + contenteditable）
  Day 4:  P1-T2.3（连线工厂）→ P1-T2.4（waypoint + 箭头）
  Day 5:  // 验证 P1-A1 ~ P1-A3；周末不合并

Week 2 ──────────────────────────────────────────────────
  Day 1:  P1-T3.1（撤销重做）→ P1-T3.2（复制粘贴）
  Day 2:  P1-T3.3（对齐分布）→ P1-T3.4（自动布局）
  Day 3:  P1-T3.5（多页切换）
  Day 4:  P1-T4.1（顶栏）→ P1-T4.2（绘画面板）
  Day 5:  P1-T4.3（NodeStyle 富文本）→ P1-T4.4（EdgeStyle）

Week 3 ──────────────────────────────────────────────────
  Day 1:  P1-T5.1（画笔）+ P1-T5.2（模板）+ P1-T5.4（导出）
  Day 2:  P1-T5.3（AI 并行，独立人）+ P1-T5.5（持久化 + 旧数据迁移）
  Day 3-5:P2-T1.1（分组重构）→ P2-T1.2 / T1.5 / T1.6（3 子任务并行）

Week 4 ──────────────────────────────────────────────────
  Day 1:  P2-T2.1（容器） → P2-T2.2（泳道）
  Day 2:  P2-T2.3（分组）→ P2-T2.4（图层）
  Day 3:  P2-T2.5（大纲）+ P2-T3.1（版本历史，独立人并行）
  Day 4:  P2-T3.2（查找替换）+ P2-T3.3（Snapline 强化）
  Day 5:  P2-T4.1（PDF）+ P2-T5.1（图片）+ P2-T5.2（链接）

Week 5 ──────────────────────────────────────────────────
  Day 1-3: P2-T4.2/T4.3 drawio 导入导出 + 回归测试
  Day 4-5: 全量联调 + checklist 逐项勾 + Bugfix
```
