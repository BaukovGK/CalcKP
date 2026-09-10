import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginOxlint from 'eslint-plugin-oxlint'
import skipFormatting from 'eslint-config-prettier/flat'

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    name: 'app/hints',
    files: ['**/*.vue'],
    rules: {
      // Пояснения к пунктам и строкам — всплывающими сносками v-hint
      // (src/directives/hint.ts, Дизайн-бриф §8), а не нативным title: тот
      // появляется через секунду, не переносит строки и выглядит системной
      // подсказкой, а не частью интерфейса. У компонентов проп title — свой
      // (заголовок модала), поэтому правило только для HTML-элементов.
      'vue/no-restricted-static-attribute': [
        'error',
        { key: 'title', element: '/^[a-z][a-z0-9]*$/', message: 'Пояснение — через v-hint, а не title (Дизайн-бриф §8)' },
      ],
      'vue/no-restricted-v-bind': [
        'error',
        { argument: 'title', element: '/^[a-z][a-z0-9]*$/', message: 'Пояснение — через v-hint, а не :title (Дизайн-бриф §8)' },
      ],
    },
  },

  ...pluginOxlint.buildFromOxlintConfigFile('.oxlintrc.json'),

  skipFormatting,
)
