<script setup lang="ts">
/**
 * OCR 扫描弹窗：来源 = 截图（capture_screenshot 命令，系统交互式框选）或 选图（文件选择器）。
 * 拿到图片后走 ocrClient.recognizeText（tesseract.js 主，中文优先，完全离线），
 * 结果进入可编辑文本框（OCR 常有错字，先让人在确认前修正），确认后回传文本。
 * 对齐移动端 §7.16 的「截图 / 选图」双入口。
 */
import { ref } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import { recognizeText } from '@/lib/ocr/ocrClient';
import { captureScreenshot } from '@/lib/screenshot';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirmed: [text: string];
}>();

const busy = ref(false);
const error = ref('');
const text = ref('');
const step = ref<'pick' | 'result'>('pick');
const fileInput = ref<HTMLInputElement | null>(null);

function close() {
  busy.value = false;
  text.value = '';
  error.value = '';
  step.value = 'pick';
  emit('update:modelValue', false);
}

async function runOcr(blob: Blob) {
  busy.value = true;
  error.value = '';
  try {
    const result = await recognizeText(blob);
    text.value = (result || '').replace(/[ \t]+\n/g, '\n').trim();
    step.value = 'result';
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'OCR 识别失败';
  } finally {
    busy.value = false;
  }
}

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void runOcr(file);
}

/** 截图识别：拉起系统交互式框选 → base64 PNG → OCR */
async function startScreenshot() {
  busy.value = true;
  error.value = '';
  try {
    const blob = await captureScreenshot();
    if (!blob) {
      busy.value = false;
      return; // 用户取消，静默回到选择
    }
    await runOcr(blob);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '截图失败';
    busy.value = false;
  }
}

function confirm() {
  if (!text.value.trim()) return;
  emit('confirmed', text.value.trim());
  close();
}

function retake() {
  text.value = '';
  error.value = '';
  step.value = 'pick';
}
</script>

<template>
  <div v-if="modelValue" class="ocr-overlay" @click.self="close">
    <div class="ocr-modal">
      <div class="ocr-head">
        <span><Icon name="scan" :size="15" /> OCR 文字扫描</span>
        <button class="ocr-close" @click="close" aria-label="关闭"><Icon name="x" :size="16" /></button>
      </div>

      <!-- 选择来源 -->
      <div v-if="step === 'pick'" class="ocr-pick">
        <button class="ocr-src" :disabled="busy" @click="startScreenshot">
          <Icon name="screenshot" :size="20" />
          <span>截图识别</span>
        </button>
        <button class="ocr-src" :disabled="busy" @click="fileInput?.click()">
          <Icon name="image" :size="20" />
          <span>从图片选择</span>
        </button>
        <input ref="fileInput" type="file" accept="image/*" class="hidden-file-input" @change="onFilePicked" />
        <p v-if="busy" class="ocr-tip">正在截图…请在屏幕上框选要识别的区域（ESC 取消）</p>
        <p v-else-if="error" class="ocr-error">{{ error }}</p>
        <p v-else class="ocr-tip">识别在本地离线完成，图片不会上传到任何服务器。</p>
      </div>

      <!-- 识别结果（可编辑） -->
      <div v-else class="ocr-result">
        <div v-if="busy" class="ocr-loading"><Icon name="loader" :size="16" class="ai-spin" /> 正在识别…</div>
        <template v-else>
          <textarea v-model="text" class="kb-input ocr-text" placeholder="识别结果可在此修正…"></textarea>
          <p v-if="error" class="ocr-error">{{ error }}</p>
          <div class="ocr-actions">
            <button class="kb-btn wb-ghost-btn" @click="retake">重新识别</button>
            <button class="kb-btn kb-btn-primary" :disabled="!text.trim()" @click="confirm">
              <Icon name="check" :size="14" /> 确认插入
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ocr-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.ocr-modal {
  width: min(560px, 92vw);
  background: var(--kb-card);
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}
.ocr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--kb-border);
  font-weight: 600;
}
.ocr-head > span {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ocr-close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--kb-muted-foreground);
}
.ocr-pick {
  display: flex;
  gap: 14px;
  padding: 24px 16px;
}
.ocr-src {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 22px 0;
  border: 1px solid var(--kb-border);
  border-radius: 12px;
  background: var(--kb-background);
  cursor: pointer;
  color: var(--kb-foreground);
}
.ocr-src:hover:not(:disabled) {
  border-color: var(--kb-primary);
}
.ocr-src:disabled {
  opacity: 0.55;
  cursor: default;
}
.ocr-tip,
.ocr-error {
  width: 100%;
  text-align: center;
  font-size: 12px;
  color: var(--kb-muted-foreground);
  padding: 0 16px 16px;
}
.ocr-error {
  color: #ef4444;
}
.ocr-result {
  padding: 16px;
}
.ocr-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  padding: 40px 0;
  color: var(--kb-muted-foreground);
}
.ocr-text {
  width: 100%;
  min-height: 180px;
  resize: vertical;
  font-family: inherit;
  line-height: 1.6;
}
.ocr-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
}
.hidden-file-input {
  display: none;
}
</style>
