<template>
  <SurveyShell
    ref="shell"
    title="Опросный лист — колодец"
    :zayavka="form.zayavka || '—'"
    :draft-time="draftTime"
    :active-sec="activeSec"
    :sections="steps"
    :back-to="backTarget"
    :back-label="backLabel"
    @go="goSection"
    @scroll="onScroll"
  >
    <template #form>
      <section id="sec-1" class="ol-sec">
        <h2 class="ol-h">1 · Общие</h2>
        <!-- Порядок и ширины — как в КНС: сверху то, чем лист опознают
             (заявка, тип, стадия, дата), снизу — чей объект. -->
        <div class="ol-grid">
          <label class="fld fld--3"><span>№ заявки ОЛ</span><input v-model="form.zayavka" /></label>
          <label class="fld fld--3"><span>Тип колодца</span>
            <select v-model="form.wellType"><option v-for="t in WELL_TYPES" :key="t">{{ t }}</option></select>
          </label>
          <label class="fld fld--3"><span>Стадия</span>
            <select v-model="form.stadiya"><option v-for="t in STAGES" :key="t">{{ t }}</option></select>
          </label>
          <label class="fld fld--3"><span>Дата</span><input v-model="form.data" /></label>
          <label class="fld fld--4"><span>Заказчик <b class="req">*</b></span>
            <input v-model="form.zakazchik" :class="{ 'is-missing': !form.zakazchik.trim() }" />
          </label>
          <label class="fld fld--5"><span>Объект</span><input v-model="form.obekt" /></label>
          <label class="fld fld--3"><span>Регион</span><input v-model="form.region" /></label>
        </div>
      </section>

      <!-- 2. Тип изделия -->
      <section id="sec-2" class="ol-sec">
        <h2 class="ol-h">2 · Тип изделия</h2>
        <DeviceTypeSection
          :model-value="deviceType"
          :types="deviceTypes"
          :can-change="canChangeType"
          :project-title="projectTitle"
          @update:model-value="$emit('update:deviceType', $event)"
        />
      </section>

      <section id="sec-3" class="ol-sec">
        <h2 class="ol-h">3 · Корпус</h2>
        <!-- Размеры корпуса и признак проезжей части — одной строкой:
             под проезжей частью меняется жёсткость, то есть марка трубы. -->
        <div class="ol-grid">
          <label class="fld fld--3"><span>DN рабочей части, мм <b class="req">*</b></span>
            <select v-model="form.dn"><option v-for="d in DN_LIST" :key="d">{{ d }}</option></select>
          </label>
          <label class="fld fld--3"><span>Глубина H, мм <b class="req">*</b></span>
            <input v-model="form.depthMm" class="num" :class="{ 'is-missing': !form.depthMm }" />
          </label>
          <label class="fld fld--3"><span>Возвышение, мм</span><input v-model="form.elevationMm" class="num" /></label>
          <ToggleYesNo v-model="form.underRoadway" stacked class="fld--3" label="Под проезжей частью" />
        </div>

        <div class="ol-card">
          <div class="ol-card-h">Труба корпуса <span class="f-mark" title="PN и SN продиктованы глубиной и требованиями заказчика">ƒ</span></div>
          <div v-if="s.pipeMark.value" class="ol-grade">{{ s.pipeMark.value }}</div>
          <div v-else class="ol-grade ol-grade--empty">— укажите DN и глубину</div>
          <div class="ol-explain">{{ s.explain.value }}</div>

          <label class="ol-chk">
            <input v-model="form.pipeManual" type="checkbox" /><span>изменить вручную</span>
          </label>
          <div v-if="form.pipeManual" class="ol-manual">
            <label class="fld fld--3"><span>PN, МПа</span>
              <select v-model="form.pnManual"><option value="">расч.</option><option v-for="p in PN_LIST" :key="p">{{ p }}</option></select>
            </label>
            <label class="fld fld--3"><span>SN, Па</span>
              <select v-model="form.snManual"><option value="">расч.</option><option v-for="v in SN_LIST" :key="v">{{ v }}</option></select>
            </label>
            <button class="ol-reset fld--12" @click="resetPipe">↺ вернуть расчётные</button>
          </div>
        </div>

        <!-- Прогрессивное раскрытие: размеры стоят в одной строке со своим
             признаком — горловина с диаметром и высотой, теплоизоляция с
             глубиной, — а не отдельным блоком под всеми тумблерами. -->
        <div class="ol-grid ol-grid--mid">
          <ToggleYesNo v-model="form.hasNeck" stacked class="fld--3" label="Горловина" />
          <!-- Горловина — отрезок стеклопластиковой трубы своего диаметра,
               поэтому селект по ряду труб, а не свободный ввод. -->
          <label v-if="form.hasNeck" class="fld fld--3"><span>DN горловины, мм <b class="req">*</b></span>
            <select v-model="form.neckD"><option v-for="d in DN_LIST" :key="d">{{ d }}</option></select>
          </label>
          <label v-if="form.hasNeck" class="fld fld--3"><span>h горловины, мм <b class="req">*</b></span>
            <input v-model="form.neckH" class="num" />
          </label>
        </div>
        <div class="ol-grid">
          <ToggleYesNo v-model="form.hasLadder" stacked class="fld--3" label="Лестница" />
          <ToggleYesNo v-model="form.insulation" stacked class="fld--3" label="Теплоизоляция" />
          <label v-if="form.insulation" class="fld fld--3"><span>Глубина ТИ, мм</span>
            <input v-model="form.tiGlubina" class="num" />
          </label>
        </div>
      </section>

      <section id="sec-4" class="ol-sec">
        <h2 class="ol-h">4 · Смола и стоки</h2>
        <div class="ol-grid">
          <label class="fld fld--3"><span>Тип смолы</span>
            <select v-model="form.resin"><option v-for="r in RESINS" :key="r">{{ r }}</option></select>
          </label>
          <label class="fld fld--4"><span>Марка смолы ƒ</span>
            <!-- Марка подставляется автоматически по типу (ТЗ §5.6) -->
            <input :value="resinGrade(form.resin)" disabled />
          </label>
          <label class="fld fld--3"><span>Вид стоков</span>
            <select v-model="form.effluent"><option v-for="e in EFFLUENTS" :key="e">{{ e }}</option></select>
          </label>
        </div>
      </section>

      <section id="sec-5" class="ol-sec">
        <h2 class="ol-h">5 · Патрубки</h2>
        <div class="ol-cards">
          <div class="ol-card">
            <div class="ol-card-h">Подводящий</div>
            <div class="ol-grid">
              <label class="fld"><span>Материал</span>
                <select v-model="form.podvMat"><option v-for="m in MATERIALS" :key="m">{{ m }}</option></select>
              </label>
              <label class="fld"><span>DN, мм</span><input v-model="form.podvDn" class="num" /></label>
              <label class="fld"><span>Кол-во</span><input v-model="form.podvKol" class="num" /></label>
              <label class="fld"><span>Глубина лотка, мм</span><input v-model="form.podvLotok" class="num" /></label>
            </div>
          </div>
          <div class="ol-card">
            <div class="ol-card-h">Отводящий</div>
            <div class="ol-grid">
              <label class="fld"><span>Материал</span>
                <select v-model="form.otvMat"><option v-for="m in MATERIALS" :key="m">{{ m }}</option></select>
              </label>
              <label class="fld"><span>DN, мм</span><input v-model="form.otvDn" class="num" /></label>
              <label class="fld"><span>Кол-во</span><input v-model="form.otvKol" class="num" /></label>
              <label class="fld"><span>Глубина лотка, мм</span><input v-model="form.otvLotok" class="num" /></label>
            </div>
          </div>
        </div>
      </section>

      <section id="sec-6" class="ol-sec">
        <h2 class="ol-h">6 · Доп. оборудование</h2>
        <!-- Корзина и дробилка — независимые признаки, как в КНС: одним
             селектом это выражалось значением «обе», которое читалось хуже
             двух тумблеров. Хранится по-прежнему одним полем. -->
        <div class="ol-grid">
          <ToggleYesNo v-model="hasBasket" stacked class="fld--3" label="Корзина" />
          <ToggleYesNo v-model="hasGrinder" stacked class="fld--3" label="Дробилка" />
          <ToggleYesNo v-model="form.hasValves" stacked class="fld--3" label="Запорная арматура" />
          <ToggleYesNo v-model="form.datchiki" stacked class="fld--3" label="Датчики" />
        </div>
        <div class="ol-grid">
          <ToggleYesNo v-model="form.shu" stacked class="fld--3" label="Шкаф управления" />
        </div>
        <p class="ol-live-hint">У колодца нет насосов, поэтому раздела «Напорный трубопровод» в расчёте не будет.</p>
      </section>
    </template>

    <template #live>
      <div class="ol-live-h">Геометрия</div>
      <dl class="ol-live-vals">
        <div v-for="v in liveValues" :key="v.k" class="ol-live-row" :title="v.f">
          <dt>{{ v.k }} <span class="ol-f">ƒ</span></dt>
          <dd>{{ v.v }}</dd>
        </div>
      </dl>

      <div class="ol-live-lbl">Полная глубина корпуса</div>
      <div class="ol-live-npodz" title="ƒ рабочая часть + горловина (высота + возвышение)">
        {{ fmtInt(s.geo.value.totalDepthMm) }} <span class="ol-live-u">мм</span>
      </div>

      <div class="ol-live-h">Изделие</div>
      <div class="ol-live-prev">
        <div class="ol-prev-t">{{ s.title.value }}</div>
        <div class="ol-prev-s">{{ form.effluent }} · {{ resinGrade(form.resin) }}</div>
        <div class="ol-prev-s">{{ blocksOn }} из {{ blocks.length }} блоков включено</div>
      </div>

      <p class="ol-live-hint">Значения пересчитываются при каждом вводе. Наведите на подпись — увидите формулу.</p>

      <div class="ol-live-foot">
        <div v-if="!s.canCreate.value" class="ol-hint">Заполните: {{ s.missingRequired.value.join(', ') }}</div>
        <button class="ol-create" :disabled="!s.canCreate.value" @click="previewOpen = true">
          {{ isEdit ? 'Сохранить ОЛ →' : 'Создать расчёт →' }}
        </button>
      </div>
    </template>

    <BaseModal :show="previewOpen" :title="s.title.value" :close-on-backdrop="true" @close="previewOpen = false">
      <p class="mo-sub">{{ s.pipeMark.value }} · глубина {{ fmtInt(s.geo.value.totalDepthMm) }} мм</p>
      <ul class="mo-list">
        <li v-for="b in blocks" :key="b.t">
          <span :class="b.on ? 'mo-on' : 'mo-off'">{{ b.on ? '☑' : '☐' }}</span> {{ b.t }}
        </li>
      </ul>
      <template #footer>
        <button class="ol-btn" @click="previewOpen = false">Отмена</button>
        <button class="ol-create" :disabled="creating" @click="createEstimate">
          {{ creating ? 'Сохраняем…' : isEdit ? 'Сохранить ОЛ → конфигуратор' : 'Создать расчёт → конфигуратор' }}
        </button>
      </template>
    </BaseModal>
  </SurveyShell>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import BaseModal from '@/components/ui/BaseModal.vue'
import SurveyShell from '@/components/survey/SurveyShell.vue'
import ToggleYesNo from '@/components/survey/ToggleYesNo.vue'
import DeviceTypeSection from '@/components/survey/DeviceTypeSection.vue'
import type { DeviceType } from '@/api/estimates'
import { useKolSurvey } from '@/composables/useEmkKolSurvey'
import { toast } from '@/composables/useToast'
import { tryEvalExpr } from '@/engines/expr'
import { makeDefaultKolSurvey, resinGrade, type KolSurveyForm } from '@/types/survey-emk-kol'
import { grinderValue, hasBasketIn, hasGrinderIn, pickCommon } from '@/types/survey'
import { estimatesApi } from '@/api/estimates'
import { projectsApi } from '@/api/projects'
import { KOL_SECTIONS } from '@/engines/template-emk-kol'

/** Ветка КОЛ единого опросного листа — режимы как у КНС (см. SurveyKnsView). */
const props = defineProps<{
  estimateId?: string | null
  projectId?: string | null
  initial?: Partial<KolSurveyForm> | null
  surveyRev?: number
  /** Тип изделия и его переключение — секция 2 листа (владелец — SurveyView). */
  deviceType: DeviceType
  deviceTypes: ReadonlyArray<{ value: DeviceType; label: string }>
  canChangeType: boolean
  projectTitle?: string | null
}>()

defineEmits<{ 'update:deviceType': [DeviceType] }>()

const router = useRouter()
const form = ref<KolSurveyForm>({ ...makeDefaultKolSurvey(), ...props.initial })
const s = useKolSurvey(form)

// Корзина и дробилка — два тумблера над одним полем модели (см. grinderValue).
const hasBasket = computed({
  get: () => hasBasketIn(form.value.grinder),
  set: (v: boolean) => { form.value.grinder = grinderValue(v, hasGrinder.value) },
})
const hasGrinder = computed({
  get: () => hasGrinderIn(form.value.grinder),
  set: (v: boolean) => { form.value.grinder = grinderValue(hasBasket.value, v) },
})

const isEdit = computed(() => Boolean(props.estimateId))

const backTarget = computed(() =>
  props.projectId ? { name: 'project', params: { id: props.projectId } } : { name: 'dashboard' },
)
const backLabel = computed(() => (props.projectId ? '← Проект' : '← Проекты'))

const WELL_TYPES = ['Смотровой', 'Поворотный', 'Перепадный', 'Гаситель', 'Накопительный'] as const
const STAGES = ['проект', 'рабочая', 'КД', 'продажа', 'тендер'] as const
const MATERIALS = ['ПЭ', 'ПВХ', 'ПНД', 'ПП', 'Асбестцемент', 'Корсис', 'стеклокомпозит'] as const
const RESINS = ['Стандарт', 'Винилэфирная стандарт', 'Винилэфирная высокотемп.'] as const
const EFFLUENTS = ['Хозяйственно-бытовые', 'Ливневые', 'Промышленные', 'Агрессивные'] as const
const PN_LIST = ['0,1', '0,6', '1', '1,6'] as const
const SN_LIST = ['1250', '2500', '5000', '10000'] as const
const DN_LIST = [300, 350, 400, 450, 500].concat(Array.from({ length: 25 }, (_, i) => 600 + i * 100)).map(String)

const activeSec = ref(1)
const previewOpen = ref(false)
const creating = ref(false)
const shell = ref<InstanceType<typeof SurveyShell> | null>(null)
const draftTime = ref(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))

const fmtInt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
const num = (v: string) => tryEvalExpr(v)

const steps = computed(() => [
  { n: 1, title: 'Общие', done: form.value.zakazchik.trim() !== '' },
  { n: 2, title: 'Тип изделия', done: true },
  { n: 3, title: 'Корпус', done: num(form.value.dn) != null && num(form.value.depthMm) != null },
  { n: 4, title: 'Смола и стоки', done: true },
  { n: 5, title: 'Патрубки', done: num(form.value.podvDn) != null },
  { n: 6, title: 'Доп. оборудование', done: true },
])

const liveValues = computed(() => {
  const g = s.geo.value
  return [
    { k: 'Рабочая часть', v: `${form.value.depthMm} мм`, f: 'ƒ вход опросного листа' },
    { k: 'Горловина', v: form.value.hasNeck ? `${fmtInt(g.neckHeightMm)} мм · Ø${g.neckDiameterMm}` : 'нет', f: 'ƒ высота горловины + возвышение (эталон N5)' },
    { k: 'SN', v: String(g.sn ?? '—'), f: 'ƒ по полной глубине; проезжая часть — на ступень выше' },
  ]
})

const blocks = computed(() => [
  { t: 'Корпус колодца', on: true },
  { t: 'Горловина', on: form.value.hasNeck },
  { t: 'Теплоизоляция', on: form.value.insulation },
  { t: 'Корзина', on: form.value.grinder === 'корзина' || form.value.grinder === 'обе' },
  { t: 'Лестница', on: form.value.hasLadder },
  { t: 'Перекрытие, площадка и несущие балки', on: true },
  { t: 'Вентиляционный стояк', on: true },
  { t: 'Крепёж', on: true },
  { t: 'Запорная арматура', on: form.value.hasValves },
])
const blocksOn = computed(() => blocks.value.filter((b) => b.on).length)

function goSection(n: number) {
  activeSec.value = n
  document.getElementById(`sec-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function onScroll() {
  const el = shell.value?.formEl
  if (!el) return
  const top = el.getBoundingClientRect().top
  let best = 1
  for (const sec of steps.value) {
    const node = document.getElementById(`sec-${sec.n}`)
    if (node && node.getBoundingClientRect().top - top <= 24) best = sec.n
  }
  activeSec.value = best
}

function resetPipe() {
  form.value.pipeManual = false
  form.value.pnManual = ''
  form.value.snManual = ''
}

/** Единый контракт surveyData — см. комментарий в SurveyKnsView. */
function surveyPayload() {
  return {
    common: pickCommon(form.value),
    // Ключ `kol` — по нему стор выбирает шаблон колодца (materializeByDevice).
    kol: {
      dn: num(form.value.dn) ?? 0,
      workingDepthMm: num(form.value.depthMm) ?? 0,
      elevationMm: num(form.value.elevationMm) ?? 0,
      pnSurvey: s.pn.value,
      hasNeck: form.value.hasNeck,
      neckHeightMm: num(form.value.neckH) ?? 0,
      neckDiameterMm: num(form.value.neckD) ?? 0,
      inletDn: num(form.value.podvDn) ?? 0,
      inletCount: num(form.value.podvKol) ?? 0,
      outletDn: num(form.value.otvDn) ?? 0,
      outletCount: num(form.value.otvKol) ?? 0,
      hasBasket: form.value.grinder === 'корзина' || form.value.grinder === 'обе',
      underRoadway: form.value.underRoadway,
      insulationEnabled: form.value.insulation,
      insulationDepthMm: num(form.value.tiGlubina) ?? 0,
    },
    form: { ...form.value },
    surveyRev: (props.surveyRev ?? 0) + 1,
  }
}

async function createEstimate() {
  creating.value = true
  try {
    let id: string
    if (props.estimateId) {
      await estimatesApi.patchSurvey(props.estimateId, surveyPayload())
      id = props.estimateId
      toast('Опросный лист сохранён — расчёт будет пересчитан', 'success')
    } else {
      const dto = {
        title: s.title.value,
        deviceType: 'KOL' as const,
        surveyData: {
          ...surveyPayload(),
          sections: KOL_SECTIONS.map((x) => ({ code: x.code, title: x.title, enabled: true, components: [] })),
        },
      }
      const est = props.projectId
        ? await projectsApi.addEstimate(props.projectId, dto)
        : await estimatesApi.create(dto)
      id = est.id
      toast('Расчёт колодца создан', 'success')
    }
    await router.push({ name: 'calculator', params: { id } })
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Не удалось сохранить', 'error')
    creating.value = false
  }
}
</script>
