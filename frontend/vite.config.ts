import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: true,  // 核心配置：监听所有网络接口
    strictPort: true,  // 端口被占用时直接报错
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8080',
        ws: true,
      },
    },
  },
})
