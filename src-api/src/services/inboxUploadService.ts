/**
 * 收集箱附件上传服务（语音 / 图片 / PDF）。
 *
 * ⚠️ 与原实现的唯一差异：原 `saveUploadedFile(req, kind)` 直接吃 FastifyRequest，
 * 违反「Service 入参出参不得出现 Fastify 实例」。这里改为接收中立的 `UploadSource`，
 * 由 Controller 负责从 `req.file()` 取出 part 并适配。落盘行为、白名单、
 * 命名规则、超限处理与错误 statusCode 全部保持原样。
 *
 * 落盘统一走 lib/paths.ts 的 getUploadsDir()（打包后为
 * ~/Library/Application Support/com.lectoforge.desktop/uploads），**绝不能**拼
 * src-api/ 相对路径——.app 包内只读，写入会直接 EROFS。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';

import { getUploadsDir } from '../lib/paths';
import type { UploadKind, UploadResult, UploadSource } from '../types/inbox';

/** 单文件体积上限 25MB —— 语音灵感与截图都远小于此，超出多半是误传大文件 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** 允许的扩展名白名单（按用途分组，避免把可执行文件写进数据目录） */
const ALLOWED_EXT: Record<UploadKind, string[]> = {
  audio: ['.webm', '.wav', '.mp3', '.m4a', '.ogg', '.oga', '.mp4', '.aac'],
  assets: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.pdf', '.txt', '.md'],
};

/** MIME → 扩展名兜底（MediaRecorder 产出的 Blob 常常没有文件名） */
const MIME_EXT: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'video/webm': '.webm', // Chrome 的 MediaRecorder 有时把纯音频标成 video/webm
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
};

/**
 * 由「原始文件名 + MIME」推断一个安全扩展名。
 * 只信任白名单内的扩展名，其余一律按 MIME 映射，都拿不到就退回 kind 的默认值。
 */
function safeExt(kind: UploadKind, filename: string | undefined, mimetype: string | undefined): string {
  const raw = path.extname(filename || '').toLowerCase();
  if (raw && ALLOWED_EXT[kind].includes(raw)) return raw;
  const byMime = MIME_EXT[(mimetype || '').toLowerCase().split(';')[0].trim()];
  if (byMime && ALLOWED_EXT[kind].includes(byMime)) return byMime;
  return kind === 'audio' ? '.webm' : '.png';
}

/** 生成不会撞名、也不含用户可控路径片段的文件名：<yyyyMMdd>-<8位随机>.<ext> */
function makeStoredName(ext: string): string {
  const d = new Date();
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${day}-${crypto.randomBytes(4).toString('hex')}${ext}`;
}

/**
 * 把上传流落盘到 <dataDir>/uploads/<kind>/。
 * 用流式 pipeline 写入，避免大文件整个读进内存；超限时删掉半截文件再报错（413）。
 */
export async function saveUploadedFile(src: UploadSource, kind: UploadKind): Promise<UploadResult> {
  const ext = safeExt(kind, src.filename, src.mimetype);
  const dir = path.join(getUploadsDir(), kind);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = makeStoredName(ext);
  const absPath = path.join(dir, fileName);

  try {
    await pipeline(src.stream, fs.createWriteStream(absPath));
  } catch (e) {
    fs.rmSync(absPath, { force: true });
    throw e;
  }
  // @fastify/multipart 在超限时不会抛错，而是把 truncated 置为 true，需要显式检查
  if (src.isTruncated()) {
    fs.rmSync(absPath, { force: true });
    throw Object.assign(new Error(`文件超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 上限`), { statusCode: 413 });
  }

  const size = fs.statSync(absPath).size;
  return {
    url: `/uploads/${kind}/${fileName}`,
    fileName,
    originalName: src.filename || fileName,
    mimeType: src.mimetype || 'application/octet-stream',
    size,
    kind,
  };
}
