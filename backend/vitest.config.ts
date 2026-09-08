import { defineConfig } from 'vitest/config'

/**
 * Тесты бэкенда — чистые модули (расчёты насосной станции, гидравлика, подбор
 * насоса, модель печатной формы КП). БД им не нужна, поэтому environment: node.
 *
 * `include` сужен до `src/**` намеренно. Без него vitest берёт файлы по всему
 * пакету и подхватывает СОБРАННЫЕ копии из `dist/`, которые падают с «Vitest
 * cannot be imported in a CommonJS module using require()». В CI шаг
 * `npm test` идёт после `npm run build`, то есть dist там всегда существует.
 * Второй рубеж — `exclude` в tsconfig.json: тесты вообще не компилируются.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
})
