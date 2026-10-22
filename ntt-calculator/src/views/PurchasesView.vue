<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <div class="logo">НТТ · Калькулятор</div>
        <div class="logo-sub">{{ auth.user?.name }}</div>
      </div>
      <div class="sidebar-scroll">
        <div class="nav-section">Навигация</div>
        <button class="nav-link nav-link--active">Заявки на закупку</button>
        <button class="nav-link" @click="router.push('/prices')">Прайс-лист</button>
      </div>
      <div class="sidebar-footer">
        <BugReportButton />
        <ThemeToggle />
        <UserMenu />
      </div>
    </aside>

    <div class="main-col">
      <div class="topbar">
        <div class="tb-title">Заявки на закупку</div>
      </div>

      <div class="pu-filters">
        <input class="fi pu-search" v-model="search" placeholder="Поиск по наименованию единицы…" />
        <select class="fi pu-sel" v-model="deviceType" aria-label="Тип оборудования">
          <option value="">Любое оборудование</option>
          <option v-for="(label, t) in DEVICE_LABELS" :key="t" :value="t">{{ label }}</option>
        </select>
        <button class="btn btn-g" :disabled="!search && !deviceType" @click="search = ''; deviceType = ''">Сбросить</button>
      </div>

      <div class="calc-area">
        <div v-if="loading" class="dash-state"><div class="dash-state-txt">Загрузка…</div></div>
        <div v-else-if="error" class="dash-state">
          <div class="dash-state-txt dash-err">{{ error }}</div>
          <button class="btn btn-g" @click="load">Повторить</button>
        </div>
        <div v-else-if="filtered.length === 0" class="dash-state">
          <div class="dash-state-txt">{{ units.length === 0 ? 'Расчётов для закупки пока нет.' : 'Ничего не найдено.' }}</div>
        </div>
        <div v-else class="pu-wrap">
          <table class="pu">
            <thead>
              <tr><th>Единица</th><th>Тип</th><th>Инженер</th><th>Обновлена</th></tr>
            </thead>
            <tbody>
              <tr v-for="u in filtered" :key="u.id" class="pu-row" @click="open(u.id)">
                <td class="pu-title">{{ u.title }}</td>
                <td><span class="dev-badge" :class="`dev-badge--${u.deviceType.toLowerCase()}`">{{ u.deviceType }}</span></td>
                <td class="pu-txt">{{ u.author?.name ?? '—' }}</td>
                <td class="pu-date">{{ fmtDate(u.updatedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/api/client'
import type { DeviceType } from '@/api/estimates'
import { apiErrorMessage } from '@/utils/api-error'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import BugReportButton from '@/components/ui/BugReportButton.vue'
import UserMenu from '@/components/ui/UserMenu.vue'

/**
 * Главный экран снабженца: расчёты, по которым ведётся закупка. Проекты ему
 * закрыты — в них заказчики и цены продажи, — поэтому здесь только единица,
 * её тип, инженер и дата. Строка открывает заявку на закупку.
 */
interface PurchaseUnit {
  id: string
  title: string
  deviceType: DeviceType
  updatedAt: string
  author: { name: string } | null
}

const DEVICE_LABELS: Record<DeviceType, string> = { KNS: 'КНС', EMK: 'Ёмкость', KOL: 'Колодец' }

const router = useRouter()
const auth = useAuthStore()

const units = ref<PurchaseUnit[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const deviceType = ref<DeviceType | ''>('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return units.value.filter((u) =>
    (!deviceType.value || u.deviceType === deviceType.value) && (!q || u.title.toLowerCase().includes(q)),
  )
})

async function load() {
  loading.value = true; error.value = null
  try { units.value = (await api.get<PurchaseUnit[]>('/estimates')).data }
  catch (e: unknown) { error.value = apiErrorMessage(e, 'Ошибка загрузки') }
  finally { loading.value = false }
}

function open(id: string) {
  router.push({ name: 'purchase-request', params: { id } })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

onMounted(load)
</script>

<style scoped>
.pu-filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg1); flex-shrink: 0; }
.pu-search { flex: 1 1 220px; min-width: 0; }
.pu-sel { width: auto; flex: 0 0 auto; }
.pu-wrap { padding: 12px; overflow-x: auto; }
.pu { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--bg2); border: 1px solid var(--border); }
.pu th { text-align: left; padding: 7px 9px; border-bottom: 1px solid var(--border); background: var(--bg1);
  color: var(--tx3); font-size: 11.5px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; }
.pu td { padding: 7px 9px; border-bottom: 1px solid var(--border); }
.pu-row { cursor: pointer; transition: background .12s; }
.pu-row:hover { background: var(--bg3); }
.pu-title { font-weight: 600; color: var(--tx1); }
.pu-txt { color: var(--tx2); }
.pu-date { color: var(--tx3); white-space: nowrap; font-variant-numeric: tabular-nums; }
</style>
