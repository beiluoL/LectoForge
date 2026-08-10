// 数据备份控制器层：只做 HTTP 契约（解析 body、委派服务、塑造错误响应），不含文件 IO 与业务逻辑。
import type { FastifyReply, FastifyRequest } from 'fastify';

import * as backupService from '../services/backupService';
import type { BackupSchedule } from '../services/backupService';

/** POST /api/backup —— 立即备份一次。body: { outDir: string } */
export async function runBackup(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as { outDir?: string };
  if (!b.outDir || !b.outDir.trim()) {
    return reply.code(400).send({ code: 400, message: '备份输出目录不能为空' });
  }
  try {
    return await backupService.runBackup(b.outDir);
  } catch (e) {
    const message = e instanceof Error ? e.message : '备份失败';
    return reply.code(500).send({ code: 500, message });
  }
}

/** GET /api/backup/schedule —— 读取每日自动备份计划 */
export async function getSchedule(_req: FastifyRequest, _reply: FastifyReply): Promise<BackupSchedule> {
  return backupService.getSchedule();
}

/** PUT /api/backup/schedule —— 保存每日自动备份计划。body: { enabled?, time?, outDir? } */
export async function setSchedule(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as Partial<BackupSchedule>;
  try {
    return backupService.setSchedule(b);
  } catch (e) {
    const message = e instanceof Error ? e.message : '保存备份计划失败';
    return reply.code(500).send({ code: 500, message });
  }
}
