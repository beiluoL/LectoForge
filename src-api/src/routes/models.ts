// 语音模型路由（挂载前缀 /api，见 index.ts），对外端点：
//   GET  /api/models           列出可选模型及其本地状态（available/downloading/downloaded）
//   GET  /api/models/config    读取语音配置（runtime + selectedModelId）
//   POST /api/models/config    保存语音配置
//   POST /api/models/:id/download  下载指定模型（SSE 进度流）
//   DELETE /api/models/:id     删除已下载模型 / 取消进行中的下载
//
// 业务实现见 services/whisperModelService.ts 与 services/speechConfigService.ts。
import type { FastifyInstance } from 'fastify';

import * as modelsController from '../controllers/modelsController';

export default async function modelsRoutes(app: FastifyInstance) {
  app.get('/models', modelsController.listModelsHandler);
  app.get('/models/config', modelsController.getConfigHandler);
  app.post('/models/config', modelsController.saveConfigHandler);
  app.post('/models/:id/download', modelsController.downloadHandler);
  app.delete('/models/:id', modelsController.deleteHandler);
}
