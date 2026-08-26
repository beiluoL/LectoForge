<template>
  <div>
    <header class="kb-set-head">
      <h2 class="kb-set-head-title">AI 模型服务</h2>
      <span class="kb-status-badge" :class="s.statusClass.value">
        <span class="dot"></span>{{ s.statusText.value }}
      </span>
    </header>

    <section class="kb-set-card">
      <label class="lf-switch">
        <input type="checkbox" v-model="s.form.enabled" />
        <span class="lf-switch-track"></span>
        <span class="lf-switch-label">启用 AI 增强功能</span>
      </label>

      <!-- 服务商选择 -->
      <div class="lf-provider-list" role="radiogroup" aria-label="选择模型服务商">
        <button
          v-for="p in s.presets.value"
          :key="p.value"
          type="button"
          class="lf-provider-chip"
          :class="{ active: s.form.provider === p.value }"
          :aria-checked="s.form.provider === p.value"
          @click="s.selectProvider(p.value)"
        >
          <span class="lf-provider-name">{{ p.label }}</span>
          <span v-if="p.value === 'deepseek'" class="lf-provider-tag">推荐</span>
        </button>
      </div>

      <div v-if="s.currentPreset.value" class="lf-help-panel">
        <Icon name="circle-help" :size="16" />
        <div class="lf-help-body">
          <p class="lf-help-text">{{ s.currentPreset.value.helpText }}</p>
          <a
            v-if="s.currentPreset.value.signupUrl"
            :href="s.currentPreset.value.signupUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="lf-help-link"
          >
            <Icon name="external-link" :size="12" /> 直达注册 / 获取 API Key
          </a>
        </div>
      </div>

      <div class="lf-grid2">
        <div class="lf-field lf-span-2">
          <label class="kb-label">API Key</label>
          <div class="lf-key-row">
            <input
              v-model="s.form.apiKey"
              class="kb-input"
              type="password"
              autocomplete="off"
              :placeholder="s.saved.apiKeyMask ? `已保存：${s.saved.apiKeyMask}（留空表示不修改）` : '粘贴你的 API Key'"
            />
            <button
              v-if="s.saved.apiKeyMask"
              class="kb-btn kb-btn-danger"
              title="清空已保存的 Key"
              @click="s.clearKey()"
            >
              <Icon name="trash-2" :size="14" /> 清空
            </button>
          </div>
          <p class="lf-field-hint">只保存在本机数据目录（权限 600），不会上传、不进版本库。</p>
        </div>

        <div class="lf-field">
          <label class="kb-label">模型</label>
          <div class="lf-model-row">
            <select v-if="s.currentPreset.value?.models?.length" v-model="s.form.model" class="kb-input">
              <option v-for="m in s.currentPreset.value.models" :key="m" :value="m">{{ m }}</option>
              <option value="__custom__">自定义模型名…</option>
            </select>
            <input v-else v-model="s.form.model" class="kb-input" placeholder="输入模型名" spellcheck="false" />
            <input
              v-if="s.form.model === '__custom__' || !s.currentPreset.value?.models?.length"
              v-model="s.customModel.value"
              class="kb-input"
              placeholder="输入模型名"
              spellcheck="false"
            />
          </div>
        </div>

        <div class="lf-field">
          <label class="kb-label">超时（秒）</label>
          <input type="number" min="5" max="180" class="kb-input" v-model.number="s.form.timeoutSec" />
          <p class="lf-field-hint">长文生成建议 45 秒以上。</p>
        </div>

        <div class="lf-field lf-span-2">
          <label class="kb-label">采样温度 {{ s.form.temperature.toFixed(1) }}</label>
          <input type="range" min="0.1" max="2.0" step="0.1" v-model.number="s.form.temperature" class="lf-range" />
          <p class="lf-field-hint">越低越稳定。评分类任务建议 0.1~0.3。</p>
        </div>

        <div class="lf-field lf-span-2">
          <button type="button" class="lf-advanced-toggle" @click="s.showAdvanced.value = !s.showAdvanced.value">
            <Icon :name="s.showAdvanced.value ? 'chevron-up' : 'chevron-down'" :size="14" />
            {{ s.showAdvanced.value ? '收起高级设置' : '展开高级设置（API 网关地址）' }}
          </button>
          <div v-if="s.showAdvanced.value" class="lf-advanced-body">
            <label class="kb-label">API 网关地址</label>
            <input v-model="s.form.baseUrl" class="kb-input" placeholder="https://api.deepseek.com/v1" spellcheck="false" />
            <p class="lf-field-hint">默认已按服务商自动填充，通常无需修改。填到 /v1 为止，不要带 /chat/completions。</p>
          </div>
        </div>
      </div>

      <div class="lf-actions">
        <button class="kb-btn kb-btn-sm" :disabled="s.testing.value" @click="s.onTest()">
          <Icon :name="s.testing.value ? 'loader' : 'plug-zap'" :size="14" :class="s.testing.value ? 'lf-spin' : ''" />
          测试连通性
        </button>
        <button class="kb-btn kb-btn-primary" :disabled="s.saving.value" @click="s.saveAll()">
          <Icon :name="s.saving.value ? 'loader' : 'save'" :size="16" :class="s.saving.value ? 'lf-spin' : ''" />
          保存设置
        </button>
        <span v-if="s.testState.value" class="lf-test-result" :class="s.testState.value.ok ? 'is-ok' : 'is-fail'">
          <Icon :name="s.testState.value.ok ? 'check-circle' : 'x-circle'" :size="14" />
          {{ s.testState.value.text }}
        </span>
      </div>

      <!-- 向量化服务 -->
      <div class="lf-embed">
        <div class="kb-set-card-head" style="margin-bottom: .5rem;">
          <Icon name="boxes" :size="16" class="kb-set-card-icon" style="color: var(--kb-muted-foreground);" />
          <div>
            <h3 class="kb-set-card-title" style="font-size: .9375rem;">向量化服务（内容关联）</h3>
            <p class="kb-set-card-desc">用于「内容关联 / 学习路径」，与聊天服务可独立配置，可选。</p>
          </div>
          <span class="kb-status-badge" :class="s.saved.embeddingsConfigured ? 'is-ok' : 'is-off'">
            <span class="dot"></span>{{ s.saved.embeddingsConfigured ? '已配置' : '未配置（可选）' }}
          </span>
        </div>

        <div class="lf-grid2">
          <div class="lf-field">
            <label class="kb-label">向量化服务商</label>
            <select v-model="s.form.embeddingsProvider" class="kb-input" @change="s.applyEmbeddingPreset()">
              <option v-for="p in s.embedPresets.value" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </div>
          <div class="lf-field">
            <label class="kb-label">向量模型</label>
            <input v-model="s.form.embeddingsModel" class="kb-input" placeholder="BAAI/bge-m3" spellcheck="false" />
          </div>
          <div class="lf-field lf-span-2">
            <label class="kb-label">向量化 API 地址</label>
            <input v-model="s.form.embeddingsBaseUrl" class="kb-input" placeholder="https://api.siliconflow.cn/v1" spellcheck="false" />
          </div>
          <div class="lf-field lf-span-2">
            <label class="kb-label">向量化 API Key</label>
            <div class="lf-key-row">
              <input
                v-model="s.form.embeddingsApiKey"
                class="kb-input"
                type="password"
                autocomplete="off"
                :placeholder="s.saved.embeddingsConfigured ? '已保存（留空表示不修改）' : '粘贴向量化服务的 API Key'"
              />
              <button
                v-if="s.saved.embeddingsConfigured"
                class="kb-btn kb-btn-danger"
                title="清空已保存的向量化 Key"
                @click="s.clearEmbeddingKey()"
              >
                <Icon name="trash-2" :size="14" /> 清空
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import Icon from '@/components/ui/Icon.vue'
import { useSettings } from '../useSettings'

const s = useSettings()
</script>

<style scoped>
/* 启用开关 */
.lf-switch { display: inline-flex; align-items: center; gap: .5rem; margin: .25rem 0 .75rem; cursor: pointer; }
.lf-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.lf-switch-track { width: 38px; height: 22px; border-radius: 999px; background: var(--kb-border); position: relative; transition: background .15s ease; flex-shrink: 0; }
.lf-switch-track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 999px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .15s ease; }
.lf-switch input:checked + .lf-switch-track { background: var(--kb-primary); }
.lf-switch input:checked + .lf-switch-track::after { transform: translateX(16px); }
.lf-switch-label { font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); font-weight: 500; }

.lf-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.lf-span-2 { grid-column: span 2; }
.lf-field { display: flex; flex-direction: column; gap: .35rem; min-width: 0; }
.lf-field .kb-input { width: 100%; }
.lf-field-hint { font-size: var(--kb-fs-caption); color: var(--kb-muted-foreground); margin: 0; line-height: 1.4; }
.lf-key-row { display: flex; align-items: center; gap: .5rem; }
.lf-key-row .kb-input { flex: 1; min-width: 0; }
.lf-range { width: 100%; accent-color: var(--kb-primary); }
.lf-actions { display: flex; align-items: center; gap: .625rem; margin-top: 1rem; flex-wrap: wrap; }
.lf-test-result { display: inline-flex; align-items: center; gap: .35rem; font-size: var(--kb-fs-caption); }
.lf-test-result.is-ok { color: var(--kb-accent); }
.lf-test-result.is-fail { color: var(--kb-destructive); }

.lf-provider-list { display: flex; flex-wrap: wrap; gap: .5rem; margin: .25rem 0 .75rem; }
.lf-provider-chip { display: inline-flex; align-items: center; gap: .4rem; padding: .45rem .7rem; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); background: var(--kb-card); color: var(--kb-foreground); font-size: var(--kb-fs-body-sm); cursor: pointer; transition: border-color .15s, background .15s, color .15s; }
.lf-provider-chip:hover { border-color: var(--kb-primary); }
.lf-provider-chip.active { border-color: var(--kb-primary); background: var(--kb-primary-soft); color: var(--kb-primary); font-weight: 600; }
.lf-provider-tag { font-size: var(--kb-fs-caption); padding: .05rem .35rem; border-radius: 999px; background: var(--kb-primary); color: var(--kb-primary-foreground); }

.lf-help-panel { display: flex; align-items: flex-start; gap: .625rem; padding: .75rem .9rem; border-radius: var(--kb-radius-md); background: var(--kb-primary-soft); border: 1px solid color-mix(in srgb, var(--kb-primary) 22%, transparent); margin-bottom: .75rem; }
.lf-help-panel :deep(svg) { flex-shrink: 0; color: var(--kb-primary); margin-top: .15rem; }
.lf-help-body { display: flex; flex-direction: column; gap: .35rem; min-width: 0; }
.lf-help-text { margin: 0; font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); line-height: 1.5; }
.lf-help-link { display: inline-flex; align-items: center; gap: .3rem; font-size: var(--kb-fs-body-sm); font-weight: 600; color: var(--kb-primary); text-decoration: none; }
.lf-help-link:hover { text-decoration: underline; }

.lf-model-row { display: flex; align-items: center; gap: .5rem; }
.lf-model-row .kb-input { flex: 1; min-width: 0; }

.lf-advanced-toggle { display: inline-flex; align-items: center; gap: .35rem; padding: .35rem .5rem; margin: .25rem 0; border: none; background: transparent; color: var(--kb-muted-foreground); font-size: var(--kb-fs-body-sm); cursor: pointer; }
.lf-advanced-toggle:hover { color: var(--kb-primary); }
.lf-advanced-body { display: flex; flex-direction: column; gap: .35rem; }

.lf-embed { margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px solid var(--kb-border); }

.lf-spin { animation: lf-rotate .9s linear infinite; }
@keyframes lf-rotate { to { transform: rotate(360deg); } }
@media (max-width: 640px) { .lf-grid2 { grid-template-columns: 1fr; } .lf-span-2 { grid-column: span 1; } }
</style>
