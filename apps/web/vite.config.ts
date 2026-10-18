/**
 * Vite 配置
 * - 开发：/api 与 /media 反向代理到后端 127.0.0.1:8080，前端零 CORS 烦恼
 * - 构建：产物落在 apps/web/dist，由后端同源托管（生产不需要额外配置 Nginx 路径）
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BACKEND = process.env.CJW_BACKEND ?? 'http://127.0.0.1:8080';
/** 本文件所在目录（apps/web）；用 import.meta.url 而非 __dirname，ESM 下同样可用 */
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 共享包直接吃 TS 源码，避免额外的构建步骤
      '@cangjingwu/shared': here('../../packages/shared/src/index.ts'),
      '@': here('./src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: false },
      '/media': { target: BACKEND, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        /**
         * 手动分块，两个作用：
         * 1) 缓存：第三方库不随业务代码变化，改一行业务不用让用户重下 1.5 MB
         * 2) 绕开本机 esbuild 的缺陷 —— 它对 ≥1 MB 的输入必挂
         *    （`remove %TEMP%\esbuild-xxx: Access is denied`，Windows 下临时文件映射未释放）。
         *    每个 chunk 都远小于 1 MB 就不会触发，因此不必牺牲压缩。
         */
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('highlight.js')) return 'hljs';
          if (id.includes('marked') || id.includes('dompurify') || id.includes('html-to-image')) {
            return 'markdown';
          }
          if (id.includes('react-router') || id.includes('react-dom') || /[\\/]react[\\/]/.test(id)) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
});
