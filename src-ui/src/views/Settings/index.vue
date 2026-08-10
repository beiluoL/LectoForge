<template>
  <!-- 统一设置中心：通用配置 + AI 模型服务 + AI 能力清单 + 关于。
       通过唯一「⚙️ 设置」入口进入（旧 /settings/ai 已重定向至此）。
       视觉沿用工作台 --kb-* 设计令牌，卡片化、上下左右对称，贴近 macOS 系统偏好设置。 -->
  <div class="lf-page animate-fade-in">
    <!-- 返回条（sticky 常驻）：设置页是 standalone 无顶栏页，这里是回到主界面的唯一出口。
         左侧「返回」优先回上一页，无历史时兜底回工作台；右侧提示未保存改动。 -->
    <div class="lf-backbar">
      <button type="button" class="kb-btn lf-back-btn" :title="backTitle" @click="goBack">
        <Icon name="arrow-left" :size="15" />
        {{ backLabel }}
        <kbd class="lf-kbd">Esc</kbd>
      </button>
      <span v-if="dirty" class="lf-dirty" title="修改尚未写入本机配置文件">
        <i class="lf-dirty-dot"></i> 有未保存的修改
      </span>
    </div>

    <!-- 页头 -->
    <header class="lf-head">
      <h1 class="lf-title">
        <Icon name="settings" :size="22" class="lf-title-icon" /> 设置
      </h1>
      <p class="lf-sub">管理数据目录与 AI 服务。所有配置只保存在本机，随时可改。</p>
    </header>

    <!-- ============ 卡片 1：通用配置 ============ -->
    <section class="lf-card">
      <div class="lf-card-head">
        <Icon name="folder-open" :size="18" class="lf-card-icon" />
        <div>
          <h2 class="lf-card-title">知识库数据目录</h2>
          <p class="lf-card-desc">笔记、复习卡片、记忆宫殿等数据的存放位置。</p>
        </div>
      </div>

      <div class="lf-dir-row">
        <input
          v-model="form.dataDir"
          class="kb-input"
          placeholder="~/Library/Application Support/com.lectoforge.desktop"
          spellcheck="false"
        />
        <button class="kb-btn" :disabled="picking" @click="pickDirectory">
          <Icon :name="picking ? 'loader' : 'folder-search'" :size="15" :class="picking ? 'lf-spin' : ''" />
          选择文件夹
        </button>
      </div>
      <p class="lf-hint">修改后建议重启应用生效；迁移既有数据请手动拷贝。</p>
    </section>

    <!-- ============ 卡片 2：AI 模型配置（合并原 /settings/ai 全部功能） ============ -->
    <section class="lf-card">
      <div class="lf-card-head">
        <Icon name="bot" :size="18" class="lf-card-icon" />
        <div>
          <h2 class="lf-card-title">AI 模型服务</h2>
          <p class="lf-card-desc">配置一次，全局生效。所有 AI 能力均为可选增强，不配置也不影响原有功能。</p>
        </div>
        <span class="lf-status" :class="statusClass">
          <i class="lf-status-dot"></i>{{ statusText }}
        </span>
      </div>

      <label class="lf-switch">
        <input type="checkbox" v-model="form.enabled" />
        <span class="lf-switch-track"></span>
        <span class="lf-switch-label">启用 AI 增强功能</span>
      </label>

      <!-- 2 列网格：左列服务商/网关/Key，右列模型/温度/超时 -->
      <div class="lf-grid2">
        <div class="lf-field lf-span-2">
          <label class="kb-label">服务商</label>
          <select v-model="form.provider" class="kb-input" @change="applyPreset">
            <option v-for="p in presets" :key="p.value" :value="p.value">{{ p.label }}</option>
          </select>
        </div>

        <div class="lf-field lf-span-2">
          <label class="kb-label">API 网关地址</label>
          <input v-model="form.baseUrl" class="kb-input" placeholder="https://api.deepseek.com/v1" spellcheck="false" />
          <p class="lf-field-hint">填到 /v1 为止，不要带 /chat/completions。</p>
        </div>

        <div class="lf-field lf-span-2">
          <label class="kb-label">API Key</label>
          <div class="lf-key-row">
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
          <p class="lf-field-hint">只保存在本机数据目录（权限 600），不会上传、不进版本库。</p>
        </div>

        <div class="lf-field">
          <label class="kb-label">模型名称</label>
          <input v-model="form.model" class="kb-input" placeholder="deepseek-chat" spellcheck="false" />
        </div>

        <div class="lf-field">
          <label class="kb-label">超时（秒）</label>
          <input type="number" min="5" max="180" class="kb-input" v-model.number="form.timeoutSec" />
          <p class="lf-field-hint">长文生成建议 45 秒以上。</p>
        </div>

        <div class="lf-field lf-span-2">
          <label class="kb-label">采样温度 {{ form.temperature.toFixed(1) }}</label>
          <input
            type="range"
            min="0.1"
            max="2.0"
            step="0.1"
            v-model.number="form.temperature"
            class="lf-range"
          />
          <p class="lf-field-hint">越低越稳定。评分类任务建议 0.1~0.3。</p>
        </div>
      </div>

      <!-- 操作栏：测试连通性 + 保存设置（统一保存数据目录 + AI 全量配置） -->
      <div class="lf-actions">
        <button class="kb-btn kb-btn-sm" :disabled="testing" @click="onTest">
          <Icon :name="testing ? 'loader' : 'plug-zap'" :size="14" :class="testing ? 'lf-spin' : ''" />
          测试连通性
        </button>
        <button class="kb-btn kb-btn-primary" :disabled="saving" @click="saveAll">
          <Icon :name="saving ? 'loader' : 'save'" :size="16" :class="saving ? 'lf-spin' : ''" />
          保存设置
        </button>
        <span v-if="testState" class="lf-test-result" :class="testState.ok ? 'is-ok' : 'is-fail'">
          <Icon :name="testState.ok ? 'check-circle' : 'x-circle'" :size="14" />
          {{ testState.text }}
        </span>
      </div>

      <!-- 向量化服务（内容关联，可选，与原 /settings/ai 一致） -->
      <div class="lf-embed">
        <div class="lf-card-head" style="margin-bottom: .5rem;">
          <Icon name="boxes" :size="16" class="lf-card-icon" style="color: var(--kb-muted-foreground);" />
          <div>
            <h3 class="lf-card-title" style="font-size: .9375rem;">向量化服务（内容关联）</h3>
            <p class="lf-card-desc">用于「内容关联 / 学习路径」，与聊天服务可独立配置，可选。</p>
          </div>
          <span class="lf-status" :class="saved.embeddingsConfigured ? 'is-ok' : 'is-off'">
            <i class="lf-status-dot"></i>{{ saved.embeddingsConfigured ? '已配置' : '未配置（可选）' }}
          </span>
        </div>

        <div class="lf-grid2">
          <div class="lf-field">
            <label class="kb-label">向量化服务商</label>
            <select v-model="form.embeddingsProvider" class="kb-input" @change="applyEmbeddingPreset">
              <option v-for="p in embedPresets" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </div>
          <div class="lf-field">
            <label class="kb-label">向量模型</label>
            <input v-model="form.embeddingsModel" class="kb-input" placeholder="BAAI/bge-m3" spellcheck="false" />
          </div>
          <div class="lf-field lf-span-2">
            <label class="kb-label">向量化 API 地址</label>
            <input v-model="form.embeddingsBaseUrl" class="kb-input" placeholder="https://api.siliconflow.cn/v1" spellcheck="false" />
          </div>
          <div class="lf-field lf-span-2">
            <label class="kb-label">向量化 API Key</label>
            <div class="lf-key-row">
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
          </div>
        </div>
      </div>
    </section>

    <!-- ============ 卡片 3：AI 能力清单 ============ -->
    <section class="lf-card">
      <div class="lf-card-head">
        <Icon name="brain-circuit" :size="18" class="lf-card-icon" />
        <div>
          <h2 class="lf-card-title">已接入的 AI 能力</h2>
          <p class="lf-card-desc">每项能力都是「按需触发 + 结果可编辑」：AI 只把结果填进输入框，是否采纳由你决定。</p>
        </div>
      </div>

      <div class="lf-cap-grid">
        <article v-for="c in capabilities" :key="c.name" class="lf-cap">
          <span class="lf-cap-icon"><Icon :name="c.icon" :size="16" /></span>
          <div class="lf-cap-body">
            <p class="lf-cap-name">{{ c.name }}</p>
            <p class="lf-cap-desc">{{ c.desc }}</p>
          </div>
          <router-link :to="c.to" class="kb-btn kb-btn-sm lf-cap-go">
            前往 <Icon name="chevron-right" :size="12" />
          </router-link>
        </article>
      </div>
    </section>

    <!-- ============ 卡片 4：关于 ============ -->
    <section class="lf-card">
      <div class="lf-card-head">
        <Icon name="info" :size="18" class="lf-card-icon" style="color: var(--kb-muted-foreground);" />
        <div>
          <h2 class="lf-card-title">关于</h2>
          <p class="lf-card-desc">本机离线运行的个人学习工作台。</p>
        </div>
      </div>
      <dl class="lf-about">
        <div><dt>应用</dt><dd>LectoForge 学习工作台</dd></div>
        <div><dt>版本</dt><dd>v1.0.0</dd></div>
        <div><dt>运行模式</dt><dd><span class="lf-badge"><Icon name="hard-drive" :size="12" /> 本地离线</span></dd></div>
      </dl>

      <!-- 数据备份：立即备份 + 每日自动备份开关与时刻 + 最近备份列表 -->
      <div class="lf-backup">
        <div class="lf-card-head" style="margin: 1.1rem 0 .75rem;">
          <Icon name="archive" :size="18" class="lf-card-icon" style="color: var(--kb-muted-foreground);" />
          <div>
            <h3 class="lf-card-title" style="font-size: .9375rem;">数据备份</h3>
            <p class="lf-card-desc">定期把数据库、上传文件与配置打包成 zip，换机或重装后可一键恢复。</p>
          </div>
        </div>

        <div class="lf-dir-row">
          <input
            v-model="appStore.backup.dir"
            class="kb-input"
            placeholder="选择备份保存目录"
            spellcheck="false"
          />
          <button class="kb-btn" :disabled="pickingBackup" @click="pickBackupDir">
            <Icon :name="pickingBackup ? 'loader' : 'folder-search'" :size="15" :class="pickingBackup ? 'lf-spin' : ''" />
            选择文件夹
          </button>
        </div>

        <div class="lf-actions">
          <button class="kb-btn kb-btn-primary" :disabled="backupBusy" @click="onBackupNow">
            <Icon :name="backupBusy ? 'loader' : 'download'" :size="15" :class="backupBusy ? 'lf-spin' : ''" />
            立即备份
          </button>
          <button class="kb-btn kb-btn-sm" @click="openBackupFolder">
            <Icon name="folder-open" :size="14" /> 打开目录
          </button>
          <span v-if="backupMsg" class="lf-test-result" :class="backupMsg.ok ? 'is-ok' : 'is-fail'">
            <Icon :name="backupMsg.ok ? 'check-circle' : 'x-circle'" :size="14" />
            {{ backupMsg.text }}
          </span>
        </div>

        <label class="lf-switch">
          <input type="checkbox" v-model="appStore.backup.auto" @change="onToggleAuto" />
          <span class="lf-switch-track"></span>
          <span class="lf-switch-label">每日自动备份</span>
        </label>

        <div v-if="appStore.backup.auto" class="lf-field lf-span-2" style="margin-top: .6rem;">
          <label class="kb-label">每日触发时刻</label>
          <input type="time" v-model="appStore.backup.time" class="kb-input" style="max-width: 160px;" @change="onTimeChange" />
        </div>

        <div v-if="backupList.length" class="lf-backup-list">
          <p class="lf-field-hint">最近备份（共 {{ backupList.length }} 个）</p>
          <ul>
            <li v-for="b in backupList" :key="b.name">
              <Icon name="file" :size="14" />
              <span class="lf-bname">{{ b.name }}</span>
              <span class="lf-bmeta">{{ formatSize(b.size) }} · {{ formatTime(b.modifiedAt) }}</span>
            </li>
          </ul>
        </div>
      </div>

      <div class="lf-actions">
        <button class="kb-btn kb-btn-sm" @click="rerunOnboarding">
          <Icon name="rotate-ccw" :size="14" /> 重新运行新手引导
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
// 统一设置中心（2026-08-08 重构）：将原 /settings（通用配置）与 /settings/ai（AI 详细配置 + 能力清单）
// 三页面融合为单一设置界面，仅靠顶栏唯一「⚙️ 设置」入口进入。
//
// ⚠️ 架构红线（不改动后端契约）：
// - 数据目录经 useAppStore.saveSettings() → POST /api/config/init 落盘；
// - AI 全量配置经 saveAiConfig() → PUT /api/ai/config 落盘（完整保留 enabled / temperature / timeoutMs / embeddings）。
// - 由于 /config/init 后端会把 enabled 写死 true 且仅收 apiUrl/apiKey/model，
//   统一保存时**先存数据目录、再存 AI 全量配置（最后写）**，确保最终实现以表单为准、不丢温度/超时/向量化。
// - 明文 apiKey 绝不进 localStorage：store 的 persist.pick 已排除；表单提交时留空表示保持已保存值。
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
// 顶层静态导入：build 模式下动态 import('@tauri-apps/api/core') 的 chunk 可能加载失败
import { invoke } from '@tauri-apps/api/core'
// 数据备份：用 fs 插件确保备份目录存在（Tauri 2 fs 插件）
import { mkdir } from '@tauri-apps/plugin-fs'
import Icon from '@/components/ui/Icon.vue'
import { notify, getApiError, confirmDialog, toastState } from '@/utils/toast'
import { useAppStore } from '@/store/app-store'
import { useSearchStore } from '@/store/search-store'
import { useInboxStore } from '@/store/inbox-store'
import { useNoteStore } from '@/store/note-store'
import { getAppConfig } from '@/api/config'
import {
  getAiConfig,
  saveAiConfig,
  testAiConnection,
  type AiConfigVO,
  type AiProviderPreset,
  type AiPingResult,
} from '@/api/ai'

const router = useRouter()
const appStore = useAppStore()
// 仅用于 Esc 互斥判断：这三个全局弹层由 App.vue 的 window keydown 统一消费 Esc，
// 弹层开着时本页不能抢走这次 Esc，否则会「关弹层的同时把页面也退掉」。
const searchStore = useSearchStore()
const inboxStore = useInboxStore()
const noteStore = useNoteStore()

const picking = ref(false)
const testing = ref(false)
const saving = ref(false)
const testState = ref<{ ok: boolean; text: string } | null>(null)

// 数据备份相关本地状态
const pickingBackup = ref(false)
const backupBusy = ref(false)
const backupMsg = ref<{ ok: boolean; text: string } | null>(null)
const backupList = ref<Array<{ name: string; size: number; modifiedAt: number }>>([])

const presets = ref<AiProviderPreset[]>([])
const embedPresets = ref<AiProviderPreset[]>([])

/** 已保存配置的安全视图（掩码 + 状态），不持有明文 */
const saved = reactive({
  apiKeyMask: '',
  configured: false,
  embeddingsConfigured: false,
})

const form = reactive({
  // 通用配置
  dataDir: '',
  // AI 模型服务
  enabled: true,
  provider: 'deepseek',
  baseUrl: '',
  model: '',
  apiKey: '',
  temperature: 0.3,
  timeoutSec: 45,
  // 向量化（内容关联，可选，与聊天服务解耦）
  embeddingsProvider: 'siliconflow',
  embeddingsBaseUrl: '',
  embeddingsApiKey: '',
  embeddingsModel: '',
})

/** AI 能力清单（原 AiSettings.vue 迁移，图标均为 lucide 合法名，经 <Icon> 渲染） */
const capabilities = [
  { icon: 'wand-2', name: '费曼故事清晰度评分', desc: '按通俗度/完整度/准确度/类比质量四维打分，并指出你还没真正理解的地方。', to: '/workbench/story' },
  { icon: 'edit-2', name: '主动回忆语义评分', desc: '换个说法也算对——按意思还原度评分，比字面比对准得多。', to: '/workbench/recall' },
  { icon: 'notebook-pen', name: '康奈尔笔记线索列生成', desc: '从笔记正文自动生成问题式线索列与总结区。', to: '/workbench/notes' },
  { icon: 'bar-chart-3', name: '学习周报 / 洞察', desc: '把复习量、遗忘率等硬数据讲成自然语言周报。', to: '/insights/ai' },
  { icon: 'target', name: '薄弱点诊断', desc: '基于近期答错/遗忘记录，归纳常在哪类知识上翻车。', to: '/insights/ai' },
  { icon: 'map-pin', name: '记忆宫殿位点生成', desc: '给知识点自动铺成有序空间位点，并配联想图像。', to: '/workbench/palace' },
  { icon: 'list-ordered', name: '智能复习推荐', desc: '结合排程与遗忘记录，告诉你现在最该复习什么。', to: '/insights/ai' },
  { icon: 'git-merge', name: '内容关联 / 学习路径', desc: '把收集箱、笔记、故事向量化后串成学习路径。', to: '/insights/ai' },
]

const statusClass = computed(() => {
  if (!form.enabled) return 'is-off'
  return saved.configured ? 'is-ok' : 'is-err'
})
const statusText = computed(() => {
  if (!form.enabled) return '已关闭'
  return saved.configured ? '已就绪' : '待配置'
})

/* ============ 返回主界面 ============
 * 设置页 meta.standalone = true（App.vue 不渲染顶栏），必须自带出口。
 * 返回目标优先取进入设置前的来源页（vue-router 把它维护在 history.state.back），
 * 冷启动 / 深链直达设置时无来源，兜底回工作台，避免 router.back() 退出应用。 */
const backPath = ref<string | null>(null)

const backLabel = computed(() => (backPath.value ? '返回' : '返回工作台'))
const backTitle = computed(() =>
  backPath.value ? `返回上一页（${backPath.value}）· Esc` : '返回工作台 · Esc',
)

/** 统一出口：有历史来源走 back（保留滚动位置与前进历史），否则 push 工作台 */
function goBack() {
  if (backPath.value) router.back()
  else router.push('/workbench')
}

/** 全局弹层是否占用着 Esc（命令面板 / 速记 / 极速新建 / 确认框） */
function overlayHoldsEsc(): boolean {
  return (
    searchStore.isOpen ||
    inboxStore.quickOpen ||
    noteStore.quickCreateOpen ||
    toastState.confirms.length > 0
  )
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  if (overlayHoldsEsc()) return
  goBack()
}

/* ============ 未保存改动保护 ============
 * 表单快照 vs 基线：任何出口（返回按钮、Esc、能力清单「前往」、重新运行引导）
 * 都经 onBeforeRouteLeave 统一确认，保护逻辑只有一处，不散落在各按钮里。 */
const baseline = ref('')

function snapshot(): string {
  return JSON.stringify({
    dataDir: form.dataDir.trim(),
    enabled: form.enabled,
    provider: form.provider,
    baseUrl: form.baseUrl.trim(),
    model: form.model.trim(),
    temperature: form.temperature,
    timeoutSec: form.timeoutSec,
    embeddingsProvider: form.embeddingsProvider,
    embeddingsBaseUrl: form.embeddingsBaseUrl.trim(),
    embeddingsModel: form.embeddingsModel.trim(),
    // Key 只看「是否填了新值」，明文不进快照
    keyTouched: !!form.apiKey.trim(),
    embedKeyTouched: !!form.embeddingsApiKey.trim(),
  })
}

/** 基线为空 = 首屏配置尚未载入，此时一律视为干净，避免加载期误报 */
const dirty = computed(() => !!baseline.value && snapshot() !== baseline.value)

onBeforeRouteLeave(async () => {
  if (!dirty.value) return true
  return await confirmDialog('设置有未保存的修改，确定离开吗？未保存的改动将丢失。')
})

function applyPreset() {
  const p = presets.value.find((x) => x.value === form.provider)
  if (!p || !p.baseUrl) return
  form.baseUrl = p.baseUrl
  form.model = p.model
}

function applyEmbeddingPreset() {
  const p = embedPresets.value.find((x) => x.value === form.embeddingsProvider)
  if (!p || !p.baseUrl) return
  form.embeddingsBaseUrl = p.baseUrl
  form.embeddingsModel = p.model
}

/** 用后端返回的完整配置视图回填表单（apiKey 字段留空，避免明文残留） */
function syncAiForm(cfg: AiConfigVO) {
  saved.apiKeyMask = cfg.apiKeyMask || ''
  saved.configured = !!cfg.configured
  saved.embeddingsConfigured = !!cfg.embeddingsConfigured
  form.enabled = cfg.enabled
  form.provider = cfg.provider
  form.baseUrl = cfg.baseUrl
  form.model = cfg.model
  form.temperature = cfg.temperature
  form.apiKey = ''
  form.embeddingsApiKey = ''
  form.embeddingsModel = cfg.embeddingsModel || ''
  form.timeoutSec = Math.round(cfg.timeoutMs / 1000)
}

onMounted(async () => {
  // 解析来源页：排除 /settings 自身（旧 /settings/ai 重定向而来）与 /onboarding（引导页不该被回退到）
  const prev = (window.history.state as { back?: unknown } | null)?.back
  backPath.value =
    typeof prev === 'string' && prev && !prev.startsWith('/settings') && !prev.startsWith('/onboarding')
      ? prev
      : null
  window.addEventListener('keydown', onKeydown)

  await appStore.initFromBackend()
  try {
    const cfg = await getAiConfig()
    presets.value = cfg.presets || []
    embedPresets.value = cfg.embeddingPresets || []
    syncAiForm(cfg)
  } catch (e) {
    notify(getApiError(e, '读取 AI 配置失败'), 'error')
  }
  try {
    const app = await getAppConfig()
    if (app.dataDir) form.dataDir = app.dataDir
  } catch {
    form.dataDir = appStore.settings.dataDir
  }
  // 数据备份计划（不计入「未保存改动」基线）
  await loadBackupSettings()
  // 全部载入完成后才立基线，否则回填过程会被误判成「用户改动」
  baseline.value = snapshot()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})

async function pickDirectory() {
  if (picking.value) return
  picking.value = true
  try {
    const dir = await invoke<string>('select_directory')
    if (dir) form.dataDir = dir
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    if (!msg.includes('取消')) {
      notify('当前为浏览器预览模式，选择文件夹仅在桌面应用内可用；可直接粘贴路径', 'info')
    }
  } finally {
    picking.value = false
  }
}

async function onTest() {
  if (testing.value) return
  if (!form.baseUrl.trim() || (!form.model.trim() && form.enabled)) {
    notify('请先填写 API 地址与模型名再测试', 'info')
    return
  }
  testing.value = true
  testState.value = null
  try {
    const r = await testAiConnection({
      enabled: form.enabled,
      provider: form.provider,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      apiKey: form.apiKey.trim() || undefined,
      temperature: form.temperature,
      timeoutMs: Math.round(form.timeoutSec * 1000),
    })
    testState.value = { ok: true, text: `✅ 连接正常 · ${r.model} · ${r.latencyMs}ms` }
  } catch (e) {
    testState.value = { ok: false, text: `❌ 连接失败，请检查 Key 或网关地址（${getApiError(e, '')}）` }
  } finally {
    testing.value = false
  }
}

/**
 * 统一保存：先存数据目录（POST /config/init），再存 AI 全量配置（PUT /ai/config，最后写）。
 * 顺序保证 AI 的 enabled / temperature / timeoutMs / embeddings 不被 /config/init 的写死逻辑覆盖。
 */
async function saveAll() {
  if (saving.value) return
  saving.value = true
  try {
    // 1) 数据目录：同步到 store 后走 POST /config/init
    appStore.updateSettings({
      dataDir: form.dataDir.trim(),
      ai: { apiUrl: form.baseUrl.trim(), apiKey: form.apiKey, model: form.model.trim() },
    })
    await appStore.saveSettings()

    // 2) AI 全量配置：最后写，权威覆盖（保留 enabled / 温度 / 超时 / 向量化）
    const cfg = await saveAiConfig({
      enabled: form.enabled,
      provider: form.provider,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      apiKey: form.apiKey.trim() || undefined,
      temperature: form.temperature,
      timeoutMs: Math.round(form.timeoutSec * 1000),
      embeddingsBaseUrl: form.embeddingsBaseUrl.trim(),
      embeddingsApiKey: form.embeddingsApiKey.trim() || undefined,
      embeddingsModel: form.embeddingsModel.trim(),
    })
    presets.value = cfg.presets || presets.value
    embedPresets.value = cfg.embeddingPresets || embedPresets.value
    syncAiForm(cfg)
    baseline.value = snapshot() // 已落盘，重置基线以撤下「未保存」提示
    notify('设置已保存', 'success')
  } catch (e) {
    notify(getApiError(e, '保存失败，请重试'), 'error')
  } finally {
    saving.value = false
  }
}

async function clearKey() {
  if (!(await confirmDialog('确定清空已保存的 API Key？清空后所有 AI 功能将自动降级为不可用。'))) return
  try {
    const cfg = await saveAiConfig({ apiKey: null })
    syncAiForm(cfg)
    baseline.value = snapshot()
    notify('已清空 API Key', 'success')
  } catch (e) {
    notify(getApiError(e, '操作失败'), 'error')
  }
}

async function clearEmbeddingKey() {
  if (!(await confirmDialog('确定清空已保存的向量化 API Key？「内容关联」功能将降级为不可用。'))) return
  try {
    const cfg = await saveAiConfig({ embeddingsApiKey: null })
    syncAiForm(cfg)
    baseline.value = snapshot()
    notify('已清空向量化 Key', 'success')
  } catch (e) {
    notify(getApiError(e, '操作失败'), 'error')
  }
}

/** 重新运行引导：跳回 /onboarding（守卫会在 hasOnboarded=true 时拦截，故用 query 放行） */
function rerunOnboarding() {
  router.push({ path: '/onboarding', query: { rerun: '1' } })
}

/* ============ 数据备份 ============
 * 目录 / 开关 / 时刻经 store 持久化到 localStorage，并实时经 Rust 命令落盘到后端 backup-config.json；
 * 立即备份与每日调度都由 Rust 侧调用后端 POST /api/backup（Node 侧车用 child_process 跑 backup.js）。 */

/** 把当前备份设置写回后端（Rust → 后端 PUT /api/backup/schedule） */
async function persistSchedule(): Promise<void> {
  try {
    await invoke('set_backup_schedule', {
      enabled: appStore.backup.auto,
      time: appStore.backup.time,
      outDir: appStore.backup.dir,
    })
  } catch (e) {
    notify(getApiError(e, '保存备份计划失败'), 'error')
  }
}

/** 选择备份保存目录 */
async function pickBackupDir() {
  if (pickingBackup.value) return
  pickingBackup.value = true
  try {
    const dir = await invoke<string>('select_directory')
    if (dir) {
      appStore.updateBackup({ dir })
      await persistSchedule()
      await refreshBackupList()
    }
  } catch {
    /* 用户取消：静默 */
  } finally {
    pickingBackup.value = false
  }
}

/** 立即备份一次 */
async function onBackupNow() {
  if (backupBusy.value) return
  if (!appStore.backup.dir) {
    notify('请先选择备份保存目录', 'info')
    return
  }
  backupBusy.value = true
  backupMsg.value = null
  try {
    // 用 fs 插件确保目录存在（backup.js 也会自建，这里用 fs 插件做一次）
    try {
      await mkdir(appStore.backup.dir, { recursive: true })
    } catch {
      /* 目录可能已存在，忽略 */
    }
    const zipPath = await invoke<string>('create_backup', { outDir: appStore.backup.dir })
    backupMsg.value = { ok: true, text: `已备份：${zipPath.split('/').pop()}` }
    await refreshBackupList()
  } catch (e) {
    backupMsg.value = { ok: false, text: getApiError(e, '备份失败') }
  } finally {
    backupBusy.value = false
  }
}

/** 切换每日自动备份 */
async function onToggleAuto() {
  await persistSchedule()
}

/** 修改每日触发时刻 */
async function onTimeChange() {
  await persistSchedule()
}

/** 打开备份目录（Finder 中定位） */
async function openBackupFolder() {
  if (!appStore.backup.dir) {
    notify('请先选择备份保存目录', 'info')
    return
  }
  try {
    await invoke('open_backup_folder', { path: appStore.backup.dir })
  } catch (e) {
    notify(getApiError(e, '打开目录失败'), 'error')
  }
}

/** 刷新最近备份列表（Rust list_backups 命令，std::fs 读取，无 ACL 范围限制） */
async function refreshBackupList() {
  if (!appStore.backup.dir) {
    backupList.value = []
    return
  }
  try {
    const list = await invoke<Array<{ name: string; size: number; modifiedAt: number }>>('list_backups', {
      dir: appStore.backup.dir,
    })
    backupList.value = list
  } catch {
    backupList.value = []
  }
}

/** 载入后端保存的备份计划，回填 UI；目录为空时默认落到数据目录下的 backups/ */
async function loadBackupSettings() {
  try {
    const s = await invoke<{ enabled: boolean; time: string; outDir: string }>('get_backup_schedule')
    let dir = s.outDir || ''
    if (!dir && appStore.settings.dataDir) dir = `${appStore.settings.dataDir}/backups`
    appStore.updateBackup({ dir, auto: s.enabled, time: s.time || '03:00' })
    // 把默认目录落盘，保证自动备份在用户未手动选择时也能运行
    if (dir) await persistSchedule()
  } catch {
    /* 后端未就绪（如浏览器预览）：保留本地持久化值 */
  }
  await refreshBackupList()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatTime(secs: number): string {
  const d = new Date(secs * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<style scoped>
.lf-page { max-width: 56rem; margin: 0 auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem; }

/* 返回条：贴 viewport 顶部常驻（本页无顶栏，滚到卡片深处也要能一键回去）。
   负 margin 抵掉 .lf-page 的 padding，使毛玻璃背景横向铺满、视觉上等同原生 toolbar。 */
.lf-backbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: .75rem;
  margin: -1.5rem -1.5rem 0;
  padding: .625rem 1.5rem;
  border-bottom: 1px solid var(--kb-border);
  background: color-mix(in srgb, var(--kb-background) 82%, transparent);
  backdrop-filter: saturate(180%) blur(12px);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
}
.lf-back-btn { display: inline-flex; align-items: center; gap: .375rem; font-weight: 600; }
.lf-back-btn:hover { color: var(--kb-primary); border-color: var(--kb-primary); }
.lf-kbd {
  margin-left: .125rem;
  padding: .05rem .3rem;
  border: 1px solid var(--kb-border);
  border-radius: 4px;
  background: var(--kb-muted);
  color: var(--kb-muted-foreground);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.5;
}
.lf-dirty {
  display: inline-flex;
  align-items: center;
  gap: .375rem;
  margin-left: auto;
  font-size: var(--kb-fs-caption, .75rem);
  color: var(--kb-warning);
}
.lf-dirty-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--kb-warning); }

.lf-head { margin-bottom: -.25rem; }
.lf-title { display: flex; align-items: center; gap: .5rem; font-size: var(--kb-fs-h2, 1.5rem); font-weight: 700; color: var(--kb-foreground); margin: 0; }
.lf-title-icon { color: var(--kb-primary); }
.lf-sub { color: var(--kb-muted-foreground); font-size: var(--kb-fs-body-sm, .8125rem); margin: .3rem 0 0; }

.lf-card {
  background: var(--kb-card);
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-lg, 16px);
  padding: 1.25rem 1.375rem;
  box-shadow: var(--shadow-card, 0 1px 2px rgba(0,0,0,.04));
}
.lf-card-head { display: flex; align-items: flex-start; gap: .625rem; margin-bottom: .75rem; }
.lf-card-icon { color: var(--kb-primary); margin-top: 2px; flex-shrink: 0; }
.lf-card-title { font-size: var(--kb-fs-h4, 1rem); font-weight: 600; color: var(--kb-foreground); margin: 0; }
.lf-card-desc { font-size: var(--kb-fs-body-sm, .8125rem); color: var(--kb-muted-foreground); margin: .125rem 0 0; line-height: 1.5; }

.lf-hint { font-size: var(--kb-fs-caption, .75rem); color: var(--kb-muted-foreground); margin-top: .75rem; line-height: 1.5; }

.lf-dir-row { display: flex; gap: .5rem; align-items: center; }
.lf-dir-row .kb-input { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 12.5px; }

/* 状态徽标 */
.lf-status { display: inline-flex; align-items: center; gap: .375rem; font-size: var(--kb-fs-caption, .75rem); padding: .15rem .55rem; border-radius: 999px; margin-left: auto; align-self: center; background: var(--kb-muted); color: var(--kb-muted-foreground); }
.lf-status-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--kb-muted-foreground); }
.lf-status.is-ok { color: var(--kb-primary); background: color-mix(in srgb, var(--kb-primary) 12%, transparent); }
.lf-status.is-ok .lf-status-dot { background: var(--kb-primary); }
.lf-status.is-err { color: var(--kb-warning); background: color-mix(in srgb, var(--kb-warning) 14%, transparent); }
.lf-status.is-err .lf-status-dot { background: var(--kb-warning); }
.lf-status.is-off { color: var(--kb-muted-foreground); }

/* 启用开关 */
.lf-switch { display: inline-flex; align-items: center; gap: .5rem; margin: .25rem 0 .75rem; cursor: pointer; }
.lf-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.lf-switch-track { width: 38px; height: 22px; border-radius: 999px; background: var(--kb-border); position: relative; transition: background .15s ease; flex-shrink: 0; }
.lf-switch-track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 999px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .15s ease; }
.lf-switch input:checked + .lf-switch-track { background: var(--kb-primary); }
.lf-switch input:checked + .lf-switch-track::after { transform: translateX(16px); }
.lf-switch-label { font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); font-weight: 500; }

/* 2 列表单网格 */
.lf-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.lf-span-2 { grid-column: span 2; }
.lf-field { display: flex; flex-direction: column; gap: .35rem; min-width: 0; }
.lf-field .kb-input { width: 100%; }
.lf-field-hint { font-size: var(--kb-fs-caption, .75rem); color: var(--kb-muted-foreground); margin: 0; line-height: 1.4; }
.lf-key-row { display: flex; align-items: center; gap: .5rem; }
.lf-key-row .kb-input { flex: 1; min-width: 0; }
.lf-range { width: 100%; accent-color: var(--kb-primary); }

/* 操作栏 */
.lf-actions { display: flex; align-items: center; gap: .625rem; margin-top: 1rem; flex-wrap: wrap; }
.lf-test-result { display: inline-flex; align-items: center; gap: .35rem; font-size: var(--kb-fs-caption, .75rem); }
.lf-test-result.is-ok { color: var(--kb-accent); }
.lf-test-result.is-fail { color: var(--kb-destructive); }

/* 向量化服务子区 */
.lf-embed { margin-top: 1.25rem; padding-top: 1.25rem; border-top: 1px solid var(--kb-border); }

/* 能力清单网格 */
.lf-cap-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .625rem; margin-top: .5rem; }
.lf-cap { display: flex; align-items: center; gap: .75rem; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md, 10px); padding: .625rem .75rem; background: var(--kb-card); }
.lf-cap-icon { flex-shrink: 0; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; background: color-mix(in srgb, var(--kb-primary) 10%, transparent); color: var(--kb-primary); }
.lf-cap-body { flex: 1; min-width: 0; }
.lf-cap-name { font-size: var(--kb-fs-body-sm); font-weight: 600; color: var(--kb-foreground); margin: 0; }
.lf-cap-desc { font-size: var(--kb-fs-caption, .75rem); color: var(--kb-muted-foreground); margin: .125rem 0 0; line-height: 1.4; }
.lf-cap-go { flex-shrink: 0; }

/* 关于 */
.lf-about { display: flex; flex-direction: column; gap: .5rem; margin: 0; }
.lf-about > div { display: flex; align-items: center; gap: 1rem; }
.lf-about dt { width: 84px; flex-shrink: 0; font-size: var(--kb-fs-body-sm); color: var(--kb-muted-foreground); margin: 0; }
.lf-about dd { font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); margin: 0; }
.lf-badge { display: inline-flex; align-items: center; gap: .35rem; padding: .15rem .55rem; border-radius: 999px; background: var(--kb-muted); color: var(--kb-muted-foreground); font-size: var(--kb-fs-caption, .75rem); }

/* 数据备份子区 */
.lf-backup { border-top: 1px solid var(--kb-border); padding-top: .25rem; margin-top: -.25rem; }
.lf-dir-row .kb-input { font-family: var(--font-mono); font-size: 12.5px; }
.lf-backup-list { margin-top: .9rem; }
.lf-backup-list ul { list-style: none; margin: .4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; max-height: 12rem; overflow-y: auto; }
.lf-backup-list li { display: flex; align-items: center; gap: .5rem; padding: .35rem .55rem; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md, 10px); background: var(--kb-muted); }
.lf-backup-list li > :first-child { color: var(--kb-muted-foreground); flex-shrink: 0; }
.lf-bname { font-size: var(--kb-fs-body-sm); color: var(--kb-foreground); font-family: var(--font-mono); word-break: break-all; }
.lf-bmeta { margin-left: auto; font-size: var(--kb-fs-caption, .72rem); color: var(--kb-muted-foreground); white-space: nowrap; flex-shrink: 0; }

.lf-spin { animation: lf-rotate .9s linear infinite; }
@keyframes lf-rotate { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .lf-grid2 { grid-template-columns: 1fr; }
  .lf-span-2 { grid-column: span 1; }
  .lf-cap-grid { grid-template-columns: 1fr; }
}
</style>
