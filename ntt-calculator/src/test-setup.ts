import { config } from '@vue/test-utils'
import { vHint } from '@/directives/hint'

// Директива сносок регистрируется в main.ts глобально; компоненты в тестах
// монтируются без приложения, поэтому регистрируем её и здесь — иначе Vue
// предупреждает о неизвестной директиве и сноски в тестах не проверить.
config.global.directives = { ...config.global.directives, hint: vHint }
