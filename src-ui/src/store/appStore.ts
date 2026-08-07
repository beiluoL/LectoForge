/**
 * useAppStore —— 应用外壳全局状态（新手引导 + 全局设置中心）
 *
 * 状态
 * - hasOnboarded：是否已完成首次引导。初始值由 pinia-plugin-persistedstate 从 localStorage 同步水合，
 *   随后在 App.vue 挂载时由 initFromBackend() 与后端 /api/config 对齐（后端为权威来源）。
 * - settings：{ dataDir, ai: { apiUrl, apiKey, model } }。数据目录 + AI 网关参数。
 *
 * Actions
 * - initFromBackend()：拉取 /api/config 覆盖本地（后端权威）；后端未就绪时静默保留本地持久化值。
 * - updateSettings(patch)：局部更新设置（供设置中心 / 引导页表单双向绑定后写回）。
 * - completeOnboarding()：调用 /api/config/init 落盘，成功后置 hasOnboarded=true 并清空本地明文 Key。
 *
 * 安全约定：明文 apiKey 绝不写入 localStorage —— 见文件底部 persist.pick，只持久化引导状态、
 * 数据目录与非密的 apiUrl / model；真正的 Key 只存后端 ai-config.json（权限 600）。
 *
 * 组件用法
 * ```ts
 * import { storeToRefs } from 'pinia'
 * import { useAppStore } from '@/store/appStore'
 * const store = useAppStore()
 * const { hasOnboarded, settings } = storeToRefs(store)
 * const { completeOnboarding, updateSettings } = store
 * ```
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAppConfig, initAppConfig } from '@/api/config'

/** AI 网关参数（引导页 Step 2 / 设置中心共用） */
export interface AiSettings {
  apiUrl: string
  apiKey: string
  model: string
}

/** 应用设置聚合体 */
export interface AppSettings {
  dataDir: string
  ai: AiSettings
}

/** 默认 AI 参数：与后端 llm.ts 的 DeepSeek 预设一致（引导页默认值即取自此处） */
function defaultSettings(): AppSettings {
  return {
    dataDir: '',
    ai: {
      apiUrl: 'https://api.deepseek.com',
      apiKey: '',
      model: 'deepseek-chat',
    },
  }
}

export const useAppStore = defineStore(
  'app',
  () => {
    /** 是否已完成首次引导（初值 false，由 localStorage 水合 + 后端对齐） */
    const hasOnboarded = ref<boolean>(false)

    /** 应用设置 */
    const settings = ref<AppSettings>(defaultSettings())

    /** initFromBackend 是否已执行完成（守卫可据此避免重复请求；非必须） */
    const initialized = ref<boolean>(false)

    /**
     * 与后端 /api/config 对齐（后端为权威来源）。
     * 后端不可用（首启侧车未就绪 / 浏览器预览）时静默保留本地持久化值，不打断引导流程。
     */
    async function initFromBackend(): Promise<void> {
      try {
        const cfg = await getAppConfig()
        hasOnboarded.value = cfg.hasOnboarded
        if (cfg.dataDir) settings.value.dataDir = cfg.dataDir
        if (cfg.ai) {
          if (cfg.ai.baseUrl) settings.value.ai.apiUrl = cfg.ai.baseUrl
          if (cfg.ai.model) settings.value.ai.model = cfg.ai.model
          // apiKey 仅后端持有明文，这里不回写；表单以「已保存」占位提示是否已配置
        }
      } catch {
        /* 后端未就绪：保留 localStorage 水合的本地值 */
      } finally {
        initialized.value = true
      }
    }

    /** 局部更新设置（引导页 / 设置中心表单写回） */
    function updateSettings(patch: Partial<AppSettings>): void {
      if (patch.dataDir !== undefined) settings.value.dataDir = patch.dataDir
      if (patch.ai) settings.value.ai = { ...settings.value.ai, ...patch.ai }
    }

    /**
     * 把数据目录 + AI 参数 + hasOnboarded 提交后端落盘（引导完成 / 设置保存共用内核）。
     * 成功后以后端回显为准更新本地状态，并清空内存里的明文 Key（已交后端保管）。
     * @param markOnboarded 本次提交后 hasOnboarded 的目标值
     */
    async function persistConfig(markOnboarded: boolean): Promise<void> {
      const res = await initAppConfig({
        dataDir: settings.value.dataDir,
        aiSettings: {
          apiUrl: settings.value.ai.apiUrl.trim(),
          apiKey: settings.value.ai.apiKey.trim(),
          model: settings.value.ai.model.trim(),
        },
        hasOnboarded: markOnboarded,
      })
      hasOnboarded.value = res.hasOnboarded
      if (res.dataDir) settings.value.dataDir = res.dataDir
      if (res.ai?.model) settings.value.ai.model = res.ai.model
      if (res.ai?.baseUrl) settings.value.ai.apiUrl = res.ai.baseUrl
      // 明文 Key 已落后端，内存态清空避免残留
      settings.value.ai.apiKey = ''
    }

    /** 完成首次引导：强制把 hasOnboarded 置为已完成 */
    function completeOnboarding(): Promise<void> {
      return persistConfig(true)
    }

    /** 设置中心保存：保持当前 hasOnboarded 不变（避免把已完成的引导状态回退） */
    function saveSettings(): Promise<void> {
      return persistConfig(hasOnboarded.value)
    }

    return {
      hasOnboarded,
      settings,
      initialized,
      initFromBackend,
      updateSettings,
      completeOnboarding,
      saveSettings,
    }
  },
  {
    // 明文 apiKey 不落 localStorage：仅持久化引导状态、数据目录与非密的 apiUrl / model
    persist: {
      key: 'kf:app',
      storage: localStorage,
      pick: ['hasOnboarded', 'settings.dataDir', 'settings.ai.apiUrl', 'settings.ai.model'],
    },
  },
)
