/**
 * 题库控制器：解析 query/params/body，调用 qaBankService，返回纯数据（信封由 onSend 统一包裹）。
 * 仅 import-pdf 需要 multipart，复用 inboxUploadService 的体积上限。
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import * as qaBankService from '../services/qaBankService';
import { MAX_UPLOAD_BYTES } from '../services/inboxUploadService';
import type { QaBankFilter, QaSourceType } from '../types/qaBank';

interface IdParams {
  id: string;
}
interface ListQuery {
  sourceType?: string;
  tag?: string;
  difficulty?: string;
}

/** 与 inboxController 同样用结构化类型收口 @fastify/multipart 的 part，避免类型版本漂移。 */
interface MultipartPart {
  filename?: string;
  mimetype?: string;
  file: NodeJS.ReadableStream & { truncated?: boolean };
}
type FileReader = {
  file(options?: { limits?: { fileSize?: number; files?: number } }): Promise<MultipartPart | undefined>;
};

function buildFilter(q: ListQuery): QaBankFilter {
  const filter: QaBankFilter = {};
  if (q.sourceType) filter.sourceType = q.sourceType as QaSourceType;
  if (q.tag) filter.tag = q.tag;
  if (q.difficulty) {
    const d = Number(q.difficulty);
    if (Number.isFinite(d)) filter.difficulty = d;
  }
  return filter;
}

// ===================== 查询 =====================

export async function list(req: FastifyRequest) {
  return qaBankService.listBanks(buildFilter((req.query ?? {}) as ListQuery));
}

export async function get(req: FastifyRequest) {
  const id = Number((req.params as IdParams).id);
  return qaBankService.getBank(id);
}

export async function randomNext(req: FastifyRequest) {
  return qaBankService.randomNext(buildFilter((req.query ?? {}) as ListQuery));
}

// ===================== 导入 =====================

export async function importMarkdown(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body ?? {}) as { text?: string };
  if (!b.text || !b.text.trim()) {
    return reply.code(400).send({ message: 'text 不能为空' });
  }
  const imported = qaBankService.ingestFromMarkdown(b.text);
  return { imported };
}

export async function importPdf(req: FastifyRequest, reply: FastifyReply) {
  try {
    const part = await (req as unknown as FileReader).file({
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    });
    if (!part) return reply.code(400).send({ message: '未收到 PDF 文件' });
    const chunks: Buffer[] = [];
    for await (const c of part.file) chunks.push(c as Buffer);
    if ((part.file as { truncated?: boolean }).truncated) {
      return reply.code(413).send({ message: 'PDF 超过体积上限' });
    }
    const buffer = Buffer.concat(chunks);
    const imported = await qaBankService.ingestFromPdf(buffer);
    return { imported };
  } catch (e) {
    const err = e as { statusCode?: number; message?: string };
    return reply.code(err?.statusCode || 400).send({ message: err?.message || 'PDF 导入失败' });
  }
}

export async function importFromReviewCards() {
  return { imported: qaBankService.importFromReviewCards() };
}

export async function importFromNotes() {
  return { imported: qaBankService.importFromNotes() };
}
