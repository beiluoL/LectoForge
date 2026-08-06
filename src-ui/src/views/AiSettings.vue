<template>
  <div class="space-y-4 animate-fade-in">
    <!-- 页头：与工作台各页保持同一排布（左标题+描述，右操作） -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h1 class="kb-h1 mb-1 flex items-center gap-2" style="color: var(--kb-foreground);">
          <Icon name="ai-sparkle" :size="24" style="color: var(--kb-highlight);" /> AI 设置
        </h1>
        <p class="kb-body" style="color: var(--kb-muted-foreground);">
          配置一次，全局生效。所有 AI 能力均为可选增强，不配置也不影响任何原有功能。
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button class="kb-btn" @click="router.back()">
          <Icon name="chevron-left" :size="16" /> 返回
        </button>
      </div>
    </div>

    <div class="ai-settings">
      <!-- ===== 服务配置 ===== -->
      <section class="ai-card">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h2 class="ai-card-title">
            <Icon name="server" :size="18" style="color: var(--kb-primary);" /> 模型服务
          </h2>
          <span class="ai-status" :class="statusClass">
            <i class="ai-status-dot"></i>{{ statusText }}
          </span>
        </div>
        <p class="ai-card-desc">
          支持任何 OpenAI 兼容接口。API Key 只保存在本机数据目录（权限 600），不会上传、不会进版本库。
        </p>

        <label class="ai-switch">
          <input type="checkbox" v-model="form.enabled" />
          <span class="ai-switch-track"></span>
          <span style="font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); font-weight: 500;">
            启用 AI 增强功能
          </span>
        </label>

        <div class="ai-form-grid">
          <div>
            <label class="kb-label">服务商</label>
            <select v-model="form.provider" class="kb-input" @change="applyPreset">
              <option v-for="p in presets" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </div>
          <div>
            <label class="kb-label">模型</label>
            <input v-model="form.model" class="kb-input" placeholder="deepseek-chat" />
          </div>

          <div class="ai-span-2">
            <label class="kb-label">API 地址</label>
            <input v-model="form.baseUrl" class="kb-input" placeholder="https://api.deepseek.com/v1" />
            <p class="ai-field-hint">填到 /v1 为止，不要带 /chat/completions。</p>
          </div>

          <div class="ai-span-2">
            <label class="kb-label">API Key</label>
            <div class="flex items-center gap-2">
              <input
                v-model="form.apiKey"
                class="kb-input"
                type="password"
                autocomplete="off"
                :placeholder="saved.apiKeyMask ? `已保存：${saved.apiKeyMask}（留空表示不修改）` : '粘贴你的 API Key'"
              />
              <button
                v-if="saved.apiKeyMask"
                class="kb-btn kb-btn-danger"
                title="清空已保存的 Key"
                @click="clearKey"
              >
                <Icon name="trash-2" :size="14" /> 清空
              </button>
            </div>
            <p class="ai-field-hint">
              存放位置：<code>src-api/data/ai-config.json</code>（该目录已被 .gitignore 排除）。
            </p>
          </div>

          <div>
            <label class="kb-label">采样温度 {{ form.temperature.toFixed(1) }}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              v-model.number="form.temperature"
              style="accent-color: var(--kb-primary); width: 100%;"
            />
            <p class="ai-field-hint">越低越稳定。评分类任务建议 0.1~0.3。</p>
          </div>
          <div>
            <label class="kb-label">超时（秒）</label>
            <input
              type="number"
              min="5"
              max="180"
              class="kb-input"
              v-model.number="timeoutSec"
            />
            <p class="ai-field-hint">长文生成建议 45 秒以上。</p>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <button class="kb-btn kb-btn-primary" :disabled="saving" @click="save">
            <Icon name="save" :size="14" :class="saving ? 'ai-spin' : ''" /> 保存配置
          </button>
          <button class="kb-btn ai-btn" :disabled="testing" @click="test">
            <Icon :name="testing ? 'loader' : 'zap'" :size="14" :class="testing ? 'ai-spin' : ''" />
            {{ testing ? '测试中…' : '测试连通性' }}
          </button>
          <span v-if="testResult" class="ai-meta">
            <Icon name="check-circle" :size="12" style="color: var(--kb-accent);" />
            {{ testResult.model }} · {{ testResult.latencyMs }}ms · 回显「{{ testResult.reply }}」
          </span>
        </div>
      </section>

      <!-- ===== 向量化服务（G3 内容关联，可选） ===== -->
      <section class="ai-card">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h2 class="ai-card-title">
            <Icon name="boxes" :size="18" style="color: var(--kb-primary);" /> 向量化服务（内容关联）
          </h2>
          <span class="ai-status" :class="saved.embeddingsConfigured ? 'is-ok' : 'is-err'">
            <i class="ai-status-dot"></i>{{ saved.embeddingsConfigured ? '已配置' : '未配置（可选）' }}
          </span>
        </div>
        <p class="ai-card-desc">
          用于「内容关联 / 学习路径」功能：把收集箱、笔记、故事转成本地向量并存储，相似度在本地计算。
          聊天模型（如 DeepSeek）通常不含 embeddings 端点，可单独配置 SiliconFlow 等 OpenAI 兼容服务。未配置不影响任何其它功能。
        </p>

        <div class="ai-form-grid">
          <div>
            <label class="kb-label">向量化服务商</label>
            <select v-model="form.embeddingsProvider" class="kb-input" @change="applyEmbeddingPreset">
              <option v-for="p in embeddingPresets" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </div>
          <div>
            <label class="kb-label">向量模型</label>
            <input v-model="form.embeddingsModel" class="kb-input" placeholder="BAAI/bge-m3" />
          </div>

          <div class="ai-span-2">
            <label class="kb-label">向量化 API 地址</label>
            <input v-model="form.embeddingsBaseUrl" class="kb-input" placeholder="https://api.siliconflow.cn/v1" />
            <p class="ai-field-hint">填到 /v1 为止，与聊天服务可不同。</p>
          </div>

          <div class="ai-span-2">
            <label class="kb-label">向量化 API Key</label>
            <div class="flex items-center gap-2">
              <input
                v-model="form.embeddingsApiKey"
                class="kb-input"
                type="password"
                autocomplete="off"
                :placeholder="saved.embeddingsConfigured ? '已保存（留空表示不修改）' : '粘贴向量化服务的 API Key'"
              />
              <button
                v-if="saved.embeddingsConfigured"
                class="kb-btn kb-btn-danger"
                title="清空已保存的向量化 Key"
                @click="clearEmbeddingKey"
              >
                <Icon name="trash-2" :size="14" /> 清空
              </button>
            </div>
            <p class="ai-field-hint">
              配置后请到「AI 学习洞察」页点击「重建向量索引」生成内容关联。Key 同样只存于本机。
            </p>
          </div>
        </div>
      </section>

      <!-- ===== 能力清单 ===== -->
      <section class="ai-card">
        <h2 class="ai-card-title">
          <Icon name="brain-circuit" :size="18" style="color: var(--kb-primary);" /> 已接入的 AI 能力
        </h2>
        <p class="ai-card-desc">
          每项能力都是「按需触发 + 结果可编辑」：AI 只把结果填进输入框，是否采纳、是否保存由你决定。
        </p>
        <div class="ai-cap-list">
          <article v-for="c in capabilities" :key="c.name" class="ai-cap">
            <span class="ai-cap-icon"><Icon :name="c.icon" :size="16" /></span>
            <div class="ai-cap-body">
              <p class="ai-cap-name">{{ c.name }}</p>
              <p class="ai-cap-desc">{{ c.desc }}</p>
            </div>
            <router-link :to="c.to" class="kb-btn kb-btn-sm" style="flex-shrink: 0;">
              前往 <Icon name="chevron-right" :size="12" />
            </router-link>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
// AI 配置中心（P0）：统一管理 OpenAI 兼容服务的接入参数，并汇总当前已接入的 AI 能力入口。
// 视觉沿用工作台既有令牌与 .kb-* 组件类，AI 相关元素统一用 signature highlight 暖橘色区分。
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import { notify, getApiError, confirmDialog } from '@/utils/toast'
import {
  getAiConfig,
  saveAiConfig,
  testAiConnection,
  type AiConfigVO,
  type AiPingResult,
  type AiProviderPreset,
} from '@/api/ai'
import './ai-shared.css'

const router = useRouter()

const saving = ref(false)
const testing = ref(false)
const testResult = ref<AiPingResult | null>(null)
const presets = ref<AiProviderPreset[]>([])
const embeddingPresets = ref<AiProviderPreset[]>([])

const saved = reactive<AiConfigVO>({
  enabled: true,
  provider: 'deepseek',
  baseUrl: '',
  model: '',
  temperature: 0.3,
  timeoutMs: 45000,
  apiKeyMask: '',
  configured: false,
  embeddingsModel: '',
  embeddingsConfigured: false,
})

const form = reactive({
  enabled: true,
  provider: 'deepseek',
  baseUrl: '',
  model: '',
  apiKey: '',
  temperature: 0.3,
  // 向量化（G3 内容关联，可选，与聊天服务解耦）
  embeddingsProvider: 'siliconflow',
  embeddingsBaseUrl: '',
  embeddingsApiKey: '',
  embeddingsModel: '',
})

/** 超时用「秒」呈现更符合直觉，提交时再换算回毫秒 */
const timeoutSec = ref(45)

const capabilities = [
  {
    icon: 'wand-2',
    name: '费曼故事清晰度评分',
    desc: '按通俗度/完整度/准确度/类比质量四维打分，并指出你还没真正理解的地方。',
    to: '/workbench/story',
  },
  {
    icon: 'edit-2',
    name: '主动回忆语义评分',
    desc: '换个说法也算对——按意思还原度评分，列出遗漏要点，比字面比对准得多。',
    to: '/workbench/recall',
  },
  {
    icon: 'notebook-pen',
    name: '康奈尔笔记线索列生成',
    desc: '从笔记正文自动生成问题式线索列与总结区，补齐最容易被跳过的两栏。',
    to: '/workbench/notes',
  },
  {
    icon: 'bar-chart-3',
    name: '学习周报 / 洞察',
    desc: '把复习量、遗忘率等硬数据讲成自然语言周报，并指出该补哪里。',
    to: '/insights/ai',
  },
  {
    icon: 'target',
    name: '薄弱点诊断',
    desc: '基于近期答错/遗忘记录，归纳你常在哪类知识上翻车，并给补救建议。',
    to: '/insights/ai',
  },
  {
    icon: 'map-pin',
    name: '记忆宫殿位点生成',
    desc: '给一组知识点自动铺成有序空间位点，并配夸张易记的联想图像。',
    to: '/workbench/palace',
  },
  {
    icon: 'list-ordered',
    name: '智能复习推荐',
    desc: '结合排程与遗忘记录，告诉你现在最该复习什么、用什么方式复习。',
    to: '/insights/ai',
  },
  {
    icon: 'git-merge',
    name: '内容关联 / 学习路径',
    desc: '把收集箱、笔记、故事向量化后，找出语义相近的内容串成学习路径。',
    to: '/insights/ai',
  },
]

const statusClass = computed(() => {
  if (!saved.enabled) return 'is-off'
  return saved.configured ? 'is-ok' : 'is-err'
})
const statusText = computed(() => {
  if (!saved.enabled) return '已关闭'
  return saved.configured ? '已就绪' : '待配置'
})

function applyPreset() {
  const p = presets.value.find((x) => x.value === form.provider)
  if (!p || !p.baseUrl) return
  form.baseUrl = p.baseUrl
  form.model = p.model
}

function syncForm(cfg: AiConfigVO) {
  Object.assign(saved, cfg)
  form.enabled = cfg.enabled
  form.provider = cfg.provider
  form.baseUrl = cfg.baseUrl
  form.model = cfg.model
  form.temperature = cfg.temperature
  form.apiKey = ''
  form.embeddingsProvider = 'siliconflow'
  form.embeddingsBaseUrl = ''
  form.embeddingsApiKey = ''
  form.embeddingsModel = cfg.embeddingsModel || ''
  timeoutSec.value = Math.round(cfg.timeoutMs / 1000)
}

function applyEmbeddingPreset() {
  const p = embeddingPresets.value.find((x) => x.value === form.embeddingsProvider)
  if (!p || !p.baseUrl) return
  form.embeddingsBaseUrl = p.baseUrl
  form.embeddingsModel = p.model
}

onMounted(async () => {
  try {
    const cfg = await getAiConfig()
    presets.value = cfg.presets || []
    embeddingPresets.value = cfg.embeddingPresets || []
    syncForm(cfg)
  } catch (e) {
    notify(getApiError(e, '读取 AI 配置失败'), 'error')
  }
})

async function save() {
  if (form.enabled && (!form.baseUrl.trim() || !form.model.trim())) {
    notify('请先填写 API 地址与模型名', 'warning')
    return
  }
  saving.value = true
  try {
    const cfg = await saveAiConfig({
      enabled: form.enabled,
      provider: form.provider,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      apiKey: form.apiKey.trim() || undefined,
      temperature: form.temperature,
      timeoutMs: Math.round(timeoutSec.value * 1000),
      embeddingsBaseUrl: form.embeddingsBaseUrl.trim(),
      embeddingsApiKey: form.embeddingsApiKey.trim() || undefined,
      embeddingsModel: form.embeddingsModel.trim(),
    })
    presets.value = cfg.presets || presets.value
    embeddingPresets.value = cfg.embeddingPresets || embeddingPresets.value
    syncForm(cfg)
    notify('AI 配置已保存', 'success')
  } catch (e) {
    notify(getApiError(e, '保存失败'), 'error')
  } finally {
    saving.value = false
  }
}

async function test() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await testAiConnection({
      provider: form.provider,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      apiKey: form.apiKey.trim() || undefined,
      timeoutMs: Math.round(timeoutSec.value * 1000),
    })
    notify('连接成功，模型可用', 'success')
  } catch (e) {
    notify(getApiError(e, '连接失败'), 'error')
  } finally {
    testing.value = false
  }
}

async function clearKey() {
  if (!(await confirmDialog('确定清空已保存的 API Key？清空后所有 AI 功能将自动降级为不可用。'))) return
  try {
    const cfg = await saveAiConfig({ apiKey: null })
    syncForm(cfg)
    notify('已清空 API Key', 'success')
  } catch (e) {
    notify(getApiError(e, '操作失败'), 'error')
  }
}

async function clearEmbeddingKey() {
  if (!(await confirmDialog('确定清空已保存的向量化 API Key？「内容关联」功能将降级为不可用。'))) return
  try {
    const cfg = await saveAiConfig({ embeddingsApiKey: null })
    syncForm(cfg)
    notify('已清空向量化 Key', 'success')
  } catch (e) {
    notify(getApiError(e, '操作失败'), 'error')
  }
}
</script>
