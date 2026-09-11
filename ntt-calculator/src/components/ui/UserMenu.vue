<template>
  <div class="um" :class="{ 'um--inline': inline }">
    <button
      v-if="!isDemo"
      v-hint="ACCOUNT_HINTS.changePassword"
      class="btn btn-g"
      :class="{ 'btn-full': !inline }"
      @click="passwordOpen = true"
    >
      Сменить пароль
    </button>
    <button v-hint="ACCOUNT_HINTS.logout" class="btn btn-g" :class="{ 'btn-full': !inline }" @click="logout">Выйти</button>
    <ChangePasswordModal :show="passwordOpen" @close="passwordOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import ChangePasswordModal from '@/components/ui/ChangePasswordModal.vue'
import { useAuthStore } from '@/stores/auth'
import { useProjectsStore } from '@/stores/projects'
import { ACCOUNT_HINTS } from '@/hints/account'

/**
 * Блок пользователя: смена своего пароля и выход — на каждом основном экране.
 *
 * Прежде «Выйти» было только на экране проектов, а технолога и снабженца
 * роутер оттуда переводит на «Шаблоны» и «Прайс»: выйти им было неоткуда.
 * Смены пароля в интерфейсе не было вовсе — только запросом к API.
 *
 * @prop inline — в строку, для топбара; по умолчанию — столбиком, для
 *   подвала боковой панели.
 */
defineProps<{ inline?: boolean }>()

const auth = useAuthStore()
const projects = useProjectsStore()
const router = useRouter()
const passwordOpen = ref(false)

/** Демо-вход работает без сервера — пароля у него нет. */
const isDemo = computed(() => auth.accessToken === 'demo-token')

async function logout() {
  await auth.logout()
  projects.clear()
  await router.push('/login')
}
</script>

<style scoped>
.um { display: flex; flex-direction: column; gap: 2px; }
.um--inline { flex-direction: row; align-items: center; gap: 6px; }
</style>
