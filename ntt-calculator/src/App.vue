<template>
  <RouterView />
  <HintLayer />
  <template v-if="showBugReport">
    <BugReportFab v-if="!hasShellButton" />
    <BugReportDialog />
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import HintLayer from '@/components/ui/HintLayer.vue'
import BugReportDialog from '@/components/ui/BugReportDialog.vue'
import BugReportFab from '@/components/ui/BugReportFab.vue'
import { hasShellButton, useBugReportAvailable } from '@/composables/useBugReport'

const route = useRoute()
const available = useBugReportAvailable()

/**
 * «Сообщить о проблеме» — на каждом экране и вкладке после входа, кроме
 * самого входа. Кнопка стоит в оболочке экрана (`BugReportButton`); у экрана
 * без неё — запасная в углу. Окно отчёта одно, общее.
 */
const showBugReport = computed(() => available.value && route.name !== 'login')
</script>
