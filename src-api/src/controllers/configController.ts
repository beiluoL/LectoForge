// 应用级配置控制器层：只做 HTTP 契约（解析 req.body、委派服务、塑造响应），
// 不含任何文件 IO 与业务逻辑。
import type { FastifyReply, FastifyRequest } from 'fastify';

import * as configService from '../services/configService';
import type { InitConfigInput } from '../services/configService';

/** GET /api/config —— 应用初始化时读取引导状态与数据目录偏好、AI 公共视图 */
export async function getConfig(_req: FastifyRequest, _reply: FastifyReply) {
  return configService.getConfigView();
}

/**
 * POST /api/config/init —— 引导完成 / 设置中心保存。
 * body: { dataDir?: string, aiSettings?: { apiUrl, apiKey, model }, hasOnboarded?: boolean }
 * 任何落盘异常都按 500 返回（沿用原路由的错误语义，onSend 钩子跳过信封装配）。
 */
export async function initConfig(req: FastifyRequest, reply: FastifyReply) {
  const b = (req.body || {}) as InitConfigInput;
  try {
    return configService.initConfig(b);
  } catch (e) {
    const message = e instanceof Error ? e.message : '配置保存失败';
    return reply.code(500).send({ code: 500, message });
  }
}
