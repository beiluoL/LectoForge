<template>
  <section class="ai-assoc-panel">
    <div class="ai-assoc-head">
      <h3 class="ai-assoc-title">
        <Icon name="compass" :size="16" style="color: var(--kb-primary);" /> 相关内容
      </h3>
      <div class="ai-assoc-actions">
        <button class="kb-btn ai-btn ai-assoc-btn" :disabled="syncing" @click="rebuild">
          <Icon :name="syncing ? 'loader' : 'refresh-cw'" :size="14" :class="{ 'ai-spin': syncing }" />
          {{ syncing ? '索引中…' : '重建索引' }}
        </button>
        <button class="kb-btn ai-btn ai-assoc-btn" :disabled="loading" @click="runAssociate">
          <Icon :name="loading ? 'loader' : 'link'" :size="14" :class="{ 'ai-spin': loading }" />
          {{ loading ? '检索中…' : '查找关联' }}
        </button>
      </div>
    </div>
    <p class="ai-assoc-desc">基于本地向量，找出与本文最相似的笔记 / 收集箱 / 故事，串成学习路径，数据不出本机。</p>

    <div v-if="hintVisible" class="ai-hint">
      <Icon name="info" :size="14" />
      <span>未配置向量化服务，无法做内容关联。</span>
      <router-link to="/settings/ai">前往 AI 设置</router-link>
    </div>

    <div v-if="syncedMsg" class="ai-assoc-synced">
      已索引 {{ syncedMsg.total }} 条 · 本次新增 {{ syncedMsg.synced }} · 跳过 {{ syncedMsg.skipped }}
    </div>

    <div v-if="result" class="ai-panel">
      <div class="ai-panel-head">
        <span class="ai-panel-title"><Icon name="link" :size="14" /> 关联结果</span>
        <span class="ai-meta">{{ result.model }} · {{ result.latencyMs }}ms</span>
      </div>
      <ul class="assoc-list">
        <li v-for="(it, i) in result.items" :key="'a' + i">
          <router-link :to="it.route" class="assoc-link">
            <span class="assoc-title">{{ it.title }}</span>
            <span class="assoc-type">{{ typeLabel(it.entityType) }}</span>
            <span class="assoc-score">{{ Math.round(it.score * 100) }}%</span>
          </router-link>
          <p v-if="it.snippet" class="assoc-snippet">{{ it.snippet }}</p>
        </li>
      </ul>
      <p v-if="!result.items.length" class="ai-empty">没有找到相似内容，先点「重建索引」试试。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { notify, getApiError } from '@/utils/toast'
import { associateContent, syncEmbeddings, type AssociateResult, type SyncEmbeddingsResult } from '@/api/ai'
import '@/views/ai-shared.css'

const props = defineProps<{
  entityType: 'capture' | 'note' | 'story'
  entityId: number | null
  variant?: 'card' | 'flush'
}>()

const loading = ref(false)
const syncing = ref(false)
const hintVisible = ref(false)
const result = ref<AssociateResult | null>(null)
const syncedMsg = ref<SyncEmbeddingsResult | null>(null)

function typeLabel(t: string): string {
  if (t === 'capture') return '收集箱'
  if (t === 'note') return '笔记'
  if (t === 'story') return '故事'
  return t
}

async function runAssociate() {
  if (!props.entityId) {
    notify('请先保存后再查找关联', 'warning')
    return
  }
  loading.value = true
  hintVisible.value = false
  try {
    result.value = await associateContent({ entityType: props.entityType, entityId: props.entityId, limit: 8 })
    notify('关联检索完成', 'success')
  } catch (e) {
    const msg = getApiError(e, 'AI 关联失败')
    if (msg.includes('AI 设置') || msg.includes('未配置') || msg.includes('已关闭')) hintVisible.value = true
    notify(msg, 'error')
  } finally {
    loading.value = false
  }
}

async function rebuild() {
  syncing.value = true
  hintVisible.value = false
  try {
    syncedMsg.value = await syncEmbeddings({ force: false })
    notify(`索引完成：本次新增 ${syncedMsg.value.synced} 条`, 'success')
  } catch (e) {
    const msg = getApiError(e, '索引失败')
    if (msg.includes('AI 设置') || msg.includes('未配置') || msg.includes('已关闭')) hintVisible.value = true
    notify(msg, 'error')
  } finally {
    syncing.value = false
  }
}
</script>

<style scoped>
.ai-assoc-panel {
  padding: var(--kb-space-5);
  border-radius: var(--kb-radius-lg);
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: var(--kb-space-2);
}
.ai-assoc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.ai-assoc-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 700;
  color: var(--kb-foreground);
}
.ai-assoc-actions {
  display: flex;
  gap: 8px;
}
.ai-assoc-btn {
  font-size: 12px;
  padding: 6px 12px;
}
.ai-assoc-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--kb-muted-foreground);
}
.ai-assoc-synced {
  font-family: var(--font-mono);
  font-size: var(--kb-fs-caption);
  color: var(--kb-muted-foreground);
}
.ai-assoc-flush {
  border: none;
  background: transparent;
  box-shadow: none;
  padding: 0;
}
</style>
