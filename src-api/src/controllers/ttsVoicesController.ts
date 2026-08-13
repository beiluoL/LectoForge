// TTS 音色 / 配置 / 合成的 HTTP 控制器。
//
// 约定（与 modelsController 一致）：普通端点直接 reply.send(数据)，由 index.ts 的 onSend
// 自动包成 { code, data } 信封；唯一例外是 SSE 下载端点（直接接管 reply.raw）与
// 合成端点（返回二进制 WAV，非 JSON，onSend 原样透传）。
import type { FastifyReply } from 'fastify';

import {
  listVoices,
  downloadVoice,
  deleteVoice,
  type VoiceEntry,
} from '../services/piperVoiceService';
import { getTtsConfig, saveTtsConfig, type TtsConfig, type TtsEngine } from '../services/ttsConfigService';
import { synthesize } from '../services/piperTtsService';
import { getTtsVoice, DEFAULT_TTS_VOICE_ID } from '../services/ttsVoices';

export async function listVoicesHandler(_req: any, reply: FastifyReply) {
  return reply.send(listVoices());
}

export async function getConfigHandler(_req: any, reply: FastifyReply) {
  return reply.send(getTtsConfig());
}

export async function saveConfigHandler(req: any, reply: FastifyReply) {
  const body = (req.body ?? {}) as Partial<{ engine: TtsEngine; selectedVoiceId: string }>;
  return reply.send(saveTtsConfig(body));
}

/** SSE 端点：流式汇报下载进度（绕过信封，直接操作 reply.raw） */
export async function downloadHandler(req: any, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': (req.headers.origin as string) ?? '*',
  });
  const send = (obj: unknown) => reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
  try {
    const outPath = await downloadVoice(id, (received, total) => {
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

export async function deleteHandler(req: any, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  return reply.send(deleteVoice(id));
}

/**
 * 合成端点：POST /api/tts/synthesize
 * body: { text: string, voiceId?: string }
 * 返回 audio/wav 二进制（非 JSON）。仅当 TTS 引擎为 piper 时被前端调用。
 */
export async function synthesizeHandler(req: any, reply: FastifyReply) {
  const body = (req.body ?? {}) as { text?: string; voiceId?: string };
  const text = (body.text || '').trim();
  if (!text) {
    return reply.code(400).send({ code: 400, message: '合成文本不能为空' });
  }
  const cfg: TtsConfig = getTtsConfig();
  if (cfg.engine !== 'piper') {
    return reply.code(400).send({ code: 400, message: '当前 TTS 引擎非 piper，无法使用本地合成' });
  }
  const voiceId = body.voiceId || cfg.selectedVoiceId || DEFAULT_TTS_VOICE_ID;
  if (!getTtsVoice(voiceId)) {
    return reply.code(400).send({ code: 400, message: `未知 TTS 音色: ${voiceId}` });
  }
  const wav = await synthesize(text, voiceId);
  reply.header('Content-Type', 'audio/wav');
  reply.header('Content-Length', String(wav.length));
  reply.header('Cache-Control', 'no-store');
  return reply.send(wav);
}

export type { VoiceEntry, TtsConfig };
