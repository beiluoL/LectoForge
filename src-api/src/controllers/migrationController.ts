import type { FastifyReply, FastifyRequest } from 'fastify';

import * as migrationService from '../services/migrationService';
import type { ImportPayload } from '../types/migration';

/**
 * 数据迁移控制器（挂载在 /api/workbench）。
 *
 * 成功响应刻意只 return 纯数据 { ok, imported }：
 * index.ts 的 onSend 钩子会统一包成 { code: 200, data: { ok, imported } }，
 * 与重构前手写 reply.code(200).send({ code: 200, data }) 的报文逐字节一致，
 * 同时不再由 Controller 自行拼装信封（重构红线 2）。
 */
export async function importData(req: FastifyRequest, reply: FastifyReply) {
  const body = (req.body || {}) as ImportPayload;
  const outcome = migrationService.importWorkbenchData(body);

  switch (outcome.kind) {
    case 'ok':
      return outcome.data;
    case 'missingData':
      return reply.code(400).send({ code: 400, message: 'invalid payload: 缺少 data 对象' });
    case 'emptyCollections':
      return reply
        .code(400)
        .send({ code: 400, message: 'invalid payload: data 至少应包含 captures/notes/stories/palaces 之一' });
    case 'conflict':
      return reply
        .code(409)
        .send({ code: 409, message: '本地已有工作台数据，重复导入会导致脏数据。请先清空本地数据后再导入。' });
    default:
      return reply.code(400).send({ code: 400, message: 'invalid payload' });
  }
}
