<template>
  <SurveyShell
    ref="shell"
    title="Опросный лист — ёмкость"
    :zayavka="form.zayavka || '—'"
    :draft-time="draftTime"
    :active-sec="activeSec"
    :sections="steps"
    @go="goSection"
    @scroll="onScroll"
  >
    <!-- ── Форма ── -->
    <template #form>
      <section id="sec-1" class="ol-sec">
        <h2 class="ol-h">1 · Общие</h2>
        <div class="ol-grid">
          <label class="fld"><span>№ заявки ОЛ</span><input v-model="form.zayavka" /></label>
          <label class="fld"><span>Тип ёмкости</span>
            <select v-model="form.tankType"><option v-for="t in TANK_TYPES" :key="t">{{ t }}</option></select>
          </label>
          <label class="fld"><span>Стадия</span>
            <select v-model="form.stadiya"><option v-for="t in STAGES" :key="t">{{ t }}</option></select>
          </label>
          <label class="fld"><span>Заказчик <b class="req">*</b></span>
            <input v-model="form.zakazchik" :class="{ 'is-missing': !form.zakazchik.trim() }" />
          </label>
          <label class="fld fld--wide"><span>Объект</span><input v-model="form.obekt" /></label>
          <label class="fld"><span>Регион</span><input v-model="form.region" /></label>
          <label class="fld"><span>Дата</span><input v-model="form.data" /></label>
        </div>
      </section>

      <section id="sec-2" class="ol-sec">
        <h2 class="ol-h">2 · Габариты</h2>
        <div class="ol-grid">
          <label class="fld"><span>Объём, м³ <b class="req">*</b></span>
            <input v-model="form.volumeM3" class="num" :class="{ 'is-missing': !form.volumeM3 }" />
          </label>
          <label class="fld"><span>DN корпуса, мм <b class="req">*</b></span>
            <select v-model="form.dn"><option v-for="d in DN_LIST" :key="d">{{ d }}</option></select>
          </label>
          <label class="fld"><span>Расположение</span>
            <select v-model="form.placement"><option>горизонтальное</option><option>вертикальное</option></select>
          </label>
          <label class="fld"><span>Установка</span>
            <select v-model="form.installation">
              <option>наземная</option><option>подземная</option><option>в помещении</option>
            </select>
          </label>
        </div>

        <!-- Труба: длина считается из объёма, PN/SN — производные -->
        <div class="ol-card">
          <div class="ol-card-h">Труба корпуса <span class="f-mark" title="Длина считается из объёма; PN и SN продиктованы габаритами">ƒ</span></div>
          <div v-if="s.pipeMark.value" class="ol-grade">{{ s.pipeMark.value }}</div>
          <div v-else class="ol-grade ol-grade--empty">— укажите объём и DN</div>
          <div v-if="s.explain.value" class="ol-explain">{{ s.explain.value }}</div>

          <label class="ol-chk">
            <input v-model="form.pipeManual" type="checkbox" /><span>изменить вручную</span>
          </label>
          <div v-if="form.pipeManual" class="ol-manual">
            <label class="fld"><span>Длина трубы, мм</span>
              <input v-model="form.lengthManual" class="num" :placeholder="String(s.geo.value.pipeLengthMm ?? '')" />
            </label>
            <label class="fld"><span>PN, МПа</span>
              <select v-model="form.pnManual"><option value="">расч.</option><option v-for="p in PN_LIST" :key="p">{{ p }}</option></select>
            </label>
            <label class="fld"><span>SN, Па</span>
              <select v-model="form.snManual"><option value="">расч.</option><option v-for="v in SN_LIST" :key="v">{{ v }}</option></select>
            </label>
            <button class="ol-reset" @click="resetPipe">↺ вернуть расчётные</button>
          </div>
        </div>

        <div class="ol-toggles">
          <ToggleYesNo v-model="form.hasShaft" label="Шахта обслуживания" />
          <ToggleYesNo v-model="form.hasLadder" label="Лестница" />
          <ToggleYesNo v-model="form.insulation" label="Теплоизоляция" />
        </div>
        <div v-if="form.hasShaft || form.insulation" class="ol-grid">
          <label v-if="form.hasShaft" class="fld"><span>d шахты, мм</span><input v-model="form.shaftD" class="num" /></label>
          <label v-if="form.hasShaft" class="fld"><span>h шахты, мм</span><input v-model="form.shaftH" class="num" /></label>
          <label v-if="form.insulation" class="fld"><span>Глубина теплоизоляции, мм</span><input v-model="form.tiGlubina" class="num" /></label>
        </div>
      </section>

      <section id="sec-3" class="ol-sec">
        <h2 class="ol-h">3 · Патрубки</h2>
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

      <section id="sec-4" class="ol-sec">
        <h2 class="ol-h">4 · Насосное оборудование</h2>
        <div class="ol-toggles">
          <ToggleYesNo v-model="form.hasPumps" label="Насосное оборудование" />
        </div>
        <!-- Прогрессивное раскрытие: при «да» — гидравлический блок как у КНС -->
        <div v-if="form.hasPumps" class="ol-grid">
          <label class="fld"><span>Максимальный приток, л/с</span><input v-model="form.rashod" class="num" /></label>
          <label class="fld"><span>Расчётный напор, м</span><input v-model="form.napor" class="num" /></label>
          <label class="fld"><span>Рабочих <b class="req">*</b></span><input v-model="form.nRab" class="num" /></label>
          <label class="fld"><span>Резервных</span><input v-model="form.nRez" class="num" /></label>
          <label class="fld fld--wide"><span>Марка насосов</span><input v-model="form.marka" /></label>
        </div>
        <p v-else class="ol-live-hint">Без насосов раздел «Напорный трубопровод» в расчёте останется пустым.</p>
      </section>

      <section id="sec-5" class="ol-sec">
        <h2 class="ol-h">5 · Доп. оборудование</h2>
        <div class="ol-grid">
          <label class="fld"><span>Дробилка / корзина</span>
            <select v-model="form.grinder"><option v-for="g in GRINDERS" :key="g">{{ g }}</option></select>
          </label>
        </div>
        <div class="ol-toggles">
          <ToggleYesNo v-model="form.hasValves" label="Запорная арматура" />
          <ToggleYesNo v-model="form.shu" label="Шкаф управления" />
          <ToggleYesNo v-model="form.datchikiUrov" label="Датчики уровня" />
          <ToggleYesNo v-model="form.ventilation" label="Вентиляция" />
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
        <button class="ol-create" :disabled="!s.canCreate.value" @click="previewOpen = true">Создать расчёт →</button>
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
          {{ creating ? 'Создаём…' : 'Создать расчёт → конфигуратор' }}
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
import { useEmkSurvey } from '@/composables/useEmkKolSurvey'
import { toast } from '@/composables/useToast'
import { tryEvalExpr } from '@/engines/expr'
import { makeDefaultEmkSurvey } from '@/types/survey-emk-kol'
import { estimatesApi } from '@/api/estimates'
import { EMK_SECTIONS } from '@/engines/template-emk-kol'

const router = useRouter()
const form = ref(makeDefaultEmkSurvey())
const s = useEmkSurvey(form)

const TANK_TYPES = ['Накопительная', 'Химстойкая', 'Аккумулирующая', 'Питьевая', 'С насосным оборудованием'] as const
const STAGES = ['проект', 'рабочая', 'КД', 'продажа', 'тендер'] as const
const MATERIALS = ['ПЭ', 'ПВХ', 'ПНД', 'ПП', 'Асбестцемент', 'Корсис', 'стеклокомпозит'] as const
const GRINDERS = ['корзина', 'дробилка', 'обе', 'нет'] as const
const PN_LIST = ['0,1', '0,6', '1', '1,6'] as const
const SN_LIST = ['1250', '2500', '5000', '10000'] as const
/** Домен DN — из справочника весов, как и у КНС (30 значений). */
const DN_LIST = [300, 350, 400, 450, 500].concat(Array.from({ length: 25 }, (_, i) => 600 + i * 100)).map(String)

const activeSec = ref(1)
const previewOpen = ref(false)
const creating = ref(false)
const shell = ref<InstanceType<typeof SurveyShell> | null>(null)
const draftTime = ref(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))

const fmtInt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
const fmt = (n: number | null, d = 2) =>
  n == null ? '—' : n.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d })

const num = (v: string) => tryEvalExpr(v)

const steps = computed(() => [
  { n: 1, title: 'Общие', done: form.value.zakazchik.trim() !== '' },
  { n: 2, title: 'Габариты', done: s.lengthMm.value != null },
  { n: 3, title: 'Патрубки', done: num(form.value.podvDn) != null },
  { n: 4, title: 'Насосное', done: !form.value.hasPumps || (num(form.value.nRab) ?? 0) >= 1 },
  { n: 5, title: 'Доп. оборудование', done: true },
])

const liveValues = computed(() => {
  const g = s.geo.value
  return [
    { k: 'Объём', v: `${form.value.volumeM3} м³`, f: 'ƒ вход опросного листа' },
    { k: 'Длина трубы', v: s.lengthMm.value != null ? `${fmtInt(s.lengthMm.value)} мм` : '—', f: 'ƒ CEILING(4V/(π·(D/1000)²)·1000; 100)' },
    { k: 'Днища', v: g.ellipticVolumeM3 != null ? `эллипт. ${fmt(g.ellipticVolumeM3)} м³` : 'плоское', f: 'ƒ объём 2 днищ = π·(DN/1000)³/15 (горизонтальная)' },
    { k: 'Возвышение', v: `${g.elevationMm} мм`, f: 'ƒ подземная — 300 мм, иначе 0' },
    { k: 'Шахта', v: g.shaftDiameterMm ? `Ø${g.shaftDiameterMm} h${g.shaftHeightMm}` : 'нет', f: 'ƒ по флагу ОЛ' },
  ]
})

const blocks = computed(() => [
  { t: 'Корпус ёмкости', on: true },
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

function resetPipe() {
  form.value.pipeManual = false
  form.value.lengthManual = ''
  form.value.pnManual = ''
  form.value.snManual = ''
}

async function createEstimate() {
  creating.value = true
  try {
    const est = await estimatesApi.create({
      title: s.title.value,
      deviceType: 'EMK',
      // Ключ `emk` — по нему стор выбирает шаблон ёмкости (materializeByDevice).
      surveyData: {
        emk: {
          dn: num(form.value.dn) ?? 0,
          volumeM3: num(form.value.volumeM3) ?? 0,
          placement: form.value.placement,
          installation: form.value.installation,
          tankType: form.value.tankType,
          pnSurvey: s.pn.value,
          hasShaft: form.value.hasShaft,
          inletDn: num(form.value.podvDn) ?? 0,
          inletCount: num(form.value.podvKol) ?? 0,
          outletDn: num(form.value.otvDn) ?? 0,
          outletCount: num(form.value.otvKol) ?? 0,
          hasPumps: form.value.hasPumps,
          pumpsWorking: num(form.value.nRab) ?? 0,
          pumpsReserve: num(form.value.nRez) ?? 0,
          hasBasket: form.value.grinder === 'корзина' || form.value.grinder === 'обе',
          insulationEnabled: form.value.insulation,
          insulationDepthMm: num(form.value.tiGlubina) ?? 0,
        },
        form: { ...form.value },
        sections: EMK_SECTIONS.map((x) => ({ code: x.code, title: x.title, enabled: true, components: [] })),
      },
    })
    toast('Расчёт ёмкости создан', 'success')
    await router.push({ name: 'calculator', params: { id: est.id } })
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Не удалось создать расчёт', 'error')
    creating.value = false
  }
}
</script>
