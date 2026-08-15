import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';

import { resolvePort, resolveWebDir, resolveDataDir, getUploadsDir, getModelsDir, dataSubDir, isLaunchedByHost } from './lib/paths';
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
import aiAssistant from './routes/ai-assistant';
import library from './routes/library';
import mindmaps, { mindmapAiRoutes } from './routes/mindmap';
import config from './routes/config';
import review from './routes/review';
import search from './routes/search';
import dashboard from './routes/dashboard';
import inbox from './routes/inbox';
import pomodoro from './routes/pomodoro';
import schedule from './routes/schedule';
import habits from './routes/habits';
import quadrant from './routes/quadrant';
import tasks from './routes/tasks';
import lists from './routes/lists';
import calendar from './routes/calendar';
import backup from './routes/backup';
import interview from './routes/interview';
import qaBank from './routes/qaBank';
import models from './routes/models';
import diagram from './routes/diagram';
import diagramHistory from './routes/diagramHistory';
import { aiDiagramRoutes } from './routes/ai-diagram';
import ttsVoices from './routes/ttsVoices';
import insight from './routes/insight';
import * as insightService from './services/insightService';

const app = Fastify({ logger: false });

/**
 * CORS 白名单。
 *
 * ⚠️ 原实现是 `{ origin: true }`，即**反射任意 Origin**。虽然服务只监听 127.0.0.1
 * 不对局域网暴露，但这挡不住浏览器：用户在任意标签页打开的恶意网站，都能用
 * fetch('http://127.0.0.1:8787/api/...') 直接读取本机学习数据——反射式 CORS
 * 会让浏览器把响应体交给那个网站。本服务又完全没有鉴权，等于全库裸奔。
 *
 * 收敛为白名单后，只有应用自己的窗口来源可跨域读取：
 *   - 生产：窗口从 http://127.0.0.1:<port> 加载，属同源，但 Origin 头仍会带上；
 *   - 开发：Vite dev server 在 5173，通过 proxy 转发，同时直连也放行便于调试。
 * 非浏览器请求（curl / Node / Tauri 原生侧）不带 Origin，一律放行——
 * 它们本就不受同源策略约束，拦截没有意义，只会打断健康探测。
 */
const ALLOWED_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

app.register(cors, {
  origin(origin, cb) {
    // 无 Origin：同源导航、curl、Tauri 原生请求、健康探测
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGIN.test(origin)) return cb(null, true);
    // 明确拒绝而不是静默放行；浏览器侧表现为标准 CORS 报错，便于定位
    return cb(new Error('Origin not allowed'), false);
  },
});

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

/* ===== 收集箱（知识闭环第一步：极速输入，先积累再沉淀）=====
 * 独立前缀 /api：端点 /inbox/list、/inbox、/inbox/clip、/inbox/:id、/inbox/:id/process。
 * 存储复用 wb_capture 表（与 /api/workbench/captures 同一张表，两套契约并存：
 * 老接口用大写状态 + starred 语义，新接口对外收敛为小写三态 unprocessed/archived/trashed）。 */
app.register(inbox, { prefix: '/api' });

/* ===== 番茄钟（专注计时 + 白噪音 + 历史统计）=====
 * 独立前缀 /api：端点 /pomodoro/record、/pomodoro/stats、/pomodoro/config、/pomodoro/today。
 * 已完成时段落 wb_pomodoro_log（新表，不复用任何复习表），用户偏好落 pomodoro-config.json。 */
app.register(pomodoro, { prefix: '/api' });

/* ===== 日程计划 / 每日任务（晨间 Routine、备考日、重复任务）=====
 * 独立前缀 /api：端点 /schedule/templates 与 /schedule/tasks 系列，
 * 与既有 workbench 契约互不干扰；重复规则按需实时推算，不在启动期预生成。 */
app.register(schedule, { prefix: '/api' });

/* ===== 任务清单（Things 3 模型：收件箱 / 今天 / 计划 / 随时 / 某天 / 日志本）=====
 * 独立前缀 /api：端点 /tasks 与 /lists 两组。
 *
 * 与上面的 /schedule 是**继任关系**而非并列：/schedule 的「一天一张平铺清单」
 * 模型已由 /tasks 的「状态 + 清单 + 层级」取代，前端 /schedule 路由整体重定向到
 * /tasks。旧路由暂留是为了让日历联查与历史统计不断线，待旧数据消化完再摘除。 */
app.register(tasks, { prefix: '/api' });
app.register(lists, { prefix: '/api' });

/* ===== 习惯打卡（每日微习惯 + 连续打卡热力图）=====
 * 独立前缀 /api：端点 /habits 系列，与既有 workbench 契约互不干扰。 */
app.register(habits, { prefix: '/api' });

/* ===== 四象限 / 艾森豪威尔矩阵（紧急 × 重要 的 2×2 任务网格）=====
 * 独立前缀 /api：端点 /quadrant/tasks 系列。与 /schedule（按时间排任务）
 * 是互补关系——日程回答「什么时候做」，四象限回答「先做哪个」。 */
app.register(quadrant, { prefix: '/api' });

/* ===== 日历视图（月 / 周 / 日 三视图共用的时间轴事件）=====
 * 独立前缀 /api：端点 /calendar/events 系列。与 /schedule、/quadrant 三者互补——
 * 日程回答「今天这几件事做没做」，四象限回答「先做哪个」，
 * 日历回答「几点到几点被占用了」。
 * 唯一的读接口强制携带 start_date / end_date，不提供全量拉取形态。 */
app.register(calendar, { prefix: '/api' });

/* ===== 模拟面试 / 语音通话（离线 STT + LLM 编排，逐轮 SSE）=====
 * 独立前缀 /api：端点 /interview/transcribe（录音转写）、/interview/start、/interview/answer（SSE）。
 * 与既有 workbench 契约互不干扰；SSE 由控制器直接接管 reply.raw，绕过统一 JSON 信封。 */
app.register(interview, { prefix: '/api' });

/* ===== 模拟面试题库（手动面经 + 复习卡 + 康奈尔笔记统一题库层）=====
 * 独立前缀 /api：端点 /qa-bank 系列。 */
app.register(qaBank, { prefix: '/api' });
app.register(models, { prefix: '/api' });
app.register(diagram, { prefix: '/api' });
app.register(diagramHistory, { prefix: '/api' });
app.register(ttsVoices, { prefix: '/api' });

/* ===== AI 流程图生成（自然语言 → 流程图结构，坐标由前端 dagre 自动布局）=====
 * 挂在 /api/ai 下与既有 AI 能力同域；未配置 Key 时返回示例骨架而非报错。 */
app.register(aiDiagramRoutes, { prefix: '/api/ai' });

/* ===== 主动智能：每日学习日报（聚合 + AI 文案 + 薄弱点闪卡联动）=====
 * 端点 /insight/daily-report（只读聚合）、/insight/daily-report/generate（AI 文案）、
 * /insight/daily-report/generate-cards（薄弱点→wb_review_card）。 */
app.register(insight, { prefix: '/api/insight' });

/* ===== 数据自动备份（设置中心「数据备份」区 + Rust 每日调度器共用）=====
 * 独立前缀 /api：端点 /backup（立即备份）、/backup/schedule（GET/PUT 计划）。
 * 实际打包由 Node 侧车用 child_process 拉起 backup.js（archiver）完成。 */
app.register(backup, { prefix: '/api' });

// ===== AI 能力路由（独立前缀，不侵入既有 workbench 契约，未配置 Key 时整体降级）=====
app.register(ai, { prefix: '/api/ai' });

/* ===== AI 助手 / 多轮对话（对标 DeepSeek 网页端：会话管理 + 流式多轮 + RAG 上下文）=====
 * 独立前缀 /api/ai-assistant：会话/消息落本地 SQLite（wb_ai_conversation / wb_ai_message），
 * SSE 流式端点复用 RAG 检索，与 /api/ai/rag/ask 共用同一套知识库能力。 */
app.register(aiAssistant, { prefix: '/api/ai-assistant' });

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
  service: 'lectoforge-desktop-api',
  bootId: BOOT_ID,
  pid: process.pid,
  /* uptime 供前端识别「后端是刚被宿主重启起来的新实例」：
   * 重连成功后若 bootId 变了，说明侧车重启过，前端据此决定是否刷新只读缓存。 */
  uptimeMs: Date.now() - STARTED_AT,
  dataDir: resolveDataDir(),
  webDir: resolveWebDir(),
}));

/* ===== 同源托管用户上传资产（录音 / 图片 / 附件）=====
 * 落盘目录是 <dataDir>/uploads（打包后为 ~/Library/Application Support/com.lectoforge.desktop/uploads），
 * 与前端构建产物完全不同的两棵目录树，因此必须**再注册一次** @fastify/static。
 *
 * 两个要点：
 * 1. decorateReply: false —— @fastify/static 默认往 reply 上挂 sendFile()，同一实例注册两次会报
 *    "The decorator 'sendFile' has already been added"。这里让下面托管 webDir 的那次去装饰，
 *    本次只做纯静态目录映射。
 * 2. 必须先于 webDir 注册 —— webDir 是根路径通配（/*），先注册会把 /uploads/* 也吃掉。
 *
 * 前端拿到的 URL 形如 /uploads/audio/20260808-ab12cd.webm，dev 下由 vite proxy 转发，
 * 生产下与页面同源（都在 http://127.0.0.1:<port>），因此可直接塞进 <audio src> / Markdown 图片。 */
const uploadsDir = getUploadsDir();
app.register(staticPlugin, {
  root: uploadsDir,
  prefix: '/uploads/',
  decorateReply: false,
  // 录音/图片是内容寻址式命名（时间戳+随机 hex），文件名不变则内容不变，可长缓存
  maxAge: '7d',
});

/* ===== 同源托管离线模型资源（tesseract / whisper 的 wasm / worker / 语言包 / 模型）=====
 * 双根托管（@fastify/static 支持 array root）：
 *   1) <dataDir>/models（可写，优先）—— 运行时下载的 ggml 模型权重落这里；
 *   2) 打包资源目录 <RESOURCES_DIR>/models（只读兜底）—— tesseract 文件、whisper.wasm 等随包内置。
 * 二者都挂在 /models/ 下，前端 URL（/models/tesseract/...、/models/whisper/...）不变，
 * 下载的模型与内置的 wasm 共享同一域名，零 CORS、零外网依赖。
 * 必须先于 webDir 注册，否则根通配会吃掉 /models/*。 */
const dataModelsDir = dataSubDir('models');
const whisperRoots: string[] = [dataModelsDir];
const modelsDir = getModelsDir();
if (fs.existsSync(modelsDir)) whisperRoots.push(modelsDir);
app.register(staticPlugin, {
  root: whisperRoots,
  prefix: '/models/',
  decorateReply: false,
  maxAge: '30d',
});

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
    /* 上传资产必须如实 404：录音 .webm / 附件 .pdf 不在 ASSET_EXT 白名单里，
     * 若回落成 index.html，<audio> 会静默播不出声、下载下来是一坨 HTML。 */
    if (pathname.startsWith('/uploads/')) {
      return reply.code(404).type('text/plain').send(`upload not found: ${pathname}`);
    }
    /* 离线模型缺失时如实 404（.wasm/.gz/.traineddata 不在 ASSET_EXT 白名单），
     * 否则会回落成 index.html，前端 fetch 拿到 HTML 当成模型解析直接崩。 */
    if (pathname.startsWith('/models/')) {
      return reply.code(404).type('text/plain').send(`model not found: ${pathname}`);
    }
    if (ASSET_EXT.test(pathname)) {
      return reply.code(404).type('text/plain').send(`asset not found: ${pathname}`);
    }
    return reply.sendFile('index.html');
  });
} else {
  app.get('/', async () => ({ app: 'LectoForge 学习工作台桌面后端', status: 'ok', note: '前端未构建或 --web-dir 未指定' }));
}

/* 孤儿自检（仅当由 Tauri 宿主拉起时启用）。
 * 宿主若被强制退出或崩溃，它的退出回调来不及杀掉本进程，侧车就会常驻后台占着端口，
 * 下次启动只能往后漂，反复几次便堆积出一串僵尸后端。这里自行监测：
 * 一旦被 launchd 收养（ppid 变成 1），说明宿主没了，主动退出。 */
if (isLaunchedByHost()) {
  const orphanTimer = setInterval(() => {
    if (process.ppid === 1) {
      console.log('[lectoforge-desktop] 宿主已退出，侧车自动关闭');
      process.exit(0);
    }
  }, 5000);
  orphanTimer.unref();

  /* 主动智能：每日学习日报清晨推送。
   * 每小时轮询一次，命中本地 08:00 整点即生成昨日日报（聚合 + AI 文案）并落盘
   * <dataDir>/last-daily-report.json。用「当天日期标记」防同一天重复生成（覆盖同小时多次触发与重启）。 */
  const markerPath = path.join(resolveDataDir(), 'last-daily-report.json');
  const localDayKey = (d: Date = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const pushTimer = setInterval(async () => {
    const now = new Date();
    if (now.getHours() !== 8) return; // 仅本地 08:00 触发
    const todayKey = localDayKey(now);
    let marker: { date?: string } = {};
    try {
      marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    } catch {
      /* 首跑无标记文件，忽略 */
    }
    if (marker.date === todayKey) return; // 今日已生成，跳过
    try {
      const bundle = await insightService.runMorningPush();
      fs.writeFileSync(
        markerPath,
        JSON.stringify(
          { date: todayKey, reportDate: bundle.date, generatedAt: now.toISOString(), stats: bundle.stats, content: bundle.content },
          null,
          2,
        ),
      );
      console.log(`[lectoforge-desktop] 学习日报已生成（${bundle.date}）`);
    } catch (e) {
      console.error('[lectoforge-desktop] 学习日报生成失败', e);
    }
  }, 60 * 60 * 1000);
  pushTimer.unref();
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
      console.log(`[lectoforge-desktop] API on http://127.0.0.1:${port}`);
      console.log(`[lectoforge-desktop] data dir: ${resolveDataDir()}`);
      console.log(`[lectoforge-desktop] web dir: ${webDir ?? '(none)'}`);
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
