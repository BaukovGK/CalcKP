<template>
  <!-- Вкладка «Калькулятор» в карточке сделки Битрикс24
       (doc/План_Б24_сделка.md). Пока — шапка сделки из портала; проекты
       и КП по сделке появятся на следующих этапах. -->
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <button class="back-link" @click="router.push('/')">← Проекты</button>
        <div class="logo">Сделка</div>
        <div class="logo-sub">{{ auth.user?.name }}</div>
      </div>
      <div class="sidebar-scroll"></div>
      <div class="sidebar-footer">
        <BugReportButton />
        <ThemeToggle />
        <UserMenu />
      </div>
    </aside>

    <div class="main-col">
      <div class="topbar">
        <div class="tb-title">{{ deal?.title ?? `Сделка №${id}` }}</div>
      </div>

      <div class="calc-area">
        <p v-if="loading" class="dl-muted">Загружаем сделку из Битрикс24…</p>
        <div v-else-if="error" class="dl-card">
          <div class="auth-err" role="alert">{{ error }}</div>
        </div>
        <div v-else-if="deal" class="dl-card">
          <dl class="dl-grid">
            <dt>Заказчик</dt><dd>{{ deal.customer ?? '—' }}</dd>
            <dt>Ответственный</dt><dd>{{ deal.assignedName ?? '—' }}</dd>
            <dt>Сумма в сделке</dt><dd>{{ money(deal) }}</dd>
          </dl>
          <a v-if="!framed" :href="deal.url" target="_blank" rel="noopener" class="dl-link">Открыть в Битрикс24 ↗</a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BugReportButton from '@/components/ui/BugReportButton.vue'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import UserMenu from '@/components/ui/UserMenu.vue'
import { api, insideFrame } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { apiErrorMessage } from '@/utils/api-error'

/** Ответ GET /api/b24/deals/:id (backend utils/b24-deal.ts). */
interface DealSummary {
  id: string
  title: string
  opportunity: number | null
  currency: string | null
  customer: string | null
  assignedName: string | null
  url: string
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const framed = insideFrame()

const id = computed(() => String(route.params.id))
const deal = ref<DealSummary | null>(null)
const loading = ref(true)
const error = ref('')

function money(d: DealSummary): string {
  if (d.opportunity == null) return '—'
  const n = d.opportunity.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
  return d.currency && d.currency !== 'RUB' ? `${n} ${d.currency}` : `${n} ₽`
}

onMounted(async () => {
  try {
    deal.value = (await api.get<DealSummary>(`/b24/deals/${encodeURIComponent(id.value)}`)).data
  } catch (e) {
    error.value = apiErrorMessage(e, 'Не удалось получить сделку из Битрикс24')
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.dl-muted { color: var(--muted); font-size: 13.5px; }
.dl-card { max-width: 640px; padding: 18px 20px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg2); }
.dl-grid { display: grid; grid-template-columns: max-content 1fr; gap: 8px 18px; margin: 0; font-size: 13.5px; }
.dl-grid dt { color: var(--muted); }
.dl-grid dd { margin: 0; }
.dl-link { display: inline-block; margin-top: 14px; font-size: 13px; }
</style>
