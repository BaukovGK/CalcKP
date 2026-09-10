import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/main.css'
import { installNumericGuard } from './utils/numeric-input'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// Числовые поля (класс `num`, атрибут `data-numeric`) принимают только число
// или выражение — текст в них не попадает. Одно правило на всё приложение:
// ставится на документ, а не на каждое поле (utils/numeric-input.ts).
installNumericGuard()
