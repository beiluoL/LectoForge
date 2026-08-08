/**
 * 收集箱（Inbox）路由 —— 「极速输入，先积累再沉淀」的知识闭环第一步。
 *
 * 挂载前缀：/api（见 index.ts），对外端点：
 *   GET    /api/inbox/list            拉取全部未处理条目（时间倒序，支持 ?filter=today|week|untagged）
 *   GET    /api/inbox                 按状态查询（?status=archived|trashed|unprocessed）
 *   POST   /api/inbox                 新建一条（速记 / 链接 / 图片 / 语音 / 附件）
 *   GET|POST /api/inbox/clip          网页剪藏：抓取 title / description / og:image / 摘要
 *   GET|POST /api/inbox/metadata      同上，摘要取前 200 字
 *   PUT    /api/inbox/:id             更新内容 / 打标签 / 改状态
 *   PUT    /api/inbox/:id/process     流转：沉淀为康奈尔笔记 / 文档库 / 记忆宫殿 / 费曼故事
 *   DELETE /api/inbox/:id             软删除（移入回收站，status=trashed）
 *   ---- 进阶能力（2026-08-08） ----
 *   POST   /api/inbox/batch/process   批量归档 / 批量删除 / 批量沉淀为康奈尔笔记
 *   POST   /api/inbox/upload/audio    语音灵感：上传录音（multipart）→ <dataDir>/uploads/audio/
 *   POST   /api/inbox/upload/asset    通用附件：上传图片 / PDF（multipart）→ <dataDir>/uploads/assets/
 *   POST   /api/inbox/duplicate-check 智能去重：与近 7 天未处理条目做编辑距离相似度比对
 *
 * 业务实现见 services/inbox*.ts：
 *   inboxService（DB + 流转）/ inboxClipService（抓取）/ inboxUploadService（落盘）/ inboxDedupeService（判重）
 * 状态大小写映射集中在 inboxService 的 toStatusVo / toStatusDb，勿在别处硬编码。
 */
import { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';

import * as inboxController from '../controllers/inboxController';
import { MAX_UPLOAD_BYTES } from '../services/inboxUploadService';

export default async function inboxRoutes(app: FastifyInstance) {
  /* multipart 只在本插件作用域内注册（Fastify 插件天然封装），
   * 不污染其它路由的 body 解析；上限与 inboxUploadService 中保持一致。 */
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 8 },
  });

  app.get('/inbox/list', inboxController.list);
  app.get('/inbox', inboxController.listByStatus);
  app.post('/inbox', inboxController.create);

  app.get('/inbox/clip', inboxController.clip);
  app.post('/inbox/clip', inboxController.clip);
  app.get('/inbox/metadata', inboxController.metadata);
  app.post('/inbox/metadata', inboxController.metadata);

  app.put('/inbox/:id', inboxController.update);
  app.put('/inbox/:id/process', inboxController.process);

  app.post('/inbox/batch/process', inboxController.batchProcess);
  app.post('/inbox/upload/audio', inboxController.uploadAudio);
  app.post('/inbox/upload/asset', inboxController.uploadAsset);
  app.post('/inbox/duplicate-check', inboxController.duplicateCheck);

  app.delete('/inbox/:id', inboxController.remove);
}
