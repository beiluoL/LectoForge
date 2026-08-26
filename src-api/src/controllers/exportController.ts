/**
 * 数据导出控制器：CSV 直写响应（信封例外的延续，同 SSE）。
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import * as exportService from '../services/exportService';

function sendCsv(reply: FastifyReply, filename: string, content: string) {
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .header('Content-Length', String(Buffer.byteLength(content)))
    .send(content);
}

export function reviews(_req: FastifyRequest, reply: FastifyReply) {
  return sendCsv(reply, 'lectoforge-reviews.csv', exportService.exportReviewsCsv());
}

export function habits(_req: FastifyRequest, reply: FastifyReply) {
  return sendCsv(reply, 'lectoforge-habits.csv', exportService.exportHabitsCsv());
}

export function tasks(_req: FastifyRequest, reply: FastifyReply) {
  return sendCsv(reply, 'lectoforge-tasks.csv', exportService.exportTasksCsv());
}
