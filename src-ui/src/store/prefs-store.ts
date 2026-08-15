/**
 * usePrefsStore —— 设置中心「本地 UI 偏好」状态（无后端，纯前端持久化）
 *
 * 与 appStore（数据目录 / AI Key 等后端权威配置）区分：本 store 承载的是
 * 「本机显示与交互偏好」——主题、主题色、字号缩放、紧凑模式、通知开关、
 * 快捷键绑定、数据同步表单草稿等。这些项没有后端契约，落 localStorage 即可，
 * 且多为「即时生效」，不需要像后端配置那样「保存前确认未改动」。
 *
 * 设计令牌红线：所有颜色改动一律通过修改 :root 的 --kb-* 变量实现，
 * 绝不在这层写死十六进制色值（accentColor 例外——它是用户自定义主题色，
 * 本身就是被写入 --kb-primary 的值）。
 */
import { defineStore } from 'pinia'
import { reactive, ref, watch } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'
export type LocaleMode = 'zh-CN' | 'en-US'
export type ProxyMode = 'system' | 'manual' | 'off'
export type NavPosition = 'left' | 'top'

export interface NotificationPrefs {
  review: { enabled: boolean; time: string }
  task: { enabled: boolean; time: string }
  habit: { enabled: boolean; time: string }
  calendar: { enabled: boolean; minutesBefore: number }
  dnd: { enabled: boolean; from: string; to: string }
}

export interface SyncPrefs {
  enabled: boolean
  webdav: { url: string; username: string; password: string }
  scope: string[]
  autoSync: boolean
}

/** 主题色预设（写入 --kb-primary；文案对应 lucide 图标语义） */
export const ACCENT_PRESETS: { value: string; label: string }[] = [
  { value: '#3B6FE0', label: '蓝' },
  { value: '#10B981', label: '绿' },
  { value: '#8B5CF6', label: '紫' },
  { value: '#F59E0B', label: '橙' },
  { value: '#EF4444', label: '红' },
  { value: '#06B6D4', label: '青' },
  { value: '#EC4899', label: '粉' },
  { value: '#64748B', label: '灰' },
]

/** 字号缩放档位（相对设计稿 14px 基准的倍数） */
export const FONT_SCALE_OPTIONS = [0.875, 1, 1.125, 1.25] as const

/** 默认快捷键绑定（显示用修饰键组合） */
export const DEFAULT_SHORTCUTS: Record<string, string[]> = {
  'quick-capture': ['⌥', '⇧', 'N'],
  'toggle-pomodoro': ['⌥', '⇧', 'P'],
  'screenshot-ocr': ['⌥', '⇧', 'S'],
  'toggle-main-window': ['⌥', '⇧', 'Space'],
  'global-search': ['⌘', 'K'],
}

/** 各快捷键的展示名与说明（冲突检测用的内置保留键，避免与系统冲突） */
export const SHORTCUT_META: { key: string; label: string; desc: string; reserved?: string[] }[] = [
  { key: 'quick-capture', label: '唤起快速收集箱', desc: '随时记下灵感与素材' },
  { key: 'toggle-pomodoro', label: '启停番茄钟', desc: '开始 / 暂停专注计时' },
  { key: 'screenshot-ocr', label: '截图 OCR', desc: '截屏并识别文字入库' },
  { key: 'toggle-main-window', label: '显示 / 隐藏主窗口', desc: '全局显隐应用' },
  { key: 'global-search', label: '全局搜索', desc: '跨收集箱 / 笔记 / 故事检索' },
]

/** 字号基准（设计稿 token 原始 px），用于按 scale 实时换算后写回 --kb-fs-* */
const FS_BASE: Record<string, number> = {
  '--kb-fs-h1': 40,
  '--kb-fs-h2': 32,
  '--kb-fs-h3': 24,
  '--kb-fs-h4': 20,
  '--kb-fs-body-lg': 16,
  '--kb-fs-body-md': 14,
  '--kb-fs-body-sm': 13,
  '--kb-fs-caption': 12,
  '--kb-fs-xs': 11,
}

function defaultPrefs() {
  return {
    locale: 'zh-CN' as LocaleMode,
    theme: 'system' as ThemeMode,
    accentColor: '#3B6FE0',
    fontScale: 1 as number,
    compactMode: false,
    navPosition: 'left' as NavPosition,
    transparentWindow: false,
    // 通用
    proxyMode: 'system' as ProxyMode,
    spellCheck: true,
    hardwareAccel: true,
    autoStart: false,
    minimizeToTray: false,
    showTrayIcon: true,
    // 通知
    notifications: {
      review: { enabled: true, time: '09:00' },
      task: { enabled: true, time: '09:00' },
      habit: { enabled: true, time: '21:00' },
      calendar: { enabled: true, minutesBefore: 15 },
      dnd: { enabled: false, from: '22:00', to: '08:00' },
    } as NotificationPrefs,
    // 快捷键（每项为修饰键数组）
    shortcuts: JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS)) as Record<string, string[]>,
    // 数据同步草稿
    sync: {
      enabled: false,
      webdav: { url: '', username: '', password: '' },
      scope: ['notes', 'review', 'tasks', 'habits', 'calendar'],
      autoSync: false,
    } as SyncPrefs,
  }
}

export const usePrefsStore = defineStore('prefs', () => {
  const p = defaultPrefs()
  const locale = ref(p.locale)
  const theme = ref(p.theme)
  const accentColor = ref(p.accentColor)
  const fontScale = ref(p.fontScale)
  const compactMode = ref(p.compactMode)
  const navPosition = ref(p.navPosition)
  const transparentWindow = ref(p.transparentWindow)
  const proxyMode = ref(p.proxyMode)
  const spellCheck = ref(p.spellCheck)
  const hardwareAccel = ref(p.hardwareAccel)
  const autoStart = ref(p.autoStart)
  const minimizeToTray = ref(p.minimizeToTray)
  const showTrayIcon = ref(p.showTrayIcon)
  const notifications = reactive<NotificationPrefs>(p.notifications)
  const shortcuts = reactive<Record<string, string[]>>(p.shortcuts)
  const sync = reactive<SyncPrefs>(p.sync)

  /** 解析 system 主题到具体 light / dark */
  function resolveTheme(): 'light' | 'dark' {
    if (theme.value === 'system') {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return theme.value
  }

  /** 应用主题色：写入 --kb-primary 及一组派生令牌（均用 color-mix 引用，不写死 alpha） */
  function applyAccent() {
    const root = document.documentElement
    root.style.setProperty('--kb-primary', accentColor.value)
    root.style.setProperty('--kb-ring', accentColor.value)
    root.style.setProperty(
      '--kb-primary-soft',
      `color-mix(in srgb, ${accentColor.value} 10%, transparent)`,
    )
    root.style.setProperty(
      '--kb-primary-foreground',
      '#FFFFFF',
    )
  }

  /** 应用字号缩放：把 --kb-fs-* 令牌按比例换算写回 :root */
  function applyFontScale() {
    const root = document.documentElement
    for (const [token, base] of Object.entries(FS_BASE)) {
      root.style.setProperty(token, `${Math.round(base * fontScale.value)}px`)
    }
  }

  /** 应用主题 + 紧凑模式（统一入口，App 挂载时调用一次） */
  function applyAppearance() {
    const root = document.documentElement
    root.setAttribute('data-theme', resolveTheme())
    applyAccent()
    applyFontScale()
    root.classList.toggle('kb-compact', compactMode.value)
  }

  // 响应式联动：任一偏好变化即实时写回 DOM，无需点「保存」
  watch(theme, () => {
    document.documentElement.setAttribute('data-theme', resolveTheme())
  })
  watch(accentColor, applyAccent)
  watch(fontScale, applyFontScale)
  watch(compactMode, (v) => document.documentElement.classList.toggle('kb-compact', v))

  /** 重置快捷键到默认绑定 */
  function resetShortcuts() {
    for (const k of Object.keys(shortcuts)) {
      shortcuts[k] = [...(DEFAULT_SHORTCUTS[k] || [])]
    }
  }

  return {
    locale,
    theme,
    accentColor,
    fontScale,
    compactMode,
    navPosition,
    transparentWindow,
    proxyMode,
    spellCheck,
    hardwareAccel,
    autoStart,
    minimizeToTray,
    showTrayIcon,
    notifications,
    shortcuts,
    sync,
    resolveTheme,
    applyAppearance,
    applyAccent,
    applyFontScale,
    resetShortcuts,
  }
})
