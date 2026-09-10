<template>
  <SurveyShell
    ref="shell"
    title="Опросный лист — ёмкость"
    :zayavka="form.zayavka || '—'"
    :status="syncLabel"
    :status-kind="sync.status.value"
    :status-title="sync.error.value"
    :active-sec="activeSec"
    :sections="steps"
    :back-to="backTarget"
    :back-label="backLabel"
    @go="goSection"
    @scroll="onScroll"
  >
    <template #topbar-actions>
      <RouterLink v-if="estimateId" class="ol-lnk" :to="{ name: 'calculator', params: { id: estimateId } }">
        → Расчёт
      </RouterLink>
    </template>

    <!-- ── Форма ── -->
    <template #form>
      <section id="sec-1" class="ol-sec">
        <h2 class="ol-h">1 · Общие</h2>
        <!-- Порядок и ширины — как в КНС: сверху то, чем лист опознают
             (заявка, тип, стадия, дата), снизу — чей объект. -->
        <div class="ol-grid">
          <label class="fld fld--3"><span>№ заявки ОЛ</span><input v-model="form.zayavka" /></label>
          <label class="fld fld--3"><span>Тип ёмкости</span>
            <select v-model="form.tankType"><option v-for="t in TANK_TYPES" :key="t">{{ t }}</option></select>
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
        <h2 class="ol-h">3 · Габариты</h2>
        <div class="ol-grid">
          <label class="fld fld--3"><span>Объём, м³ <b class="req">*</b></span>
            <input v-model="form.volumeM3" class="num" :class="{ 'is-missing': !form.volumeM3 }" />
          </label>
          <label class="fld fld--3"><span>DN корпуса, мм <b class="req">*</b></span>
            <select v-model="form.dn"><option v-for="d in DN_LIST" :key="d">{{ d }}</option></select>
          </label>
          <label class="fld fld--3"><span>Расположение</span>
            <select v-model="form.placement"><option>горизонтальное</option><option>вертикальное</option></select>
          </label>
          <label class="fld fld--3"><span>Установка</span>
            <select v-model="form.installation">
              <option>наземная</option><option>подземная</option><option>в помещении</option>
            </select>
          </label>
          <!-- Днища — у горизонтальной ёмкости: два, по концам трубы. У
               вертикальной их нет — там плоское дно и перекрытие (эталон
               D25/D27 листа «Калькулятор ЕМК»). -->
          <template v-if="form.placement === 'горизонтальное'">
            <ToggleYesNo
              v-model="ellipticBottoms"
              stacked
              class="fld--6"
              label="Днища — 2 шт., по концам трубы"
              on-label="эллиптические"
              off-label="цилиндрические"
            />
            <div class="ol-pick ol-pick--bottom fld--6">{{ bottomsHint }}</div>
          </template>
        </div>

        <!-- Труба: длина считается из объёма, PN/SN — производные -->
        <div class="ol-card">
          <div class="ol-card-h">Труба корпуса <span class="f-mark" title="Длина считается из объёма; PN и SN продиктованы габаритами">ƒ</span></div>
          <div v-if="s.pipeMark.value" class="ol-grade">{{ s.pipeMark.value }}</div>
          <div v-else class="ol-grade ol-grade--empty">— укажите объём и DN</div>
          <div v-if="s.explain.value" class="ol-explain">{{ s.explain.value }}</div>

          <!-- Цена трубы договорная, в прайсе её нет: даётся здесь и связана с
               ценой строки трубы в расчёте в обе стороны. -->
          <div class="ol-grid ol-grid--mid">
            <label class="fld"><span>Цена трубы, ₽/м.п.</span>
              <input v-model="form.pipePrice" class="num" placeholder="договорная — введите" />
            </label>
            <div class="ol-pick ol-pick--bottom" :class="{ 'ol-pick--warn': !pipePriceValue }">{{ pipeCostHint }}</div>
          </div>

          <label class="ol-chk">
            <input v-model="form.pipeManual" type="checkbox" /><span>изменить вручную</span>
          </label>
          <div v-if="form.pipeManual" class="ol-manual">
            <label class="fld fld--3"><span>Длина трубы, мм</span>
              <input v-model="form.lengthManual" class="num" :placeholder="String(s.geo.value.pipeLengthMm ?? '')" />
            </label>
            <label class="fld fld--3"><span>PN, МПа</span>
              <select v-model="form.pnManual"><option value="">расч.</option><option v-for="p in PN_LIST" :key="p">{{ p }}</option></select>
            </label>
            <label class="fld fld--3"><span>SN, Па</span>
              <select v-model="form.snManual"><option value="">расч.</option><option v-for="v in SN_LIST" :key="v">{{ v }}</option></select>
            </label>
            <button class="ol-reset fld--12" @click="resetPipe">↺ вернуть расчётные</button>
          </div>
        </div>

        <!-- Признаки и зависимые от них размеры — одной сеткой: шахта и её
             диаметр с высотой читаются вместе, как DN с признаками у КНС. -->
        <div class="ol-grid ol-grid--mid">
          <ToggleYesNo v-model="form.hasShaft" stacked class="fld--3" label="Шахта обслуживания" />
          <!-- Шахта — та же стеклопластиковая труба, что корпус, но своего
               диаметра, поэтому здесь селект по ряду труб, а не свободный
               ввод. Типовая — DN 1200. -->
          <label v-if="form.hasShaft" class="fld fld--3"><span>DN шахты, мм</span>
            <select v-model="form.shaftD"><option v-for="d in DN_LIST" :key="d">{{ d }}</option></select>
          </label>
          <label v-if="form.hasShaft" class="fld fld--3"><span>h шахты, мм</span>
            <input v-model="form.shaftH" class="num" :placeholder="String(s.geo.value.shaftHeightMm)" />
          </label>
          <!-- Цена трубы шахты — своя, не корпуса: диаметр другой. Связана с
               ценой строки трубы шахты в расчёте, как цена трубы корпуса. -->
          <label v-if="form.hasShaft" class="fld fld--3"><span>Цена трубы, ₽/м.п.</span>
            <input v-model="form.servicePipePrice" class="num" placeholder="договорная" :class="{ 'is-missing': !form.servicePipePrice }"
              title="Без цены строка трубы шахты в расчёте «красная» и КП не выпустить" />
          </label>
        </div>
        <div class="ol-grid">
          <ToggleYesNo v-model="form.hasLadder" stacked class="fld--3" label="Лестница" />
          <ToggleYesNo v-model="form.insulation" stacked class="fld--3" label="Теплоизоляция" />
          <label v-if="form.insulation" class="fld fld--3"><span>Глубина ТИ, мм</span><input v-model="form.tiGlubina" class="num" /></label>
        </div>
      </section>

      <section id="sec-4" class="ol-sec">
        <h2 class="ol-h">4 · Патрубки</h2>
          <!-- Ряд DN патрубков — подсказки при вводе; вне ряда поле заменит
               значение ближайшим (onDnChange). -->
          <datalist id="nozzle-dn">
            <option v-for="d in NOZZLE_DN_SERIES" :key="d" :value="d" />
          </datalist>
        <div class="ol-cards">
          <div class="ol-card">
            <div class="ol-card-h">Подводящий</div>
            <div class="ol-grid">
              <label class="fld"><span>Материал</span>
                <select v-model="form.podvMat"><option v-for="m in MATERIALS" :key="m">{{ m }}</option></select>
              </label>
              <label class="fld"><span>DN, мм</span><input v-model.lazy="form.podvDn" class="num" list="nozzle-dn" @change="onDnChange('podvDn', $event)" /></label>
              <label class="fld"><span>Кол-во</span><input v-model="form.podvKol" class="num" /></label>
              <!-- От глубины лотка — цепь и направляющие корзины: при
                   корзине поле обязательное, как в листе завода (E51). -->
              <label class="fld"><span>Глубина лотка, мм <b v-if="hasBasket" class="req">*</b></span>
                <input v-model="form.podvLotok" class="num" :class="{ 'is-missing': hasBasket && !form.podvLotok }" />
              </label>
            </div>
          </div>
          <div class="ol-card">
            <div class="ol-card-h">Отводящий</div>
            <div class="ol-grid">
              <label class="fld"><span>Материал</span>
                <select v-model="form.otvMat"><option v-for="m in MATERIALS" :key="m">{{ m }}</option></select>
              </label>
              <label class="fld"><span>DN, мм</span><input v-model.lazy="form.otvDn" class="num" list="nozzle-dn" @change="onDnChange('otvDn', $event)" /></label>
              <label class="fld"><span>Кол-во</span><input v-model="form.otvKol" class="num" /></label>
              <label class="fld"><span>Глубина лотка, мм</span><input v-model="form.otvLotok" class="num" /></label>
            </div>
          </div>
        </div>
      </section>

      <section id="sec-5" class="ol-sec">
        <h2 class="ol-h">5 · Насосное оборудование</h2>
        <div class="ol-grid">
          <ToggleYesNo v-model="form.hasPumps" stacked class="fld--3" label="Насосное оборудование" />
        </div>
        <!-- Прогрессивное раскрытие: при «да» — гидравлический блок как у КНС:
             сверху рабочая точка, снизу сколько насосов её обслуживают. -->
        <template v-if="form.hasPumps">
          <div class="ol-grid">
            <label class="fld fld--4"><span>Рабочий расход, л/с</span><input v-model="form.rashod" class="num" /></label>
            <label class="fld fld--4"><span>Расчётный напор, м</span><input v-model="form.napor" class="num" /></label>
          </div>
          <div class="ol-grid">
            <label class="fld fld--4"><span>Рабочих насосов <b class="req">*</b></span><input v-model="form.nRab" class="num" /></label>
            <label class="fld fld--4"><span>Резервных насосов</span><input v-model="form.nRez" class="num" /></label>
          </div>
          <div class="ol-grid">
            <label class="fld fld--8"><span>Марка насосов</span><input v-model="form.marka" /></label>
          </div>
        </template>
        <p v-else class="ol-live-hint">Без насосов раздел «Напорный трубопровод» в расчёте останется пустым.</p>
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
          <ToggleYesNo v-model="form.ventilation" stacked class="fld--3" label="Вентиляция" />
        </div>
        <div class="ol-grid">
          <ToggleYesNo v-model="form.shu" stacked class="fld--3" label="Шкаф управления" />
          <ToggleYesNo v-model="form.datchikiUrov" stacked class="fld--3" label="Датчики уровня" />
        </div>
        <div v-if="hasBasket && !form.podvLotok" class="ol-explain">
          Цепь и направляющие корзины считаются от глубины лотка подводящего —
          заполните её в разделе «Патрубки».
        </div>
        <div v-if="hasGrinder" class="ol-explain">
          В листе ёмкости узла дробилки нет — в расчёт она не входит, строки
          добавьте вручную.
        </div>
      </section>
    </template>

    <!-- ── Live-панель ── -->
    <template #live>
      <div class="ol-live-h">Габариты</div>
      <dl class="ol-live-vals">
        <div v-for="v in liveValues" :key="v.k" class="ol-live-row" :title="v.f">
          <dt>{{ v.k }} <span class="ol-f">ƒ</span></dt>
          <dd>{{ v.v }}</dd>
        </div>
      </dl>

      <div class="ol-live-lbl">Габаритная длина</div>
      <div class="ol-live-npodz">
        {{ s.overallMm.value != null ? fmtInt(s.overallMm.value) : '—' }} <span class="ol-live-u">мм</span>
      </div>
      <div v-if="s.lengthOverridden.value" class="ol-live-ovr">ручной ввод</div>

      <div class="ol-live-h">Изделие</div>
      <div class="ol-live-prev">
        <div class="ol-prev-t">{{ s.title.value }}</div>
        <div class="ol-prev-s">{{ form.placement }} · {{ form.installation }} · {{ s.material.value }}</div>
        <div class="ol-prev-s">{{ blocksOn }} из {{ blocks.length }} блоков включено</div>
      </div>

      <p class="ol-live-hint">Значения пересчитываются при каждом вводе. Наведите на подпись — увидите формулу.</p>

      <div class="ol-live-foot">
        <div v-if="!s.canCreate.value" class="ol-hint">Заполните: {{ s.missingRequired.value.join(', ') }}</div>
        <!-- У существующего изделия сохранять нечего: расчёт следует за ОЛ
             сам (useSurveySync). Вместо кнопки — итог и путь в расчёт. -->
        <template v-if="isEdit">
          <div class="ol-live-price">
            <span class="ol-live-lbl">Цена продажи</span>
            <strong>{{ sync.salePriceRub.value != null ? `${fmtInt(sync.salePriceRub.value)} ₽` : '—' }}</strong>
          </div>
          <RouterLink class="ol-create ol-create--link" :to="{ name: 'calculator', params: { id: estimateId } }">
            Открыть расчёт →
          </RouterLink>
        </template>
        <button v-else class="ol-create" :disabled="!s.canCreate.value" @click="previewOpen = true">
          Создать расчёт →
        </button>
      </div>
    </template>

    <!-- ── Модал-превью ── -->
    <BaseModal :show="previewOpen" :title="s.title.value" :close-on-backdrop="true" @close="previewOpen = false">
      <p class="mo-sub">{{ s.pipeMark.value }} · {{ form.placement }} · {{ form.installation }}</p>
      <ul class="mo-list">
        <li v-for="b in blocks" :key="b.t">
          <span :class="b.on ? 'mo-on' : 'mo-off'">{{ b.on ? '☑' : '☐' }}</span> {{ b.t }}
        </li>
      </ul>
      <template #footer>
        <button class="ol-btn" @click="previewOpen = false">Отмена</button>
        <button class="ol-create" :disabled="creating" @click="createEstimate">
          {{ creating ? 'Создаём…' : 'Создать расчёт' }}
        </button>
      </template>
    </BaseModal>
  </SurveyShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import BaseModal from '@/components/ui/BaseModal.vue'
import SurveyShell from '@/components/survey/SurveyShell.vue'
import ToggleYesNo from '@/components/survey/ToggleYesNo.vue'
import DeviceTypeSection from '@/components/survey/DeviceTypeSection.vue'
import type { DeviceType } from '@/api/estimates'
import { useEmkSurvey } from '@/composables/useEmkKolSurvey'
import { toast } from '@/composables/useToast'
import { useSurveySync } from '@/composables/useSurveySync'
import { useCalcTreeStore } from '@/stores/calcTree'
import { tryEvalExpr } from '@/engines/expr'
import { acceptDn, NOZZLE_DN_SERIES } from '@/engines/dn-series'
import { makeDefaultEmkSurvey, type EmkSurveyForm } from '@/types/survey-emk-kol'
import { grinderValue, hasBasketIn, hasGrinderIn, pickCommon } from '@/types/survey'
import { estimatesApi } from '@/api/estimates'
import { projectsApi } from '@/api/projects'
import { EMK_SECTIONS } from '@/engines/template-emk-kol'

/** Ветка ЕМК единого опросного листа — режимы как у КНС (см. SurveyKnsView). */
const props = defineProps<{
  estimateId?: string | null
  projectId?: string | null
  initial?: Partial<EmkSurveyForm> | null
  surveyRev?: number
  /** Итог расчёта на момент открытия, ₽ — показывается до первого пересчёта. */
  totalRub?: number | null
  /** Сохранённый surveyData — с ним сверяется, есть ли что сохранять. */
  savedSurvey?: Record<string, unknown> | null
  /** Тип изделия и его переключение — секция 2 листа (владелец — SurveyView). */
  deviceType: DeviceType
  deviceTypes: ReadonlyArray<{ value: DeviceType; label: string }>
  canChangeType: boolean
  projectTitle?: string | null
}>()

defineEmits<{ 'update:deviceType': [DeviceType] }>()

const router = useRouter()
const form = ref<EmkSurveyForm>({ ...makeDefaultEmkSurvey(), ...props.initial })
// Разбор числовых полей. Объявлен до useSurveySync намеренно: watch
// вычисляет нагрузку (surveyPayload → num) сразу при создании, и объявленная
// ниже константа давала ReferenceError. Ошибка глоталась, а watch запоминал
// только поля «Общих» — правки DN, объёма и тумблеров не сохранялись, пока
// не тронешь заказчика или заявку.
const num = (v: string) => tryEvalExpr(v)

// Корзина и дробилка — два тумблера над одним полем модели (см. grinderValue).
const hasBasket = computed({
  get: () => hasBasketIn(form.value.grinder),
  set: (v: boolean) => { form.value.grinder = grinderValue(v, hasGrinder.value) },
})
const hasGrinder = computed({
  get: () => hasGrinderIn(form.value.grinder),
  set: (v: boolean) => { form.value.grinder = grinderValue(hasBasket.value, v) },
})
const s = useEmkSurvey(form)

/** Тумблер днищ: левая половина — эллиптические, правая — цилиндрические. */
const ellipticBottoms = computed({
  get: () => form.value.bottomType !== 'цилиндрические',
  set: (v: boolean) => { form.value.bottomType = v ? 'эллиптические' : 'цилиндрические' },
})
const bottomsHint = computed(() =>
  ellipticBottoms.value
    ? 'Формованные: масса — из матрицы «Формовка эллиптических днищ» по DN и длине. К трубе — ламинирование по Мс (DN трубы, минимальное PN).'
    : 'Из той же трубы: +1,5 м трубы на оба днища, ламинация косых и центрального стыков по Мс (DN трубы, минимальное PN).',
)

const isEdit = computed(() => Boolean(props.estimateId))

const backTarget = computed(() =>
  props.projectId ? { name: 'project', params: { id: props.projectId } } : { name: 'dashboard' },
)
const backLabel = computed(() => (props.projectId ? '← Проект' : '← Проекты'))

const TANK_TYPES = ['Накопительная', 'Химстойкая', 'Аккумулирующая', 'Питьевая', 'С насосным оборудованием'] as const
const STAGES = ['проект', 'рабочая', 'КД', 'продажа', 'тендер'] as const
const MATERIALS = ['ПЭ', 'ПВХ', 'ПНД', 'ПП', 'Асбестцемент', 'Корсис', 'стеклокомпозит'] as const
const PN_LIST = ['0,1', '0,6', '1', '1,6'] as const
const SN_LIST = ['1250', '2500', '5000', '10000'] as const
/** Домен DN — из справочника весов, как и у КНС (30 значений). */
const DN_LIST = [300, 350, 400, 450, 500].concat(Array.from({ length: 25 }, (_, i) => 600 + i * 100)).map(String)

const activeSec = ref(1)
const previewOpen = ref(false)
const creating = ref(false)
const shell = ref<InstanceType<typeof SurveyShell> | null>(null)

// ── Расчёт следует за ОЛ ────────────────────────────────────────────────────

const store = useCalcTreeStore()
const estimateId = computed(() => props.estimateId ?? null)

/**
 * Правка ОЛ существующего изделия сама пересобирает и сохраняет расчёт —
 * как у КНС. У нового листа сохранять некуда: там работает «Создать расчёт».
 */
const sync = useSurveySync({
  estimateId: () => props.estimateId,
  initialRev: props.surveyRev ?? 0,
  initialPrice: props.totalRub ?? null,
  savedPayload: props.savedSurvey ?? null,
  payload: () => surveyPayload(),
})

const syncLabel = computed(() => {
  if (!props.estimateId) return 'новый лист · сохранится при создании расчёта'
  switch (sync.status.value) {
    case 'pending': return 'изменения…'
    case 'saving': return 'сохраняем и пересчитываем…'
    case 'invalid': return 'не сохранено: исправьте поля, выделенные красным'
    case 'saved': return `сохранено ${sync.savedAt.value?.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) ?? ''} · расчёт пересчитан`
    case 'error': return `не сохранено: ${sync.error.value ?? 'ошибка'}`
    default: return 'сохранено · расчёт актуален'
  }
})

// Справочники — сразу: первый пересчёт не будет ждать их загрузки.
onMounted(() => {
  store.ensureContext().catch(() => {
    // Без справочников пересчёт попробует загрузить их сам при первой правке.
  })
})

/** Цена трубы корпуса и что она даёт на длину корпуса. */
const pipePriceValue = computed(() => tryEvalExpr(form.value.pipePrice))
const pipeCostHint = computed(() => {
  const price = pipePriceValue.value
  if (price == null) return 'без цены строка трубы в расчёте «красная» и КП не выпустить'
  const lengthMm = s.pipeTotalMm.value
  if (lengthMm == null || lengthMm <= 0) return 'длина трубы станет известна после габаритов'
  const lengthM = lengthMm / 1000
  const what = s.bottomsFromPipe.value ? 'на корпус и днища' : 'на корпус'
  return `× ${lengthM.toLocaleString('ru-RU')} м = ${fmtInt(price * lengthM)} ₽ ${what}`
})

const fmtInt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
const fmt = (n: number | null, d = 2) =>
  n == null ? '—' : n.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d })

const steps = computed(() => [
  { n: 1, title: 'Общие', done: form.value.zakazchik.trim() !== '' },
  { n: 2, title: 'Тип изделия', done: true },
  { n: 3, title: 'Габариты', done: s.lengthMm.value != null },
  { n: 4, title: 'Патрубки', done: num(form.value.podvDn) != null },
  { n: 5, title: 'Насосное', done: !form.value.hasPumps || (num(form.value.nRab) ?? 0) >= 1 },
  { n: 6, title: 'Доп. оборудование', done: true },
])

const liveValues = computed(() => {
  const g = s.geo.value
  return [
    { k: 'Объём', v: `${form.value.volumeM3} м³`, f: 'ƒ вход опросного листа' },
    {
      k: 'Длина трубы',
      v: s.lengthMm.value != null ? `${fmtInt(s.lengthMm.value)} мм` : '—',
      f: s.lengthOverridden.value ? 'ручной ввод' : 'ƒ CEILING(4V/(π·(D/1000)²)·1000; 100)',
    },
    {
      k: 'Днища',
      v:
        form.value.placement !== 'горизонтальное'
          ? 'плоское'
          : s.bottomsFromPipe.value
            ? 'цилиндр. ×2, +1,5 м трубы'
            : `эллипт. ×2 · ${fmt(g.ellipticVolumeM3)} м³`,
      f: s.bottomsFromPipe.value
        ? 'ƒ из той же трубы: (L + 1,5 м), ламинация (Мс/0,707 + Мс/2)·2'
        : 'ƒ объём 2 днищ = π·(DN/1000)³/15; масса — матрица f(DN, L)',
    },
    { k: 'Возвышение', v: `${g.elevationMm} мм`, f: 'ƒ подземная — 300 мм, иначе 0' },
    { k: 'Шахта', v: g.shaftDiameterMm ? `Ø${g.shaftDiameterMm} h${g.shaftHeightMm}` : 'нет', f: 'ƒ по флагу ОЛ' },
  ]
})

const blocks = computed(() => [
  { t: 'Корпус ёмкости', on: true },
  {
    t:
      form.value.placement !== 'горизонтальное'
        ? 'Днище плоское'
        : s.bottomsFromPipe.value
          ? 'Днища цилиндрические ×2'
          : 'Днища эллиптические ×2',
    on: true,
  },
  { t: 'Шахта обслуживания', on: form.value.hasShaft },
  { t: 'Теплоизоляция', on: form.value.insulation },
  { t: 'Корзина', on: form.value.grinder === 'корзина' || form.value.grinder === 'обе' },
  { t: 'Лестница', on: form.value.hasLadder },
  { t: 'Перекрытие, площадка и несущие балки', on: true },
  { t: 'Вентиляционный стояк', on: form.value.ventilation },
  { t: 'Напорный трубопровод', on: form.value.hasPumps },
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


/** Поля DN патрубков этого листа. */
type DnKey = 'podvDn' | 'otvDn'

/**
 * DN патрубка — только из ряда мастер-книги (engines/dn-series.ts): введённое
 * вне ряда при уходе с поля заменяется ближайшим, и об этом говорится.
 * Модель поля обновляется по change (v-model.lazy), поэтому промежуточное
 * «2850» до замены не успевает уйти в расчёт.
 */
function onDnChange(key: DnKey, e: Event) {
  const raw = (e.target as HTMLInputElement).value
  const accepted = acceptDn(raw)
  if (!accepted) return
  if (accepted.text !== raw.trim()) form.value[key] = accepted.text
  if (accepted.from != null) {
    toast(`DN ${accepted.from.toLocaleString('ru-RU')} нет в ряду патрубков — принят ${accepted.text}`)
  }
}

function resetPipe() {
  form.value.pipeManual = false
  form.value.lengthManual = ''
  form.value.pnManual = ''
  form.value.snManual = ''
}

/** Единый контракт surveyData — см. комментарий в SurveyKnsView. */
function surveyPayload() {
  return {
    common: pickCommon(form.value),
    // Ключ `emk` — по нему стор выбирает шаблон ёмкости (materializeByDevice).
    emk: {
      dn: num(form.value.dn) ?? 0,
      volumeM3: num(form.value.volumeM3) ?? 0,
      placement: form.value.placement,
      installation: form.value.installation,
      tankType: form.value.tankType,
      bottomType: form.value.bottomType,
      pnSurvey: s.pn.value,
      // Труба — та, что в листе: ручные длина и SN раньше сюда не доходили,
      // и расчёт считал другую трубу, чем показывал ОЛ.
      sn: s.sn.value,
      pipeLengthMm: s.manualLengthMm.value,
      hasShaft: form.value.hasShaft,
      shaftDiameterMm: num(form.value.shaftD),
      shaftHeightMm: num(form.value.shaftH),
      servicePipePriceRub: num(form.value.servicePipePrice),
      inletDn: num(form.value.podvDn) ?? 0,
      inletCount: num(form.value.podvKol) ?? 0,
      outletDn: num(form.value.otvDn) ?? 0,
      outletCount: num(form.value.otvKol) ?? 0,
      hasPumps: form.value.hasPumps,
      pumpsWorking: num(form.value.nRab) ?? 0,
      pumpsReserve: num(form.value.nRez) ?? 0,
      hasBasket: form.value.grinder === 'корзина' || form.value.grinder === 'обе',
      inletTrayDepthMm: num(form.value.podvLotok),
      insulationEnabled: form.value.insulation,
      insulationDepthMm: num(form.value.tiGlubina) ?? 0,
      // Цена трубы — поле ОЛ, связанное со строкой трубы (priceBinding).
      pipePriceRub: num(form.value.pipePrice),
    },
    form: { ...form.value },
  }
}

/**
 * Создание изделия из ОЛ.
 *
 * Расчёт строится сразу же (applySurvey), а лист остаётся открытым — уже как
 * лист существующего изделия (/survey/:id): дальше правки ОЛ сами ведут
 * расчёт, а в него самого ведёт «Открыть расчёт →».
 */
async function createEstimate() {
  creating.value = true
  try {
    const dto = {
      title: s.title.value,
      deviceType: 'EMK' as const,
      surveyData: {
        ...surveyPayload(),
        surveyRev: 1,
        sections: EMK_SECTIONS.map((x) => ({ code: x.code, title: x.title, enabled: true, components: [] })),
      },
    }
    const est = props.projectId
      ? await projectsApi.addEstimate(props.projectId, dto)
      : await estimatesApi.create(dto)
    await store.applySurvey(est.id, { ...surveyPayload(), surveyRev: 2 })
    // Временной слепок исходного состояния: дальше ОЛ пересобирает расчёт
    // при каждой правке, и то, с чего единица начала, иначе не восстановить.
    // Не удался — единица уже создана, поэтому не обрываем, а предупреждаем.
    try {
      await estimatesApi.createSnapshot(est.id, 'CREATE')
    } catch {
      toast('Слепок исходного состояния не снят — зафиксируйте версию вручную в расчёте', 'error')
    }
    toast('Расчёт ёмкости создан, расчёт собран', 'success')
    previewOpen.value = false
    await router.replace({ name: 'survey', params: { id: est.id } })
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Не удалось создать расчёт', 'error')
  } finally {
    creating.value = false
  }
}
</script>
