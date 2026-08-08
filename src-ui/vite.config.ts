import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  plugins: [vue()],
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
  },
});
