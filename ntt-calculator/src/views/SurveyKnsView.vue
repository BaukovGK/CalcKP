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
            <label class="fld fld--3"><span>№ заявки ОЛ</span><input v-model="form.zayavka" /></label>
            <label class="fld fld--3"><span>Тип НС</span>
              <select v-model="form.tipNs">
                <option v-for="t in NS_TYPES" :key="t">{{ t }}</option>
              </select>
            </label>
            <label class="fld fld--3"><span>Стадия проекта</span>
              <select v-model="form.stadiya"><option v-for="t in STAGES" :key="t">{{ t }}</option></select>
            </label>
            <label class="fld fld--3"><span>Дата</span><input v-model="form.data" /></label>
            <label class="fld fld--4"><span>Заказчик</span><input v-model="form.zakazchik" /></label>
            <label class="fld fld--5"><span>Объект</span><input v-model="form.obekt" /></label>
            <label class="fld fld--3"><span>Регион</span><input v-model="form.region" /></label>
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
        
          <!-- Диаметр и два признака корпуса — одной строкой: признаки влияют
               на жёсткость и марку трубы, то есть читаются вместе с DN. -->
          <div class="ol-grid ol-grid--mid">
            <label class="fld fld--3"><span>DN корпуса, мм</span>
              <select v-model="form.dn"><option v-for="d in DN_LIST" :key="d">{{ d }}</option></select>
            </label>
            <ToggleYesNo v-model="form.underRoadway" label="Под проезжей частью" stacked class="fld--3" />
            <ToggleYesNo v-model="form.mvk" label="По ТТ МВК" stacked class="fld--3" />
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
              <label class="fld fld--3"><span>PN, МПа</span>
                <select v-model="form.pnManual"><option value="">расчётное</option><option v-for="p in PN_LIST" :key="p">{{ p }}</option></select>
              </label>
              <label class="fld fld--3"><span>SN, Па</span>
                <select v-model="form.snManual"><option value="">расчётное</option><option v-for="v in SN_LIST" :key="v">{{ v }}</option></select>
              </label>
              <!-- Возвышение, исполнение и теплоизоляция живут здесь же: это
                   такие же типовые величины, что PN и SN, и трогают их так же
                   редко. Глубина показывается только при включённой
                   теплоизоляции — иначе она ни на что не влияет. -->
              <!-- Подписи короткие намеренно: в ячейку на три колонки длинная
                   переносится на вторую строку, и поле ввода опускается ниже
                   соседних — ряд снова разъезжается. -->
              <label class="fld fld--3"><span>Возвышение, мм</span>
                <input v-model="form.vozv" class="num" :placeholder="String(ELEVATION_DEFAULT_MM)" />
              </label>
              <label class="fld fld--3"><span>Исполнение обечайки</span>
                <select v-model="form.ispolnenie">
                  <option value="частями">Труба частями</option>
                  <option value="целая">Целая труба</option>
                </select>
              </label>
              <ToggleYesNo v-model="form.insulation" label="Теплоизоляция" stacked class="fld--3" />
              <label v-if="form.insulation" class="fld fld--3"><span>Глубина ТИ, мм</span>
                <input v-model="form.tiGlubina" class="num" :placeholder="String(TI_DEPTH_DEFAULT_MM)" />
              </label>
              <button class="ol-reset fld--12" @click="resetPipe">↺ вернуть расчётные</button>
            </div>
          </div>

          <!-- Что из свёрнутого меняет состав расчёта — видно и без раскрытия. -->
          <div v-if="form.ispolnenie === 'частями'" class="ol-explain">
            Труба частями: в расчёт добавятся сегменты (длины разносите вручную)
            и ламинирование стыков по Мс из справочника.
          </div>
          <div v-if="!form.insulation" class="ol-explain">Теплоизоляция выключена.</div>
        </section>

        <!-- 3. Насосное оборудование -->
        <section :id="'sec-3'" class="ol-sec">
          <h2 class="ol-h">3 · Насосное оборудование</h2>
          <!-- Две строки: сверху то, что задаёт рабочую точку (расход и напор),
               снизу — сколько насосов её обслуживают. -->
          <div class="ol-grid">
            <label class="fld fld--4"><span>Рабочий расход <b class="req">*</b></span>
              <div class="ol-unit">
                <input v-model="form.rashod" class="num" />
                <select v-model="form.rashodUnit" class="ol-unit-sel">
                  <option value="l/s">л/с</option>
                  <option value="m3/h">м³/ч</option>
                  <option value="m3/day">м³/сут</option>
                </select>
              </div>
            </label>
            <label class="fld fld--4"><span>Расчётный напор, м</span><input v-model="form.napor" class="num" /></label>
          </div>

          <div class="ol-grid">
            <label class="fld fld--4"><span>Рабочих насосов <b class="req">*</b></span><input v-model="form.nRab" class="num" /></label>
            <label class="fld fld--4"><span>Резервных насосов</span><input v-model="form.nRez" class="num" /></label>
            <!-- «На склад» — формулировка опросного листа завода: эти насосы
                 в станцию не ставятся и в обвязку не входят. -->
            <label class="fld fld--4"><span>Запасных на склад</span><input v-model="form.nZap" class="num" /></label>
          </div>

          <div class="ol-grid">
            <label class="fld fld--12"><span>Марка насосов</span>
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
                :placeholder="p.pumpModelCalc.value ?? 'подберётся по расходу и напору'"
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
          </div>

          <!-- Корзина и дробилка — независимые признаки: бывает и то, и другое
               сразу. Одним селектом это выражалось значением «обе», которое
               читалось хуже двух тумблеров. -->
          <div class="ol-grid ol-grid--mid">
            <ToggleYesNo v-model="hasBasket" label="Корзина" stacked class="fld--3" />
            <ToggleYesNo v-model="hasGrinder" label="Дробилка" stacked class="fld--3" />
            <ToggleYesNo v-model="form.vzryv" label="Взрывозащита" stacked class="fld--3" />
          </div>
          <div v-if="hasGrinder" class="ol-explain">
            Узел дробилки в расчёт пока не материализуется — строки добавьте
            вручную (doc/Вопросы_заводу.md: ждём модели и состав).
          </div>
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
                <label class="fld"><span>DN, мм</span><input v-model="form.napDn" class="num" /></label>
                <label class="fld"><span>Кол-во</span><input v-model="form.napKol" class="num" /></label>
                <label class="fld"><span>Глубина лотка, мм</span><input v-model="form.napLotok" class="num" /></label>
              </div>
              <!-- Подсказки гидравлики — подвалом карточки, а не под своими
                   полями: они длиннее поля в несколько строк и, стоя в сетке,
                   раздвигали её так, что вторая строка карточек разъезжалась.
                   DN автоматически не подставляется — он входит в наименования
                   строк расчёта, и молчаливая подмена увела бы ручные цены. -->
              <div v-if="p.pipeExplain.value || p.pipingExplain.value" class="ol-card-foot">
                <div v-if="p.pipeExplain.value">{{ p.pipeExplain.value }}</div>
                <div v-if="p.pipingExplain.value">{{ p.pipingExplain.value }}</div>
              </div>
            </div>
          </div>

          <!-- Оба признака и зависимая от одного из них муфта — одной строкой
               сетки: муфта появляется прямо рядом с тумблером, который её
               включает. Муфта приваривается к трубопроводу, наружу торчит
               только ответная часть; её размер от DN линии не зависит. -->
          <div class="ol-grid ol-grid--mid">
            <ToggleYesNo v-model="form.valveOnInlet" label="Арматура на подводящем" stacked class="fld--3" />
            <ToggleYesNo v-model="form.emergency" label="Аварийный трубопровод" stacked class="fld--3" />
            <label v-if="form.emergency" class="fld fld--3"><span>Быстросъёмная муфта</span>
              <select v-model="form.muftaGm">
                <option v-for="gm in COUPLING_SIZES" :key="gm" :value="String(gm)">ГМ{{ gm }}</option>
              </select>
            </label>
          </div>

          <!-- Арматура: вычисляется с override -->
          <!-- Арматура считается из числа патрубков и насосов, поэтому свёрнута
               так же, как труба корпуса: итог виден, поля ввода — под флажком. -->
          <div class="ol-card">
            <div class="ol-card-h">
              Арматура
              <span class="f-mark" title="Считается из числа патрубков, насосов и отводящих">ƒ</span>
            </div>
            <div class="ol-grade">{{ armatureSummary }}</div>
            <div class="ol-explain">{{ s.gatesExplain.value }} · {{ s.pressureGatesExplain.value }}</div>

            <label class="ol-chk">
              <input v-model="form.armaturaManual" type="checkbox" />
              <span>изменить вручную</span>
            </label>

            <div v-if="form.armaturaManual" class="ol-manual">
              <CalcField
                v-model="form.zadvManual"
                label="Задвижки — подводящие"
                :calc="s.gatesCalc.value"
                :value="s.gates.value"
                :overridden="s.gatesOverridden.value"
                :explain="s.gatesExplain.value"
              />
              <CalcField
                v-model="form.kranManual"
                label="Задвижки — напорная сторона"
                :calc="s.pressureGatesCalc.value"
                :value="s.pressureGates.value"
                :overridden="s.pressureGatesOverridden.value"
                :explain="s.pressureGatesExplain.value"
              />
              <CalcField
                v-model="form.klapanManual"
                label="Обратные клапаны"
                :calc="s.checkValvesCalc.value"
                :value="s.checkValves.value"
                :overridden="s.checkValvesOverridden.value"
                :explain="s.checkValvesExplain.value"
              />
              <button class="ol-reset fld--12" @click="resetArmature">↺ вернуть расчётные</button>
            </div>
          </div>
        
        </section>

        <!-- 5. Автоматика -->
        <section :id="'sec-5'" class="ol-sec">
          <h2 class="ol-h">5 · Автоматика</h2>
          <!-- Четыре признака — по три колонки: одной строкой и по одним и тем
               же вертикалям, а не свободным потоком, где «Расходомер» отрывался
               на вторую строку. Поля ШУ идут под своим тумблером. -->
          <div class="ol-grid">
            <ToggleYesNo v-model="form.shu" label="Шкаф управления" stacked class="fld--3" />
            <ToggleYesNo v-model="form.datchikiDavl" label="Датчики давления" stacked class="fld--3" />
            <ToggleYesNo v-model="form.datchikiUrov" label="Датчики уровня" stacked class="fld--3" />
            <ToggleYesNo v-model="form.rashodomer" label="Расходомер" stacked class="fld--3" />
          </div>
          <div v-if="form.shu" class="ol-grid">
            <label class="fld fld--3"><span>Тип ШУ</span>
              <select v-model="form.shuTip"><option>внутренний</option><option>уличный</option></select>
            </label>
            <label class="fld fld--3"><span>Пуск</span>
              <select v-model="form.shuPusk"><option>стандартный</option><option>плавный</option><option>ЧП</option></select>
            </label>
          </div>
          <!-- Расходомер меняет не только автоматику: под него в напорном узле
               появляются фланцы, поэтому признак виден и здесь, и в патрубках. -->
          <div v-if="form.rashodomer" class="ol-explain">
            Расходомер: в напорном узле добавятся по два фланца на каждый отводящий патрубок.
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
          расход {{ form.rashod }} {{ unitLabel }} · {{ form.nRab }}+{{ form.nRez }} насоса
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
import '@/assets/survey-form.css'
import ToastHost from '@/components/ui/ToastHost.vue'
import { useKnsSurvey } from '@/composables/useKnsSurvey'
import { usePumpSelection } from '@/composables/usePumpSelection'
import { useTheme } from '@/composables/useTheme'
import { toast } from '@/composables/useToast'
import {
  grinderValue,
  hasBasketIn,
  hasGrinderIn,
  makeDefaultKnsSurvey,
  pickCommon,
  type KnsSurveyForm,
  type PipeExecution,
} from '@/types/survey'
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
const PN_LIST = ['0,1', '0,6', '1', '1,6'] as const
const SN_LIST = ['1250', '2500', '5000', '10000'] as const

/** Типовая глубина теплоизоляции, мм — меняется вручную по флажку. */
const TI_DEPTH_DEFAULT_MM = 2000

/** Типовое возвышение корпуса над землёй, мм — там же, за флажком. */
const ELEVATION_DEFAULT_MM = 300

/** Типовое исполнение обечайки: цельную трубу нужной длины берут не всегда. */
const PIPE_EXECUTION_DEFAULT: PipeExecution = 'частями'
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
    { k: 'Q', v: `${fmt(d.qLps)} л/с`, f: 'ƒ рабочий расход, приведённый к л/с' },
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

// Корзина и дробилка — два тумблера над одним полем модели (см. grinderValue).
const hasBasket = computed({
  get: () => hasBasketIn(form.value.drobilka),
  set: (v: boolean) => { form.value.drobilka = grinderValue(v, hasGrinder.value) },
})

const hasGrinder = computed({
  get: () => hasGrinderIn(form.value.drobilka),
  set: (v: boolean) => { form.value.drobilka = grinderValue(hasBasket.value, v) },
})

/** Свёрнутая строка арматуры: что именно поедет в расчёт. */
const armatureSummary = computed(() => {
  const gates = s.gates.value + s.pressureGates.value
  return `задвижек ${gates} · обратных клапанов ${s.checkValves.value}`
})

function resetArmature() {
  form.value.armaturaManual = false
  form.value.zadvManual = ''
  form.value.kranManual = ''
  form.value.klapanManual = ''
}

function resetPipe() {
  form.value.pipeManual = false
  form.value.pnManual = ''
  form.value.snManual = ''
  form.value.tiGlubina = String(TI_DEPTH_DEFAULT_MM)
  form.value.vozv = String(ELEVATION_DEFAULT_MM)
  form.value.ispolnenie = PIPE_EXECUTION_DEFAULT
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
      // Ключ `balls` в сохранённых листах остался от шаровых кранов; по схеме
      // завода на напорной стороне задвижки, их и пишем.
      balls: s.pressureGates.value,
      checkValves: s.checkValves.value,
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
.ol-tail { height: 40vh; }

/* Подсказка подбора под полем: марка насоса, расчётный диаметр напорного. */
.ol-pick { font-size: 12px; color: var(--faint); line-height: 1.45; display: block; }
.ol-pick--warn { color: var(--amber); }
.ol-pick-btn {
  font: inherit; font-size: 12px; margin-left: 6px; padding: 0;
  background: none; border: none; border-bottom: 1px dashed currentColor;
  color: var(--acc); cursor: pointer;
}
.ol-pick-btn:hover { border-bottom-style: solid; }


/* Live-панель */
.ol-live { width: 300px; flex: none; border-left: 2px solid var(--line); background: var(--panel);
  padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.ol-live-h { font-size: 12px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); }
.ol-live-lbl { font-size: 12.6px; color: var(--muted); }
.ol-live-npodz { font-size: 26.4px; font-weight: 700; }
.ol-live-hint { font-size: 11.4px; color: var(--faint); line-height: 1.5; }
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
