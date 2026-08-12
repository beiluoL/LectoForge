/**
 * 题库路由（挂载前缀 /api，见 index.ts），对外端点：
 *   GET    /api/qa-bank                             列出题库（?sourceType=&tag=&difficulty=）
 *   GET    /api/qa-bank/:id                          取单条
 *   GET    /api/qa-bank/random-next                  随机抽一道（?sourceType=&tag=&difficulty=）
 *   POST   /api/qa-bank/import-md                    从 Markdown/纯文本面经导入 { text }
 *   POST   /api/qa-bank/import-pdf                   从 PDF 导入（multipart 文件字段）
 *   POST   /api/qa-bank/import-from-review-cards     复用复习卡（wb_review_card）
 *   POST   /api/qa-bank/import-from-notes            复用康奈尔笔记（wb_note）
 *
 * 业务实现见 services/qaBankService.ts；multipart 仅在本插件作用域注册。
 */
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';

import * as qaBankController from '../controllers/qaBankController';
import { MAX_UPLOAD_BYTES } from '../services/inboxUploadService';

export default async function qaBankRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 8 },
  });

  app.get('/qa-bank', qaBankController.list);
  app.get('/qa-bank/:id', qaBankController.get);
  app.get('/qa-bank/random-next', qaBankController.randomNext);
  app.post('/qa-bank/import-md', qaBankController.importMarkdown);
  app.post('/qa-bank/import-pdf', qaBankController.importPdf);
  app.post('/qa-bank/import-from-review-cards', qaBankController.importFromReviewCards);
  app.post('/qa-bank/import-from-notes', qaBankController.importFromNotes);
}
