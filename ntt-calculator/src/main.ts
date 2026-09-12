import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/main.css'
import { installNumericGuard } from './utils/numeric-input'
import { installLatinGuard } from './utils/latin-input'
import { hideHint, vHint } from './directives/hint'

const app = createApp(App)
app.use(createPinia())
app.use(router)
// Всплывающие сноски с пояснениями — одна директива на всё приложение
// (directives/hint.ts); окно рисует HintLayer в App.vue.
app.directive('hint', vHint)
// Смена экрана убирает открытую сноску: её пункт уже не на экране.
router.beforeEach(() => hideHint())
app.mount('#app')

// Числовые поля (класс `num`, атрибут `data-numeric`) принимают только число
// или выражение — текст в них не попадает. Одно правило на всё приложение:
// ставится на документ, а не на каждое поле (utils/numeric-input.ts).
installNumericGuard()

// Логин (поля с `data-latin`) принимает только латиницу: набранный в русской
// раскладке адрес почты не совпадёт ни с одной учётной записью, а человек
// будет искать ошибку в пароле (utils/latin-input.ts).
installLatinGuard()
