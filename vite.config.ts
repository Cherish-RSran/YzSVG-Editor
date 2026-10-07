import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 把入口脚本改成经典脚本（去掉 type=module 与 crossorigin），
 * 这样构建产物可以用 file:// 直接双击打开，不受 ES module 的 CORS 限制。
 */
function classicScript(): Plugin {
  return {
    name: 'classic-script',
    transformIndexHtml: {
      order: 'post',
      handler(html: string) {
        return html
          .replace(/<script type="module"([^>]*)>/g, '<script$1 defer>')
          .replace(/\scrossorigin(?=[=\s>])/g, '');
      },
    },
  };
}

export default defineConfig({
  // 刻意不接 Service Worker：这个产物是双击 dist/index.html 直接跑的，
  // 一旦注册了 SW，旧版本会被缓存住，出现「明明改了代码，浏览器里还是老样子」。
  plugins: [react(), classicScript()],
  // 使用相对路径 + 经典脚本输出，构建产物可直接双击打开（无需服务器）
  base: './',
  build: {
    target: 'es2019',
    modulePreload: false,
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'assets/[name].js' },
    },
  },
  server: { port: 5173, host: true },
});
