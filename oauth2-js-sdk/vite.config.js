import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'OAuth2ClientSDK',
      fileName: (format) => `oauth2-js-sdk.${format}.js`,
      // 输出 es、umd、iife 三种格式：
      // - iife：script 标签直接引入（静态 HTML 页面使用）
      // - es：ES Module 方式引入（Vite/Webpack 项目使用）
      // - umd：兼容 CommonJS / AMD / 全局变量（Node.js 或旧项目使用）
      formats: ['es', 'umd', 'iife'],
    },
    rollupOptions: {
      // axios 打包进 SDK，无需宿主页面额外引入 axios
      external: [],
      output: {
        exports: 'named',
        banner: '',
      },
    },
  },
});
