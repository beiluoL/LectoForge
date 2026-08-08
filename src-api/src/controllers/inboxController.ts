/**
 * 收集箱控制器：解析 params/query/body，调用 service，按结果决定 HTTP 状态码。
 * 不写任何 SQL，也不拼 { code: 200 } 信封（由 index.ts 的 onSend 钩子统一包裹）。
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import * as inboxService from '../services/inboxService';
import * as dedupeService from '../services/inboxDedupeService';
import { clipUrl } from '../services/inboxClipService';
import { MAX_UPLOAD_BYTES, saveUploadedFile } from '../services/inboxUploadService';
import type { PageQuery } from '../types/pagination';
import type {
  BatchTarget,
  CreateInboxDTO,
  InboxFilter,
  UpdateInboxDTO,
  UploadKind,
} from '../types/inbox';

/** Fastify 在未声明 schema 时 req.query/params/body 为 unknown，这里用显式结构收口 */
interface IdParams {
  id: string;
}
interface ListQuery extends PageQuery {
  sort?: string;
  filter?: string;
}
interface StatusQuery extends PageQuery {
  status?: string;
}
interface UrlPayload {
  url?: string;
  sourceUrl?: string;
}
interface ProcessPayload {
  target?: string;
  targetType?: string;
  palaceId?: unknown;
  lociId?: unknown;
}
interface BatchPayload {
  ids?: unknown;
  target?: string;
  targetType?: string;
}
interface DuplicatePayload {
  content?: unknown;
  sourceUrl?: unknown;
  excludeId?: unknown;
}

/**
 * @fastify/multipart 注入的 req.file()。这里用结构化类型就地收口，
 * 不直接依赖插件的类型导出，避免类型版本漂移影响编译。
 */
interface MultipartPart {
  filename?: string;
  mimetype?: string;
  file: NodeJS.ReadableStream & { truncated?: boolean };
}
type FileReader = {
  file(options?: { limits?: { fileSize?: number; files?: number } }): Promise<MultipartPart | undefined>;
};

const VALID_BATCH_TARGETS: readonly string[] = ['archive', 'delete', 'cornell'];

// ===================== 查询 =====================

export async function list(req: FastifyRequest) {
  const q = (req.query ?? {}) as ListQuery;
  return inboxService.listUnprocessed({
    ascSort: String(q.sort || '').toLowerCase() === 'asc',
    filter: String(q.filter || 'all').toLowerCase() as InboxFilter,
    // 分页参数原样透传，字符串→数字的归一化统一在 resolvePage 内部完成
    page: q.page,
    pageSize: q.pageSize,
    limit: q.limit,
    offset: q.offset,
  });
}

export async function listByStatus(req: FastifyRequest) {
  const q = (req.query ?? {}) as StatusQuery;
  return inboxService.listByStatus(q.status, q);
}

// ===================== 写入 =====================

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const vo = inboxService.createItem((req.body ?? {}) as CreateInboxDTO);
  return reply.code(201).send(vo);
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const vo = inboxService.updateItem(id, (req.body ?? {}) as UpdateInboxDTO);
  if (!vo) return reply.code(404).send({ message: '收集项不存在' });
  return vo;
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  if (!inboxService.trashItem(id)) return reply.code(404).send({ message: '收集项不存在' });
  return reply.code(204).send();
}

// ===================== 网页剪藏 =====================

/** 从 query / body 两处兜底取 url，兼容 GET ?url= 与 POST { url } */
function pickUrl(req: FastifyRequest): string {
  const q = (req.query ?? {}) as UrlPayload;
  const b = (req.body ?? {}) as UrlPayload;
  return (q.url || q.sourceUrl || b.url || b.sourceUrl || '').toString().trim();
}

/** 始终返回 200 结构，前端据 ok 字段决定提示语气 */
export async function clip(req: FastifyRequest) {
  const url = pickUrl(req);
  if (!url) return { title: '', description: 'URL 不能为空', image: null, url: '', snippet: '', ok: false };
  return clipUrl(url);
}

/** 与 clip 同源，摘要取前 200 字（比 clip 的 120 更长，便于「摘录初稿」） */
export async function metadata(req: FastifyRequest) {
  const url = pickUrl(req);
  if (!url) return { title: '', description: 'URL 不能为空', image: null, url: '', snippet: '', ok: false };
  return clipUrl(url, 200);
}

// ===================== 流转（沉淀） =====================

export async function process(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const q = (req.query ?? {}) as ProcessPayload;
  const b = (req.body ?? {}) as ProcessPayload;
  // 兼容 spec 的 targetType 命名与既有 target 命名
  const target = String(b.targetType || b.target || q.targetType || q.target || 'cornell').toLowerCase();
  const rawPalaceId = b.palaceId ?? q.palaceId;

  const outcome = await inboxService.processItem(id, {
    target,
    palaceId: Number(rawPalaceId),
    lociId: Number(b.lociId ?? q.lociId ?? 0) || 0,
  });

  switch (outcome.kind) {
    case 'notFound':
      return reply.code(404).send({ message: '收集项不存在' });
    case 'vaultNotReady':
      return reply
        .code(409)
        .send({ message: '尚未选择文档库目录，请先在「文档库」中选择本地文件夹后再沉淀为文档' });
    case 'palaceIdRequired':
      return reply.code(400).send({ message: '流转到记忆宫殿需要 palaceId' });
    case 'palaceNotFound':
      return reply.code(404).send({ message: '记忆宫殿不存在' });
    case 'invalidTarget':
      return reply.code(400).send({ message: 'target 仅支持 note | cornell | palace | story' });
    default:
      return outcome.data;
  }
}

// ===================== 批量处理 =====================

export async function batchProcess(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body ?? {}) as BatchPayload;
  const target = String(b.target || b.targetType || '').toLowerCase();
  if (!VALID_BATCH_TARGETS.includes(target)) {
    return reply.code(400).send({ message: 'target 仅支持 archive | delete | cornell' });
  }

  const ids = Array.from(
    new Set(
      (Array.isArray(b.ids) ? b.ids : [])
        .map((x: unknown) => Number(x))
        .filter((n: number) => Number.isInteger(n) && n > 0),
    ),
  ) as number[];
  if (!ids.length) return reply.code(400).send({ message: 'ids 不能为空' });

  return inboxService.batchProcess(ids, target as BatchTarget);
}

// ===================== 附件上传 =====================

/**
 * 取出 multipart 的第一个文件并交给 service 落盘。
 * 错误统一按 e.statusCode 翻译（超限 413 / 其余 400），与重构前逐字一致。
 */
async function handleUpload(req: FastifyRequest, reply: FastifyReply, kind: UploadKind, fallbackMsg: string) {
  try {
    const part = await (req as unknown as FileReader).file({
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    });
    if (!part) {
      throw Object.assign(new Error('没有收到文件（字段名任意，但必须是 multipart 文件字段）'), { statusCode: 400 });
    }
    return await saveUploadedFile(
      {
        filename: part.filename,
        mimetype: part.mimetype,
        stream: part.file,
        isTruncated: () => Boolean(part.file.truncated),
      },
      kind,
    );
  } catch (e) {
    const err = e as { statusCode?: number; message?: string } | null | undefined;
    return reply.code(err?.statusCode || 400).send({ message: err?.message || fallbackMsg });
  }
}

export async function uploadAudio(req: FastifyRequest, reply: FastifyReply) {
  return handleUpload(req, reply, 'audio', '录音上传失败');
}

export async function uploadAsset(req: FastifyRequest, reply: FastifyReply) {
  return handleUpload(req, reply, 'assets', '附件上传失败');
}

// ===================== 智能去重 =====================

export async function duplicateCheck(req: FastifyRequest) {
  const b = (req.body ?? {}) as DuplicatePayload;
  return dedupeService.checkDuplicate({
    content: String(b.content ?? ''),
    sourceUrl: String(b.sourceUrl ?? ''),
    excludeId: Number(b.excludeId ?? 0) || 0,
  });
}
