/**
 * 离线语音转文字组合式函数。
 *
 * 录制走既有的 useVoiceRecorder（已处理 macOS 麦克风轨道释放与 mimeType 探测），
 * 停止后把音频交给 whisperClient（whisper.cpp WASM）本地转写，结果通过 onResult 回调
 * 回填到调用方输入框。整个过程零云依赖。
 */
import { ref } from 'vue';
import { useVoiceRecorder } from '@/composables/useVoiceRecorder';
import { transcribeAudio } from '@/lib/stt/whisperClient';

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
      const text = await transcribeAudio(rec.blob);
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
