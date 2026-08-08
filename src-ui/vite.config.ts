import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
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
