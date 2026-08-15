<template>
  <div class="vh-mask" @click.self="emit('close')">
    <aside class="vh-drawer" role="dialog" aria-label="版本历史">
      <header class="vh-head">
        <h3>版本历史</h3>
        <button class="kb-btn kb-btn-sm" @click="emit('close')">✕ 关闭</button>
      </header>

      <div class="vh-body">
        <div v-if="loading" class="vh-hint">加载中…</div>
        <div v-else-if="!list.length" class="vh-hint">暂无历史快照。编辑或按 ⌘S 后会自动记录。</div>

        <ul v-else class="vh-list">
          <li
            v-for="item in list"
            :key="item.id"
            :class="{ active: item.id === selectedId }"
            @click="selectedId = item.id"
          >
            <div class="vh-item-main">
              <span class="vh-label">{{ item.actionLabel || '快照' }}</span>
              <span class="vh-time">{{ fmtTime(item.createdAt) }}</span>
            </div>
            <div class="vh-item-sub">{{ item.nodeCount }} 个节点 · #{{ item.id }}</div>
          </li>
        </ul>
      </div>

      <footer class="vh-foot" v-if="selectedId">
        <button class="kb-btn kb-btn-sm kb-btn-primary" @click="onRestore">↩ 恢复到此版本</button>
        <button class="kb-btn kb-btn-sm" @click="onDownload">⤓ 下载 .json</button>
      </footer>
    </aside>
  </div>
</template>

<script setup lang="ts">
/**
 * 版本历史抽屉（P2-T3.1）。
 * - 拉取当前图文件的历史快照列表（倒序）；
 * - 选中某条 → 底部出现「恢复 / 下载」；
 * - 恢复：调后端 restore（覆盖前后端已存「恢复前自动备份」安全快照），随后 emit('restored')
 *   让画布重新加载，原状态始终可回退（不污染原文档）；
 * - 下载：取快照对象落盘为 .json（走 WKWebView 的 blob 下载）。
 */
import { ref, onMounted } from 'vue'
import {
  fetchDiagramHistory,
  restoreDiagramHistory,
  downloadDiagramHistory,
  type DiagramHistorySummary,
  type DiagramDetail,
} from '@/api/diagram'
import { notify } from '@/utils/toast'

const props = defineProps<{ diagramId: number | null }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'restored', detail: DiagramDetail): void
}>()

const list = ref<DiagramHistorySummary[]>([])
const selectedId = ref<number | null>(null)
const loading = ref(false)

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function loadList() {
  if (props.diagramId == null) return
  loading.value = true
  try {
    list.value = await fetchDiagramHistory(props.diagramId)
    if (list.value.length && selectedId.value == null) selectedId.value = list.value[0].id
  } catch (e) {
    console.error('[history] 加载失败', e)
    notify('历史加载失败', 'error')
  } finally {
    loading.value = false
  }
}

async function onRestore() {
  if (selectedId.value == null || props.diagramId == null) return
  if (!window.confirm('恢复到此版本？当前内容会被覆盖（系统已自动备份，可再次从历史回退）。')) return
  try {
    const detail = await restoreDiagramHistory(props.diagramId, selectedId.value)
    notify('已恢复到所选版本', 'success')
    emit('restored', detail)
    await loadList()
  } catch (e) {
    console.error('[history] 恢复失败', e)
    notify('恢复失败', 'error')
  }
}

async function onDownload() {
  if (selectedId.value == null || props.diagramId == null) return
  try {
    const data = await downloadDiagramHistory(props.diagramId, selectedId.value)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `diagram-${props.diagramId}-history-${selectedId.value}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    console.error('[history] 下载失败', e)
    notify('下载失败', 'error')
  }
}

onMounted(loadList)
</script>

<style scoped>
.vh-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: rgba(15, 23, 42, 0.28);
  display: flex;
  justify-content: flex-end;
}
.vh-drawer {
  width: 320px;
  height: 100%;
  background: var(--kb-card, #fff);
  border-left: 1px solid var(--kb-border, #e2e8f0);
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 24px rgba(15, 23, 42, 0.12);
}
.vh-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--kb-border, #e2e8f0);
}
.vh-head h3 {
  margin: 0;
  font-size: 14px;
  color: var(--kb-foreground, #0f172a);
}
.vh-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 8px;
}
.vh-hint {
  font-size: 12px;
  color: var(--kb-muted-foreground, #64748b);
  padding: 16px 8px;
  line-height: 1.6;
}
.vh-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.vh-list li {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
}
.vh-list li:hover {
  background: var(--kb-muted, #f1f5f9);
}
.vh-list li.active {
  border-color: var(--kb-primary, #3b6fe0);
  background: color-mix(in srgb, var(--kb-primary, #3b6fe0) 10%, transparent);
}
.vh-item-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.vh-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--kb-foreground, #0f172a);
}
.vh-time {
  font-size: 11px;
  color: var(--kb-muted-foreground, #64748b);
  white-space: nowrap;
}
.vh-item-sub {
  font-size: 11px;
  color: var(--kb-muted-foreground, #64748b);
  margin-top: 2px;
}
.vh-foot {
  display: flex;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--kb-border, #e2e8f0);
}
</style>
