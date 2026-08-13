/**
 * 离线语音转文字组合式函数（笔记速记 / 收集箱 / 笔记编辑通用）。
 *
 * 录制走既有的 useVoiceRecorder（已处理 macOS 麦克风轨道释放与 mimeType 探测），
 * 停止后把音频交给 sttDispatch 统一转写——默认走后端 whisper-server 侧车（native，
 * Metal 加速、速度快），若用户在「设置 → 本地模型」选了 wasm 则回落前端 worker。
 * 与离线模拟面试共用同一条已验证链路、同一份模型、同一套重试兜底。整个过程零云依赖。
 */
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useVoiceRecorder } from '@/composables/useVoiceRecorder';
import { transcribe } from '@/lib/stt/sttDispatch';
import { confirmDialog } from '@/utils/toast';

export interface SpeechToTextOptions {
  /** 识别成功后的文本（已 trim） */
  onResult: (text: string) => void;
  /** 失败 / 无识别结果时的兜底提示（模型未下载类错误会被「去设置」对话框接管） */
  onError?: (message: string) => void;
}

/**
 * 判断转写错误是否由「WASM 运行方式下模型尚未下载」引起。
 * sttDispatch 抛出的文案固定含「语音模型」且点名「尚未下载 / 未找到」，
 * 这类错误不是偶发故障，而是需要用户去设置页下载，故单独接管为可操作对话框。
 */
function isModelNotDownloaded(msg: string): boolean {
  return msg.includes('语音模型') && (msg.includes('尚未下载') || msg.includes('未找到'));
}

/** 跳转设置页后，轮询把「本地模型」卡片滚到视野中央（不依赖路由 scrollBehavior） */
function scrollToLocalModelCard(): void {
  let tries = 0;
  const tick = () => {
    const el = document.getElementById('local-model');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (tries++ < 30) window.setTimeout(tick, 50);
  };
  window.setTimeout(tick, 50);
}

export function useSpeechToText(options: SpeechToTextOptions) {
  const router = useRouter();
  const recorder = useVoiceRecorder();
  const transcribing = ref(false);
  const lastError = ref('');

  async function stopAndTranscribe() {
    const rec = await recorder.stop();
    if (!rec) return;
    transcribing.value = true;
    lastError.value = '';
    try {
      const { text } = await transcribe(rec.blob);
      if (text && text.trim()) options.onResult(text.trim());
      else options.onError?.('未识别到语音内容，请靠近麦克风重试');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '语音转文字失败';
      lastError.value = msg;
      // 模型未下载：用可操作的对话框把它接好 UI 反馈，并给一键跳设置入口
      if (isModelNotDownloaded(msg)) {
        const go = await confirmDialog(
          `${msg}\n\n是否前往「设置 → 本地模型」下载该模型？`,
        );
        if (go) {
          void router.push('/settings#local-model');
          scrollToLocalModelCard();
          return;
        }
        // 用户取消：对话框已完整传达信息，不再重复 toast
        return;
      }
      options.onError?.(msg);
    } finally {
      transcribing.value = false;
    }
  }

  /** 录音中则停止并转写；未录音则开始录音 */
  async function toggle() {
    if (recorder.recording.value) {
      await stopAndTranscribe();
    } else {
      await recorder.start();
    }
  }

  return {
    ...recorder,
    transcribing,
    lastError,
    toggle,
    stopAndTranscribe,
  };
}
