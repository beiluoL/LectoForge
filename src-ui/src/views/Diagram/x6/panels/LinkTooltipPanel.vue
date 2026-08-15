<template>
  <div class="x6-panel" v-if="hasTarget">
    <h4 class="x6-panel-title">链接 / 提示</h4>
    <section class="x6-field">
      <label class="x6-field-row x6-col">
        <span class="kb-label">超链接</span>
        <input
          class="kb-input"
          type="text"
          :value="href"
          placeholder="https://…"
          @change="(e) => setHref((e.target as HTMLInputElement).value)"
        />
      </label>
      <button class="kb-btn kb-btn-sm" :disabled="!href" @click="openLink" title="在系统默认浏览器打开">↗ 打开链接</button>

      <label class="x6-field-row x6-col">
        <span class="kb-label">悬停提示</span>
        <textarea
          class="kb-input x6-tip-input"
          :value="tooltip"
          rows="2"
          placeholder="鼠标悬停时显示…"
          @change="(e) => setTooltip((e.target as HTMLTextAreaElement).value)"
        ></textarea>
      </label>
      <p class="x6-hint">提示：按住 Ctrl / ⌘ 点击元素即可打开超链接</p>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * X6 方案 B「链接 / 提示」面板（P2-T5.2）：节点与连线共用。
 * 编辑结果写入 cell.data.{href,tooltip}，由画布 hover/Ctrl+点击交互消费。
 * 所有写入包一层 graph.batchUpdate → 仅 1 条 history。
 */
import { computed, inject } from 'vue'
import { X6_CTX_KEY, type X6Context } from '../context'
import { useSelection } from '../useSelection'
import { invoke } from '@tauri-apps/api/core'

const props = defineProps<{ kind: 'node' | 'edge' }>()
const ctx = inject(X6_CTX_KEY) as X6Context
const sel = useSelection(ctx.graph)

const hasTarget = computed(() => (props.kind === 'node' ? sel.hasNode.value : sel.hasEdge.value))

function first(): any {
  return (props.kind === 'node' ? sel.selectedNodes.value : sel.selectedEdges.value)[0] as any
}

const href = computed(() => (first()?.getData()?.href as string) || '')
const tooltip = computed(() => (first()?.getData()?.tooltip as string) || '')

function applyToCells(fn: (c: any) => void) {
  const g = ctx.graph.value
  const cells = props.kind === 'node' ? sel.selectedNodes.value : sel.selectedEdges.value
  if (!g || !cells.length) return
  g.batchUpdate('link-tooltip', () => cells.forEach((c: any) => fn(c)))
}

function setHref(v: string) {
  const val = v.trim()
  applyToCells((c) => c.setData({ ...(c.getData() || {}), href: val || undefined }))
}

function setTooltip(v: string) {
  const val = v.trim()
  applyToCells((c) => c.setData({ ...(c.getData() || {}), tooltip: val || undefined }))
}

function openLink() {
  const url = href.value
  if (!url) return
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    void invoke('open_external_url', { url })
  } else {
    window.open(url, '_blank', 'noopener')
  }
}
</script>

<style scoped>
.x6-panel {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.x6-panel-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
}
.x6-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--kb-border, #e2e8f0);
}
.x6-field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.x6-col {
  flex-direction: column;
  align-items: stretch;
}
.x6-tip-input {
  resize: vertical;
  font-size: 12px;
  padding: 4px 6px;
  border: 1px solid var(--kb-border, #cbd5e1);
  border-radius: 6px;
  font-family: inherit;
}
.x6-hint {
  font-size: 11px;
  color: var(--kb-muted-foreground, #64748b);
  margin: 0;
}
</style>
