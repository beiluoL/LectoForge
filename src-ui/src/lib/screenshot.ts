import { invoke } from '@tauri-apps/api/core';

/**
 * 拉起系统交互式截图（macOS 内置 screencapture 框选），返回 PNG Blob。
 *
 * - 用户取消（按 ESC）→ 返回 null；
 * - 其它错误（如未授权「屏幕录制」）→ 向上抛出，由调用方提示。
 *
 * 统一收敛「截图识别 / 截图插入」两条链路对底层 Tauri 命令的调用，避免各处
 * 重复 base64 解码逻辑。命令实现见 src-tauri/src/lib.rs 的 capture_screenshot。
 */
export async function captureScreenshot(): Promise<Blob | null> {
  let b64: string;
  try {
    b64 = await invoke<string>('capture_screenshot');
  } catch (e) {
    const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : '';
    // 用户取消（Rust 侧返回 Err("cancelled")）时静默处理
    if (msg.includes('cancelled')) return null;
    throw e;
  }
  if (!b64) return null;
  const bin = atob(b64);
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: 'image/png' });
}
