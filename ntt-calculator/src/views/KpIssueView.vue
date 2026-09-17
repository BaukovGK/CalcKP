<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <button class="back-link" @click="toCalculator">← Расчёт</button>
        <div class="logo">Выпуск КП</div>
      </div>

      <div class="sidebar-scroll">
        <div class="nav-section">Документ</div>
        <button
          v-for="t in TABS"
          :key="t.id"
          class="nav-link"
          :class="{ 'nav-link--active': tab === t.id }"
          @click="tab = t.id"
        >
          {{ t.label }}
          <span v-if="t.id === 'kit' && !manualDescription" class="nav-cnt kpv-cnt">{{ kit.length }}</span>
        </button>
      </div>

      <div class="sidebar-footer">
        <div v-if="draft" class="kpv-sum">
          <div class="kpv-sum-l">Сумма КП</div>
          <div class="kpv-sum-v">{{ fmtMoney(draft.position.totalRub) }} ₽</div>
          <div class="kpv-sum-n">{{ number || 'без номера' }}</div>
        </div>
        <ThemeToggle />
      </div>
    </aside>

    <div class="main-col">
      <header class="topbar">
        <div class="tb-l">
          <span class="tb-title">{{ draft?.customer ?? 'Коммерческое предложение' }}</span>
          <span v-if="draft?.object" class="tb-sub">{{ draft.object }}</span>
        </div>
        <div class="tb-r">
          <button class="btn" :disabled="busy" @click="toCalculator">Отмена</button>
          <button class="btn btn-acc" :disabled="busy || loading || !draft" @click="issue">
            {{ busy ? 'Выпускаем…' : 'Выпустить КП' }}
          </button>
        </div>
      </header>

      <div v-if="loading" class="kpv-state">Собираем черновик…</div>
      <div v-else-if="error" class="kpv-state kpv-state--err">{{ error }}</div>

      <div v-else-if="draft" class="calc-area kpv-body">
        <!-- Отказ гейта — на месте, а не всплывающим уведомлением: инженеру
             нужно прочитать список строк и уйти чинить их в расчёт. -->
        <div v-if="block" class="kpv-block">
          <div class="kpv-block-h">КП не выпущено</div>
          <p class="kpv-block-msg">{{ block.message }}</p>
          <ul v-if="block.rows.length" class="kpv-block-list">
            <li v-for="(r, i) in block.rows" :key="i">
              {{ r.name }}<span v-if="r.unit" class="kpv-block-u">, {{ r.unit }}</span>
            </li>
          </ul>
          <p v-if="block.more > 0" class="kpv-block-more">…и ещё {{ block.more }}</p>
          <div class="kpv-block-act">
            <button class="btn" @click="block = null">Закрыть</button>
            <button v-if="block.showRows" class="btn btn-acc" @click="toBlockedRows">
              Показать строки в расчёте
            </button>
          </div>
        </div>

        <!-- ── Изделие ── -->
        <section v-if="tab === 'product'" class="kpv-pane">
          <p class="kpv-sub">
            Черновик собран из опросного листа и умолчаний. Что здесь останется, то и уйдёт
            заказчику: документ печатается из этой редакции и потом не пересобирается.
          </p>

          <h3 class="sec-h kpv-h">Шапка</h3>
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

          <h3 class="sec-h kpv-h">Изделие</h3>
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

          <h3 class="sec-h kpv-h">
            Наименование номенклатуры
            <label class="kpv-tgl">
              <input v-model="manualDescription" type="checkbox" />
              <span v-hint="H.manual">править текстом</span>
            </label>
          </h3>
          <textarea v-if="manualDescription" v-model="description" class="kpv-text" rows="16"></textarea>
          <pre v-else class="kpv-prev">{{ preview }}</pre>
        </section>

        <!-- ── Комплектация ── -->
        <section v-else-if="tab === 'kit'" class="kpv-pane">
          <h3 class="sec-h kpv-h">
            В комплекте
            <span v-if="kit.length" class="kpv-h-cnt">{{ kit.length }}</span>
          </h3>

          <p v-if="manualDescription" class="kpv-note">
            Наименование правится текстом — состав в документ не пойдёт. Снимите
            «править текстом» на вкладке «Изделие», чтобы вернуть список.
          </p>

          <template v-else>
            <!-- Заголовок изделия — контекст списка, правится на вкладке «Изделие». -->
            <p class="kpv-head-prev">{{ headline }}</p>

            <!-- Позиция — блок: наименование во всю ширину и многострочно (у
                 КНС оно в сотню знаков), количество и единица — рядом. -->
            <ol class="kit-list">
              <li v-for="(item, i) in kit" :key="i" class="kit-row">
                <span class="kit-n">{{ i + 1 }}</span>
                <textarea
                  :ref="(el) => grow(el as HTMLTextAreaElement | null)"
                  v-model="item.name"
                  v-hint="H.kitName"
                  class="kit-name"
                  rows="1"
                  spellcheck="false"
                  @input="grow($event.target as HTMLTextAreaElement)"
                ></textarea>
                <input v-model.number="item.qty" v-hint="H.kitQty" class="kit-qty" type="number" min="0" step="1" />
                <input v-model="item.unit" v-hint="H.kitUnit" class="kit-unit" />
                <button class="btn btn-g kit-drop" v-hint="H.kitDrop" aria-label="Убрать строку" @click="kit.splice(i, 1)">✕</button>
              </li>
            </ol>
            <p v-if="!kit.length" class="kpv-note">Состав пуст — заказчик увидит только описание изделия.</p>
            <button class="btn kit-add" @click="addItem">+ строка</button>
          </template>
        </section>

        <!-- ── Условия ── -->
        <section v-else-if="tab === 'terms'" class="kpv-pane">
          <h3 class="sec-h kpv-h">Условия</h3>
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
            <label class="fld fld--12">
              <span v-hint="H.excluded">Не входит в стоимость — по пункту на строку</span>
              <textarea v-model="excluded" class="kpv-text" rows="4"></textarea>
            </label>
          </div>
        </section>

        <!-- ── Подпись ── -->
        <section v-else class="kpv-pane">
          <h3 class="sec-h kpv-h">Подпись и исполнитель</h3>
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
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Экран выпуска КП: шапка, описание изделия, состав, условия и подпись.
 *
 * Был окном поверх расчёта — стал экраном (17.09.2026). В окне состав изделия
 * прокручивался в полосе высотой в треть экрана, наименования узлов обрезались
 * на середине, а условия уходили под сгиб: у КНС в составе два десятка строк,
 * и править их вслепую нельзя. Здесь разделы разведены по боковому меню, и
 * каждый получает весь экран: у комплектации — таблица во всю ширину рядом с
 * живым предпросмотром «как увидит заказчик».
 *
 * Черновик приходит с сервера (`GET /estimates/:id/kp/draft`): наименование и
 * состав собраны из опросного листа, условия и подпись — умолчаниями, номер —
 * следующий по сквозному счётчику. Правки уходят в выпуск и ложатся в снапшот:
 * документ печатается из него, а не пересобирается заново.
 *
 * Гейты расчёта (строки без цены, отрицательные суммы, ставки не из прайса)
 * стоят на сервере, и отказ показывается здесь же — списком строк с переходом
 * в расчёт, где они уже отобраны фильтром.
 */
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import { estimatesApi, type KpDraft, type KpIssuePayload, type KpKitItem } from '@/api/estimates'
import { serverBlock, type KpBlock } from '@/utils/kp-gate'
import { toast } from '@/composables/useToast'
import '@/assets/survey-form.css'

const route = useRoute()
const router = useRouter()
const estimateId = computed(() => String(route.params.id ?? ''))

/** Разделы документа — они же боковое меню. */
const TABS = [
  { id: 'product', label: 'Изделие' },
  { id: 'kit', label: 'Комплектация' },
  { id: 'terms', label: 'Условия' },
  { id: 'sign', label: 'Подпись' },
] as const
type TabId = (typeof TABS)[number]['id']
const tab = ref<TabId>('product')

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
  manual: 'Описание собирается из опросного листа. Включите, чтобы вписать свой текст целиком — тогда состав в документ не пойдёт',
  kitName: 'Узел так, как его прочтёт заказчик: корпус, шахта, лестница, гильза, насос, шкаф',
  kitQty: 'Количество узлов на весь заказ',
  kitUnit: 'шт. или компл.',
  kitDrop: 'Убрать узел из состава. На цену это не влияет — она посчитана в расчёте; из документа пропадёт только строка',
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
const busy = ref(false)
const error = ref<string | null>(null)
const draft = ref<KpDraft | null>(null)
const block = ref<KpBlock | null>(null)

const number = ref('')
const tag = ref('')
const mark = ref('')
const tu = ref('')
const unit = ref('')
const manualDescription = ref(false)
const description = ref('')
const kit = ref<KpKitItem[]>([])
/**
 * Поле наименования растёт под текст: у КНС наименование узла — сотня знаков,
 * в одной строке оно обрезалось, а состав из двух десятков таких строк в
 * одном текстовом поле сливался в стену. Каждая позиция — свой блок.
 */
function grow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

/** Заголовок изделия без списка состава — контекст над позициями. */
const headline = computed(() => {
  const full = draft.value?.position.description ?? ''
  return full.split('\nВ комплекте:')[0] ?? full
})
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
    const d = await estimatesApi.kpDraft(estimateId.value)
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

/** Шапка документа в том виде, в каком её принимает сервер. */
function payload(): KpIssuePayload {
  return {
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
  }
}

async function issue() {
  if (!draft.value) return
  busy.value = true
  block.value = null
  try {
    const data = await estimatesApi.kp(estimateId.value, payload())
    toast(
      `КП ${data.kp.number} выпущено · снапшот v${data.snapshot.version} (прайс v${data.snapshot.priceListVersion})`,
      'success',
    )
    await router.push({ name: 'calculator', params: { id: estimateId.value } })
  } catch (err) {
    const data = (
      err as {
        response?: {
          data?: { code?: string; message?: string; rows?: Array<{ name: string; unit?: string }> }
        }
      }
    ).response?.data
    // Гейт сервера — блоком с причиной и списком строк. Не гейт (сеть, 500) —
    // тостом: чинить в расчёте нечего.
    const b = serverBlock(data)
    if (b) block.value = b
    else toast(data?.message ?? 'Не удалось сформировать КП', 'error')
  } finally {
    busy.value = false
  }
}

function toCalculator() {
  void router.push({ name: 'calculator', params: { id: estimateId.value } })
}

/** В расчёт с уже включённым фильтром: строки, из-за которых отказано. */
function toBlockedRows() {
  void router.push({
    name: 'calculator',
    params: { id: estimateId.value },
    query: { rows: 'missing' },
  })
}

watch(estimateId, (id) => { if (id) void load() }, { immediate: true })
</script>

<style scoped>



.kpv-pane { max-width: 1040px; }

.kpv-sub { font-size: 12.5px; color: var(--tx2); margin-bottom: 14px; max-width: 720px; }
.kpv-tgl { display: flex; align-items: center; gap: 5px; margin-left: auto;
  font-size: 12.5px; font-weight: 400; color: var(--tx2); }
.kpv-h-cnt { font-size: 12px; font-weight: 400; color: var(--tx3); }
.kpv-head-prev { font-size: 12.5px; color: var(--tx2); line-height: 1.45; white-space: pre-wrap;
  padding: 8px 10px; margin-bottom: 12px; background: var(--bg3); border-left: 3px solid var(--line2); max-width: 900px; }

/* Позиции состава: номер · наименование (растёт под текст) · кол-во · ед. · убрать. */
.kit-list { list-style: none; display: flex; flex-direction: column; gap: 6px; max-width: 900px; }
.kit-row { display: grid; grid-template-columns: 26px minmax(0, 1fr) 76px 84px 30px; gap: 6px; align-items: start; }
.kit-n { font-size: 12px; color: var(--tx3); padding-top: 7px; text-align: right; font-variant-numeric: tabular-nums; }
.kit-name, .kit-qty, .kit-unit { font: inherit; font-size: 13.5px; color: var(--text); background: var(--cellbg);
  border: 1px solid var(--line2); padding: 5px 8px; }
.kit-name { width: 100%; resize: none; overflow: hidden; line-height: 1.4; min-height: 30px; display: block; }
.kit-qty { text-align: right; }
.kit-drop { padding: 4px 6px; }
.kit-add { margin-top: 10px; }
@media (max-width: 760px) {
  .kit-row { grid-template-columns: 26px minmax(0, 1fr) 30px; }
  .kit-qty, .kit-unit { grid-column: 2; width: 120px; }
}
.kpv-note { font-size: 12.5px; color: var(--tx2); padding: 10px 12px; background: var(--bg3);
  border: 1px solid var(--bd); max-width: 560px; }

.kpv-text { width: 100%; font: inherit; font-size: 12.5px; resize: vertical; }
/* Состав — во весь экран: строк два десятка, и прокручивать их в полосе нельзя. */
.kpv-prev { margin: 0; padding: 8px 10px; background: var(--bg3); border: 1px solid var(--bd);
  font: inherit; font-size: 12.5px; white-space: pre-wrap; max-height: 420px; overflow: auto; }

/* Таблица состава — во всю ширину: узлы КНС длинные, обрезать их нельзя. */

.kpv-sum { margin-bottom: 8px; }
.kpv-sum-l { font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--tx3); }
.kpv-sum-v { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
.kpv-sum-n { font-size: 12px; color: var(--tx2); }

.kpv-block { border: 1px solid var(--acc); background: var(--bg2); padding: 12px 14px;
  margin-bottom: 16px; max-width: 720px; }
.kpv-block-h { font-size: 13.5px; font-weight: 700; color: var(--acc); margin-bottom: 4px; }
.kpv-block-msg { font-size: 12.5px; margin: 0 0 8px; }
.kpv-block-list { margin: 0 0 6px; padding-left: 18px; font-size: 12.5px; }
.kpv-block-u { color: var(--tx2); }
.kpv-block-more { font-size: 12.5px; color: var(--tx2); margin: 0 0 8px; }
.kpv-block-act { display: flex; gap: 8px; }

</style>
