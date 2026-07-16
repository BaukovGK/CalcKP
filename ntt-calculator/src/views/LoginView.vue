<template>
  <div class="auth-page">
    <div class="auth-card">

      <div class="auth-logo">НТТ · КАЛЬКУЛЯТОР</div>
      <div class="auth-sub">Система расчёта стоимости оборудования</div>

      <div v-if="error" class="auth-err">{{ error }}</div>

      <form @submit.prevent="onSubmit">
        <div class="ff">
          <label class="fl" for="email">Email</label>
          <input
            id="email"
            v-model="form.email"
            class="fi"
            type="email"
            placeholder="you@company.ru"
            autocomplete="email"
            :disabled="loading"
            required
          />
        </div>
        <div class="ff">
          <label class="fl" for="password">Пароль</label>
          <input
            id="password"
            v-model="form.password"
            class="fi"
            type="password"
            placeholder="••••••••"
            autocomplete="current-password"
            :disabled="loading"
            required
          />
        </div>

        <button type="submit" class="btn btn-am btn-full" :disabled="loading" style="margin-top:4px">
          {{ loading ? 'Вход…' : 'Войти' }}
        </button>
      </form>

      <div class="auth-sep"></div>

      <button class="btn btn-full btn-g" @click="onDemo" :disabled="loading">
        Войти как демо (без сервера)
      </button>

      <div class="auth-footer">
        Backend подключается в Sprint 4 · v0.2.0
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth   = useAuthStore()

const form    = reactive({ email: '', password: '' })
const loading = ref(false)
const error   = ref('')

async function onSubmit() {
  error.value = ''
  loading.value = true
  try {
    await auth.login(form.email, form.password)
    router.push('/')
  } catch (e: any) {
    error.value = e.message || 'Не удалось выполнить вход'
  } finally {
    loading.value = false
  }
}

function onDemo() {
  auth.loginDemo()
  router.push('/')
}
</script>
