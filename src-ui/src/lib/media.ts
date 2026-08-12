/**
 * 媒体 / 附件上传共享工具。
 *
 * 统一收敛「拍照 / 选图 / 附件 / OCR 结果」落盘与内联引用逻辑，供收集箱
 * （QuickCapture）与康奈尔笔记编辑器（WorkbenchNoteEdit）复用，避免两处各写一套。
 *
 * 设计对齐移动端 §7.13.1：不设附件表，文件落盘到 <dataDir>/uploads/assets/，
 * 正文以内联形式引用——收集箱走 Markdown `![](url)`，笔记栏走 contenteditable `<img>`。
 */
import { uploadInboxAsset, type UploadResult } from '@/api/inbox';

/** 允许的图片 MIME（用于文件选择器的 accept 与结果分流） */
const IMAGE_MIME = /^(image\/png|image\/jpe?g|image\/gif|image\/webp|image\/bmp|image\/svg\+xml)$/i;

export function isImageMime(mime: string | undefined | null): boolean {
  return !!mime && IMAGE_MIME.test(mime);
}

/** 把任意文件当作附件上传，返回后端产出的同源 URL 等元信息 */
export function uploadAttachment(file: File | Blob, fileName?: string): Promise<UploadResult> {
  return uploadInboxAsset(file, fileName);
}

/** 生成笔记富文本栏（contenteditable）用的 <img> 片段 */
export function imageHtmlTag(url: string, alt: string): string {
  const safeAlt = String(alt || '').replace(/["<>]/g, '');
  return `<img src="${url}" alt="${safeAlt}" />`;
}

/** 生成收集箱 Markdown 用的图片引用 */
export function imageMarkdown(url: string, alt: string): string {
  return `![${alt || 'image'}](${url})`;
}

/** 生成收集箱 Markdown 用的非图片附件引用 */
export function docLinkMarkdown(url: string, name: string): string {
  return `[${name || 'attachment'}](${url})`;
}

/** 根据上传结果构造应并入正文的内容片段（图片→图，其它→链接） */
export function attachmentSnippet(result: UploadResult): string {
  if (isImageMime(result.mimeType)) return imageMarkdown(result.url, result.originalName || 'image');
  return docLinkMarkdown(result.url, result.originalName || 'file');
}

export { uploadInboxAsset };
export type { UploadResult };
