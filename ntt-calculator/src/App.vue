<template>
  <RouterView />
  <HintLayer />
  <!-- «Сообщить об ошибке» — на каждом экране после входа. Демо-вход работает
       без сервера, отправлять ему некуда. -->
  <BugReportWidget v-if="auth.isLoggedIn && auth.accessToken !== 'demo-token'" />
</template>

<script setup lang="ts">
import HintLayer from '@/components/ui/HintLayer.vue'
import BugReportWidget from '@/components/ui/BugReportWidget.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
</script>
