<template>
  <div class="ol">
    <!-- ── Топбар ── -->
    <header class="ol-top">
      <div class="ol-top-l">
        <RouterLink class="ol-lnk" :to="backTarget">{{ backLabel }}</RouterLink>
        <span class="ol-name">Опросный лист — насосная станция</span>
        <span class="ol-zayavka">заявка {{ form.zayavka }} · черновик валиден в любом порядке</span>
      </div>
      <div class="ol-top-r">
        <span class="ol-draft">сохранено {{ draftTime }}</span>
        <RouterLink v-if="lastEstimateId" class="ol-lnk" :to="{ name: 'calculator', params: { id: lastEstimateId } }">
          → Конфигуратор расчёта
        </RouterLink>
        <button class="ol-btn" title="Переключить тему" @click="toggle">
          {{ theme === 'dark' ? '☾' : '☀' }} тема
        </button>
      </div>
    </header>

    <div class="ol-body">
      <!-- ── Степпер секций ── -->
      <nav class="ol-steps">
        <button
          v-for="sec in SECTIONS"
          :key="sec.n"
          class="ol-step"
          :class="{ 'is-active': activeSec === sec.n }"
          @click="goSection(sec.n)"
        >
          <!-- ✓ секция заполнена · ● есть незаполненные обязательные -->
          <span class="ol-step-m" :class="secDone(sec.n) ? 'ok' : 'todo'">{{ secDone(sec.n) ? '✓' : '●' }}</span>
          <span class="ol-step-t">{{ sec.title }}</span>
        </button>
        <p class="ol-steps-hint">Секции заполняются в любом порядке. ● — есть незаполненные обязательные.</p>
      </nav>

      <!-- ── Форма ── -->
      <main ref="formEl" class="ol-form" @scroll="onScroll">
        <!-- 1. Общие -->
        <section :id="'sec-1'" class="ol-sec">
          <h2 class="ol-h">1 · Общие</h2>
          <div class="ol-grid">
            <label class="fld"><span>№ заявки ОЛ</span><input v-model="form.zayavka" /></label>
            <label class="fld"><span>Тип НС</span>
              <select v-model="form.tipNs">
                <option v-for="t in NS_TYPES" :key="t">{{ t }}</option>
              </select>
            </label>
            <label class="fld"><span>Стадия проекта</span>
              <select v-model="form.stadiya"><option v-for="t in STAGES" :key="t">{{ t }}</option></select>
            </label>
            <label class="fld"><span>Заказчик</span><input v-model="form.zakazchik" /></label>
            <label class="fld fld--wide"><span>Объект</span><input v-model="form.obekt" /></label>
            <label class="fld"><span>Регион</span><input v-model="form.region" /></label>
            <label class="fld"><span>Дата</span><input v-model="form.data" /></label>
          </div>
        </section>

        <!-- 2. Тип изделия -->
        <section :id="'sec-2'" class="ol-sec">
          <h2 class="ol-h">2 · Тип изделия</h2>
          <DeviceTypeSection
            :model-value="deviceType"
            :types="deviceTypes"
            :can-change="canChangeType"
            :project-title="projectTitle"
            @update:model-value="$emit('update:deviceType', $event)"
          />
        
          <div class="ol-grid">
            <label class="fld"><span>DN корпуса, мм</span>
              <select v-model="form.dn"><option v-for="d in DN_LIST" :key="d">{{ d }}</option></select>
            </label>
          </div>

          <!-- Труба корпуса: PN/SN вычисляются, не задаются -->
          <div class="ol-card">
            <div class="ol-card-h">Труба корпуса <span class="f-mark" title="PN и SN не задаются: они продиктованы глубиной и требованиями заказчика">ƒ</span></div>
            <!-- Марка без префикса «Труба» — как в прототипе: подпись карточки
                 уже говорит, что это труба корпуса. -->
            <div v-if="s.pipeMark.value" class="ol-grade">{{ s.pipeMark.value }}</div>
            <div v-else class="ol-grade ol-grade--empty">— укажите DN и глубину</div>
            <div v-if="s.snExplain.value" class="ol-explain">{{ s.snExplain.value }}</div>

            <label class="ol-chk">
              <input v-model="form.pipeManual" type="checkbox" />
              <span>изменить вручную</span>
            </label>

            <div v-if="form.pipeManual" class="ol-manual">
              <label class="fld"><span>PN, МПа</span>
                <select v-model="form.pnManual"><option value="">расчётное</option><option v-for="p in PN_LIST" :key="p">{{ p }}</option></select>
              </label>
              <label class="fld"><span>SN, Па</span>
                <select v-model="form.snManual"><option value="">расчётное</option><option v-for="v in SN_LIST" :key="v">{{ v }}</option></select>
              </label>
              <!-- Возвышение и глубина теплоизоляции живут здесь же: это
                   такие же типовые величины, что PN и SN, и трогают их так же
                   редко. Глубина показывается только при включённой
                   теплоизоляции — иначе она ни на что не влияет. -->
              <label class="fld"><span>Возвышение над землёй, мм</span>
                <input v-model="form.vozv" class="num" :placeholder="String(ELEVATION_DEFAULT_MM)" />
              </label>
              <label v-if="form.insulation" class="fld"><span>Глубина теплоизоляции, мм</span>
                <input v-model="form.tiGlubina" class="num" :placeholder="String(TI_DEPTH_DEFAULT_MM)" />
              </label>
              <button class="ol-reset" @click="resetPipe">↺ вернуть расчётные</button>
            </div>
          </div>

          <div class="ol-toggles">
            <ToggleYesNo v-model="form.underRoadway" label="Под проезжей частью" />
            <ToggleYesNo v-model="form.mvk" label="По ТТ МВК" />
            <ToggleYesNo v-model="form.insulation" label="Теплоизоляция" />
          </div>
          <label class="fld"><span>Исполнение обечайки</span>
            <select v-model="form.ispolnenie">
              <option value="целая">Целая труба</option>
              <option value="частями">Труба частями</option>
            </select>
          </label>
          <div v-if="form.ispolnenie === 'частями'" class="ol-explain">
            В расчёт добавятся сегменты трубы (длины разносите вручную) и
            ламинирование стыков по Мс из справочника.
          </div>
        
        </section>

        <!-- 3. Насосное оборудование -->
        <section :id="'sec-3'" class="ol-sec">
          <h2 class="ol-h">3 · Насосное оборудование</h2>
          <!-- Две строки, а не одна сетка: сверху то, что задаёт рабочую точку
               (расход и напор), снизу — сколько насосов её обслуживают. Раньше
               «Рабочих» затекало в первую строку и читалось как часть напора. -->
          <div class="ol-grid ol-grid--2">
            <label class="fld"><span>Максимальный приток <b class="req">*</b></span>
              <div class="ol-unit">
                <input v-model="form.rashod" class="num" />
                <select v-model="form.rashodUnit" class="ol-unit-sel">
                  <option value="l/s">л/с</option>
                  <option value="m3/h">м³/ч</option>
                  <option value="m3/day">м³/сут</option>
                </select>
              </div>
            </label>
            <label class="fld"><span>Расчётный напор, м</span><input v-model="form.napor" class="num" /></label>
          </div>

          <div class="ol-grid ol-grid--3">
            <label class="fld"><span>Рабочих насосов <b class="req">*</b></span><input v-model="form.nRab" class="num" /></label>
            <label class="fld"><span>Резервных насосов</span><input v-model="form.nRez" class="num" /></label>
            <!-- «На склад» — формулировка опросного листа завода: эти насосы
                 в станцию не ставятся и в обвязку не входят. -->
            <label class="fld"><span>Запасных на склад</span><input v-model="form.nZap" class="num" /></label>
          </div>

          <div class="ol-grid">
            <label class="fld fld--wide"><span>Марка насосов</span>
              <!-- Выбор из подобранных: по умолчанию оптимальный, но инженер
                   может взять другой — в том числе отсечённый по запасу. -->
              <select v-if="hasPumpChoices" :value="pumpChoice" @change="onPumpChoice">
                <option value="">
                  автоматически{{ p.pumpModelCalc.value ? ` — ${p.pumpModelCalc.value}` : '' }}
                </option>
                <optgroup v-if="p.choices.value.fitting.length" label="Подходят">
                  <option v-for="c in p.choices.value.fitting" :key="c.name" :value="c.name">
                    {{ p.optionLabel(c) }}
                  </option>
                </optgroup>
                <optgroup
                  v-if="p.choices.value.belowMargin.length"
                  :label="`Напор дают, но запас меньше ${p.marginBand.value?.min ?? 0} м`"
                >
                  <option v-for="c in p.choices.value.belowMargin" :key="c.name" :value="c.name">
                    {{ p.optionLabel(c) }}
                  </option>
                </optgroup>
                <option value="__manual">ввести вручную…</option>
              </select>
              <input
                v-if="!hasPumpChoices || manualPump"
                v-model="form.marka"
                :placeholder="p.pumpModelCalc.value ?? 'подберётся по притоку и напору'"
              />
              <span v-if="p.pumpExplain.value" class="ol-pick" :class="{ 'ol-pick--warn': !p.pumpModelCalc.value && p.ready.value && !p.loading.value }">
                {{ p.pumpExplain.value }}
                <button
                  v-if="p.pumpModelCalc.value && p.pumpModelOverridden.value"
                  type="button" class="ol-pick-btn" @click="p.resetToCalculated"
                >вернуть подобранную</button>
              </span>
              <span v-if="p.alternativesExplain.value" class="ol-pick">{{ p.alternativesExplain.value }}</span>
            </label>
            <label class="fld"><span>Дробилка / корзина</span>
              <select v-model="form.drobilka"><option v-for="g in GRINDERS" :key="g">{{ g }}</option></select>
            </label>
          </div>
          <div class="ol-toggles"><ToggleYesNo v-model="form.vzryv" label="Взрывозащита" /></div>
        
        </section>

        <!-- 4. Патрубки -->
        <section :id="'sec-4'" class="ol-sec">
          <h2 class="ol-h">4 · Патрубки</h2>
          <div class="ol-cards">
            <div class="ol-card">
              <div class="ol-card-h">Подводящий</div>
              <div class="ol-grid">
                <label class="fld"><span>Материал</span>
                  <select v-model="form.podvMat"><option v-for="m in MATERIALS" :key="m">{{ m }}</option></select>
                </label>
                <label class="fld"><span>DN, мм</span><input v-model="form.podvDn" class="num" /></label>
                <label class="fld"><span>Кол-во</span><input v-model="form.podvKol" class="num" /></label>
                <label class="fld"><span>Глубина лотка, мм <b class="req">*</b></span>
                  <input v-model="form.podvLotok" class="num" :class="{ 'is-missing': !form.podvLotok }" />
                </label>
              </div>
            </div>
            <div class="ol-card">
              <div class="ol-card-h">Напорный</div>
              <div class="ol-grid">
                <label class="fld"><span>Материал</span>
                  <select v-model="form.napMat"><option v-for="m in MATERIALS" :key="m">{{ m }}</option></select>
                </label>
                <label class="fld"><span>DN, мм</span>
                  <input v-model="form.napDn" class="num" />
                  <!-- Только подсказка: DN напорного входит в наименования строк
                       расчёта, и молчаливая подмена увела бы за собой ручные цены. -->
                  <span v-if="p.pipeExplain.value" class="ol-pick">{{ p.pipeExplain.value }}</span>
                </label>
                <label class="fld"><span>Кол-во</span>
                  <input v-model="form.napKol" class="num" />
                  <!-- Число ниток делит поток: при одной нитке на два насоса
                       отводящий патрубок выходит крупнее стояка. -->
                  <span v-if="p.pipingExplain.value" class="ol-pick">{{ p.pipingExplain.value }}</span>
                </label>
                <label class="fld"><span>Глубина лотка, мм</span><input v-model="form.napLotok" class="num" /></label>
              </div>
            </div>
          </div>

          <div class="ol-toggles">
            <ToggleYesNo v-model="form.valveOnInlet" label="Арматура на подводящем" />
            <ToggleYesNo v-model="form.emergency" label="Аварийный трубопровод" />
          </div>
          <!-- Муфта приваривается к трубопроводу, наружу торчит только ответная
               часть под подключение машины. Её размер от DN линии не зависит. -->
          <label v-if="form.emergency" class="fld"><span>Быстросъёмная муфта</span>
            <select v-model="form.muftaGm">
              <option v-for="gm in COUPLING_SIZES" :key="gm" :value="String(gm)">ГМ{{ gm }}</option>
            </select>
          </label>

          <!-- Арматура: вычисляется с override -->
          <div class="ol-grid">
            <CalcField
              v-model="form.zadvManual"
              label="Задвижки — подводящие (безнапорные)"
              :calc="s.gatesCalc.value"
              :value="s.gates.value"
              :overridden="s.gatesOverridden.value"
              :explain="s.gatesExplain.value"
            />
            <CalcField
              v-model="form.kranManual"
              label="Шаровые краны — напорная линия"
              :calc="s.ballsCalc.value"
              :value="s.balls.value"
              :overridden="s.ballsOverridden.value"
              :explain="s.ballsExplain.value"
            />
          </div>
        
        </section>

        <!-- 5. Автоматика -->
        <section :id="'sec-5'" class="ol-sec">
          <h2 class="ol-h">5 · Автоматика</h2>
          <div class="ol-toggles">
            <ToggleYesNo v-model="form.shu" label="Шкаф управления" />
            <ToggleYesNo v-model="form.datchikiDavl" label="Датчики давления" />
            <ToggleYesNo v-model="form.datchikiUrov" label="Датчики уровня" />
            <ToggleYesNo v-model="form.rashodomer" label="Расходомер" />
          </div>
          <div v-if="form.shu" class="ol-grid">
            <label class="fld"><span>Тип ШУ</span>
              <select v-model="form.shuTip"><option>внутренний</option><option>уличный</option></select>
            </label>
            <label class="fld"><span>Пуск</span>
              <select v-model="form.shuPusk"><option>стандартный</option><option>плавный</option><option>ЧП</option></select>
            </label>
          </div>
        
        </section>






        <div class="ol-tail" />
      </main>

      <!-- ── Live-панель «Подбор глубины» ── -->
      <aside class="ol-live">
        <div class="ol-live-h">Подбор глубины</div>

        <!-- Порядок как в прототипе: сначала цепочка величин, затем итог. -->
        <dl class="ol-live-vals">
          <div v-for="v in liveValues" :key="v.k" class="ol-live-row" :title="v.f">
            <dt>{{ v.k }} <span class="ol-f">ƒ</span></dt>
            <dd>{{ v.v }}</dd>
          </div>
        </dl>

        <div class="ol-live-lbl">Рекомендуемая глубина подземной части</div>
        <div class="ol-live-npodz" title="ƒ Нподз = ROUNDUP((лоток/1000 + hР)·1000, до 100 вверх)">
          {{ s.depthMm.value != null ? fmtInt(s.depthMm.value) : '—' }} <span class="ol-live-u">мм</span>
        </div>
        <div v-if="s.depthOverridden.value" class="ol-live-ovr">ручной ввод</div>

        <div class="ol-live-act">
          <button class="ol-btn ol-btn--acc" :disabled="s.depth.value.npodzMm == null" @click="acceptDepth">
            {{ accepted ? 'Принято ✓' : 'Принять' }}
          </button>
          <label class="fld"><span>своя, мм</span><input v-model="form.npodzManual" class="num" placeholder="—" /></label>
        </div>

        <div class="ol-live-h">Изделие</div>
        <div class="ol-live-prev">
          <div class="ol-prev-t">{{ s.title.value }}</div>
          <div class="ol-prev-s">
            подз. {{ s.depthMm.value != null ? fmtInt(s.depthMm.value) : '—' }} мм ·
            {{ form.rashod }} {{ unitLabel }}
          </div>
          <div class="ol-prev-s">
            {{ form.nRab }}+{{ form.nRez }} насоса · {{ blocksOn }} из {{ blocks.length }} блоков включено
          </div>
        </div>

        <p class="ol-live-hint">
          Значения пересчитываются при каждом вводе. Наведите на подпись — увидите формулу.
        </p>

        <div class="ol-live-foot">
          <div v-if="!s.canCreate.value" class="ol-hint">
            Заполните: {{ s.missingRequired.value.join(', ') }}
          </div>
          <button class="ol-create" :disabled="!s.canCreate.value" @click="previewOpen = true">
            {{ isEdit ? 'Сохранить ОЛ →' : 'Создать расчёт →' }}
          </button>
        </div>
      </aside>
    </div>

    <!-- ── Модал-превью перед материализацией ── -->
    <BaseModal :show="previewOpen" :title="s.title.value" :close-on-backdrop="true" @close="previewOpen = false">
      <template #default>
        <p class="mo-sub">
          {{ s.pipeGrade.value }} · подз. {{ s.depthMm.value != null ? fmtInt(s.depthMm.value) : '—' }} мм ·
          приток {{ form.rashod }} {{ unitLabel }} · {{ form.nRab }}+{{ form.nRez }} насоса
        </p>
        <ul class="mo-list">
          <li v-for="b in blocks" :key="b.t">
            <span :class="b.on ? 'mo-on' : 'mo-off'">{{ b.on ? '☑' : '☐' }}</span> {{ b.t }}
          </li>
        </ul>
      </template>
      <template #footer>
        <button class="ol-btn" @click="previewOpen = false">Отмена</button>
        <button class="ol-create" :disabled="creating" @click="createEstimate">
          {{ creating ? 'Сохраняем…' : isEdit ? 'Сохранить ОЛ → конфигуратор' : 'Создать расчёт → конфигуратор' }}
        </button>
      </template>
    </BaseModal>

    <ToastHost />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import BaseModal from '@/components/ui/BaseModal.vue'
import ToggleYesNo from '@/components/survey/ToggleYesNo.vue'
import DeviceTypeSection from '@/components/survey/DeviceTypeSection.vue'
import type { DeviceType } from '@/api/estimates'
import CalcField from '@/components/survey/CalcField.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { useKnsSurvey } from '@/composables/useKnsSurvey'
import { usePumpSelection } from '@/composables/usePumpSelection'
import { useTheme } from '@/composables/useTheme'
import { toast } from '@/composables/useToast'
import { makeDefaultKnsSurvey, pickCommon, type KnsSurveyForm } from '@/types/survey'
import { tryEvalExpr } from '@/engines/expr'
import { COUPLING_SIZES } from '@/engines/pressure-pipe-kit'
import { estimatesApi } from '@/api/estimates'
import { projectsApi } from '@/api/projects'
import { KNS_SECTIONS } from '@/engines/template-kns'

/**
 * Ветка КНС единого опросного листа (SurveyView).
 *
 * Три режима — по props:
 *  - создание вне проекта (без props),
 *  - создание в проекте (`projectId`),
 *  - редактирование ОЛ существующего расчёта (`estimateId` + `initial`):
 *    сохранение поднимает `surveyRev`, и конфигуратор рематериализует дерево
 *    с пометкой конфликтов (Механика §8.3).
 */
const props = defineProps<{
  estimateId?: string | null
  projectId?: string | null
  initial?: Partial<KnsSurveyForm> | null
  surveyRev?: number
  /** Тип изделия и его переключение — секция 2 листа (владелец — SurveyView). */
  deviceType: DeviceType
  deviceTypes: ReadonlyArray<{ value: DeviceType; label: string }>
  canChangeType: boolean
  projectTitle?: string | null
}>()

defineEmits<{ 'update:deviceType': [DeviceType] }>()

const router = useRouter()
const { theme, toggle } = useTheme()

const form = ref<KnsSurveyForm>({ ...makeDefaultKnsSurvey(), ...props.initial })
const s = useKnsSurvey(form)
/** Подбор насоса и диаметра напорного — считает сервер (`/api/pump-station`). */
const p = usePumpSelection(form)

/** Есть ли из чего выбирать: пока подбор не пришёл, показываем обычное поле. */
const hasPumpChoices = computed(
  () => p.choices.value.fitting.length > 0 || p.choices.value.belowMargin.length > 0,
)

/** Инженер выбрал «ввести вручную» — открываем текстовое поле. */
const manualPump = ref(false)

/**
 * Что показывать выбранным в списке: пустая марка — «автоматически», совпадение
 * с одной из моделей — её саму, произвольный текст — режим ручного ввода.
 */
const pumpChoice = computed(() => {
  const marka = form.value.marka.trim()
  if (marka === '') return manualPump.value ? '__manual' : ''
  const known = [...p.choices.value.fitting, ...p.choices.value.belowMargin]
  return known.some((c) => c.name === marka) ? marka : '__manual'
})

function onPumpChoice(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  if (v === '__manual') {
    manualPump.value = true
    return
  }
  manualPump.value = false
  // Пустое значение — вернуться к подобранной автоматически.
  if (v === '') p.resetToCalculated()
  else p.choose(v)
}

const isEdit = computed(() => Boolean(props.estimateId))

// «← Проект» — если ОЛ открыт в контексте проекта, иначе к списку проектов.
const backTarget = computed(() =>
  props.projectId ? { name: 'project', params: { id: props.projectId } } : { name: 'dashboard' },
)
const backLabel = computed(() => (props.projectId ? '← Проект' : '← Проекты'))

const SECTIONS = [
  { n: 1, title: 'Общие' },
  { n: 2, title: 'Тип изделия' },
  { n: 3, title: 'Насосное' },
  { n: 4, title: 'Патрубки' },
  { n: 5, title: 'Автоматика' },
]

const NS_TYPES = ['Канализационная', 'Ливневая', 'Дренажная', 'Водопроводная'] as const
const STAGES = ['проект', 'рабочая', 'КД', 'продажа', 'тендер'] as const
const MATERIALS = ['ПЭ', 'ПВХ', 'ПНД', 'ПП', 'Асбестцемент', 'Корсис', 'стеклокомпозит'] as const
const GRINDERS = ['корзина', 'дробилка', 'обе', 'нет'] as const
const PN_LIST = ['0,1', '0,6', '1', '1,6'] as const
const SN_LIST = ['1250', '2500', '5000', '10000'] as const

/** Типовая глубина теплоизоляции, мм — меняется вручную по флажку. */
const TI_DEPTH_DEFAULT_MM = 2000

/** Типовое возвышение корпуса над землёй, мм — там же, за флажком. */
const ELEVATION_DEFAULT_MM = 300
/**
 * Домен DN — ровно как в справочнике весов (30 значений, 162 строки GRP):
 * 300…500 с шагом 50, дальше 600…3000 с шагом 100. Промежуточных значений
 * (550 и т.п.) в справочнике НЕТ — выбор такого DN дал бы промах поиска веса.
 */
const DN_LIST = [300, 350, 400, 450, 500]
  .concat(Array.from({ length: 25 }, (_, i) => 600 + i * 100))
  .map(String)

const activeSec = ref(1)
const formEl = ref<HTMLElement | null>(null)
const previewOpen = ref(false)
const creating = ref(false)
const accepted = ref(false)
const draftTime = ref(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))

const fmt = (n: number | null, d = 2) =>
  n == null ? '—' : n.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtInt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })

const unitLabel = computed(
  () => ({ 'l/s': 'л/с', 'm3/h': 'м³/ч', 'm3/day': 'м³/сут' })[form.value.rashodUnit],
)

/** Цепочка подбора глубины — с формулой в тултипе у каждой величины. */
const liveValues = computed(() => {
  const d = s.depth.value
  return [
    { k: 'Q', v: `${fmt(d.qLps)} л/с`, f: 'ƒ приток, приведённый к л/с' },
    { k: 'Vэф', v: `${fmt(d.vEf)} м³`, f: 'ƒ Vэф = Q·3,6 / (4 · 10 пусков/ч · n раб)' },
    { k: 'Vмин', v: `${fmt(d.vMin)} м³`, f: 'ƒ Vмин = (Q·3,6 / n) · 5/60' },
    { k: 'hраб', v: `${fmt(d.hRab, 3)} м`, f: 'ƒ hраб = 4·Vмин / (π·(DN/1000)²)' },
    { k: 'hР', v: `${fmt(d.hR, 3)} м`, f: 'ƒ hР = hраб + 0,3 + h рамы 0,16 + h мин. уровня 0,627' },
  ]
})

/** Блоки шаблона, включаемые флагами ОЛ (§9.1). */
const blocks = computed(() => [
  { t: 'Корпус (обечайка, днище, патрубки)', on: true },
  { t: 'Труба частями: сегменты и ламинирование стыков', on: form.value.ispolnenie === 'частями' },
  { t: 'Теплоизоляция', on: form.value.insulation },
  { t: 'Лестница', on: true },
  { t: 'Перекрытие, площадка, несущие балки', on: true },
  { t: 'Вентиляционный стояк', on: true },
  { t: 'Напорный трубопровод', on: true },
  { t: 'Крепёж', on: true },
  { t: 'Оборудование и запорная арматура', on: true },
  { t: 'МВК-комплект', on: form.value.mvk },
  { t: 'Шкаф управления и КИПиА', on: form.value.shu },
])

const blocksOn = computed(() => blocks.value.filter((b) => b.on).length)

/** Расчёт, созданный в этой сессии или редактируемый — для ссылки «→ Конфигуратор расчёта». */
const lastEstimateId = ref<string | null>(props.estimateId ?? null)

/**
 * Секция заполнена: все её обязательные поля непусты.
 * ✓ / ● в степпере — по прототипу.
 */
function secDone(n: number): boolean {
  const f = form.value
  const has = (v: string) => v.trim() !== ''
  switch (n) {
    case 1:
      return has(f.zayavka) && has(f.zakazchik) && has(f.obekt)
    case 2:
      // Тип выбран всегда; обязательным здесь остаётся DN корпуса.
      return has(f.dn)
    case 3:
      return has(f.rashod) && has(f.napor) && (tryEvalExpr(f.nRab) ?? 0) >= 1
    case 4:
      return has(f.podvLotok)
    case 5:
      return true // в автоматике обязательных полей нет
    default:
      return true
  }
}

function goSection(n: number) {
  activeSec.value = n
  document.getElementById(`sec-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Scrollspy: подсвечиваем секцию, ближайшую к верху области прокрутки. */
function onScroll() {
  const el = formEl.value
  if (!el) return
  const top = el.getBoundingClientRect().top
  let best = 1
  for (const sec of SECTIONS) {
    const node = document.getElementById(`sec-${sec.n}`)
    if (node && node.getBoundingClientRect().top - top <= 24) best = sec.n
  }
  activeSec.value = best
}

function resetPipe() {
  form.value.pipeManual = false
  form.value.pnManual = ''
  form.value.snManual = ''
  form.value.tiGlubina = String(TI_DEPTH_DEFAULT_MM)
  form.value.vozv = String(ELEVATION_DEFAULT_MM)
}

function acceptDepth() {
  const v = s.depth.value.npodzMm
  if (v == null) return
  form.value.npodzManual = String(v)
  accepted.value = true
  toast(`Нподз = ${fmtInt(v)} мм принята`)
}

/**
 * Единый контракт surveyData (все три изделия пишут одинаково):
 * `common` — общий блок для страниц, не знающих тип изделия;
 * `kns|emk|kol` — параметры материализации; `form` — полная форма для
 * повторного открытия ОЛ; `surveyRev` — маркер «ОЛ изменился» для
 * рематериализации в конфигураторе.
 */
function surveyPayload() {
  return {
    common: pickCommon(form.value),
    kns: { ...form.value },
    form: { ...form.value },
    derived: {
      npodzMm: s.depthMm.value,
      sn: s.sn.value,
      pn: s.pn.value,
      pipeGrade: s.pipeGrade.value,
      fullHeightMm: s.fullHeightMm.value,
      gates: s.gates.value,
      balls: s.balls.value,
      // Марка насоса: подобранная сервером либо введённая вручную. Идёт в
      // наименование строки насоса, а оттуда — в спецификацию КП.
      pumpModel: p.pumpModel.value,
      /** Диаметр напорного по гидравлике — справочно, DN берётся из поля ОЛ. */
      dischargePipeDiameterMm: p.pipe.value?.diameterMm ?? null,
    },
    surveyRev: (props.surveyRev ?? 0) + 1,
  }
}

async function createEstimate() {
  creating.value = true
  try {
    let id: string
    if (props.estimateId) {
      // Редактирование ОЛ существующего расчёта — НЕ создаём дубль.
      await estimatesApi.patchSurvey(props.estimateId, surveyPayload())
      id = props.estimateId
      toast('Опросный лист сохранён — расчёт будет пересчитан')
    } else {
      const dto = {
        title: s.title.value,
        deviceType: 'KNS' as const,
        surveyData: {
          ...surveyPayload(),
          sections: KNS_SECTIONS.map((x) => ({ code: x.code, title: x.title, enabled: true, components: [] })),
        },
      }
      // Внутри проекта расчёт создаётся привязанным к нему (projectId),
      // иначе он невидим в UI: Dashboard показывает только проекты.
      const est = props.projectId
        ? await projectsApi.addEstimate(props.projectId, dto)
        : await estimatesApi.create(dto)
      id = est.id
      toast('Расчёт создан')
    }
    lastEstimateId.value = id
    await router.push({ name: 'calculator', params: { id } })
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Не удалось сохранить', 'error')
    creating.value = false
  }
}
</script>

<style scoped>
.ol { display: flex; flex-direction: column; height: 100vh; background: var(--bg); color: var(--text); }

/* Топбар */
.ol-top { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 14px; border-bottom: 2px solid var(--line); background: var(--panel); flex: none; }
.ol-top-l { display: flex; align-items: baseline; gap: 10px; }
.ol-name { font-size: 18px; font-weight: 700; }
.ol-zayavka { font-size: 13.8px; color: var(--muted); }
.ol-top-r { display: flex; align-items: center; gap: 10px; }
.ol-draft { font-size: 13.2px; color: var(--faint); }

.ol-body { flex: 1; display: flex; min-height: 0; }

/* Степпер */
.ol-steps { width: 190px; flex: none; border-right: 1px solid var(--line); background: var(--panel);
  padding: 8px 0; overflow-y: auto; }
.ol-step { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  padding: 7px 12px; background: transparent; border: none; border-left: 3px solid transparent;
  color: var(--muted); font-size: 14.4px; }
.ol-step:hover { color: var(--text); background: var(--panel2); }
.ol-step.is-active { border-left-color: var(--acc); background: var(--panel2); color: var(--text); }
.ol-step-m { font-size: 12px; min-width: 10px; }
.ol-step-m.ok { color: var(--green); }
.ol-step-m.todo { color: var(--acc); }
.ol-steps-hint { padding: 10px 12px; font-size: 11.4px; color: var(--faint); line-height: 1.5; }
.ol-step-t { flex: 1; }

/* Форма */
.ol-form { flex: 1; overflow-y: auto; padding: 16px 20px; min-width: 0; }
.ol-sec { max-width: 820px; margin: 0 auto 26px; }
.ol-h { font-size: 18px; font-weight: 700; margin-bottom: 10px; padding-bottom: 6px;
  border-bottom: 2px solid var(--line); }
.ol-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
/* Фиксированное число колонок там, где строка несёт смысл: поля не должны
   перетекать между строками при изменении ширины окна. На узком экране
   переносятся, иначе поле сжимается до нечитаемого. */
.ol-grid--2 { grid-template-columns: repeat(2, minmax(200px, 1fr)); }
.ol-grid--3 { grid-template-columns: repeat(3, minmax(160px, 1fr)); }
@media (max-width: 900px) {
  .ol-grid--2, .ol-grid--3 { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
}
.ol-tail { height: 40vh; }

.fld { display: flex; flex-direction: column; gap: 3px; }
.fld--wide { grid-column: span 2; }
.fld > span { font-size: 13.2px; color: var(--muted); }
.req { color: var(--acc); }
.fld input, .fld select {
  background: var(--cellbg); border: 1px solid var(--line2); color: var(--text);
  padding: 5px 9px; font-size: 15px; font-family: inherit;
}
.fld input.num { text-align: right; }
.fld input.is-missing { border-color: var(--acc); background: var(--acc-bg); }

/* Подсказка подбора под полем: марка насоса, расчётный диаметр напорного. */
.ol-pick { font-size: 12px; color: var(--faint); line-height: 1.45; display: block; }
.ol-pick--warn { color: var(--amber); }
.ol-pick-btn {
  font: inherit; font-size: 12px; margin-left: 6px; padding: 0;
  background: none; border: none; border-bottom: 1px dashed currentColor;
  color: var(--acc); cursor: pointer;
}
.ol-pick-btn:hover { border-bottom-style: solid; }

/* Карточка (труба корпуса, патрубки) */
.ol-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ol-card { border: 1px solid var(--line); background: var(--panel); padding: 10px; margin-top: 10px; }
.ol-card-h { font-size: 12px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); margin-bottom: 8px; }
.ol-grade { font-size: 16.8px; font-weight: 600; }
.ol-grade--empty { color: var(--faint); font-weight: 400; }
.ol-explain { font-size: 13.2px; color: var(--muted); margin-top: 3px; }
.ol-chk { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 13.8px; color: var(--muted); }
.ol-manual { display: flex; gap: 10px; align-items: flex-end; margin-top: 8px;
  padding: 8px; background: var(--blue-bg); border-left: 3px solid var(--blue); }
.ol-reset { background: transparent; border: none; color: var(--blue); font-size: 13.2px; text-decoration: underline; }

.ol-toggles { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; }

.ol-unit { display: flex; }
.ol-unit input { flex: 1; min-width: 0; }
.ol-unit-sel { border-left: none; }

/* Live-панель */
.ol-live { width: 300px; flex: none; border-left: 2px solid var(--line); background: var(--panel);
  padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.ol-live-h { font-size: 12px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); }
.ol-live-lbl { font-size: 12.6px; color: var(--muted); }
.ol-live-npodz { font-size: 26.4px; font-weight: 700; }
.ol-live-hint { font-size: 11.4px; color: var(--faint); line-height: 1.5; }
.f-mark { color: var(--faint); font-size: 10.8px; }
.ol-live-u { font-size: 15.6px; font-weight: 400; color: var(--muted); }
.ol-live-ovr { font-size: 12px; color: var(--blue); margin-top: -8px; }
.ol-live-vals { display: flex; flex-direction: column; gap: 3px; border-top: 1px solid var(--line); padding-top: 8px; }
.ol-live-row { display: flex; justify-content: space-between; font-size: 13.8px; }
.ol-live-row dt { color: var(--muted); }
.ol-f { color: var(--faint); font-size: 10.8px; }
.ol-live-act { display: flex; gap: 8px; align-items: flex-end; border-top: 1px solid var(--line); padding-top: 8px; }
.ol-live-prev { border: 1px solid var(--line); padding: 8px; background: var(--panel2); }
.ol-prev-t { font-size: 15px; font-weight: 600; }
.ol-prev-s { font-size: 13.2px; color: var(--muted); margin-top: 2px; }
.ol-live-foot { margin-top: auto; display: flex; flex-direction: column; gap: 6px; }
.ol-hint { font-size: 13.2px; color: var(--amber); }

.ol-btn { background: transparent; border: 1px solid var(--line2); color: var(--muted);
  padding: 5px 11px; font-size: 13.8px; }
.ol-btn:hover:not(:disabled) { color: var(--text); }
.ol-btn--acc { border-color: var(--acc); color: var(--acc); }
.ol-btn:disabled { opacity: .4; }
.ol-create { background: var(--acc); border: 1px solid var(--acc); color: #fff;
  padding: 8px 14px; font-size: 15px; font-weight: 600; }
.ol-create:disabled { opacity: .4; }

/* Модал */
.mo-h { font-size: 18px; font-weight: 700; }
.mo-sub { font-size: 13.8px; color: var(--muted); margin: 4px 0 10px; }
.mo-list { list-style: none; display: flex; flex-direction: column; gap: 3px; font-size: 14.4px; }
.mo-on { color: var(--green); }
.mo-off { color: var(--faint); }

@media (max-width: 1100px) {
  .ol-steps { display: none; }
  .ol-cards { grid-template-columns: 1fr; }
}
</style>
