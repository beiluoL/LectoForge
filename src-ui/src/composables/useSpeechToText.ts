/**
 * 离线语音转文字组合式函数（笔记速记 / 收集箱 / 笔记编辑通用）。
 *
 * 录制走既有的 useVoiceRecorder（已处理 macOS 麦克风轨道释放与 mimeType 探测），
 * 停止后把音频交给 sttDispatch 统一转写——默认走后端 whisper-server 侧车（native，
 * Metal 加速、速度快），若用户在「设置 → 本地模型」选了 wasm 则回落前端 worker。
 * 与离线模拟面试共用同一条已验证链路、同一份模型、同一套重试兜底。整个过程零云依赖。
 */
import { ref } from 'vue';
import { useVoiceRecorder } from '@/composables/useVoiceRecorder';
import { transcribe } from '@/lib/stt/sttDispatch';

export interface SpeechToTextOptions {
  /** 识别成功后的文本（已 trim） */
  onResult: (text: string) => void;
  /** 失败 / 无识别结果时的提示 */
  onError?: (message: string) => void;
}

export function useSpeechToText(options: SpeechToTextOptions) {
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
