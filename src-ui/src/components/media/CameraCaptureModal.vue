<script setup lang="ts">
/**
 * 拍照弹窗：webview 摄像头实时预览 → 抓拍一帧 → 以 PNG Blob 回传。
 * 复用了 useCameraCapture 的 getUserMedia 逻辑（含 macOS 摄像头轨道释放）。
 */
import { ref, watch, onUnmounted } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import { useCameraCapture } from '@/composables/useCameraCapture';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  captured: [blob: Blob];
}>();

const cam = useCameraCapture();
const videoWrap = ref<HTMLElement | null>(null);
const shotPreview = ref<string | null>(null);

function close() {
  cam.stop();
  shotPreview.value = null;
  emit('update:modelValue', false);
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      shotPreview.value = null;
      await cam.start();
    } else {
      cam.stop();
    }
  },
);

function onVideoMounted(el: any) {
  cam.bindVideo(el);
}

function takePhoto() {
  const blob = cam.capture();
  if (!blob) return;
  shotPreview.value = URL.createObjectURL(blob);
  cam.stop();
  // 短暂预览后回传（用户可见已拍画面）
  emit('captured', blob);
  close();
}

onUnmounted(() => cam.stop());
</script>

<template>
  <div v-if="modelValue" class="cam-overlay" @click.self="close">
    <div class="cam-modal">
      <div class="cam-head">
        <span><Icon name="camera" :size="15" /> 拍照</span>
        <button class="cam-close" @click="close" aria-label="关闭">
          <Icon name="x" :size="16" />
        </button>
      </div>

      <div ref="videoWrap" class="cam-stage">
        <video
          v-if="!shotPreview"
          class="cam-video"
          autoplay
          playsinline
          muted
          ref="videoEl"
          @vue:mounted="onVideoMounted($event)"
        ></video>
        <img v-else :src="shotPreview" class="cam-preview" alt="拍摄预览" />
        <p v-if="cam.error.value" class="cam-error">{{ cam.error.value }}</p>
        <p v-else-if="!cam.ready.value && !shotPreview" class="cam-hint">正在打开摄像头…</p>
      </div>

      <div class="cam-actions">
        <button class="kb-btn wb-ghost-btn" @click="close">取消</button>
        <button class="kb-btn kb-btn-primary" :disabled="!cam.ready.value" @click="takePhoto">
          <Icon name="camera" :size="14" /> 拍照
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cam-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.cam-modal {
  width: min(520px, 92vw);
  background: var(--kb-surface, #fff);
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}
.cam-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--kb-border, #e5e7eb);
  font-weight: 600;
}
.cam-head > span {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cam-close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--kb-text-muted, #6b7280);
}
.cam-stage {
  position: relative;
  background: #0b0f1a;
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cam-video,
.cam-preview {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
}
.cam-hint,
.cam-error {
  position: absolute;
  color: #cbd5e1;
  font-size: 13px;
  padding: 0 16px;
  text-align: center;
}
.cam-error {
  color: #fca5a5;
}
.cam-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--kb-border, #e5e7eb);
}
</style>
