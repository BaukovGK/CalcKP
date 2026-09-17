<template>
  <BaseModal :show="show" title="Выпуск КП" @close="emit('close')">
    <div v-if="loading" class="kpi-state">Собираем черновик…</div>
    <div v-else-if="error" class="kpi-state kpi-state--err">{{ error }}</div>

    <div v-else-if="draft" class="kpi">
      <p class="kpi-sub">
        Черновик собран из опросного листа и умолчаний. Что здесь останется, то и уйдёт заказчику:
        документ печатается из этой редакции и потом не пересобирается.
      </p>

      <section class="kpi-sec">
        <h3 class="kpi-h">Шапка</h3>
        <div class="ol-grid">
          <label class="fld fld--4">
            <span v-hint="H.number">Исх. №</span>
            <input v-model="number" />
          </label>
          <label class="fld fld--4">
            <span v-hint="H.customer">Заказчик</span>
            <input :value="draft.customer ?? '—'" disabled />
          </label>
          <label class="fld fld--4">
            <span v-hint="H.object">Объект</span>
            <input :value="draft.object ?? '—'" disabled />
          </label>
        </div>
      </section>

      <section class="kpi-sec">
        <h3 class="kpi-h">Изделие</h3>
        <div class="ol-grid">
          <label class="fld fld--3">
            <span v-hint="H.tag">Обозначение по проекту</span>
            <input v-model="tag" placeholder="НС1" />
          </label>
          <label class="fld fld--4">
            <span v-hint="H.mark">Марка изделия</span>
            <input v-model="mark" placeholder="СК-20-К 5000-2600" />
          </label>
          <label class="fld fld--5">
            <span v-hint="H.tu">ТУ</span>
            <input v-model="tu" />
          </label>
          <label class="fld fld--3">
            <span v-hint="H.unit">Ед. изм.</span>
            <input v-model="unit" />
          </label>
          <label class="fld fld--3">
            <span v-hint="H.qty">Кол-во</span>
            <input :value="draft.position.qty" disabled />
          </label>
          <label class="fld fld--3">
            <span v-hint="H.price">Цена, ₽</span>
            <input :value="fmtMoney(draft.position.priceRub)" disabled />
          </label>
          <label class="fld fld--3">
            <span v-hint="H.sum">Сумма, ₽</span>
            <input :value="fmtMoney(draft.position.totalRub)" disabled />
          </label>
        </div>
      </section>

      <section class="kpi-sec">
        <h3 class="kpi-h">
          Наименование номенклатуры
          <label class="kpi-tgl">
            <input v-model="manualDescription" type="checkbox" />
            <span v-hint="H.manual">править текстом</span>
          </label>
        </h3>
        <textarea v-if="manualDescription" v-model="description" class="kpi-text" rows="10"></textarea>
        <pre v-else class="kpi-prev">{{ preview }}</pre>
      </section>

      <section v-if="!manualDescription" class="kpi-sec">
        <h3 class="kpi-h">
          В комплекте
          <button class="btn btn-g kpi-add" @click="addItem">+ строка</button>
        </h3>
        <table class="kpi-tbl">
          <thead>
            <tr>
              <th v-hint="H.kitName">Наименование узла</th>
              <th class="kpi-num" v-hint="H.kitQty">Кол-во</th>
              <th class="kpi-unit" v-hint="H.kitUnit">Ед.</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in kit" :key="i">
              <td><input v-model="item.name" /></td>
              <td><input v-model.number="item.qty" class="kpi-num" type="number" min="0" step="1" /></td>
              <td><input v-model="item.unit" class="kpi-unit" /></td>
              <td><button class="btn btn-g" @click="kit.splice(i, 1)">✕</button></td>
            </tr>
            <tr v-if="!kit.length">
              <td colspan="4" class="kpi-empty">Состав пуст — заказчик увидит только описание изделия</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="kpi-sec">
        <h3 class="kpi-h">Условия</h3>
        <div class="ol-grid">
          <label class="fld fld--3">
            <span v-hint="H.vat">НДС, %</span>
            <input v-model.number="terms.vatRatePct" type="number" min="0" max="100" />
          </label>
          <label class="fld fld--3">
            <span v-hint="H.valid">Действительно до</span>
            <input v-model="validUntil" type="date" />
          </label>
          <label class="fld fld--3">
            <span v-hint="H.prepay">Предоплата, %</span>
            <input v-model.number="terms.prepaymentPct" type="number" min="0" max="100" />
          </label>
          <label class="fld fld--3">
            <span v-hint="H.payDays">Оплата, раб. дней</span>
            <input v-model.number="terms.paymentDays" type="number" min="0" />
          </label>
          <label class="fld fld--6">
            <span v-hint="H.delivery">Доставка на объект</span>
            <input v-model="deliveryTo" />
          </label>
          <label class="fld fld--6">
            <span v-hint="H.warehouse">Склад отгрузки</span>
            <input v-model="shipmentFrom" />
          </label>
          <label class="fld fld--3">
            <span v-hint="H.lead">Срок поставки, раб. дней</span>
            <input v-model="terms.leadTimeDays" />
          </label>
          <label class="fld fld--3">
            <span v-hint="H.euro">Порог курса евро, %</span>
            <input v-model.number="terms.euroThresholdPct" type="number" min="0" max="100" />
          </label>
          <label class="fld fld--6">
            <span v-hint="H.excluded">Не входит в стоимость — по пункту на строку</span>
            <textarea v-model="excluded" class="kpi-text" rows="3"></textarea>
          </label>
        </div>
      </section>

      <section class="kpi-sec">
        <h3 class="kpi-h">Подпись и исполнитель</h3>
        <div class="ol-grid">
          <label class="fld fld--6">
            <span v-hint="H.signerTitle">Должность подписанта</span>
            <input v-model="signature.signerTitle" />
          </label>
          <label class="fld fld--6">
            <span v-hint="H.signerName">Подписант</span>
            <input v-model="signerName" placeholder="И.О. Фамилия" />
          </label>
          <label class="fld fld--3">
            <span v-hint="H.executor">Исполнитель</span>
            <input v-model="executorName" />
          </label>
          <label class="fld fld--3">
            <span v-hint="H.executorPosition">Должность</span>
            <input v-model="executorPosition" />
          </label>
          <label class="fld fld--3">
            <span v-hint="H.phone">Телефон</span>
            <input v-model="executorPhone" placeholder="+7 (499) 000-00-00 доб. 000" />
          </label>
          <label class="fld fld--3">
            <span v-hint="H.email">Почта</span>
            <input v-model="executorEmail" />
          </label>
        </div>
      </section>
    </div>

    <template #footer>
      <button class="btn" @click="emit('close')">Отмена</button>
      <button class="btn btn-acc" :disabled="busy || loading || !draft" @click="submit">
        {{ busy ? 'Выпускаем…' : 'Выпустить КП' }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
/**
 * Окно выпуска КП: шапка, описание изделия, состав и условия.
 *
 * Черновик приходит с сервера (`GET /estimates/:id/kp/draft`): наименование и
 * состав собраны из опросного листа, условия и подпись — умолчаниями, номер —
 * следующий по сквозному счётчику. Менеджер правит что нужно, и правки уходят
 * в выпуск: документ печатается из снапшота, а не пересобирается заново.
 *
 * Само КП выпускает родитель — там же, где ловятся отказы гейта (строки без
 * цены, отрицательные суммы, ставки не из прайса): окно отдаёт только шапку.
 */
import { reactive, ref, watch } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import { estimatesApi, type KpDraft, type KpIssuePayload, type KpKitItem } from '@/api/estimates'
import '@/assets/survey-form.css'

const props = defineProps<{ show: boolean; estimateId: string; busy?: boolean }>()
const emit = defineEmits<{ close: []; submit: [payload: KpIssuePayload] }>()

/** Подсказки полей — сносками, как на опросном листе. */
const H = {
  number: 'Исходящий номер из журнала корреспонденции. Подставлен следующий по счётчику программы; вписали свой — счётчик не тратится',
  customer: 'Заказчик из карточки проекта: в документе печатается строкой «Заказчик:»',
  object: 'Объект и адрес из карточки проекта — одной строкой, как в образце',
  tag: 'Обозначение изделия по проекту («НЕ1», «НС2»): печатается первой строкой ячейки наименования',
  mark: 'Марка изделия завода. Правило её сборки заводом не задано, поэтому поле ручное; пусто — в наименовании её не будет',
  tu: 'ТУ изделия — идёт и в наименование, и в абзац соответствия',
  unit: 'Единица измерения изделия в таблице: обычно комплект',
  qty: 'Количество изделий в заказе (тираж расчёта). Меняется в расчёте, не здесь',
  price: 'Цена за одно изделие — итог расчёта, делённый на тираж',
  sum: 'Сумма по позиции: цена × количество. Это и есть общая сумма КП',
  manual: 'Описание собирается из опросного листа. Включите, чтобы вписать свой текст целиком — тогда состав ниже в документ не пойдёт',
  kitName: 'Узел так, как его прочтёт заказчик: корпус, шахта, лестница, гильза, насос, шкаф',
  kitQty: 'Количество узлов на весь заказ',
  kitUnit: 'шт. или компл.',
  vat: 'Ставка НДС для пункта условий и справочной строки. Налог уже в цене, сверху не начисляется',
  valid: 'До какой даты предложение действительно. По умолчанию — две недели от выпуска',
  prepay: 'Доля предоплаты; остаток печатается автоматически',
  payDays: 'Сколько рабочих дней даётся на каждый платёж',
  delivery: 'Адрес доставки для пункта 1. Пусто — про доставку в условиях не пишем',
  warehouse: 'Склад, с которого идёт самовывоз: про него пункт 1 говорит, что в цену он не входит',
  lead: 'Срок поставки, рабочих дней — можно диапазоном: 40-50',
  euro: 'Порог изменения курса евро по ЦБ, после которого стоимость уточняется',
  excluded: 'Что не входит в стоимость: каждая строка станет отдельным пунктом условий',
  signerTitle: 'Должность подписанта — печатается слева над подписью',
  signerName: 'Инициалы и фамилия подписанта. Пусто — останется место для подписи от руки',
  executor: 'Исполнитель — к кому заказчику обращаться. По умолчанию автор расчёта, фамилией с инициалами',
  executorPosition: 'Должность исполнителя из его учётной записи. Заполняется в админке — здесь можно поправить для одного КП',
  phone: 'Прямой телефон исполнителя, с добавочным',
  email: 'Рабочая почта исполнителя',
}

const loading = ref(false)
const error = ref<string | null>(null)
const draft = ref<KpDraft | null>(null)

const number = ref('')
const tag = ref('')
const mark = ref('')
const tu = ref('')
const unit = ref('')
const manualDescription = ref(false)
const description = ref('')
const kit = ref<KpKitItem[]>([])
const validUntil = ref('')
const deliveryTo = ref('')
const shipmentFrom = ref('')
const excluded = ref('')
const signerName = ref('')
const executorName = ref('')
const executorPosition = ref('')
const executorPhone = ref('')
const executorEmail = ref('')

const terms = reactive({
  vatRatePct: 22,
  prepaymentPct: 70,
  paymentDays: 3,
  leadTimeDays: '',
  euroThresholdPct: 5,
})
const signature = reactive({ signerTitle: '' })

const fmtMoney = (v: number) => v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Предпросмотр наименования: заголовок и абзац соответствия — из черновика,
 * список — из правленого состава.
 *
 * Сервер собирает то же самое заново, поэтому здесь достаточно склейки:
 * править состав и не видеть результата было бы хуже, чем небольшой повтор.
 */
const preview = ref('')
watch(
  [() => draft.value?.position.description, kit],
  () => {
    const full = draft.value?.position.description ?? ''
    const head = full.split('\nВ комплекте:')[0] ?? full
    const lines = kit.value.map((i) => `- ${i.name} - ${i.qty} ${i.unit};`)
    preview.value = lines.length ? `${head}\nВ комплекте:\n${lines.join('\n')}` : head
  },
  { deep: true, immediate: true },
)

/** ISO-момент → значение поля даты и обратно. Полдень UTC не съезжает по поясам. */
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
const fromDateInput = (v: string) => (v ? new Date(`${v}T12:00:00.000Z`).toISOString() : null)

async function load() {
  loading.value = true
  error.value = null
  try {
    const d = await estimatesApi.kpDraft(props.estimateId)
    draft.value = d
    number.value = d.number
    tag.value = d.position.tag ?? ''
    mark.value = d.position.mark ?? ''
    tu.value = d.position.tu ?? ''
    unit.value = d.position.unit
    description.value = d.position.description
    manualDescription.value = false
    kit.value = d.position.kit.map((i) => ({ ...i }))
    terms.vatRatePct = d.terms.vatRatePct
    terms.prepaymentPct = d.terms.prepaymentPct
    terms.paymentDays = d.terms.paymentDays
    terms.leadTimeDays = d.terms.leadTimeDays
    terms.euroThresholdPct = d.terms.euroThresholdPct
    validUntil.value = toDateInput(d.terms.validUntil)
    deliveryTo.value = d.terms.deliveryTo ?? ''
    shipmentFrom.value = d.terms.shipmentFrom ?? ''
    excluded.value = d.terms.excluded.join('\n')
    signature.signerTitle = d.signature.signerTitle
    signerName.value = d.signature.signerName ?? ''
    executorName.value = d.signature.executorName ?? ''
    executorPosition.value = d.signature.executorPosition ?? ''
    executorPhone.value = d.signature.executorPhone ?? ''
    executorEmail.value = d.signature.executorEmail ?? ''
  } catch (e) {
    const r = (e as { response?: { data?: { message?: string } } }).response
    error.value = r?.data?.message ?? 'Не удалось собрать черновик КП'
  } finally {
    loading.value = false
  }
}

function addItem() {
  kit.value.push({ name: '', qty: 1, unit: 'шт.' })
}

const clean = (v: string) => (v.trim() === '' ? null : v.trim())

function submit() {
  emit('submit', {
    number: number.value.trim(),
    position: {
      tag: clean(tag.value),
      mark: clean(mark.value),
      tu: clean(tu.value),
      unit: clean(unit.value),
      // Текст уходит, только если менеджер взял его на себя: иначе сервер
      // соберёт описание сам — уже с правленым составом.
      ...(manualDescription.value ? { description: description.value } : {}),
      ...(manualDescription.value
        ? {}
        : { kit: kit.value.filter((i) => i.name.trim() !== '' && i.qty > 0) }),
    },
    terms: {
      vatRatePct: terms.vatRatePct,
      prepaymentPct: terms.prepaymentPct,
      paymentDays: terms.paymentDays,
      leadTimeDays: terms.leadTimeDays,
      euroThresholdPct: terms.euroThresholdPct,
      validUntil: fromDateInput(validUntil.value),
      deliveryTo: clean(deliveryTo.value),
      shipmentFrom: clean(shipmentFrom.value),
      excluded: excluded.value.split('\n').map((s) => s.trim()).filter(Boolean),
    },
    signature: {
      signerTitle: signature.signerTitle,
      signerName: clean(signerName.value),
      executorName: clean(executorName.value),
      executorPosition: clean(executorPosition.value),
      executorPhone: clean(executorPhone.value),
      executorEmail: clean(executorEmail.value),
    },
  })
}

// Черновик загружается на каждое открытие: расчёт между открытиями меняется,
// и показывать прошлый состав с прошлой ценой нельзя.
watch(
  () => props.show,
  (open) => { if (open) void load() },
  { immediate: true },
)

</script>

<style scoped>
.kpi { display: flex; flex-direction: column; gap: 16px; max-width: 860px; }
.kpi-sub { font-size: 12.6px; color: var(--tx2); }
.kpi-state { padding: 20px 0; font-size: 13.2px; color: var(--tx2); }
.kpi-state--err { color: var(--acc); }
.kpi-sec :deep(.ol-grid) { margin-top: 2px; }
.kpi-h { display: flex; align-items: center; gap: 10px; font-size: 13.8px; font-weight: 700;
  margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--line); }
.kpi-tgl { display: flex; align-items: center; gap: 5px; margin-left: auto;
  font-size: 12px; font-weight: 400; color: var(--tx2); }
.kpi-add { margin-left: auto; font-size: 12px; }
.kpi-text { width: 100%; font: inherit; font-size: 12.6px; resize: vertical; }
.kpi-prev { margin: 0; padding: 8px 10px; background: var(--bg3); border: 1px solid var(--bd);
  font: inherit; font-size: 12.2px; white-space: pre-wrap; max-height: 240px; overflow: auto; }
.kpi-tbl { width: 100%; border-collapse: collapse; font-size: 12.6px; }
.kpi-tbl th { text-align: left; font-weight: 500; color: var(--tx2); padding: 2px 4px; }
.kpi-tbl td { padding: 2px 4px; }
.kpi-tbl input { width: 100%; }
.kpi-tbl input.kpi-num { width: 72px; text-align: right; }
.kpi-tbl input.kpi-unit { width: 68px; }
th.kpi-num, th.kpi-unit { width: 80px; }
.kpi-empty { color: var(--tx2); padding: 6px 4px; }
.btn-acc { border-color: var(--acc); color: var(--acc); }
</style>
