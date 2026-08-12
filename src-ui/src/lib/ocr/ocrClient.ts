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
 * ocrClient 加一条「macOS 先 invoke recognize_text、失败回退」分支即可（见提交历史）。
 */
import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';

const TESS_CORE = '/models/tesseract';
let workerPromise: Promise<TesseractWorker> | null = null;

/** 懒加载并缓存一个 tesseract worker（复用避免重复初始化耗时） */
function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createWorker('chi_sim+eng', 1, {
      corePath: `${TESS_CORE}/tesseract-core.wasm.js`,
      workerPath: `${TESS_CORE}/worker.min.js`,
      langPath: TESS_CORE,
      // 复用本地 worker 脚本（已通过 /models 同源托管），不依赖 Blob URL
      workerBlobURL: false,
    });
  }
  return workerPromise;
}

/** 统一入口：blob → 中文优先的离线识别文本 */
export async function recognizeText(blob: Blob): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(blob);
  return (data?.text || '').replace(/[ \t]+\n/g, '\n').trim();
}
