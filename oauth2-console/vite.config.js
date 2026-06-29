import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/variables" as *;`,
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 3010,
  },
  build: {
    // 拆分代码避免单个 chunk 超过 500KB
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        /**
         * 函数式 manualChunks：把"非 antd 主体"的重依赖独立拆 chunk，提升首屏。
         *
         * 注意：antd 内部组件之间存在大量交叉引用（Form 用 Button，Modal 用 Form 等），
         * 强行从 antd 中切出 Form/ColorPicker 子 chunk 会触发 Rollup 循环依赖警告，
         * 反而无法被并行加载。因此 antd 整体保留为单 chunk，只拆 icons / 重型业务库。
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // React 核心：相对小巧 + 长期不变
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'react-vendor';
          }

          // antd 图标：体积大、引用频繁，单独拆出后可被独立缓存
          if (id.includes('@ant-design/icons')) {
            return 'antd-icons';
          }

          // 图表库：仅详情页使用，与 antd 解耦后其他页面首包更小
          if (id.includes('recharts') || /[\\/]d3-[a-z]+[\\/]/.test(id)) {
            return 'charts';
          }

          // antd 主体 + rc-* 组件 + @rc-component（保持完整避免循环依赖）
          // 说明：尝试过把 ColorPicker 等重型子组件单独拆 chunk，但 antd 内部
          // locale/message/notification 等模块互相交叉引用，rollup 无法切干净，
          // 强行拆分会触发循环依赖警告且体积无明显下降。最终采取的是"组件级别"
          // 的 React.lazy 拆分（让品牌化 Tab 组件独立 chunk），效果由首屏跳过
          // 该 Tab 时不下载 BrandingForm chunk 来体现，而非物理切割 ColorPicker。
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
