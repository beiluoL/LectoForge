// 语音模型相关控制器：只负责 HTTP 契约（读参 / 写响应），不含业务与 IO。
// 下载进度通过 SSE（reply.raw 旁路信封，本项目约定之例外，同 interview 路由）。
import type { FastifyRequest, FastifyReply } from 'fastify';

import {
  listModels,
  downloadModel,
  deleteModel,
} from '../services/whisperModelService';
import {
  getSpeechConfig,
  saveSpeechConfig,
  type SpeechRuntime,
} from '../services/speechConfigService';

export async function listModelsHandler(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send(listModels());
}

export async function getConfigHandler(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send(getSpeechConfig());
}

export async function saveConfigHandler(req: FastifyRequest, reply: FastifyReply) {
  const body = (req.body ?? {}) as Partial<{ runtime: SpeechRuntime; selectedModelId: string }>;
  return reply.send(saveSpeechConfig(body));
}

/** POST /api/models/:id/download —— SSE 进度流 */
export async function downloadHandler(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': (req.headers.origin as string) ?? '*',
  });
  const send = (obj: unknown) => reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
  try {
    const outPath = await downloadModel(id, (received, total) => {
      send({
        type: 'progress',
        received,
        total,
        pct: total ? Math.floor((received / total) * 100) : 0,
      });
    });
    send({ type: 'done', path: outPath });
  } catch (e) {
    send({ type: 'error', message: (e as Error).message });
  } finally {
    reply.raw.end();
  }
}

export async function deleteHandler(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  return reply.send(deleteModel(id));
}
