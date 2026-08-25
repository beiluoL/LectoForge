<script setup lang="ts">
/**
 * OCR 扫描弹窗：来源 = 截图（capture_screenshot 命令，系统交互式框选）或 选图（文件选择器）。
 * 拿到图片后走 ocrClient.recognizeText（tesseract.js 主，中文优先，完全离线），
 * 结果进入可编辑文本框（OCR 常有错字，先让人在确认前修正），确认后回传文本。
 *
 * 本次优化：
 * - 重新设计选择来源卡片，文字禁止竖排，图标/标题/说明比例协调；
 * - 新增图片预览区，识别过程与结果均可见原图；
 * - 错误态按类型分类，给出明确文案 + 重试/重新选择操作；
 * - 识别前预检本地模型，缺失时直接提示运行 fetch-models.sh。
 */
import { computed, ref, watch } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import { invoke } from '@tauri-apps/api/core';
import { recognizeText, resetWorker, type OcrError, type OcrErrorCode } from '@/lib/ocr/ocrClient';
import { captureScreenshot } from '@/lib/screenshot';

const props = defineProps<{
  modelValue: boolean;
  /** 外部传入的待识别图片（全局快捷键 / 托盘触发时由控制器填入），有值且弹窗打开即直接识别 */
  pendingBlob?: Blob | null;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirmed: [text: string];
}>();

const busy = ref(false);
const error = ref<{ code: OcrErrorCode; message: string } | null>(null);
const text = ref('');
const step = ref<'pick' | 'preview' | 'result'>('pick');
const previewUrl = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
/** 已对哪张 pendingBlob 跑过识别，避免重复触发 */
const ranFor = ref<Blob | null>(null);

/** 关闭并重置所有状态 */
function close() {
  busy.value = false;
  text.value = '';
  error.value = null;
  step.value = 'pick';
  ranFor.value = null;
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = '';
  }
  emit('update:modelValue', false);
}

/**
 * 全局快捷键 / 托盘触发：控制器把截图 Blob 经 pendingBlob 传入，弹窗打开后直接识别，
 * 跳过「选择来源」步骤。收集箱内正常使用（无 pendingBlob）时此监听不触发。
 */
watch(
  () => [props.modelValue, props.pendingBlob] as const,
  ([vis, blob]) => {
    if (vis && blob && ranFor.value !== blob) {
      ranFor.value = blob;
      error.value = null;
      text.value = '';
      setPreview(blob);
      void runOcr(blob);
    }
  },
);

/**
 * 控制器主动清空 pendingBlob（新截图开始/失败时复位）：回到 pick 步，撤销旧预览 URL。
 * 防止 visible 仍为 true 时（如快速连按全局快捷键）弹窗仍展示上一轮的预览图。
 */
watch(
  () => props.pendingBlob,
  (blob) => {
    if (blob === null) {
      retake();
      ranFor.value = null;
    }
  },
);

/** 释放当前预览图，返回选择页 */
function retake() {
  text.value = '';
  error.value = null;
  step.value = 'pick';
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = '';
  }
}

function setPreview(blob: Blob) {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = URL.createObjectURL(blob);
  step.value = 'preview';
}

/** 统一错误处理：区分模型缺失 / 初始化失败 / 识别失败 / 无文字 */
function handleOcrError(e: unknown) {
  busy.value = false;
  const rawMessage = e instanceof Error ? e.message : typeof e === 'string' ? e : 'OCR 识别失败';
  if (e && typeof e === 'object' && 'code' in e && typeof (e as Record<string, unknown>).code === 'string') {
    error.value = { code: (e as OcrError).code, message: (e as OcrError).message };
  } else {
    error.value = { code: 'UNKNOWN', message: rawMessage };
  }
  // 屏幕录制权限缺失（screencapture 会「穿透」到桌面壁纸）：明确提示 + 直接打开系统设置
  if (rawMessage.includes('SCREEN_RECORDING_DENIED')) {
    error.value = {
      code: 'UNKNOWN',
      message:
        '未获得「屏幕录制」权限，截图会穿透到桌面背景。已打开系统设置，请勾选 LectoForge 后完全退出并重新启动应用。',
    };
    void invoke('open_external_url', {
      url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    });
  }
  step.value = 'preview';
}

async function runOcr(blob: Blob) {
  busy.value = true;
  error.value = null;
  try {
    const result = await recognizeText(blob);
    text.value = result;
    step.value = 'result';
  } catch (e) {
    handleOcrError(e);
  } finally {
    busy.value = false;
  }
}

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  setPreview(file);
  void runOcr(file);
}

/** 截图识别：拉起系统交互式框选 → base64 PNG → OCR */
async function startScreenshot() {
  error.value = null;
  try {
    const blob = await captureScreenshot();
    if (!blob) return; // 用户取消，静默回到选择
    setPreview(blob);
    await runOcr(blob);
  } catch (e) {
    handleOcrError(e);
  }
}

/** 重试：对同一张预览图再识别一次（可清理缓存的 worker） */
async function retry() {
  if (!previewUrl.value) return;
  // 重置 worker 能修复偶发的 WASM 初始化 / 状态异常
  await resetWorker();
  const res = await fetch(previewUrl.value);
  const blob = await res.blob();
  await runOcr(blob);
}

function confirm() {
  const trimmed = text.value.trim();
  if (!trimmed) return;
  emit('confirmed', trimmed);
  close();
}

/** 错误态下按错误码给出的恢复操作 */
const recoverAction = computed(() => {
  if (!error.value) return null;
  if (error.value.code === 'MODEL_MISSING' || error.value.code === 'INIT_FAILED') {
    return { label: '重新检测模型', handler: retry };
  }
  if (error.value.code === 'NO_TEXT') {
    return { label: '重新选择图片', handler: retake };
  }
  return { label: '重试识别', handler: retry };
});
</script>

<template>
  <div v-if="modelValue" class="ocr-overlay" @click.self="close">
    <div class="ocr-modal" role="dialog" aria-modal="true" aria-labelledby="ocr-title">
      <div class="ocr-head">
        <span id="ocr-title" class="ocr-title">
          <Icon name="scan" :size="18" class="ocr-title-icon" decorative />
          OCR 文字扫描
        </span>
        <button class="ocr-close" aria-label="关闭" @click="close">
          <Icon name="x" :size="18" decorative />
        </button>
      </div>

      <!-- 选择来源 -->
      <div v-if="step === 'pick'" class="ocr-body">
        <p class="ocr-subtitle">选择图片来源，识别完全在本地离线完成</p>
        <div class="ocr-pick">
          <button class="ocr-src" :disabled="busy" @click="startScreenshot">
            <span class="ocr-src-icon">
              <Icon name="screenshot" :size="28" decorative />
            </span>
            <span class="ocr-src-label">截图识别</span>
            <span class="ocr-src-desc">框选屏幕区域，自动识别文字</span>
          </button>
          <button class="ocr-src" :disabled="busy" @click="fileInput?.click()">
            <span class="ocr-src-icon">
              <Icon name="image" :size="28" decorative />
            </span>
            <span class="ocr-src-label">从图片选择</span>
            <span class="ocr-src-desc">上传本地图片进行文字识别</span>
          </button>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          class="hidden-file-input"
          @change="onFilePicked"
        />
        <p class="ocr-privacy-tip">
          <Icon name="shield-check" :size="12" decorative />
          识别在本地离线完成，图片不会上传到任何服务器。
        </p>
      </div>

      <!-- 识别中 / 识别失败（带预览图） -->
      <div v-else-if="step === 'preview'" class="ocr-body ocr-preview-body">
        <div class="ocr-preview">
          <img v-if="previewUrl" :src="previewUrl" alt="待识别图片预览" />
        </div>

        <div v-if="busy" class="ocr-status">
          <span class="ocr-spinner" aria-hidden="true"></span>
          <span>正在识别文字…</span>
        </div>

        <div v-else-if="error" class="ocr-error-panel">
          <div class="ocr-error-icon">
            <Icon name="alert-circle" :size="28" color="var(--kb-destructive)" decorative />
          </div>
          <p class="ocr-error-title">识别失败</p>
          <p class="ocr-error-message">{{ error.message }}</p>
          <div class="ocr-error-actions">
            <button class="kb-btn" @click="retake">重新选择</button>
            <button v-if="recoverAction" class="kb-btn kb-btn-primary" @click="recoverAction.handler">
              <Icon name="refresh-cw" :size="14" decorative />
              {{ recoverAction.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- 识别结果（可编辑） -->
      <div v-else-if="step === 'result'" class="ocr-body ocr-result-body">
        <div class="ocr-preview ocr-preview--small">
          <img v-if="previewUrl" :src="previewUrl" alt="已识别图片预览" />
        </div>
        <textarea
          v-model="text"
          class="kb-input ocr-text"
          placeholder="识别结果可在此修正…"
          rows="8"
        ></textarea>
        <div class="ocr-result-meta">
          <span v-if="text.trim()">{{ text.trim().length }} 字</span>
          <span v-else class="ocr-empty-hint">当前无文字，确认将关闭弹窗</span>
        </div>
        <div class="ocr-actions">
          <button class="kb-btn" @click="retake">重新识别</button>
          <button class="kb-btn kb-btn-primary" :disabled="!text.trim()" @click="confirm">
            <Icon name="check" :size="14" decorative />
            确认插入
          </button>
        </div>
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
  padding: 20px;
}
.ocr-modal {
  width: min(600px, 94vw);
  max-height: min(760px, 92vh);
  background: var(--kb-surface, #fff);
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.ocr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--kb-border, #e2e6ec);
  flex-shrink: 0;
}
.ocr-title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: var(--kb-fs-body-lg, 16px);
  font-weight: 600;
  color: var(--kb-foreground, #1a1d23);
}
.ocr-title-icon {
  color: var(--kb-primary, #3b6fe0);
}
.ocr-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--kb-radius-sm, 6px);
  background: transparent;
  cursor: pointer;
  color: var(--kb-text-muted, #6b7280);
  transition: background 0.15s ease, color 0.15s ease;
}
.ocr-close:hover {
  background: var(--kb-muted, #e8ecf1);
  color: var(--kb-foreground, #1a1d23);
}
.ocr-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}
.ocr-subtitle {
  margin: 0;
  text-align: center;
  font-size: var(--kb-fs-body-sm, 13px);
  color: var(--kb-muted-foreground, #6b7280);
}
.ocr-pick {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}
.ocr-src {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 28px 16px;
  border: 1px solid var(--kb-border, #e2e6ec);
  border-radius: var(--kb-radius-md, 10px);
  background: var(--kb-card, #fff);
  cursor: pointer;
  color: var(--kb-foreground, #1a1d23);
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
  min-width: 0;
}
.ocr-src:hover:not(:disabled) {
  border-color: var(--kb-primary, #3b6fe0);
  box-shadow: 0 0 0 3px rgba(59, 111, 224, 0.08);
}
.ocr-src:disabled {
  opacity: 0.55;
  cursor: default;
}
.ocr-src-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--kb-radius-md, 10px);
  background: color-mix(in srgb, var(--kb-primary, #3b6fe0) 8%, transparent);
  color: var(--kb-primary, #3b6fe0);
}
.ocr-src-label {
  font-size: var(--kb-fs-body-md, 14px);
  font-weight: 600;
  color: var(--kb-foreground, #1a1d23);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.ocr-src-desc {
  font-size: var(--kb-fs-caption, 12px);
  color: var(--kb-muted-foreground, #6b7280);
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.ocr-privacy-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0;
  font-size: var(--kb-fs-caption, 12px);
  color: var(--kb-muted-foreground, #6b7280);
}

/* 预览图与识别状态 */
.ocr-preview-body {
  gap: 14px;
}
.ocr-preview {
  width: 100%;
  min-height: 160px;
  max-height: 280px;
  border-radius: var(--kb-radius-md, 10px);
  background: var(--kb-background, #f7f8fa);
  border: 1px solid var(--kb-border, #e2e6ec);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ocr-preview--small {
  max-height: 140px;
  min-height: 80px;
}
.ocr-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.ocr-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 18px 0;
  color: var(--kb-muted-foreground, #6b7280);
  font-size: var(--kb-fs-body-md, 14px);
}
.ocr-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--kb-border, #e2e6ec);
  border-top-color: var(--kb-primary, #3b6fe0);
  border-radius: 50%;
  animation: ocr-spin 0.8s linear infinite;
}
@keyframes ocr-spin {
  to { transform: rotate(360deg); }
}

/* 错误面板 */
.ocr-error-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 12px;
  border-radius: var(--kb-radius-md, 10px);
  background: color-mix(in srgb, var(--kb-destructive, #ef4444) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--kb-destructive, #ef4444) 18%, transparent);
  text-align: center;
}
.ocr-error-title {
  margin: 0;
  font-size: var(--kb-fs-body-md, 14px);
  font-weight: 600;
  color: var(--kb-destructive, #ef4444);
}
.ocr-error-message {
  margin: 0;
  font-size: var(--kb-fs-body-sm, 13px);
  color: var(--kb-foreground, #1a1d23);
  line-height: 1.6;
  max-width: 420px;
}
.ocr-error-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}

/* 结果页 */
.ocr-result-body {
  gap: 12px;
}
.ocr-text {
  width: 100%;
  min-height: 160px;
  resize: vertical;
  font-family: inherit;
  font-size: var(--kb-fs-body-md, 14px);
  line-height: 1.7;
}
.ocr-result-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  font-size: var(--kb-fs-caption, 12px);
  color: var(--kb-muted-foreground, #6b7280);
  min-height: 18px;
}
.ocr-empty-hint {
  color: var(--kb-destructive, #ef4444);
}
.ocr-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 4px;
}
.hidden-file-input {
  display: none;
}

/* 窄屏适配：按钮从两列变单列，避免文字被压成竖排 */
@media (max-width: 480px) {
  .ocr-pick {
    grid-template-columns: 1fr;
  }
  .ocr-src {
    flex-direction: row;
    justify-content: flex-start;
    padding: 18px 16px;
    gap: 14px;
  }
  .ocr-src-icon {
    width: 44px;
    height: 44px;
    flex-shrink: 0;
  }
  .ocr-src-label {
    text-align: left;
  }
  .ocr-src-desc {
    text-align: left;
  }
}
</style>
