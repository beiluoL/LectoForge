/**
 * useOcrShortcutStore —— OCR 全局快捷键（系统级）配置与注册
 *
 * 与 Settings/ShortcutSection 里的「应用内快捷键」（prefs-store.shortcuts，仅窗口聚焦时生效）
 * 不同，这里是**系统级全局快捷键**：应用失焦甚至最小化到托盘时仍可触发 OCR 截图识别。
 * 借助 Tauri 的 global-shortcut 插件在 JS 侧注册，每个快捷键可独立配置行为模式：
 * - 'hide'   先自动隐藏主窗口再截图识别，识别完成后恢复窗口原有显示状态（默认，避免把本应用截进去）
 * - 'direct' 直接截图识别（不隐藏窗口）
 *
 * 数据持久化：shortcuts 列表落 localStorage（pinia-plugin-persistedstate），应用重启后
 * 由 App.vue 挂载时调用 init() 重新注册。
 *
 * 异常兜底：注册失败（macOS 缺「输入监视」权限等）按 id 记录到 regErrors，由设置页展示提示，
 * 不阻断应用启动；浏览器预览态下插件不可用则静默跳过。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  register,
  unregisterAll,
} from '@tauri-apps/plugin-global-shortcut'
import { notify } from '@/utils/toast'
import { useGlobalOcrStore } from './ocr-controller'

export type OcrShortcutBehavior = 'hide' | 'direct'

export interface OcrShortcut {
  id: string
  /** Tauri 加速器格式，如 "Command+Shift+O" */
  combo: string
  /** 'hide' 隐藏窗口后截图；'direct' 直接截图 */
  behavior: OcrShortcutBehavior
}

/** 默认提供一个全局 OCR 快捷键：⌘+Shift+O，隐藏窗口后截图 */
const DEFAULT_SHORTCUTS: OcrShortcut[] = [
  { id: 'default', combo: 'Command+Shift+O', behavior: 'hide' },
]

let uid = 0
function genId(): string {
  uid += 1
  return `ocr-${Date.now().toString(36)}-${uid}`
}

/** Tauri 加速器修饰键 → 显示符号（macOS 用 ⌘⌃⌥⇧） */
const DISP_MOD: Record<string, string> = {
  Command: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
}

/** 把 "Command+Shift+O" 拆成 ['⌘','⇧','O'] 供 UI 展示 */
export function acceleratorToDisplay(acc: string): string[] {
  if (!acc) return []
  return acc.split('+').map((t) => DISP_MOD[t] ?? t)
}

/** 从一次 keydown 事件构造 Tauri 加速器字符串；纯修饰键返回 null（无效） */
export function eventToAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = []
  if (e.metaKey) mods.push('Command')
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  // 仅按下修饰键本身（Meta/Control/Alt/Shift）不算有效绑定
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null
  let key = e.key
  if (key === ' ') key = 'Space'
  if (key.length === 1) key = key.toUpperCase()
  if (!key) return null
  // 至少需一个修饰键：系统级全局快捷键不允许裸键
  if (mods.length === 0) return null
  return [...mods, key].join('+')
}

const VALID_MODS = ['Command', 'Control', 'Alt', 'Shift']

/** 把注册异常翻译成用户可读中文；含权限相关关键词时给出授权引导 */
function mapRegisterError(e: unknown): string {
  const msg = String((e as Error)?.message || e || '')
  const lower = msg.toLowerCase()
  if (
    lower.includes('permission') ||
    lower.includes('input monitoring') ||
    lower.includes('accessibility') ||
    lower.includes('authorized') ||
    lower.includes('denied') ||
    lower.includes('event tap') ||
    lower.includes('cgerr') ||
    lower.includes('could not')
  ) {
    return '注册失败：可能缺少「输入监视」权限，请在系统设置 › 隐私与安全性中授权 LectoForge 后重试'
  }
  return '注册失败：' + (msg || '未知错误')
}

export const useOcrShortcutStore = defineStore('ocr-shortcuts', () => {
  const shortcuts = ref<OcrShortcut[]>(DEFAULT_SHORTCUTS.map((s) => ({ ...s })))
  /** 每个快捷键的注册错误（权限缺失 / 冲突 / 非法），key = 快捷键 id */
  const regErrors = ref<Record<string, string>>({})
  /** 插件是否可用（浏览器预览态为 false） */
  const pluginAvailable = ref(true)

  /** 校验组合键：空 / 无修饰键 / 仅修饰键 / 与他人冲突 → 返回中文错误，否则 null */
  function validateCombo(combo: string, excludeId?: string): string | null {
    if (!combo) return '请录制按键组合'
    const tokens = combo.split('+')
    const key = tokens[tokens.length - 1]
    const mods = tokens.slice(0, -1)
    if (mods.length === 0) return '全局快捷键必须包含修饰键（⌘ / ⌃ / ⌥ / ⇧）'
    if (VALID_MODS.includes(key)) return '不能只用修饰键作为快捷键'
    const hit = shortcuts.value.find((s) => s.combo === combo && s.id !== excludeId)
    if (hit) return '该组合键已被其它快捷键占用'
    return null
  }

  function addShortcut(combo = '', behavior: OcrShortcutBehavior = 'hide'): string {
    const id = genId()
    shortcuts.value.push({ id, combo, behavior })
    void reRegister()
    return id
  }

  function removeShortcut(id: string) {
    shortcuts.value = shortcuts.value.filter((s) => s.id !== id)
    delete regErrors.value[id]
    void reRegister()
  }

  function updateShortcut(id: string, patch: Partial<Omit<OcrShortcut, 'id'>>) {
    const s = shortcuts.value.find((x) => x.id === id)
    if (!s) return
    Object.assign(s, patch)
    void reRegister()
  }

  /** 取消全部注册后按当前列表逐一重注册，保证运行时与配置一致 */
  async function reRegister() {
    try {
      await unregisterAll()
    } catch {
      /* 插件不可用或尚未注册：忽略，继续尝试注册当前列表 */
    }
    regErrors.value = {}
    for (const s of shortcuts.value) {
      if (!s.combo) continue
      try {
        await register(s.combo, () => {
          const def = shortcuts.value.find((x) => x.combo === s.combo)
          useGlobalOcrStore().openCapture(def?.behavior ?? 'hide')
        })
      } catch (e) {
        regErrors.value[s.id] = mapRegisterError(e)
      }
    }
    pluginAvailable.value = true
  }

  /** 应用启动时调用：尝试注册全部快捷键；失败仅标记，不阻断启动 */
  async function init() {
    try {
      await reRegister()
    } catch (e) {
      pluginAvailable.value = false
      notify('全局快捷键当前不可用：' + mapRegisterError(e), 'warning')
    }
  }

  return {
    shortcuts,
    regErrors,
    pluginAvailable,
    acceleratorToDisplay,
    validateCombo,
    addShortcut,
    removeShortcut,
    updateShortcut,
    reRegister,
    init,
  }
})
