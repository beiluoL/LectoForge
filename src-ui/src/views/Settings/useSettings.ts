/**
 * useSettings —— 设置中心「后端权威配置」组合式（单例）
 *
 * 把旧版 Settings/index.vue 的 script 逻辑整体下沉到这里，供 index.vue 外壳与各
 * section 组件共享同一份状态。涵盖：数据目录、AI 模型服务、本地模型（LLM/Whisper/TTS）、
 * 数据备份、AI 能力清单，以及跨 section 的「未保存改动」守卫（dirty / snapshot / baseline）。
 *
 * ⚠️ 架构红线（不改动后端契约）：
 * - 数据目录经 appStore.saveSettings() → POST /api/config/init 落盘；
 * - AI 全量配置经 saveAiConfig() → PUT /api/ai/config 落盘（完整保留 enabled / temperature / timeoutMs / embeddings）。
 * - 由于 /config/init 后端会把 enabled 写死 true 且仅收 apiUrl/apiKey/model，
 *   统一保存时**先存数据目录、再存 AI 全量配置（最后写）**，确保以实现以表单为准、不丢温度/超时/向量化。
 * - 明文 apiKey 绝不进 localStorage：store 的 persist.pick 已排除；表单提交时留空表示保持已保存值。
 */
import { computed, reactive, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { mkdir } from '@tauri-apps/plugin-fs'
import { notify, getApiError, confirmDialog } from '@/utils/toast'
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
import {
  getSpeechModels,
  getSpeechConfig,
  saveSpeechConfig,
  deleteSpeechModel,
  downloadSpeechModel,
  type SpeechModelEntry,
  type SpeechConfig,
} from '@/api/speechModels'
import {
  listChineseVoices,
  getSelectedVoiceName,
  setSelectedVoiceName,
  speakText,
  cancelSpeech,
  type TtsVoiceOption,
} from '@/lib/tts/tts'
import {
  getTtsVoices,
  getTtsConfig,
  saveTtsConfig,
  deleteTtsVoice,
  downloadTtsVoice,
  type VoiceEntry,
  type TtsConfig,
} from '@/api/ttsVoices'

const appStore = useAppStore()
const searchStore = useSearchStore()
const inboxStore = useInboxStore()
const noteStore = useNoteStore()

// 单例加载守卫：loadAll 只跑一次
let loaded = false

// ============ 通用状态 ============
const testing = ref(false)
const saving = ref(false)
const testState = ref<{ ok: boolean; text: string } | null>(null)
const showAdvanced = ref(false)
const customModel = ref('')
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
  // 本地模型（离线模拟面试）：localLlmUrl 与上方 baseUrl 二选一，填了即切 local provider
  localLlmUrl: '',
  whisperUrl: '',
  whisperModel: '',
})

/** AI 能力清单（图标均为 lucide 合法名，经 <Icon> 渲染） */
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

/** 当前选中服务商的预设 */
const currentPreset = computed<AiProviderPreset | undefined>(() =>
  presets.value.find((p) => p.value === form.provider),
)

const statusClass = computed(() => {
  if (!form.enabled) return 'is-off'
  return saved.configured ? 'is-ok' : 'is-err'
})
const statusText = computed(() => {
  if (!form.enabled) return '已关闭'
  return saved.configured ? '已就绪' : '待配置'
})

// ============ 离线语音模型（运行时 + 模型下载）============
const speechModels = ref<SpeechModelEntry[]>([])
const speechCfg = reactive<SpeechConfig>({ runtime: 'native', selectedModelId: 'base-q5_1', updatedAt: '' })
const speechBusy = ref(false)
const speechSaving = ref(false)
const downloadProgress = reactive<Record<string, number>>({})

// ============ 朗读嗓音（Web Speech API）============
const ttsVoices = ref<TtsVoiceOption[]>([])
const ttsSelected = ref('')
const ttsPreviewing = ref(false)

// ============ 语音合成引擎（系统语音 / 本地神经网络 Piper）============
const ttsEngine = ref<'browser' | 'piper'>('browser')
const ttsSelectedVoiceId = ref('zh_CN-huayan-medium')
const ttsVoiceList = ref<VoiceEntry[]>([])
const ttsBusy = ref(false)
const ttsSaving = ref(false)
const ttsDownloadProgress = reactive<Record<string, number>>({})

// ============ 数据备份 ============
const pickingBackup = ref(false)
const backupBusy = ref(false)
const backupMsg = ref<{ ok: boolean; text: string } | null>(null)
const backupList = ref<Array<{ name: string; size: number; modifiedAt: number }>>([])

// ============ 未保存改动守卫 ============
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
    localLlmUrl: form.localLlmUrl.trim(),
    whisperUrl: form.whisperUrl.trim(),
    whisperModel: form.whisperModel.trim(),
    keyTouched: !!form.apiKey.trim(),
    embedKeyTouched: !!form.embeddingsApiKey.trim(),
  })
}

/** 基线为空 = 首屏配置尚未载入，此时一律视为干净，避免加载期误报 */
const dirty = computed(() => !!baseline.value && snapshot() !== baseline.value)

/* ============ AI 配置 ============ */
function resolveModel(): string {
  if (form.model === '__custom__') return customModel.value.trim()
  return form.model.trim()
}

function applyPreset() {
  const p = currentPreset.value
  if (!p) return
  if (p.baseUrl) form.baseUrl = p.baseUrl
  if (p.models?.length && p.models.includes(p.model)) {
    form.model = p.model
    customModel.value = ''
  } else if (p.model) {
    form.model = '__custom__'
    customModel.value = p.model
  } else {
    form.model = '__custom__'
    customModel.value = ''
  }
}

function selectProvider(value: string) {
  form.provider = value
  applyPreset()
}

function applyEmbeddingPreset() {
  const p = embedPresets.value.find((x) => x.value === form.embeddingsProvider)
  if (!p || !p.baseUrl) return
  form.embeddingsBaseUrl = p.baseUrl
  form.embeddingsModel = p.model
}

/** 本地 LLM 网关地址输入：一旦填写即把服务商切到 local，并把地址同步到 form.baseUrl */
function onLocalLlmUrlInput() {
  const url = form.localLlmUrl.trim()
  if (url) {
    form.provider = 'local'
    form.baseUrl = url
  }
}

/** 用后端返回的完整配置视图回填表单（apiKey 字段留空，避免明文残留） */
function syncAiForm(cfg: AiConfigVO) {
  saved.apiKeyMask = cfg.apiKeyMask || ''
  saved.configured = !!cfg.configured
  saved.embeddingsConfigured = !!cfg.embeddingsConfigured
  form.enabled = cfg.enabled
  form.provider = cfg.provider
  form.baseUrl = cfg.baseUrl
  const p = presets.value.find((x) => x.value === cfg.provider)
  if (p?.models?.length && p.models.includes(cfg.model)) {
    form.model = cfg.model
    customModel.value = ''
  } else {
    form.model = '__custom__'
    customModel.value = cfg.model || ''
  }
  form.temperature = cfg.temperature
  form.apiKey = ''
  form.embeddingsApiKey = ''
  form.embeddingsModel = cfg.embeddingsModel || ''
  form.timeoutSec = Math.round(cfg.timeoutMs / 1000)
  form.localLlmUrl = cfg.provider === 'local' ? cfg.baseUrl : ''
  form.whisperUrl = cfg.whisperUrl || ''
  form.whisperModel = cfg.whisperModel || ''
  showAdvanced.value = false
}

async function onTest() {
  if (testing.value) return
  const model = resolveModel()
  if (!form.baseUrl.trim() || (!model && form.enabled)) {
    notify('请先选择或填写模型名再测试', 'info')
    return
  }
  testing.value = true
  testState.value = null
  try {
    const r: AiPingResult = await testAiConnection({
      enabled: form.enabled,
      provider: form.provider,
      baseUrl: form.baseUrl.trim(),
      model,
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

async function saveAll() {
  if (saving.value) return
  const model = resolveModel()
  if (form.enabled && (!form.baseUrl.trim() || !model)) {
    notify('请填写 API 网关地址与模型名后再保存', 'warning')
    return
  }
  saving.value = true
  try {
    appStore.updateSettings({
      dataDir: form.dataDir.trim(),
      ai: { apiUrl: form.baseUrl.trim(), apiKey: form.apiKey, model },
    })
    await appStore.saveSettings()

    const cfg = await saveAiConfig({
      enabled: form.enabled,
      provider: form.provider,
      baseUrl: form.baseUrl.trim(),
      model,
      apiKey: form.apiKey.trim() || undefined,
      temperature: form.temperature,
      timeoutMs: Math.round(form.timeoutSec * 1000),
      embeddingsBaseUrl: form.embeddingsBaseUrl.trim(),
      embeddingsApiKey: form.embeddingsApiKey.trim() || undefined,
      embeddingsModel: form.embeddingsModel.trim(),
      whisperUrl: form.whisperUrl.trim() || undefined,
      whisperModel: form.whisperModel.trim() || undefined,
    })
    presets.value = cfg.presets || presets.value
    embedPresets.value = cfg.embeddingPresets || embedPresets.value
    syncAiForm(cfg)
    baseline.value = snapshot()
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

/* ============ 数据目录 ============ */
const picking = ref(false)
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

/* ============ 离线语音模型 ============ */
async function loadSpeech() {
  try {
    const [models, cfg] = await Promise.all([getSpeechModels(), getSpeechConfig()])
    speechModels.value = models
    speechCfg.runtime = cfg.runtime
    speechCfg.selectedModelId = cfg.selectedModelId
    speechCfg.updatedAt = cfg.updatedAt
  } catch (e) {
    notify(getApiError(e, '读取语音模型列表失败'), 'error')
  }
}

async function startDownload(id: string) {
  if (speechBusy.value) return
  speechBusy.value = true
  downloadProgress[id] = 0
  try {
    await downloadSpeechModel(id, (evt) => {
      if (evt.type === 'progress') downloadProgress[id] = evt.pct || 0
    })
    notify('模型下载完成，可离线使用', 'success')
  } catch (e) {
    notify(getApiError(e, '模型下载失败'), 'error')
  } finally {
    speechBusy.value = false
    downloadProgress[id] = 0
    await loadSpeech()
  }
}

async function removeModel(id: string) {
  try {
    await deleteSpeechModel(id)
    notify('已删除模型文件', 'success')
  } catch (e) {
    notify(getApiError(e, '删除失败'), 'error')
  }
  await loadSpeech()
}

async function saveSpeechSettings() {
  if (speechSaving.value) return
  speechSaving.value = true
  try {
    const cfg = await saveSpeechConfig({
      runtime: speechCfg.runtime,
      selectedModelId: speechCfg.selectedModelId,
    })
    speechCfg.updatedAt = cfg.updatedAt
    notify('语音识别设置已保存', 'success')
  } catch (e) {
    notify(getApiError(e, '保存失败'), 'error')
  } finally {
    speechSaving.value = false
  }
}

/* ============ 朗读嗓音（Web Speech API）============ */
async function loadTtsVoices() {
  const list = await listChineseVoices()
  ttsVoices.value = list
  ttsSelected.value = getSelectedVoiceName()
}
function onTtsVoiceChange() {
  setSelectedVoiceName(ttsSelected.value)
}
async function previewTtsVoice() {
  if (ttsPreviewing.value) {
    cancelSpeech()
    ttsPreviewing.value = false
    return
  }
  ttsPreviewing.value = true
  const sample =
    '你好，我是你的面试助手。下面请你用一分钟，介绍一下最近做过的项目，以及你在其中承担的角色。'
  await speakText(sample, { rate: 0.98, pitch: 1, sentenceGapMs: 120 })
  ttsPreviewing.value = false
}

/* ============ 语音合成引擎（系统语音 / 本地神经网络 Piper）============ */
async function loadTts() {
  try {
    const [voices, cfg] = await Promise.all([getTtsVoices(), getTtsConfig()])
    ttsVoiceList.value = voices
    ttsEngine.value = cfg.engine
    ttsSelectedVoiceId.value = cfg.selectedVoiceId
  } catch (e) {
    notify(getApiError(e, '读取 TTS 配置失败'), 'error')
  }
}
async function saveTtsEngine() {
  if (ttsSaving.value) return
  ttsSaving.value = true
  try {
    const cfg = await saveTtsConfig({
      engine: ttsEngine.value,
      selectedVoiceId: ttsSelectedVoiceId.value,
    })
    ttsEngine.value = cfg.engine
    ttsSelectedVoiceId.value = cfg.selectedVoiceId
    notify('TTS 引擎设置已保存', 'success')
  } catch (e) {
    notify(getApiError(e, '保存失败'), 'error')
  } finally {
    ttsSaving.value = false
  }
}
async function startTtsDownload(id: string) {
  if (ttsBusy.value) return
  ttsBusy.value = true
  ttsDownloadProgress[id] = 0
  try {
    await downloadTtsVoice(id, (evt) => {
      if (evt.type === 'progress') ttsDownloadProgress[id] = evt.pct || 0
    })
    notify('音色下载完成，可离线使用', 'success')
  } catch (e) {
    notify(getApiError(e, '音色下载失败'), 'error')
  } finally {
    ttsBusy.value = false
    ttsDownloadProgress[id] = 0
    await loadTts()
  }
}
async function removeTtsVoice(id: string) {
  try {
    await deleteTtsVoice(id)
    notify('已删除音色文件', 'success')
  } catch (e) {
    notify(getApiError(e, '删除失败'), 'error')
  }
  await loadTts()
}

/* ============ 数据备份 ============ */
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
async function onBackupNow() {
  if (backupBusy.value) return
  if (!appStore.backup.dir) {
    notify('请先选择备份保存目录', 'info')
    return
  }
  backupBusy.value = true
  backupMsg.value = null
  try {
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
async function onToggleAuto() {
  await persistSchedule()
}
async function onTimeChange() {
  await persistSchedule()
}
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
async function loadBackupSettings() {
  try {
    const s = await invoke<{ enabled: boolean; time: string; outDir: string }>('get_backup_schedule')
    let dir = s.outDir || ''
    if (!dir && appStore.settings.dataDir) dir = `${appStore.settings.dataDir}/backups`
    appStore.updateBackup({ dir, auto: s.enabled, time: s.time || '03:00' })
    if (dir) await persistSchedule()
  } catch {
    /* 后端未就绪：保留本地持久化值 */
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

/** 一次性载入所有后端配置（index.vue 挂载时调用，且只跑一次） */
async function loadAll() {
  if (loaded) return
  loaded = true
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
  await loadBackupSettings()
  await loadSpeech()
  await loadTts()
  await loadTtsVoices()
  baseline.value = snapshot()
}

export function useSettings() {
  return {
    // 状态
    appStore,
    form,
    saved,
    presets,
    embedPresets,
    showAdvanced,
    customModel,
    currentPreset,
    statusClass,
    statusText,
    testing,
    saving,
    testState,
    // 语音模型
    speechModels,
    speechCfg,
    speechBusy,
    speechSaving,
    downloadProgress,
    // 朗读嗓音
    ttsVoices,
    ttsSelected,
    ttsPreviewing,
    // TTS 引擎
    ttsEngine,
    ttsSelectedVoiceId,
    ttsVoiceList,
    ttsBusy,
    ttsSaving,
    ttsDownloadProgress,
    // 备份
    picking,
    pickingBackup,
    backupBusy,
    backupMsg,
    backupList,
    // 能力清单
    capabilities,
    // 守卫
    baseline,
    dirty,
    // 方法
    resolveModel,
    selectProvider,
    applyPreset,
    applyEmbeddingPreset,
    onLocalLlmUrlInput,
    syncAiForm,
    onTest,
    saveAll,
    clearKey,
    clearEmbeddingKey,
    pickDirectory,
    loadSpeech,
    startDownload,
    removeModel,
    saveSpeechSettings,
    loadTtsVoices,
    onTtsVoiceChange,
    previewTtsVoice,
    loadTts,
    saveTtsEngine,
    startTtsDownload,
    removeTtsVoice,
    persistSchedule,
    pickBackupDir,
    onBackupNow,
    onToggleAuto,
    onTimeChange,
    openBackupFolder,
    refreshBackupList,
    loadBackupSettings,
    formatSize,
    formatTime,
    loadAll,
  }
}
