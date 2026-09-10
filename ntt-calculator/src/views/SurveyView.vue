<template>
  <div v-if="loading" class="sv-state">Загрузка опросного листа…</div>
  <div v-else-if="loadError" class="sv-state sv-state--err">{{ loadError }}</div>

  <div v-else class="sv-wrap">
    <!-- Ветвление: общий каркас ОЛ, состав полей — по типу изделия.
         Сам выбор типа живёт ВНУТРИ листа, вторым пунктом после общих данных:
         он часть заполнения, а не настройка над ним. Менять тип можно только
         при создании — у существующего расчёта смена типа означала бы
         пересоздание другим шаблоном. -->
    <SurveyKnsView
      v-if="deviceType === 'KNS'"
      :estimate-id="estimateId"
      :project-id="projectId"
      :initial="initialKns"
      :survey-rev="surveyRev"
      :total-rub="totalRub"
      :saved-survey="savedSurvey"
      :device-type="deviceType"
      :device-types="DEVICE_TYPES"
      :can-change-type="!estimateId"
      :project-title="projectTitle"
      @update:device-type="deviceType = $event"
    />
    <SurveyEmkView
      v-else-if="deviceType === 'EMK'"
      :estimate-id="estimateId"
      :project-id="projectId"
      :initial="initialEmk"
      :survey-rev="surveyRev"
      :total-rub="totalRub"
      :saved-survey="savedSurvey"
      :device-type="deviceType"
      :device-types="DEVICE_TYPES"
      :can-change-type="!estimateId"
      :project-title="projectTitle"
      @update:device-type="deviceType = $event"
    />
    <SurveyKolView
      v-else
      :estimate-id="estimateId"
      :project-id="projectId"
      :initial="initialKol"
      :survey-rev="surveyRev"
      :total-rub="totalRub"
      :saved-survey="savedSurvey"
      :device-type="deviceType"
      :device-types="DEVICE_TYPES"
      :can-change-type="!estimateId"
      :project-title="projectTitle"
      @update:device-type="deviceType = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import SurveyKnsView from '@/views/SurveyKnsView.vue'
import SurveyEmkView from '@/views/SurveyEmkView.vue'
import SurveyKolView from '@/views/SurveyKolView.vue'
import { estimatesApi, type DeviceType } from '@/api/estimates'
import { projectsApi } from '@/api/projects'
import { boundPricesFromTree } from '@/engines/price-binding'
import type { KnsSurveyForm } from '@/types/survey'
import type { EmkSurveyForm, KolSurveyForm } from '@/types/survey-emk-kol'

/**
 * Единый опросный лист (§5.6): один вход `/survey/:id?` для всех изделий.
 *
 * - без `:id` — создание нового ОЛ: тип выбирается переключателем,
 *   `?type=` задаёт стартовую вкладку, `?project=` привязывает расчёт к проекту;
 * - с `:id` — ОЛ существующего изделия: форма предзаполняется сохранёнными
 *   данными, каждая правка сама пересобирает и сохраняет расчёт (useSurveySync).
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

/**
 * Ждём данные ДО первой отрисовки ветки: форма забирает `initial` один раз,
 * при создании (`{ ...defaults, ...initial }`), и значения, пришедшие позже,
 * в неё уже не попадают. Раньше карточка проекта грузилась параллельно с
 * отрисовкой — и «Заказчик» с «Объектом» оставались демонстрационными.
 */
const loading = ref(Boolean(estimateId.value || queryProjectId.value))
const loadError = ref<string | null>(null)
const projectTitle = ref<string | null>(null)

const surveyRev = ref(0)
/** Итог расчёта на момент открытия — живая панель ОЛ показывает его до первого пересчёта. */
const totalRub = ref<number | null>(null)
/** Сохранённый surveyData — с ним ОЛ сверяет, есть ли что сохранять. */
const savedSurvey = ref<Record<string, unknown> | null>(null)
const initialKns = ref<Partial<KnsSurveyForm> | null>(null)
const initialEmk = ref<Partial<EmkSurveyForm> | null>(null)
const initialKol = ref<Partial<KolSurveyForm> | null>(null)

const DEVICE_TYPES = [
  { value: 'KNS' as DeviceType, label: 'Насосная станция' },
  { value: 'EMK' as DeviceType, label: 'Ёмкость' },
  { value: 'KOL' as DeviceType, label: 'Колодец' },
]

/**
 * Загрузка листа под текущий маршрут.
 *
 * Зовётся и при монтировании, и при смене id в маршруте: после «Создать
 * расчёт» лист переходит с /survey на /survey/:id, а роутер переиспользует
 * тот же экземпляр компонента — без повторной загрузки ветка осталась бы в
 * режиме создания и не знала бы, куда сохранять.
 */
async function loadSurvey() {
  if (estimateId.value) {
    loading.value = true
    try {
      const est = await estimatesApi.get(estimateId.value)
      deviceType.value = est.deviceType
      estimateProjectId.value = est.projectId
      totalRub.value = est.totalRub
      const sd = est.surveyData as Record<string, unknown>
      savedSurvey.value = sd
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
      // Цены трубы и насоса, введённые в самом расчёте до появления полей
      // ОЛ, переезжают в поля: иначе первый же пересчёт из ОЛ собрал бы дерево
      // с пустыми полями, и цена бы пропала. Заполненное поле не трогаем.
      const prices = boundPricesFromTree(sd.tree)
      const blank = (k: string) => !String((full as Record<string, unknown> | null)?.[k] ?? '').trim()
      const inherited = Object.fromEntries(Object.entries(prices).filter(([k]) => blank(k)))
      const withPrices = full || Object.keys(inherited).length ? { ...full, ...inherited } : null
      if (est.deviceType === 'KNS') initialKns.value = withPrices as Partial<KnsSurveyForm> | null
      else if (est.deviceType === 'EMK') initialEmk.value = withPrices as Partial<EmkSurveyForm> | null
      else initialKol.value = withPrices as Partial<KolSurveyForm> | null
    } catch (e) {
      loadError.value = e instanceof Error ? e.message : 'Не удалось загрузить расчёт'
    } finally {
      loading.value = false
    }
  } else if (projectId.value) {
    // Подпись проекта в шапке; общий блок предзаполняется из карточки.
    try {
      const p = await projectsApi.get(projectId.value)
      projectTitle.value = p.title
      // В карточке проекта название объекта и его адрес — два поля, в ОЛ
      // «Объект» одно, поэтому склеиваем: «ГКБ №52, ул. Пехотная, 3».
      // Пустое у проекта значение затирает демонстрационное: приписывать
      // проекту чужого заказчика хуже, чем оставить поле пустым.
      const common = {
        zakazchik: p.customer ?? '',
        obekt: [p.title, p.address].filter(Boolean).join(', '),
      }
      initialKns.value = common
      initialEmk.value = common
      initialKol.value = common
    } catch {
      // Не блокируем создание: проект подтянется на бэке по projectId.
    } finally {
      loading.value = false
    }
  }
}

onMounted(loadSurvey)
watch(estimateId, (next, prev) => {
  if (next && next !== prev) void loadSurvey()
})
</script>

<style scoped>
.sv-state { padding: 24px; font-size: 14.4px; color: var(--muted); }
.sv-state--err { color: var(--acc); }

.sv-wrap { display: flex; flex-direction: column; height: 100vh; }
.sv-wrap > :last-child { flex: 1; min-height: 0; }
/* Вложенный экран ОЛ сам ставит height:100vh — внутри обёртки это лишнее */
.sv-wrap :deep(.ol) { height: 100%; }

.sv-typebar { display: flex; align-items: center; gap: 8px; padding: 6px 14px;
  border-bottom: 1px solid var(--line); background: var(--panel2); flex: none; }
.sv-typebar-lbl { font-size: 12px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); }
.sv-type { display: flex; align-items: baseline; gap: 6px; padding: 4px 10px;
  background: transparent; border: 1px solid var(--line2); color: var(--muted); cursor: pointer; }
.sv-type:hover { color: var(--text); }
.sv-type.active { border-color: var(--acc); color: var(--text); background: var(--acc-bg); }
.sv-type-code { font-size: 13.2px; font-weight: 700; }
.sv-type-name { font-size: 12.6px; }
.sv-typebar-note { margin-left: auto; font-size: 12.6px; color: var(--muted); }
</style>
