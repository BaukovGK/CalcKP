<template>
  <!-- Вход из вкладки Битрикс24 (ТЗ §10.3). Сервер проверил сотрудника у
       портала и привёл сюда: с одноразовым кодом — меняем на сессию, с
       причиной отказа — объясняем, что делать. -->
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-logo">НТТ · КАЛЬКУЛЯТОР</div>
      <div class="auth-sub">Вход через Битрикс24</div>

      <p v-if="busy" class="bx-text">Входим…</p>
      <template v-else>
        <div class="auth-err" role="alert">{{ message }}</div>
        <p v-if="hint" class="bx-text">{{ hint }}</p>
        <!-- Вне портала вход по паролю — запасной путь. -->
        <RouterLink v-if="!framed" to="/login" class="btn btn-full btn-g">Войти по паролю</RouterLink>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { insideFrame } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { apiErrorMessage } from '@/utils/api-error'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const framed = insideFrame()
const busy = ref(false)
const message = ref('')
const hint = ref('')

const REOPEN = 'Обновите вкладку в Битрикс24 — портал выполнит вход заново.'
const ASK_ADMIN = 'Обратитесь к администратору калькулятора.'

/** Причины отказа — коды с сервера (utils/bitrix-auth.ts, BitrixDenial). */
const DENIALS: Record<string, [string, string]> = {
  no_account: [
    'Для вас ещё нет учётной записи в калькуляторе.',
    'Администратор заводит её на вашу почту из Битрикс24 и назначает роль — после этого откройте вкладку заново.',
  ],
  no_email: [
    'Битрикс24 не передал калькулятору вашу почту.',
    'У приложения в портале не хватает прав: нужны «Пользователи (базовые)». Сообщите администратору Битрикс24.',
  ],
  blocked: ['Ваша учётная запись в калькуляторе заблокирована.', ASK_ADMIN],
  email_taken: ['Учётная запись с вашей почтой уже привязана к другому сотруднику Битрикс24.', ASK_ADMIN],
  portal_inactive: ['Ваша учётная запись в Битрикс24 неактивна.', ASK_ADMIN],
  portal_error: ['Битрикс24 не подтвердил вход.', REOPEN],
  wrong_portal: ['Запуск не с портала компании.', 'Откройте калькулятор из Битрикс24 компании.'],
  wrong_app: ['Запуск не из приложения калькулятора в Битрикс24.', ASK_ADMIN],
  bad_request: ['Битрикс24 не передал данные для входа.', REOPEN],
  disabled: ['Вход через Битрикс24 на сервере не включён.', ASK_ADMIN],
  session: ['Сеанс завершён.', REOPEN],
}

function show(code: string) {
  const [m, h] = DENIALS[code] ?? ['Войти не удалось.', REOPEN]
  message.value = m
  hint.value = h
}

onMounted(async () => {
  const code = route.query.code
  const error = route.query.error
  if (typeof code === 'string' && code) {
    busy.value = true
    try {
      await auth.loginWithBitrix(code)
      await router.replace('/')
      return
    } catch (e) {
      message.value = apiErrorMessage(e, 'Войти не удалось')
      hint.value = REOPEN
    } finally {
      busy.value = false
    }
    return
  }
  show(typeof error === 'string' ? error : 'bad_request')
})
</script>

<style scoped>
.bx-text { margin: 0 0 14px; font-size: 13.5px; line-height: 1.5; color: var(--muted); }
</style>
