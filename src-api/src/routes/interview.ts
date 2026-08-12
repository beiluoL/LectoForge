/**
 * 模拟面试路由（挂载前缀 /api，见 index.ts），对外端点：
 *   POST /api/interview/transcribe   录音转写（multipart 音频 → { text }，JSON 信封）
 *   POST /api/interview/start       开始面试（SSE 流，首事件 event:'question'）
 *   POST /api/interview/answer      提交一轮回答（SSE 流，事件顺序 evaluation → question|end）
 *
 * 业务实现见 services/interviewService.ts（状态/编排）与 whisperSttService.ts（STT 代理）。
 * SSE 流由控制器直接接管 reply.raw 写出，绕过 onSend 信封（本项目约定之例外）。
 */
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';

import * as interviewController from '../controllers/interviewController';
import { MAX_UPLOAD_BYTES } from '../services/inboxUploadService';

export default async function interviewRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 8 },
  });

  app.post('/interview/transcribe', interviewController.transcribe);
  app.post('/interview/start', interviewController.start);
  app.post('/interview/answer', interviewController.answer);
}
