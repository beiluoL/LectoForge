/**
 * 摄像头拍照组合式函数（桌面端「拍照」用）。
 *
 * 桌面无相机插件，走 webview 的 getUserMedia({video}) 抓帧——与移动端 §7.13.1 的
 * image_picker 不同，这里是实时摄像头预览 + 抓拍。CSP 在 tauri.conf.json 已置 null，
 * getUserMedia 可用；macOS 首次会弹系统相机授权（Info.plist 已声明
 * NSCameraUsageDescription）。
 *
 * 复用 useVoiceRecorder 的「轨道必须显式停」经验：stop() 要逐条 track.stop()，
 * 否则 macOS 摄像头指示灯不灭、且设备被占用导致下次打不开。
 */
import { onBeforeUnmount, ref } from 'vue';

function dataURLToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(head)?.[1] || 'image/png';
  const bin = atob(body);
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function useCameraCapture() {
  const stream = ref<MediaStream | null>(null);
  const error = ref('');
  const ready = ref(false);
  const supported =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  let videoEl: HTMLVideoElement | null = null;

  async function start(): Promise<boolean> {
    error.value = '';
    if (!supported) {
      error.value = '当前环境不支持摄像头';
      return false;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      stream.value = s;
      ready.value = true;
      if (videoEl) videoEl.srcObject = s;
      return true;
    } catch (e) {
      const name = typeof e === 'object' && e !== null && 'name' in e ? String(e.name) : '';
      error.value =
        name === 'NotAllowedError'
          ? '摄像头被拒绝：请在「系统设置 → 隐私与安全性 → 摄像头」中允许本应用'
          : '无法访问摄像头，请检查设备是否可用';
      return false;
    }
  }

  /** 供模板里的 <video> 绑定；在 start() 之后调用以挂载流 */
  function bindVideo(el: HTMLVideoElement | null) {
    videoEl = el;
    if (el && stream.value) el.srcObject = stream.value;
  }

  /** 抓一帧为 PNG Blob；未就绪返回 null */
  function capture(): Blob | null {
    if (!videoEl || !ready.value) return null;
    const v = videoEl;
    const w = v.videoWidth || 640;
    const h = v.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, w, h);
    return dataURLToBlob(canvas.toDataURL('image/png'));
  }

  function stop() {
    stream.value?.getTracks().forEach((t) => t.stop());
    stream.value = null;
    ready.value = false;
    if (videoEl) videoEl.srcObject = null;
  }

  onBeforeUnmount(stop);

  return { stream, error, ready, supported, start, bindVideo, capture, stop };
}
