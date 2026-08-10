import { defineConfig, type PluginOption } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { visualizer } from 'rollup-plugin-visualizer';

/* 是否生成打包体积分析报告。
 * 默认关闭——日常 `npm run build` 不该被浏览器弹窗打断，也不该多花几秒写 stats.html。
 * 需要看体积时执行：ANALYZE=1 npm run build（见 package.json 的 build:analyze 脚本）。 */
const ANALYZE = process.env.ANALYZE === '1';

/**
 * 第三方依赖分包表：`匹配片段 → chunk 名`。
 *
 * 顺序敏感，自上而下取首个命中项。因此**更具体的规则必须排在更宽泛的前面**，
 * 典型如 `vue-chartjs` / `@vue-flow` 都含 "vue" 字样，必须排在裸 `vue` 之前，
 * 否则会被 vendor-vue 抢走，分包退化。
 *
 * 不分包的后果：所有依赖压进单个 vendor.js（本项目约 1.5MB+），
 * 首屏必须等整包下载解析完才能渲染，而其中 markmap / vue-flow / jspdf
 * 只有进到对应页面才会用到——它们跟着路由懒加载走独立 chunk 才是正确形态。
 */
const VENDOR_CHUNKS: Array<[string[], string]> = [
  // —— 必须在裸 vue 规则之前 ——
  [['vue-chartjs', 'chart.js'], 'vendor-chart'],
  [['@vue-flow'], 'vendor-flow'],
  [['lucide-vue-next'], 'vendor-icons'],

  // 核心框架：首屏必需，单独成块以获得最佳长期缓存命中率（版本不变则文件名不变）
  [['/vue/', '/vue-router/', '/@vue/', '/pinia/', 'pinia-plugin-persistedstate'], 'vendor-vue'],

  /* 思维导图：仅 /mindmap 路由使用。markmap 自带整套 d3，并通过 transformer 插件
   * 传递依赖 katex(617KB) 与 yaml(238KB)——这两个必须显式列进来，否则会漏进
   * vendor-misc 拖累首屏（实测未列时 vendor-misc 达 716KB，其中 katex 独占 617KB）。 */
  [
    ['markmap-lib', 'markmap-view', 'markmap-common', 'markmap-html-parser', '/d3-', 'd3-flextree', 'katex', '/yaml/'],
    'vendor-markmap',
  ],

  // Markdown 渲染 + 代码高亮：highlight.js 的语言包体积可观，与编辑器页强绑定
  [['markdown-it', 'highlight.js', 'entities/', 'linkify-it', 'mdurl', 'dompurify'], 'vendor-markdown'],

  /* 导出能力：只在「导出 PDF / 长图」时触发，典型冷路径。
   * canvg / pako 是 jspdf 的传递依赖（SVG 光栅化 / zlib 压缩）；
   * core-js 也必须跟着走——它是 canvg 拖进来的 polyfill，
   * 若留在 vendor-misc 会形成 vendor-misc ⇄ vendor-export 循环引用，
   * Rollup 会报 "Circular chunk" 并退化分包效果。 */
  [['jspdf', 'html2canvas', 'canvg', 'pako', 'core-js'], 'vendor-export'],

  // 音频：番茄钟白噪音专用
  [['howler'], 'vendor-audio'],

  // 通用工具：全站高频复用，合成一块避免碎片化
  [['axios', 'dayjs', '@vueuse'], 'vendor-common'],
];

export default defineConfig({
  plugins: [
    vue(),
    /* 打包体积可视化。gzipSize/brotliSize 会让分析构建变慢，
     * 但没有压缩后体积的报告参考价值很低——反正只在 ANALYZE=1 时才跑。 */
    ANALYZE &&
      (visualizer({
        filename: 'dist/stats.html',
        // CI / 脚本化场景用 ANALYZE_OPEN=0 抑制自动弹浏览器
        open: process.env.ANALYZE_OPEN !== '0',
        gzipSize: true,
        brotliSize: true,
        template: 'treemap',
      }) as PluginOption),
  ].filter(Boolean) as PluginOption[],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // 共享契约别名：反向引用后端 src-api/src/types（纯类型，仅 import type，bundle 不含 Node 代码）
      '@shared': path.resolve(__dirname, '../src-api/src/types'),
    },
  },

  server: {
    port: 5173,
    // 允许 dev server 读取项目根之外的 src-api 目录（供 @shared 别名解析）
    fs: { allow: ['..'] },
    /* 开发期前端直连本地 Node 后端（与 Tauri 生产同源托管解耦）。
     * /uploads 是用户上传资产（录音 / 图片 / 附件）的同源目录，由后端 @fastify/static
     * 从 <dataDir>/uploads 托管；不代理的话 dev 下 <audio src="/uploads/..."> 会打到
     * vite 自身返回 index.html，表现为「录音存住了但播不出来」。 */
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/uploads': 'http://127.0.0.1:8787',
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,

    /* 产物是本地打进 .app 的，不走 CDN 也就没有网络传输成本，
     * 但 sourcemap 会让 Resources/web 体积翻倍以上，生产关闭。
     * 需要定位线上报错时临时改为 'hidden' 重新构建即可。 */
    sourcemap: false,

    /* 默认 4KB 以下资源会内联成 base64。桌面端是本地读盘，
     * 省下的那次请求毫无价值，反而让 base64 撑大 JS、拖慢解析，故关闭内联。 */
    assetsInlineLimit: 0,

    // 分包后单块理应都在 500KB 以内；仍然告警说明分包表需要补规则
    chunkSizeWarningLimit: 600,

    /* 压缩器：Terser 比 Vite 默认的 esbuild 压缩率更高，打进 .app 后体积更小，
     * 代价是构建稍慢（本地打包可接受）。passes:2 跑两轮压缩，进一步榨干冗余。
     * 若日后构建慢到不可接受，改回 'esbuild' 即可瞬间回退。 */
    minify: 'terser',
    terserOptions: {
      compress: { passes: 2 },
      format: { comments: false },
    },

    /* 让每次 `npm run build` 顺带打印 gzip 后的产物体积，便于长期盯住首屏 chunk
     * 不悄悄膨胀（Vite 默认即 true，这里显式声明以表意图）。 */
    reportCompressedSize: true,

    rollupOptions: {
      output: {
        /**
         * 手动分包：把重型第三方库拆成按需加载的独立 chunk。
         *
         * 只处理 node_modules 内的模块；业务代码保持默认行为，
         * 由 router 的 `() => import()` 自然切成路由级 chunk（已全部懒加载，勿改回静态导入）。
         *
         * @param id 模块的绝对路径 id
         * @returns chunk 名；返回 undefined 交还 Rollup 默认策略
         */
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined;
          // 统一分隔符，避免 Windows 下 '\' 导致 '/vue/' 之类的规则失配
          const normalized = id.replace(/\\/g, '/');
          for (const [patterns, chunk] of VENDOR_CHUNKS) {
            if (patterns.some((p) => normalized.includes(p))) return chunk;
          }
          /* 未命中白名单的零散依赖一律返回 undefined，交还 Rollup 默认策略。
           * ⚠️ 不要图省事兜底成 'vendor-misc'：那样会把 canvg / html2canvas 的
           * 各级传递依赖（@babel/runtime、rgbcolor、text-segmentation…）
           * 硬塞进一个与 vendor-export 相互引用的块，Rollup 报
           * "Circular chunk: vendor-misc -> vendor-export -> vendor-misc"，
           * 分包退化且运行期存在初始化顺序风险。实测改回 undefined 后告警消失，
           * 且 Rollup 自动把它们并入真正引用它们的块，总体积反而更小。 */
          return undefined;
        },

        // 产物按类型归档，便于人工核对 Resources/web 里到底装了什么
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
  },
});
