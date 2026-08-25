/**
 * useGlobalOcrStore —— 全局 OCR 截图识别控制器（系统级快捷键 / 托盘入口共用）
 *
 * 负责把「触发」翻译成完整的截图识别流程，并驱动 App 根挂载的全局 OcrModal：
 *   1. 按行为模式：'hide' 先隐藏主窗口（避免把本应用截进图里），'direct' 不隐藏；
 *   2. 调 captureScreenshot() 拉起 macOS 交互式框选；用户取消 → 静默恢复窗口并返回；
 *   3. 截图失败（最常见是「屏幕录制」权限缺失）→ 提示授权并恢复窗口；
 *   4. 拿到图片后恢复窗口显示（否则结果弹窗无窗口承载），把 Blob 交给全局 OcrModal 直接识别。
 *
 * 复用 OcrModal 组件与 ocrClient.recognizeText 完整管线（含预览、错误分类、可编辑结果、确认），
 * 与收集箱内的 OCR 走同一套识别逻辑，仅「确认后去哪」不同（全局场景：复制到剪贴板）。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { captureScreenshot } from '@/lib/screenshot'
import { notify, getApiError } from '@/utils/toast'

/** macOS「屏幕录制」系统设置面板 URL（隐私与安全性 › 屏幕录制），供 open_external_url 直达 */
const SCREEN_RECORDING_PANEL_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

export const useGlobalOcrStore = defineStore('ocr-global', () => {
  /** 全局 OcrModal 是否可见 */
  const visible = ref(false)
  /** 待识别图片（由 openCapture 在截图后填入，OcrModal 监听后直接 runOcr） */
  const pendingBlob = ref<Blob | null>(null)

  /**
   * 触发一次全局 OCR 截图识别。
   * @param behavior 'hide' 隐藏窗口后截图（默认）；'direct' 直接截图
   */
  async function openCapture(behavior: 'hide' | 'direct' = 'hide') {
    // 重要：进入即清空旧的 pendingBlob，杜绝「上一次截图残留图片」在新的 OCR 弹窗中复用——
    // OcrModal 的 watch ([modelValue, pendingBlob]) 看到同一 Blob 引用会被 ranFor 防重复逻辑
    // 短路，导致新截图失败/取消时仍展示旧图。先置空让 OcrModal 回到 pick 步，待新截图到位再赋值。
    pendingBlob.value = null

    if (behavior === 'hide') {
      try {
        const w = getCurrentWindow()
        await w.hide()
      } catch {
        /* 浏览器预览态：无原生窗口，忽略 */
      }
    }

    let blob: Blob | null = null
    try {
      blob = await captureScreenshot()
    } catch (e) {
      const msg = getApiError(e, '')
      if (msg.includes('SCREEN_RECORDING_DENIED_DEV')) {
        // 开发模式特有：当前进程是 cargo / tauri-cli / terminal 启动的开发进程，
        // 不在 .app bundle 内。系统设置里勾选的 LectoForge.app 授权记录不会继承。
        // 首次触发时 Rust 已主动调 CGRequestScreenCaptureAccess（会弹系统授权框），
        // 若是用户首次授权被拒或重启后状态变化，重启应用会再次触发弹窗。
        notify(
          '开发模式未获屏幕录制权限：当前进程不在 .app bundle 内。请重启应用重新触发系统授权弹窗，或在系统设置中找到当前终端/IDE 手动授权。',
          'error',
          8000,
        )
      } else if (msg.includes('SCREEN_RECORDING_DENIED')) {
        // 屏幕录制权限缺失：screencapture 会「穿透」到桌面壁纸（其他窗口内容被 TCC 过滤）。
        // 提示授权路径，并直接打开系统设置面板。授权后需重启应用才生效（TCC 变更不热加载）。
        notify(
          '未获得「屏幕录制」权限：已打开系统设置，请勾选 LectoForge 后完全退出并重新启动应用',
          'error',
          6000,
        )
        void invoke('open_external_url', { url: SCREEN_RECORDING_PANEL_URL })
      } else if (
        msg.includes('屏幕录制') ||
        msg.toLowerCase().includes('screen') ||
        msg.includes('内容为空')
      ) {
        notify('截图失败：请先在「系统设置 › 隐私与安全性 › 屏幕录制」中授权 LectoForge', 'error')
      } else {
        notify('截图失败：' + msg, 'error')
      }
    }

    // 不论成功与否，先恢复窗口显示（截图失败也已无意义继续隐藏）
    if (behavior === 'hide') {
      try {
        const w = getCurrentWindow()
        await w.show()
        await w.setFocus()
      } catch {
        /* 忽略 */
      }
    }

    if (!blob) {
      // 截图失败 / 取消：清空状态、不弹窗（避免 OcrModal 因 pendingBlob 不变仍展示上次的 ranFor 内容）
      pendingBlob.value = null
      visible.value = false
      return
    }
    pendingBlob.value = blob
    visible.value = true
  }

  /** 关闭全局弹窗并清理待识别图片 */
  function close() {
    visible.value = false
    pendingBlob.value = null
  }

  return { visible, pendingBlob, openCapture, close }
})
