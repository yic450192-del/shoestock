import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 注意：测试配置不放这里。
// Vite 8 的插件类型与 vitest 内置的 vite 类型不互通，混用 defineConfig 来源会产生
// 难以消除的重载冲突。vitest 的默认 include 已经覆盖 src/**/*.spec.ts，无需额外配置。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
  },
})
