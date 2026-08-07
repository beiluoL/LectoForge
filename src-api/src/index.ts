import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';

import { resolvePort, resolveWebDir, resolveDataDir, isLaunchedByHost } from './lib/paths';
import captures from './routes/captures';
import notes from './routes/notes';
import reviews from './routes/reviews';
import palaces from './routes/palaces';
import recall from './routes/recall';
import stories from './routes/stories';
import overview from './routes/overview';
import categories from './routes/categories';
import migration from './routes/migration';
import ai from './routes/ai';
import library from './routes/library';
import mindmaps, { mindmapAiRoutes } from './routes/mindmap';
import config from './routes/config';
import review from './routes/review';
import search from './routes/search';
import dashboard from './routes/dashboard';

const app = Fastify({ logger: false });

app.register(cors, { origin: true });

app.setErrorHandler((err, _req, reply) => {
  if (err.validation) return reply.code(400).send({ code: 400, message: 'invalid request' });
  const status = (err as any).statusCode || 500;
  if (status >= 500) console.error(err);
  return reply.code(status).send({ code: status, message: err.message || 'internal error' });
});

// 容忍空请求体：部分客户端（如带 Content-Type: application/json 的空 body PUT）
// 会触发 Fastify 默认 JSON 解析器报错；对齐 Web 端忽略空体的行为，统一解析为 {}。
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  if (body === '' || body == null) return done(null, {});
  try {
    done(null, JSON.parse(body as string));
  } catch (e) {
    done(e as Error, undefined);
  }
});

/**
 * 统一响应信封：所有成功（2xx）的 JSON 响应包成 { code: 200, data }，
 * 与 Web 端 Result<T> 契约一致（前端 request.ts 解包 .data）。
 * 错误响应（>=400）与 204/非 JSON 响应保持原样透传。
 */
app.addHook('onSend', (req, reply, payload, done) => {
  const status = reply.statusCode;
  if (status >= 400) return done(null, payload as any);
  if (status === 204 || payload === undefined || payload === '') return done(null, payload as any);
  const ct = reply.getHeader('content-type');
  if (typeof payload !== 'string' || !String(ct).includes('application/json')) {
    return done(null, payload as any);
  }
  try {
    const parsed = JSON.parse(payload);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      'code' in parsed &&
      'data' in parsed
    ) {
      return done(null, payload);
    }
    return done(null, JSON.stringify({ code: 200, data: parsed }));
  } catch {
    return done(null, payload as any);
  }
});

// ===== 注册学习工作台路由（与 Web 端 /api/workbench/* 契约对齐）=====
const wbPrefix = '/api/workbench';
for (const r of [overview, captures, notes, reviews, palaces, recall, stories, migration]) {
  app.register(r, { prefix: wbPrefix });
}
app.register(categories, { prefix: '/api/categories' });

/* ===== 应用级配置路由（新手引导 + 全局设置中心）=====
 * 前缀 /api：内部路由为 /config 与 /config/init，避免 register 前缀带来的尾斜杠匹配问题。 */
app.register(config, { prefix: '/api' });

/* ===== 间隔重复复习系统（跨 notes + loci 的 SM-2 卡牌）=====
 * 独立前缀 /api：端点 /reviews/due 与 /reviews/submit（与 /api/workbench/reviews/* 的
 * wb_review_card 旧系统互不干扰）。 */
app.register(review, { prefix: '/api' });

/* ===== 全局搜索（Cmd+K 命令面板后端）=====
 * 独立前缀 /api：端点 /search 跨 收集箱/笔记/故事 三表模糊检索，与既有 workbench 契约互不干扰。 */
app.register(search, { prefix: '/api' });

/* ===== 首页聚合统计（工作台数字气泡 + 今日聚焦的唯一数据源）=====
 * 独立前缀 /api：端点 /dashboard/stats，跨表实时聚合，与 /api/workbench/overview 并存
 * （overview 服务于 6 指标数据看板，dashboard 服务于闭环四步 + 今日聚焦）。 */
app.register(dashboard, { prefix: '/api' });

// ===== AI 能力路由（独立前缀，不侵入既有 workbench 契约，未配置 Key 时整体降级）=====
app.register(ai, { prefix: '/api/ai' });

/* ===== 文档库路由（Obsidian 式本地 Markdown 笔记，直接读写用户磁盘）=====
 * 独立前缀 /api/library：这里的 "notes" 指磁盘上的 .md 文件，
 * 与 /api/workbench/notes（数据库里的康奈尔笔记）是两套东西，前缀分开避免语义混淆。 */
app.register(library, { prefix: '/api/library' });

/* ===== 思维导图路由（大纲 / 导图 / 流程图三视图共用一份文档）=====
 * CRUD 落本地 JSON 文件（<dataDir>/mindmaps/*.json），与数据库彻底解耦；
 * AI 生成挂在 /api/ai 下与既有 AI 能力同域，未配置 Key 时降级为 Mock 而非报错。 */
app.register(mindmaps, { prefix: '/api/mindmaps' });
app.register(mindmapAiRoutes, { prefix: '/api/ai' });

/* 健康检查：供 Tauri 宿主确认「这个端口上的服务确实是自己刚拉起的那一个」。
 * 仅靠 TCP 连通性判断是不够的——端口可能被上一次没退干净的实例或别的程序占着。 */
const BOOT_ID = `${process.pid}-${Date.now()}`;
const STARTED_AT = Date.now();
app.get('/api/health', async () => ({
  status: 'ok',
  service: 'knowflow-desktop-api',
  bootId: BOOT_ID,
  pid: process.pid,
  /* uptime 供前端识别「后端是刚被宿主重启起来的新实例」：
   * 重连成功后若 bootId 变了，说明侧车重启过，前端据此决定是否刷新只读缓存。 */
  uptimeMs: Date.now() - STARTED_AT,
  dataDir: resolveDataDir(),
  webDir: resolveWebDir(),
}));

// ===== 同源托管前端构建产物（生产由 Tauri 传入 --web-dir）=====
const webDir = resolveWebDir();
if (webDir && fs.existsSync(webDir)) {
  /* 必须使用通配路由（wildcard 默认 true）。
   * 曾用 wildcard:false，它会在插件注册那一刻枚举目录树并为已存在的子目录建路由；
   * 一旦重新打包（assets 目录被删除重建为新 inode），常驻进程注册的路由就指向了
   * 已消失的旧目录，此后所有 /assets/* 永久 404 —— 表现为页面卡在 HTML 已加载。 */
  app.register(staticPlugin, { root: webDir });
  // Vite 构建产物对 <script type="module"> 会带 crossorigin 属性，
  // WKWebView 加载本地回环地址时仍按 CORS 模块处理，必须显式返回 Access-Control-Allow-Origin，
  // 否则模块脚本会被静默拒绝，导致页面空白。
  app.addHook('onSend', (req, reply, payload, done) => {
    const origin = req.headers.origin;
    if (origin) reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
    done(null, payload as any);
  });
  /* SPA 回退只允许给「页面路由」，带扩展名的静态资源必须如实 404。
   * 否则缺失的 .js 会被回落成 index.html，浏览器按 text/html 拒绝执行模块脚本，
   * 且控制台不报错 —— 白屏且无任何线索，极难排查。 */
  const ASSET_EXT = /\.(js|mjs|css|map|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|eot|wasm)$/i;
  app.setNotFoundHandler((req, reply) => {
    const pathname = req.url.split('?')[0];
    if (pathname.startsWith('/api/')) {
      return reply.code(404).send({ code: 404, message: 'not found' });
    }
    if (ASSET_EXT.test(pathname)) {
      return reply.code(404).type('text/plain').send(`asset not found: ${pathname}`);
    }
    return reply.sendFile('index.html');
  });
} else {
  app.get('/', async () => ({ app: 'KnowFlow 学习工作台桌面后端', status: 'ok', note: '前端未构建或 --web-dir 未指定' }));
}

/* 孤儿自检（仅当由 Tauri 宿主拉起时启用）。
 * 宿主若被强制退出或崩溃，它的退出回调来不及杀掉本进程，侧车就会常驻后台占着端口，
 * 下次启动只能往后漂，反复几次便堆积出一串僵尸后端。这里自行监测：
 * 一旦被 launchd 收养（ppid 变成 1），说明宿主没了，主动退出。 */
if (isLaunchedByHost()) {
  const orphanTimer = setInterval(() => {
    if (process.ppid === 1) {
      console.log('[knowflow-desktop] 宿主已退出，侧车自动关闭');
      process.exit(0);
    }
  }, 5000);
  orphanTimer.unref();
}

/* ===== 启动：仅绑定回环地址 =====
 * 端口策略按启动来源分两种，区别很关键：
 * - 宿主模式（Tauri 拉起）：端口由宿主协商后传入，**绝不允许漂移**。
 *   窗口加载的页面 origin 就是 http://127.0.0.1:<port>，侧车崩溃重启后若换了端口，
 *   已加载的页面永远连不回来，前端的断线重连就成了死循环。
 *   端口被上一条正在退出的实例占着属于正常时序，等它释放即可（最多 ~6 秒）。
 * - 独立模式（npm run dev:api）：保留 +1 漂移，避免开发时端口冲突挡住调试。 */
async function start() {
  let port = resolvePort();
  const hosted = isLaunchedByHost();
  const attempts = hosted ? 30 : 20;

  for (let i = 0; i < attempts; i++) {
    try {
      await app.listen({ port, host: '127.0.0.1' });
      console.log(`[knowflow-desktop] API on http://127.0.0.1:${port}`);
      console.log(`[knowflow-desktop] data dir: ${resolveDataDir()}`);
      console.log(`[knowflow-desktop] web dir: ${webDir ?? '(none)'}`);
      return;
    } catch (e: any) {
      if (e.code !== 'EADDRINUSE') throw e;
      if (hosted) {
        // 等旧实例把监听套接字彻底释放，端口保持不变
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      port += 1;
    }
  }
  throw new Error(hosted ? `端口 ${port} 长时间被占用，放弃启动` : '无法找到可用端口');
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});

export default app;
