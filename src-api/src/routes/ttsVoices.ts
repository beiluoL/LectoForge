// TTS 路由（挂载前缀 /api，见 index.ts），对外端点：
//   GET  /api/tts-voices            列出可选音色及其本地状态（available/downloading/downloaded）
//   GET  /api/tts-voices/config     读取 TTS 配置（engine + selectedVoiceId）
//   POST /api/tts-voices/config     保存 TTS 配置
//   POST /api/tts-voices/:id/download  下载指定音色（SSE 进度流，含 .onnx + .onnx.json）
//   DELETE /api/tts-voices/:id      删除已下载音色 / 取消进行中的下载
//   POST /api/tts/synthesize        合成文本为 WAV（body: {text, voiceId?}，返回 audio/wav 二进制）
//
// 业务实现见 services/piperVoiceService.ts / ttsConfigService.ts / piperTtsService.ts。
import type { FastifyInstance } from 'fastify';

import * as ttsVoicesController from '../controllers/ttsVoicesController';

export default async function ttsVoicesRoutes(app: FastifyInstance) {
  app.get('/tts-voices', ttsVoicesController.listVoicesHandler);
  app.get('/tts-voices/config', ttsVoicesController.getConfigHandler);
  app.post('/tts-voices/config', ttsVoicesController.saveConfigHandler);
  app.post('/tts-voices/:id/download', ttsVoicesController.downloadHandler);
  app.delete('/tts-voices/:id', ttsVoicesController.deleteHandler);
  app.post('/tts/synthesize', ttsVoicesController.synthesizeHandler);
}
