import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// Движок расчёта (src/engines) — чистые функции без Vue/DOM, поэтому
// environment: 'node'. jsdom подключать только если появятся тесты компонентов.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
