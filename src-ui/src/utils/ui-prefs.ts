/**
 * UI 偏好（主题 / 强调色 / 紧凑模式）：localStorage 持久化 + 即时应用。
 * 存储位置与 app-store 的 pinia persistedstate 共用 key（kf:app），
 * 启动时由 main.ts 直接读取应用，避免依赖 store 水合时序。
 */
export type ThemePref = 'light' | 'dark' | 'system'
export type AccentPref = 'blue' | 'indigo' | 'purple' | 'green' | 'orange' | 'pink'

export interface UiPrefs {
  theme: ThemePref
  accent: AccentPref
  compact: boolean
}

export const DEFAULT_UI_PREFS: UiPrefs = { theme: 'system', accent: 'blue', compact: false }

const APP_KEY = 'kf:app'
const THEMES: ThemePref[] = ['light', 'dark', 'system']
const ACCENTS: AccentPref[] = ['blue', 'indigo', 'purple', 'green', 'orange', 'pink']

export function readUiPrefs(): UiPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(APP_KEY) ?? '{}')
    const ui = raw?.settings?.ui ?? {}
    return {
      theme: THEMES.includes(ui.theme) ? ui.theme : 'system',
      accent: ACCENTS.includes(ui.accent) ? ui.accent : 'blue',
      compact: !!ui.compact,
    }
  } catch {
    return { ...DEFAULT_UI_PREFS }
  }
}

export function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(theme: ThemePref): void {
  document.documentElement.dataset.theme = theme === 'system' ? (systemDark() ? 'dark' : 'light') : theme
}

export function applyAccent(accent: AccentPref): void {
  document.documentElement.dataset.accent = accent
}

export function applyDensity(compact: boolean): void {
  if (compact) document.documentElement.dataset.density = 'compact'
  else delete document.documentElement.dataset.density
}

export function applyUiPrefs(prefs: UiPrefs): void {
  applyTheme(prefs.theme)
  applyAccent(prefs.accent)
  applyDensity(prefs.compact)
}
