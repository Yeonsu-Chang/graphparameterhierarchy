// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  css: {
    devSourcemap: false, // 개발 소스맵 off → 빠름
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['cytoscape', 'cytoscape-dagre'], // 미리 스캔
  },
  server: {
    fs: { strict: false },
  },
})
