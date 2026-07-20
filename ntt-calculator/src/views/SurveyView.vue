<template>
  <div v-if="loading" class="sv-state">Загрузка опросного листа…</div>
  <div v-else-if="loadError" class="sv-state sv-state--err">{{ loadError }}</div>

  <div v-else class="sv-wrap">
    <!-- Переключатель типа изделия — только при создании нового ОЛ.
         У существующего расчёта тип зафиксирован: сменить его — значит
         пересоздать расчёт другим шаблоном. -->
    <div v-if="!estimateId" class="sv-typebar">
      <span class="sv-typebar-lbl">Тип изделия</span>
      <button
        v-for="t in DEVICE_TYPES"
        :key="t.value"
        class="sv-type"
        :class="{ active: deviceType === t.value }"
        type="button"
        @click="deviceType = t.value"
      >
        <span class="sv-type-code">{{ t.value }}</span>
        <span class="sv-type-name">{{ t.label }}</span>
      </button>
      <span v-if="projectId" class="sv-typebar-note">→ в проект «{{ projectTitle ?? '…' }}»</span>
    </div>

    <!-- Ветвление: общий каркас ОЛ, состав полей — по типу изделия -->
    <SurveyKnsView
      v-if="deviceType === 'KNS'"
      :estimate-id="estimateId"
      :project-id="projectId"
      :initial="initialKns"
      :survey-rev="surveyRev"
    />
    <SurveyEmkView
      v-else-if="deviceType === 'EMK'"
      :estimate-id="estimateId"
      :project-id="projectId"
      :initial="initialEmk"
      :survey-rev="surveyRev"
    />
    <SurveyKolView
      v-else
      :estimate-id="estimateId"
      :project-id="projectId"
      :initial="initialKol"
      :survey-rev="surveyRev"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import SurveyKnsView from '@/views/SurveyKnsView.vue'
import SurveyEmkView from '@/views/SurveyEmkView.vue'
import SurveyKolView from '@/views/SurveyKolView.vue'
import { estimatesApi, type DeviceType } from '@/api/estimates'
import { projectsApi } from '@/api/projects'
import type { KnsSurveyForm } from '@/types/survey'
import type { EmkSurveyForm, KolSurveyForm } from '@/types/survey-emk-kol'

/**
 * Единый опросный лист (§5.6): один вход `/survey/:id?` для всех изделий.
 *
 * - без `:id` — создание нового ОЛ: тип выбирается переключателем,
 *   `?type=` задаёт стартовую вкладку, `?project=` привязывает расчёт к проекту;
 * - с `:id` — редактирование ОЛ существующего расчёта: форма предзаполняется
 *   сохранёнными данными, сохранение поднимает `surveyRev` и запускает
 *   рематериализацию в конфигураторе.
 */

const route = useRoute()

const estimateId = computed(() => {
  const id = route.params.id
  return typeof id === 'string' && id ? id : null
})
const queryProjectId = computed(() => {
  const p = route.query.project
  return typeof p === 'string' && p ? p : null
})
/** Проект редактируемого расчёта — для навигации «← Проект» в ветках. */
const estimateProjectId = ref<string | null>(null)
const projectId = computed(() => queryProjectId.value ?? estimateProjectId.value)

const deviceType = ref<DeviceType>(
  ['KNS', 'EMK', 'KOL'].includes(String(route.query.type)) ? (String(route.query.type) as DeviceType) : 'KNS',
)

const loading = ref(false)
const loadError = ref<string | null>(null)
const projectTitle = ref<string | null>(null)

const surveyRev = ref(0)
const initialKns = ref<Partial<KnsSurveyForm> | null>(null)
const initialEmk = ref<Partial<EmkSurveyForm> | null>(null)
const initialKol = ref<Partial<KolSurveyForm> | null>(null)

const DEVICE_TYPES = [
  { value: 'KNS' as DeviceType, label: 'Насосная станция' },
  { value: 'EMK' as DeviceType, label: 'Ёмкость' },
  { value: 'KOL' as DeviceType, label: 'Колодец' },
]

onMounted(async () => {
  if (estimateId.value) {
    loading.value = true
    try {
      const est = await estimatesApi.get(estimateId.value)
      deviceType.value = est.deviceType
      estimateProjectId.value = est.projectId
      const sd = est.surveyData as Record<string, unknown>
      surveyRev.value = typeof sd.surveyRev === 'number' ? sd.surveyRev : 0

      // Полная форма лежит в `form` (единый контракт). Для старых расчётов КНС
      // форма хранилась под ключом `kns`; признак полной формы — поле zayavka.
      // Расчёты legacy-формата (краткий модал) формы не имеют — откроются
      // с дефолтами, а сохранение переведёт их на единый контракт.
      const full =
        (sd.form as Record<string, unknown> | undefined) ??
        (est.deviceType === 'KNS' && (sd.kns as Record<string, unknown> | undefined)?.zayavka != null
          ? (sd.kns as Record<string, unknown>)
          : null)
      if (est.deviceType === 'KNS') initialKns.value = full as Partial<KnsSurveyForm> | null
      else if (est.deviceType === 'EMK') initialEmk.value = full as Partial<EmkSurveyForm> | null
      else initialKol.value = full as Partial<KolSurveyForm> | null
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : 'Не удалось загрузить расчёт'
    } finally {
      loading.value = false
    }
  } else if (projectId.value) {
    // Подпись проекта в шапке; общий блок можно предзаполнить из карточки.
    try {
      const p = await projectsApi.get(projectId.value)
      projectTitle.value = p.title
      const common = { zakazchik: p.customer ?? '', obekt: p.address ?? p.title }
      initialKns.value = common
      initialEmk.value = common
      initialKol.value = common
    } catch {
      // Не блокируем создание: проект подтянется на бэке по projectId.
    }
  }
})
</script>

<style scoped>
.sv-state { padding: 24px; font-size: 12px; color: var(--muted); }
.sv-state--err { color: var(--acc); }

.sv-wrap { display: flex; flex-direction: column; height: 100vh; }
.sv-wrap > :last-child { flex: 1; min-height: 0; }
/* Вложенный экран ОЛ сам ставит height:100vh — внутри обёртки это лишнее */
.sv-wrap :deep(.ol) { height: 100%; }

.sv-typebar { display: flex; align-items: center; gap: 8px; padding: 6px 14px;
  border-bottom: 1px solid var(--line); background: var(--panel2); flex: none; }
.sv-typebar-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); }
.sv-type { display: flex; align-items: baseline; gap: 6px; padding: 4px 10px;
  background: transparent; border: 1px solid var(--line2); color: var(--muted); cursor: pointer; }
.sv-type:hover { color: var(--text); }
.sv-type.active { border-color: var(--acc); color: var(--text); background: var(--acc-bg); }
.sv-type-code { font-size: 11px; font-weight: 700; }
.sv-type-name { font-size: 10.5px; }
.sv-typebar-note { margin-left: auto; font-size: 10.5px; color: var(--muted); }
</style>
