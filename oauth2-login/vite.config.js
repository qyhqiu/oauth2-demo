import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    open: true,
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        /**
         * 函数式 manualChunks（与 oauth2-console 同一套策略）
         * - 把变化频率低的第三方库独立成 chunk，提升浏览器缓存命中率
         * - antd 内部组件交叉引用严重，整体保留为单 chunk 避免循环依赖警告
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // React 核心
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return 'react-vendor';
          }

          // antd 图标（独立缓存）
          if (id.includes('@ant-design/icons')) {
            return 'antd-icons';
          }

          // antd 主体 + rc-* 子组件 + @rc-component
          if (
            /[\\/]node_modules[\\/]antd[\\/]/.test(id)
            || /[\\/]node_modules[\\/]rc-[a-z-]+[\\/]/.test(id)
            || /[\\/]node_modules[\\/]@rc-component[\\/]/.test(id)
            || /[\\/]node_modules[\\/]@ant-design[\\/](cssinjs|colors|fast-color)[\\/]/.test(id)
          ) {
            return 'antd-vendor';
          }

          // 工具库
          if (/[\\/]node_modules[\\/](axios|ahooks|dayjs|lodash|lodash-es)[\\/]/.test(id)) {
            return 'utils';
          }

          return undefined;
        },
      },
    },
  },
});
