import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Движок расчёта (src/engines) — чистые функции без Vue/DOM, поэтому по
// умолчанию environment: 'node'. Тесты компонентов (ячейки ввода) объявляют
// `// @vitest-environment jsdom` в шапке файла; vue-плагин нужен, чтобы
// vitest вообще смог импортировать .vue.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // Глобальная директива сносок v-hint — и в тестах компонентов, как в main.ts.
    setupFiles: ['src/test-setup.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
