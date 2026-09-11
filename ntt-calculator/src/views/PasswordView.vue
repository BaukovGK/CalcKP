<template>
  <!-- Обязательная смена пароля (План_устранения 2.1): пароль задан не самим
       пользователем — при установке или администратором. Сервер до смены
       закрывает API (403 PASSWORD_CHANGE_REQUIRED), роутер держит здесь. -->
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-logo">НТТ · КАЛЬКУЛЯТОР</div>
      <div class="auth-sub">Смена пароля</div>

      <p class="pw-why">
        Пароль задан не вами — при установке системы или администратором.
        Работать дальше можно после смены: новый пароль будете знать только вы.
      </p>

      <div v-if="error" class="auth-err" role="alert">{{ error }}</div>

      <form @submit.prevent="onSubmit">
        <div class="ff">
          <label v-hint="PASSWORD_VIEW_HINTS.current" class="fl" for="pw-current">Текущий пароль</label>
          <input id="pw-current" v-model="form.current" class="fi" type="password" autocomplete="current-password" :disabled="busy" />
        </div>
        <div class="ff">
          <label v-hint="ACCOUNT_HINTS.next" class="fl" for="pw-next">Новый пароль</label>
          <input id="pw-next" v-model="form.next" class="fi" type="password" autocomplete="new-password" :disabled="busy" />
        </div>
        <div class="ff">
          <label v-hint="ACCOUNT_HINTS.repeat" class="fl" for="pw-repeat">Новый пароль ещё раз</label>
          <input id="pw-repeat" v-model="form.repeat" class="fi" type="password" autocomplete="new-password" :disabled="busy" />
        </div>
        <button type="submit" class="btn btn-am btn-full" :disabled="busy" style="margin-top:4px">
          {{ busy ? 'Сохраняем…' : 'Сменить пароль' }}
        </button>
      </form>

      <div class="auth-sep"></div>

      <button v-hint="ACCOUNT_HINTS.logout" class="btn btn-full btn-g" :disabled="busy" @click="onLogout">Выйти</button>

      <div class="auth-footer">{{ auth.user?.email }}</div>
    </div>
    <ToastHost />
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import ToastHost from '@/components/ui/ToastHost.vue'
import { usePasswordChange } from '@/composables/usePasswordChange'
import { toast } from '@/composables/useToast'
import { ACCOUNT_HINTS } from '@/hints/account'
import type { Hint } from '@/directives/hint'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { form, error, busy, submit } = usePasswordChange()

const PASSWORD_VIEW_HINTS: Record<'current', Hint> = {
  current: {
    title: 'Текущий пароль',
    text: 'Тот, с которым вы только что вошли: выданный администратором или заданный при установке системы.',
  },
}

/** Куда вернуться после смены: адрес, с которого сюда привёл роутер. */
function redirectTarget(): string {
  const r = route.query.redirect
  return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : '/'
}

async function onSubmit() {
  if (!(await submit())) return
  toast('Пароль изменён', 'success')
  await router.replace(redirectTarget())
}

async function onLogout() {
  await auth.logout()
  await router.push('/login')
}
</script>

<style scoped>
.pw-why { margin: 0 0 14px; font-size: 13.2px; line-height: 1.5; color: var(--muted); }
</style>
