# LectoForge Mock 数据清零改造报告

> 改造目标：消除前端硬编码占位（类型 A），把演示数据全部下沉为真实 SQLite 种子（类型 B），AI 降级 Mock（类型 C）严格保留。
> 提交：`b8e8ab0`（本地提交，未 push）。类型检查：`tsc --noEmit`(src-api) / `vue-tsc --noEmit`(src-ui) 均 EXIT 0。

---

## 一、清理清单与处理状态

### 类型 A —— 前端硬编码占位（已全部消除 ✅）

| 文件 | 原 Mock 形态 | 处理 |
|---|---|---|
| `src-ui/src/store/memory-palace-store.ts` | `MOCK_PALACE_ID=-1`、`MOCK_LOCI`（8 条「并发编程公寓」演示位点）、`initMockData()` | **删除**。记忆宫殿纯本地数据副本清零。 |
| `src-ui/src/views/MemoryPalace/index.vue` | `isMock` 分支：演示按钮、本地拖拽、AI 仅进内存、复习不落库、`loadMock` 重新加载 | **全删**。改走真实 `listPalaces/listLoci/createLoci/updateLoci/deleteLoci/gradeLoci`。 |
| `src-ui/src/views/MindMap/useMindMapStore.ts` | `mapState.outlineData: defaultOutline()` 初始即填一份内置大纲 | **改为 `[]`**。真实内容由后端 `mindmapStore.seedIfEmpty()` 提供；`defaultOutline()` 仅作「加载到的文档 outline 为空」兜底。 |

> 说明：`views/Inbox/index.vue` 在本轮三层重构时**已接入 `useInboxStore`**（`store.loadInbox()` → `api/inbox`），不存在 `mockList`，无需改造（见第二节示例）。

### 类型 B —— 后端种子数据（已规范化幂等 ✅）

| 种子 | 位置 | 形态 |
|---|---|---|
| 默认分类 | `src-api/src/db/index.ts` `seedIfEmpty(categories,…)` | 未分类/工作/学习/生活 |
| 收集箱示例 | `seedIfEmpty(wbCapture,…)` | 4 条，`status:'INBOX'`（大写），`tags` 含「示例」便于识别清理 |
| 记忆宫殿 | `seedIfEmpty(wbPalace,…)` | 「✨ 演示宫殿 - 并发编程公寓」+ 8 个位点，带引导文案 `description:'示例宫殿，点击编辑替换…'`，可删 |

全部走统一 `seedIfEmpty(table, label, insert)`：表空才插，同步 `insert()`，失败时仅告警不阻断启动。

### 类型 C —— AI 降级 Mock（严格保留，未触碰 ✅）

| 文件 | 标识 |
|---|---|
| `src-api/src/services/mindmapAiService.ts` | 4 处 `mock: true`（未配 Key 走优雅降级，前端 `res.mock` 判定） |
| `src-api/src/controllers/aiController.ts` | `fail()` → `{code,message,aiCode}`，前端据此引导去「AI 设置」 |

---

## 二、验收脚本（全局验证）

```bash
# 1) 前端工程内不应再有任何类型 A 占位（排除合法 AI 降级与 CSS token 风格注释）
grep -rniE "mock|示例宫殿|演示宫殿|并发编程公寓|硬编码|假数据" src-ui/src \
  | grep -viE "ai|mock:\s*true|res\.mock|isMock|降级|未配置.*引导|后端未配置|AI 设置|CSS|token|色值|语义色"

# 2) 后端种子全部幂等（每个种子都有 seedIfEmpty 包裹）
grep -rn "seedIfEmpty(" src-api/src/db/index.ts

# 3) AI 降级标识完好（必须仍有 mock:true）
grep -rn "mock: true" src-api/src/services/mindmapAiService.ts

# 4) 大小写双契约未退化（收集箱 = 大写 INBOX）
grep -rn "status:\s*'INBOX'" src-api/src/db/index.ts

# 5) 类型检查
cd src-api && ./node_modules/.bin/tsc --noEmit
cd ../src-ui && ./node_modules/.bin/vue-tsc --noEmit
```

> 当前结果：第 1 条无类型 A 残留（仅剩合法 AI 降级 + CSS 风格注释 + 移除说明注释）；2/3/4 命中预期；5 全绿。

---

## 三、具体代码改造示例

### 示例 1：`views/Inbox/index.vue`（真实 API 接入范式）

该页面在三层重构时已正确接入，此处给出**当前真实写法**作为标准范式（无 `mockList`）：

```vue
<!-- views/Inbox/index.vue (script setup 节选) -->
<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useInboxStore } from '@/store/inbox-store'

const store = useInboxStore()
// 列表/loading/error 全部来自 store，由真实后端接口驱动
const { items, loading, error } = storeToRefs(store)

const overdueView = computed(() => route.query.overdue === '1')

function reload() {
  // 真实拉取：store 内部调用 api/inbox 的 fetchInboxList
  store.loadInbox(overdueView.value ? 'asc' : undefined)
}

// 挂载即拉真实数据；loading 期间 InboxList 渲染骨架屏
onMounted(reload)
</script>
```

对应 store 的真实取数（`src-ui/src/store/inbox-store.ts`）：

```ts
async function loadInbox(overrideSort?: InboxSort, overrideFilter?: InboxFilter) {
  // …
  loading.value = true
  error.value = ''
  try {
    // ★ 真实 API，无任何硬编码数组
    items.value = await fetchInboxList(useSort, useFilter)
  } catch (e) {
    error.value = (e instanceof Error ? e.message : '') || '收集箱加载失败'
    items.value = []            // 失败也清空，绝不回退到假数据
  } finally {
    loading.value = false
  }
}
```

> 若某视图返回空数组，模板用 `<div class="wb-empty">` 空态占位；加载期用 `<div class="wb-skeleton animate-pulse" />` 骨架屏——本工程中记忆宫殿、收集箱已遵循此模式。

---

### 示例 2：`src-api/src/db/index.ts` `seedIfEmpty` 幂等播种（分类 + 记忆宫殿）

```ts
/* ---- 幂等播种器：表为空才执行 insert；insert 必须是同步函数（better-sqlite3 同步 API 红线） ---- */
function seedIfEmpty(table: SQLiteTable, label: string, insert: () => number): void {
  if (!isTableEmpty(table)) return
  try {
    const n = insert()
    console.log(`[lectoforge-desktop] 种子数据已注入：${label}（${n} 条）`)
  } catch (e) {
    console.error(`[lectoforge-desktop] 种子数据注入失败：${label}`, e) // 不阻断启动
  }
}

// ---- 分类：四个基础分类 ----
seedIfEmpty(categories, '默认分类', () => {
  const rows = ['未分类', '工作', '学习', '生活'].map((name, sort) => ({ name, parentId: 0, sort }))
  db.insert(categories).values(rows).run()
  return rows.length
})

// ---- 记忆宫殿：「并发编程公寓」演示宫殿 + 8 位点（原前端 MOCK_LOCI 下沉） ----
seedIfEmpty(wbPalace, '演示记忆宫殿', () => {
  const now = nowIso()
  const palace = db.insert(wbPalace).values({
    userId: CURRENT_USER,
    name: '✨ 演示宫殿 - 并发编程公寓',
    description: '示例宫殿，点击编辑替换为你自己的空间；不需要可直接删除',
    theme: 'ROOM',
    coverColor: '#3B6FE0',
    categoryId: null,
    createdAt: now,
    updatedAt: now,
  }).returning().get()

  const loci = [
    { name: '玄关鞋柜', knowledgePoint: '进程 vs 线程：…', imageHint: '货架上的小猴子', icon: 'server', posX: 15, posY: 20 },
    // …其余 7 个位点
  ]
  db.insert(wbPalaceLoci).values(
    loci.map((l, i) => ({
      palaceId: palace.id, userId: CURRENT_USER,
      name: l.name, knowledgePoint: l.knowledgePoint, imageHint: l.imageHint, icon: l.icon,
      posX: l.posX, posY: l.posY, sortOrder: i + 1, createdAt: now, updatedAt: now,
    })),
  ).run()
  return loci.length
})
```

---

## 四、约束核对（全绿）

- ✅ **响应契约零退化**：Controller 仍 `return` 纯数据，`onSend` 负责信封；前端看到的字段结构不变，仅数据由假变真。
- ✅ **Store ID 未改**：`defineStore('memoryPalace', …)` 的 ID 与持久化 key `kf:memory-palace` 均未动，本地存储不重置。
- ✅ **同步调用红线**：`seedIfEmpty` 的 `insert` 回调无 `async/await`，`better-sqlite3` 保持同步。
- ✅ **大小写双契约**：`/api/workbench/captures`（大写 `INBOX`）与 `/api/inbox`（小写 `unprocessed`）仍隔离，收集箱种子沿用大写 `INBOX`。
- ✅ **首页仪表盘闭环**：`dashboardService`/`overviewService` 的 `todayCaptures`/`pendingCaptures`(=`INBOX`)/`dueReviews` 全部来自 `COUNT(*)`，已核对无硬编码。
- ✅ **AI 降级未删**：`mock: true` 与 `aiController.fail()` 原样保留。
