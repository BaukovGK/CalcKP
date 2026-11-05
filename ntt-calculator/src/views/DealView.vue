<template>
  <!-- Вкладка «Калькулятор» в карточке сделки Битрикс24
       (doc/План_Б24_сделка.md, этапы 4–5): шапка сделки из портала, все
       проекты калькулятора по ней с КП и «Новый расчёт по сделке».
       Сумму КП в сделку калькулятор не пишет: КП по сделке бывает много. -->
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <button class="back-link" @click="router.push('/')">← Все проекты</button>
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
        <div class="tb-spacer"></div>
        <button v-if="canCreate && deal" class="btn btn-am" @click="openNew">＋ Новый расчёт по сделке</button>
      </div>

      <div class="calc-area">
        <p v-if="dealLoading" class="dl-muted">Загружаем сделку из Битрикс24…</p>
        <div v-else-if="dealError" class="dl-card">
          <div class="auth-err" role="alert">{{ dealError }}</div>
        </div>
        <div v-else-if="deal" class="dl-card">
          <dl class="dl-grid">
            <dt>Заказчик</dt><dd>{{ deal.customer ?? '—' }}</dd>
            <dt>Ответственный</dt><dd>{{ deal.assignedName ?? '—' }}</dd>
            <dt>Сумма в сделке</dt><dd>{{ money(deal.opportunity, deal.currency) }}</dd>
          </dl>
          <a v-if="!framed" :href="deal.url" target="_blank" rel="noopener" class="dl-link">Открыть в Битрикс24 ↗</a>
        </div>

        <h2 class="dl-h">Проекты по сделке</h2>
        <p v-if="projectsLoading" class="dl-muted">Загрузка…</p>
        <p v-else-if="projectsError" class="auth-err" role="alert">{{ projectsError }}</p>
        <template v-else>
          <p v-if="!projects.length" class="dl-muted">
            По этой сделке расчётов ещё нет.
            <template v-if="canCreate && deal">Начните с кнопки «Новый расчёт по сделке».</template>
          </p>
          <div v-for="p in projects" :key="p.id" class="dl-card dl-proj">
            <div class="dl-proj-h">
              <RouterLink :to="`/projects/${p.id}`" class="dl-proj-t">{{ p.title }}</RouterLink>
              <span class="dl-muted dl-small">{{ p.author.name }} · {{ date(p.createdAt) }}</span>
            </div>
            <div v-if="p.customer || p.address" class="dl-muted dl-small">
              {{ [p.customer, p.address].filter(Boolean).join(' · ') }}
            </div>
            <p v-if="!p.estimates.length" class="dl-muted dl-small dl-gap">Единиц расчёта пока нет.</p>
            <table v-else class="adm-table dl-table">
              <thead>
                <tr><th>Единица</th><th class="num">Расчёт</th><th>КП</th></tr>
              </thead>
              <tbody>
                <tr v-for="e in p.estimates" :key="e.id">
                  <td>{{ e.title }} <span class="dl-muted">· {{ DEVICE_LABELS[e.deviceType] ?? e.deviceType }}</span></td>
                  <td class="num">{{ money(e.totalRub) }}</td>
                  <td>
                    <span v-if="!e.snapshots.length" class="dl-muted">не выпускалось</span>
                    <div v-for="s in e.snapshots" :key="s.version" class="dl-kp">
                      № {{ s.kpNumber ?? '—' }} · в.{{ s.version }} · {{ money(s.totalRub) }} · {{ date(s.createdAt) }}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="hidden" class="dl-muted dl-small">
            Ещё {{ hidden }} {{ plural(hidden) }} по сделке ведут другие сотрудники — вам они не видны.
          </p>
        </template>
      </div>
    </div>

    <BaseModal :show="newOpen" title="Новый расчёт по сделке" @close="newOpen = false">
      <p class="dl-muted dl-small">Поля заполнены из сделки — поправьте, если объект называется или находится иначе.</p>
      <div class="ff">
        <label class="fl">Объект <span style="color:var(--danger)">*</span></label>
        <input class="fi" v-model="form.title" />
      </div>
      <div class="ff">
        <label class="fl">Заказчик</label>
        <input class="fi" v-model="form.customer" />
      </div>
      <div class="ff">
        <label class="fl">Адрес объекта</label>
        <input class="fi" v-model="form.address" />
      </div>
      <div v-if="formError" class="auth-err" style="margin-top:8px">{{ formError }}</div>
      <template #footer>
        <button class="btn btn-g" @click="newOpen = false">Отмена</button>
        <button class="btn btn-am" :disabled="creating || !form.title.trim()" @click="create">
          {{ creating ? 'Создание…' : 'Создать проект' }}
        </button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import BaseModal from '@/components/ui/BaseModal.vue'
import BugReportButton from '@/components/ui/BugReportButton.vue'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import UserMenu from '@/components/ui/UserMenu.vue'
import { insideFrame } from '@/api/client'
import { b24Api, type DealProject, type DealSummary } from '@/api/b24'
import { useAuthStore } from '@/stores/auth'
import { apiErrorMessage } from '@/utils/api-error'

const DEVICE_LABELS: Record<string, string> = { KNS: 'КНС', EMK: 'Ёмкость', KOL: 'Колодец' }

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const framed = insideFrame()

const id = computed(() => String(route.params.id))
const canCreate = computed(() => ['ADMIN', 'MANAGER', 'ENGINEER'].includes(auth.user?.role ?? ''))

const deal = ref<DealSummary | null>(null)
const dealLoading = ref(true)
const dealError = ref('')

const projects = ref<DealProject[]>([])
const hidden = ref(0)
const projectsLoading = ref(true)
const projectsError = ref('')

const newOpen = ref(false)
const creating = ref(false)
const formError = ref('')
const form = reactive({ title: '', customer: '', address: '' })

function money(v: number | null | undefined, currency?: string | null): string {
  if (v == null) return '—'
  const n = v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
  return currency && currency !== 'RUB' ? `${n} ${currency}` : `${n} ₽`
}

function date(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU')
}

function plural(n: number): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'проект'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'проекта'
  return 'проектов'
}

function openNew() {
  const d = deal.value!
  form.title = d.title
  form.customer = d.customer ?? ''
  form.address = d.address ?? ''
  formError.value = ''
  newOpen.value = true
}

async function create() {
  creating.value = true
  formError.value = ''
  try {
    const p = await b24Api.createProject(id.value, {
      title: form.title.trim(),
      customer: form.customer.trim() || undefined,
      address: form.address.trim() || undefined,
    })
    newOpen.value = false
    await router.push(`/projects/${p.id}`)
  } catch (e) {
    formError.value = apiErrorMessage(e, 'Не удалось создать проект')
  } finally {
    creating.value = false
  }
}

async function loadDeal() {
  try {
    deal.value = await b24Api.deal(id.value)
  } catch (e) {
    dealError.value = apiErrorMessage(e, 'Не удалось получить сделку из Битрикс24')
  } finally {
    dealLoading.value = false
  }
}

async function loadProjects() {
  try {
    const r = await b24Api.dealProjects(id.value)
    projects.value = r.projects
    hidden.value = r.hidden
  } catch (e) {
    projectsError.value = apiErrorMessage(e, 'Не удалось загрузить проекты по сделке')
  } finally {
    projectsLoading.value = false
  }
}

onMounted(() => Promise.all([loadDeal(), loadProjects()]))
</script>

<style scoped>
.dl-muted { color: var(--muted); font-size: 13.5px; }
.dl-small { font-size: 12.5px; }
.dl-gap { margin: 8px 0 0; }
.dl-card { max-width: 900px; padding: 16px 18px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg2); margin-bottom: 12px; }
.dl-grid { display: grid; grid-template-columns: max-content 1fr; gap: 8px 18px; margin: 0; font-size: 13.5px; }
.dl-grid dt { color: var(--muted); }
.dl-grid dd { margin: 0; }
.dl-link { display: inline-block; margin-top: 14px; font-size: 13px; }
.dl-h { font-size: 15px; font-weight: 600; margin: 22px 0 10px; }
.dl-proj-h { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; margin-bottom: 4px; }
.dl-proj-t { font-weight: 600; font-size: 14px; }
.dl-table { margin-top: 10px; }
.dl-kp { font-size: 12.5px; white-space: nowrap; }
</style>
