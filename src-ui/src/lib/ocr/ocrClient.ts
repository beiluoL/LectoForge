/**
 * 离线 OCR 客户端。
 *
 * 采用 tesseract.js（WASM，跨平台、完全离线）作为唯一识别引擎，中文优先
 * （chi_sim+eng）。wasm / worker / 语言包均来自 /models/tesseract/（见
 * scripts/fetch-models.sh），不访问任何 CDN。
 *
 * 与移动端 §7.16 对齐——离线、中文优先。
 *
 * 注：曾规划在 macOS 上用系统原生 Vision 框架（Rust 命令 recognize_text）做中文
 * 高准确度兜底，因 objc2-vision 与当前 objc2 依赖树版本无法对齐、且引入会拖垮整个
 * Rust 构建，暂未引入；tesseract.js 已完整覆盖离线 OCR 诉求。如后续要补，只需在
 * ocrClient 加一条「macOS 先 invoke recognize_text、失败回落」分支即可（见提交历史）。
 */
import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';

const TESS_CORE = '/models/tesseract';
let workerPromise: Promise<TesseractWorker> | null = null;

export type OcrErrorCode =
  | 'MODEL_MISSING'
  | 'INIT_FAILED'
  | 'RECOGNIZE_FAILED'
  | 'NO_TEXT'
  | 'UNKNOWN';

export class OcrError extends Error {
  code: OcrErrorCode;
  detail?: string;
  constructor(code: OcrErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'OcrError';
    this.code = code;
    this.detail = detail;
  }
}

/** 探测单个模型资源是否存在 */
async function resourceExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', mode: 'same-origin' });
    return res.ok;
  } catch {
    return false;
  }
}

/** 判断语言包采用 gzip 压缩格式还是普通 traineddata 格式 */
async function detectLanguagePackFormat(): Promise<{ gzip: boolean }> {
  const hasGz =
    (await resourceExists(`${TESS_CORE}/chi_sim.traineddata.gz`)) ||
    (await resourceExists(`${TESS_CORE}/eng.traineddata.gz`));
  return { gzip: hasGz };
}

/**
 * 检查 OCR 所需本地资源是否就绪。
 * 返回缺失文件列表；为空即表示可以正常识别。
 */
export async function getMissingOcrResources(): Promise<string[]> {
  const required = [
    `${TESS_CORE}/worker.min.js`,
    `${TESS_CORE}/tesseract-core.wasm.js`,
    `${TESS_CORE}/tesseract-core.wasm`,
  ];
  const { gzip } = await detectLanguagePackFormat();
  const langCandidates = [
    `${TESS_CORE}/chi_sim.traineddata${gzip ? '.gz' : ''}`,
    `${TESS_CORE}/eng.traineddata${gzip ? '.gz' : ''}`,
  ];

  const missing: string[] = [];
  for (const url of required) {
    if (!(await resourceExists(url))) missing.push(url);
  }
  for (const url of langCandidates) {
    if (!(await resourceExists(url))) missing.push(url);
  }

  return missing;
}

/** 懒加载并缓存一个 tesseract worker（复用避免重复初始化耗时） */
async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    const { gzip } = await detectLanguagePackFormat();
    workerPromise = createWorker('chi_sim+eng', 1, {
      corePath: `${TESS_CORE}/tesseract-core.wasm.js`,
      workerPath: `${TESS_CORE}/worker.min.js`,
      langPath: TESS_CORE,
      gzip,
      // 复用本地 worker 脚本（已通过 /models 同源托管），不依赖 Blob URL
      workerBlobURL: false,
    });
  }
  return workerPromise;
}

/** 释放当前缓存的 worker（用于重试或资源变更后彻底重置） */
export async function resetWorker(): Promise<void> {
  if (workerPromise) {
    try {
      const w = await workerPromise;
      await w.terminate();
    } catch {
      // terminate 失败不影响清理引用
    } finally {
      workerPromise = null;
    }
  }
}

/**
 * 把 tesseract.js 抛出的原始错误翻译为中文、带错误码的 OcrError。
 */
function wrapTesseractError(e: unknown): OcrError {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();

  if (lower.includes('network') || lower.includes('fetch') || lower.includes('404')) {
    return new OcrError(
      'MODEL_MISSING',
      '本地 OCR 模型文件缺失或无法访问，请运行 scripts/fetch-models.sh 下载模型。',
      raw,
    );
  }
  if (lower.includes('init') || lower.includes('createworker') || lower.includes('loadlanguage')) {
    return new OcrError(
      'INIT_FAILED',
      'OCR 引擎初始化失败，请检查模型文件是否完整。',
      raw,
    );
  }
  if (lower.includes('recognize') || lower.includes('abort') || lower.includes('wasm')) {
    return new OcrError(
      'RECOGNIZE_FAILED',
      '图片识别过程出错，请重试或换一张图片。',
      raw,
    );
  }
  return new OcrError('UNKNOWN', raw || 'OCR 识别失败', raw);
}

/** 统一入口：blob → 中文优先的离线识别文本 */
export async function recognizeText(blob: Blob): Promise<string> {
  const missing = await getMissingOcrResources();
  if (missing.length) {
    throw new OcrError(
      'MODEL_MISSING',
      `本地 OCR 模型文件缺失：${missing.map((u) => u.split('/').pop()).join('、')}。请运行 scripts/fetch-models.sh 下载。`,
      missing.join(', '),
    );
  }

  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(blob);
    const text = (data?.text || '').replace(/[ \t]+\n/g, '\n').trim();
    if (!text) {
      throw new OcrError('NO_TEXT', '未能从图片中识别出文字，请尝试更清晰的截图。');
    }
    return text;
  } catch (e) {
    if (e instanceof OcrError) throw e;
    throw wrapTesseractError(e);
  }
}
