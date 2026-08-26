<template>
  <div class="lf-ai-mask" @click.self="emit('close')">
    <div class="lf-ai-card">
      <div class="lf-ai-head">
        <p class="lf-ai-title">✨ AI 生成流程图</p>
        <button class="kb-btn kb-btn-icon" v-tip="'关闭'" @click="emit('close')">
          <Icon name="x" size="sm" />
        </button>
      </div>

      <p class="lf-ai-tip">用一句话描述流程，AI 生成节点与连线，并自动排版。</p>

      <textarea
        ref="inputEl"
        v-model="prompt"
        class="kb-input lf-ai-textarea"
        rows="4"
        placeholder="例如：用户登录流程，包含输入账号密码、校验、失败重试、成功进入首页"
        :disabled="loading"
        @keydown.meta.enter="onGenerate"
        @keydown.ctrl.enter="onGenerate"
      />

      <div class="lf-ai-row">
        <label class="lf-ai-label">布局方向</label>
        <select v-model="layout" class="kb-select" :disabled="loading">
          <option value="TB">自上而下</option>
          <option value="LR">从左至右</option>
        </select>
      </div>

      <p v-if="error" class="lf-ai-error">{{ error }}</p>

      <div class="lf-ai-actions">
        <button class="kb-btn kb-btn-sm" :disabled="loading" @click="emit('close')">取消</button>
        <button class="kb-btn kb-btn-sm lf-ai-btn" :disabled="loading || !prompt.trim()" @click="onGenerate">
          <Icon v-if="!loading" name="sparkles" size="xs" />
          {{ loading ? '生成中…' : '生成' }}
        </button>
      </div>
      <p class="lf-ai-hint">提示：⌘/Ctrl + Enter 快捷生成</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * AI 生成流程图弹窗。
 * - 调 /api/ai/diagram/generate，拿到「无坐标的图结构」；
 * - 成功 → emit('generated') 把结构交回父组件（store.loadGenerated 负责自动布局 + 落库）；
 * - 未配置 AI Key 时后端返回 mock 骨架，这里用 notify 提示「已生成示例」。
 */
import { nextTick, ref } from 'vue';

import Icon from '@/components/ui/Icon.vue';
import { generateDiagram, type AiDiagramEdge, type AiDiagramNode } from '@/api/diagram';
import { notify } from '@/utils/toast';

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'generated', payload: { nodes: AiDiagramNode[]; edges: AiDiagramEdge[]; layout: 'TB' | 'LR'; mock?: boolean }): void;
}>();

const prompt = ref('');
const layout = ref<'TB' | 'LR'>('TB');
const loading = ref(false);
const error = ref('');
const inputEl = ref<HTMLTextAreaElement | null>(null);

nextTick(() => inputEl.value?.focus());

async function onGenerate() {
  const text = prompt.value.trim();
  if (!text || loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    const res = await generateDiagram({ prompt: text, layout: layout.value });
    if (res.mock) {
      notify('未配置 AI 服务，已生成示例流程图（可在「AI 设置」中接入）', 'info');
    }
    emit('generated', { nodes: res.nodes, edges: res.edges, layout: layout.value, mock: res.mock });
    emit('close');
  } catch (e) {
    error.value = e instanceof Error ? e.message : '生成失败，请稍后重试';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.lf-ai-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.lf-ai-card {
  width: 460px;
  max-width: 100%;
  background: var(--kb-background);
  border: 1px solid var(--kb-border);
  border-radius: 12px;
  box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0, 0, 0, 0.1));
  padding: 18px;
  box-sizing: border-box;
}
:root[data-theme='dark'] .lf-ai-card {
  background: var(--kb-card);
}
.lf-ai-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.lf-ai-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--kb-foreground);
}
.lf-ai-tip {
  font-size: 12px;
  color: var(--kb-muted-foreground);
  margin: 0 0 12px;
}
.lf-ai-textarea {
  width: 100%;
  resize: vertical;
}
.lf-ai-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.lf-ai-label {
  font-size: 12px;
  color: var(--kb-muted-foreground);
}
.lf-ai-error {
  color: #dc2626;
  font-size: 12px;
  margin: 10px 0 0;
}
.lf-ai-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.lf-ai-btn {
  color: var(--kb-primary);
}
.lf-ai-hint {
  font-size: 11px;
  color: var(--kb-muted-foreground);
  margin: 8px 0 0;
  text-align: right;
}
</style>
