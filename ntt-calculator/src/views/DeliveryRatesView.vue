<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <button v-if="auth.role === 'BUYER'" class="back-link" @click="router.push('/purchases')">← Заявки на закупку</button>
        <button v-else class="back-link" @click="router.push('/')">← Проекты</button>
        <div class="logo">Тарифы доставки</div>
      </div>
      <div class="sidebar-scroll">
        <div class="nav-section">Навигация</div>
        <button v-if="auth.role === 'BUYER'" class="nav-link" @click="router.push('/purchases')">Заявки на закупку</button>
        <button class="nav-link" @click="router.push('/prices')">Прайс-лист</button>
        <button class="nav-link nav-link--active">Тарифы доставки</button>
        <p class="dr-side-note">
          Ставки за машину с НДС по маршрутам. По ним опросный лист считает
          доставку: машин по таблице ограничений погрузки × ставка. «Нет ставки» —
          оставьте поле пустым.
        </p>
      </div>
      <div class="sidebar-footer">
        <BugReportButton />
        <ThemeToggle />
        <UserMenu />
      </div>
    </aside>

    <div class="main-col">
      <div class="topbar">
        <div class="tb-title">Тарифы доставки</div>
        <div class="tb-spacer"></div>
        <div class="dr-count">{{ filtered.length }} из {{ rates.length }} маршрутов</div>
      </div>

      <div class="dr-toolbar">
        <input v-model="search" class="fi dr-search" placeholder="Поиск по маршруту или примечанию…" @keydown.escape="search = ''" />
        <button class="btn btn-acc" :disabled="busy" @click="addOpen = !addOpen">{{ addOpen ? 'Отмена' : '+ Маршрут' }}</button>
        <input ref="fileEl" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden @change="onFile" />
        <button
          v-hint.plain="'Книга тарифов отдела закупок (.xlsx): № п/п, маршрут, ставки габарит / разрешение / сопровождение, примечание. Заменяет таблицу целиком.'"
          class="btn btn-g" :disabled="busy" @click="fileEl?.click()"
        >{{ importing ? 'Проверяем файл…' : 'Импорт из xlsx' }}</button>
      </div>

      <!-- Новый маршрут -->
      <div v-if="addOpen" class="dr-add">
        <input v-model="draft.city" class="fi" placeholder="Маршрут перевозки *" />
        <input v-model="draft.gabarit" class="fi dr-num" placeholder="Габарит, ₽" />
        <input v-model="draft.permit" class="fi dr-num" placeholder="Разрешение, ₽" />
        <input v-model="draft.escort" class="fi dr-num" placeholder="Сопровождение, ₽" />
        <input v-model="draft.note" class="fi" placeholder="Примечание" />
        <button class="btn btn-am" :disabled="busy || !draft.city.trim()" @click="create">Добавить</button>
      </div>

      <!-- Проверка файла перед заменой таблицы -->
      <div v-if="report" class="dr-imp">
        <div v-if="report.dryRun">
          Файл «{{ reportFile }}», лист «{{ report.sheet }}»: маршрутов <b>{{ report.rows }}</b>.
          Таблица будет заменена целиком (сейчас строк: {{ report.replaced }}).
          <span v-if="report.skipped.length" class="is-warn">Пропущено строк: {{ report.skipped.length }}
            ({{ report.skipped.slice(0, 5).map((s) => `стр. ${s.sheetRow} — ${s.reason}`).join('; ') }})</span>
        </div>
        <div v-else>Импорт применён: маршрутов {{ report.rows }}.</div>
        <div class="dr-imp-act">
          <button v-if="report.dryRun" class="btn btn-am" :disabled="busy" @click="applyImport">
            {{ applying ? 'Записываем…' : 'Заменить тарифы' }}
          </button>
          <button class="btn btn-g" :disabled="applying" @click="closeReport">{{ report.dryRun ? 'Отмена' : 'Закрыть' }}</button>
        </div>
      </div>

      <div class="calc-area">
        <div v-if="loading" class="dash-state"><div class="dash-state-txt">Загрузка…</div></div>
        <div v-else-if="error" class="dash-state">
          <div class="dash-state-txt dash-err">{{ error }}</div>
          <button class="btn btn-g" @click="load">Повторить</button>
        </div>
        <table v-else class="dr">
          <thead>
            <tr>
              <th class="dr-n">№</th>
              <th>Маршрут перевозки</th>
              <th class="dr-r">Габаритный груз, ₽/а/м</th>
              <th class="dr-r">Негабарит, разрешение, ₽/а/м</th>
              <th class="dr-r">Негабарит, сопровождение, ₽/а/м</th>
              <th>Примечание</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in filtered" :key="r.id" :class="{ 'is-saving': savingId === r.id }">
              <td class="dr-n">{{ r.num ?? '' }}</td>
              <td><input class="fi fi-xs" :value="r.city" @change="save(r, 'city', $event)" /></td>
              <td v-for="c in MONEY" :key="c" class="dr-r">
                <input
                  class="fi fi-xs dr-num"
                  :class="{ 'is-empty': r[c] == null }"
                  :value="r[c] == null ? '' : fmt(r[c])"
                  placeholder="нет ставки"
                  @change="save(r, c, $event)"
                />
              </td>
              <td><input class="fi fi-xs" :value="r.note ?? ''" @change="save(r, 'note', $event)" /></td>
              <td><button class="btn btn-g btn-xs" :disabled="busy" aria-label="Удалить маршрут" @click="remove(r)">✕</button></td>
            </tr>
            <tr v-if="filtered.length === 0">
              <td colspan="7" class="dr-empty">{{ rates.length ? 'Ничего не найдено.' : 'Тарифов пока нет — добавьте маршрут или импортируйте книгу.' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <ToastHost />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { deliveryRatesApi, type DeliveryImportResult, type DeliveryRateItem } from '@/api/deliveryRates'
import { apiErrorMessage } from '@/utils/api-error'
import { toast } from '@/composables/useToast'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import BugReportButton from '@/components/ui/BugReportButton.vue'
import UserMenu from '@/components/ui/UserMenu.vue'
import ToastHost from '@/components/ui/ToastHost.vue'

/**
 * Тарифы доставки — книга отдела закупок (ставки за машину по маршрутам).
 * Закупка правит строки на месте (запись по уходу с поля) или заменяет
 * таблицу импортом квартальной книги. Опросный лист КНС берёт отсюда список
 * городов и ставки (engines/delivery.ts).
 */
type MoneyCol = 'gabaritRub' | 'permitRub' | 'escortRub'
type EditCol = MoneyCol | 'city' | 'note'
const MONEY: readonly MoneyCol[] = ['gabaritRub', 'permitRub', 'escortRub']

const router = useRouter()
const auth = useAuthStore()

const rates = ref<DeliveryRateItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const savingId = ref<string | null>(null)
const addOpen = ref(false)
const creating = ref(false)
const importing = ref(false)
const applying = ref(false)
const report = ref<DeliveryImportResult | null>(null)
const reportFile = ref('')
const pendingFile = ref<File | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const draft = reactive({ city: '', gabarit: '', permit: '', escort: '', note: '' })

const busy = computed(() => creating.value || importing.value || applying.value || savingId.value != null)

const filtered = computed(() => {
  const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return rates.value
  return rates.value.filter((r) => {
    const hay = `${r.city} ${r.note ?? ''}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
})

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

/** «65 450», «65450,5» → число; пусто → null; не число → undefined (ошибка ввода). */
function parseMoney(text: string): number | null | undefined {
  const t = text.replace(/\s/g, '').replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

async function load() {
  loading.value = true
  error.value = null
  try {
    rates.value = await deliveryRatesApi.list({ fresh: true })
  } catch (e) {
    error.value = apiErrorMessage(e, 'Не удалось загрузить тарифы')
  } finally {
    loading.value = false
  }
}

async function save(row: DeliveryRateItem, col: EditCol, e: Event) {
  const input = e.target as HTMLInputElement
  const text = input.value
  let value: string | number | null
  if (col === 'city') {
    value = text.trim()
    if (!value) { input.value = row.city; toast('Маршрут не может быть пустым', 'error'); return }
  } else if (col === 'note') {
    value = text.trim() || null
  } else {
    const n = parseMoney(text)
    if (n === undefined) {
      input.value = row[col] == null ? '' : fmt(row[col])
      toast('Ставка — неотрицательное число или пусто («нет ставки»)', 'error')
      return
    }
    value = n
  }
  if (value === row[col]) return
  savingId.value = row.id
  try {
    const updated = await deliveryRatesApi.patch(row.id, { [col]: value })
    Object.assign(row, updated)
    toast('Сохранено', 'success')
  } catch (err) {
    input.value = String(row[col] ?? '')
    toast(apiErrorMessage(err, 'Не удалось сохранить'), 'error')
  } finally {
    savingId.value = null
  }
}

async function create() {
  const money = [draft.gabarit, draft.permit, draft.escort].map(parseMoney)
  if (money.some((m) => m === undefined)) { toast('Ставка — неотрицательное число или пусто', 'error'); return }
  creating.value = true
  try {
    const item = await deliveryRatesApi.create({
      city: draft.city.trim(),
      gabaritRub: money[0] ?? null,
      permitRub: money[1] ?? null,
      escortRub: money[2] ?? null,
      note: draft.note.trim() || null,
    })
    rates.value.push(item)
    Object.assign(draft, { city: '', gabarit: '', permit: '', escort: '', note: '' })
    addOpen.value = false
    toast(`Маршрут «${item.city}» добавлен`, 'success')
  } catch (e) {
    toast(apiErrorMessage(e, 'Не удалось добавить маршрут'), 'error')
  } finally {
    creating.value = false
  }
}

async function remove(row: DeliveryRateItem) {
  if (!window.confirm(`Удалить маршрут «${row.city}»?`)) return
  savingId.value = row.id
  try {
    await deliveryRatesApi.remove(row.id)
    rates.value = rates.value.filter((r) => r.id !== row.id)
    toast('Маршрут удалён', 'success')
  } catch (e) {
    toast(apiErrorMessage(e, 'Не удалось удалить'), 'error')
  } finally {
    savingId.value = null
  }
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  importing.value = true
  try {
    report.value = await deliveryRatesApi.import(file, { dryRun: true })
    reportFile.value = file.name
    pendingFile.value = file
  } catch (err) {
    toast(apiErrorMessage(err, 'Не удалось прочитать файл'), 'error')
  } finally {
    importing.value = false
  }
}

async function applyImport() {
  if (!pendingFile.value) return
  applying.value = true
  try {
    report.value = await deliveryRatesApi.import(pendingFile.value)
    pendingFile.value = null
    await load()
    toast('Тарифы обновлены', 'success')
  } catch (err) {
    toast(apiErrorMessage(err, 'Импорт не применён'), 'error')
  } finally {
    applying.value = false
  }
}

function closeReport() {
  report.value = null
  pendingFile.value = null
}

onMounted(load)
</script>

<style scoped>
.dr-side-note { padding: 10px 8px; font-size: 12px; color: var(--tx3); line-height: 1.5; }
.dr-count { font-size: 12.5px; color: var(--tx3); }
.dr-toolbar, .dr-add { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg1); flex-shrink: 0; }
.dr-search { flex: 1 1 260px; min-width: 0; width: auto; }
.dr-add .fi { flex: 1 1 150px; width: auto; }
.dr-add .dr-num { flex: 0 1 130px; }
.dr-imp { padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg2); font-size: 13px; display: flex; flex-direction: column; gap: 6px; }
.dr-imp-act { display: flex; gap: 6px; }
.is-warn { color: var(--am); }
.dr { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--bg2); border: 1px solid var(--border); }
.dr th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); background: var(--bg1);
  color: var(--tx3); font-size: 11.5px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; position: sticky; top: 0; }
.dr td { padding: 3px 6px; border-bottom: 1px solid var(--border); }
.dr-n { width: 44px; color: var(--tx3); font-variant-numeric: tabular-nums; }
.dr-r { width: 150px; text-align: right; }
.dr-num { text-align: right; font-variant-numeric: tabular-nums; }
.dr-num.is-empty::placeholder { color: var(--tx3); font-style: italic; }
.dr-empty { padding: 18px; text-align: center; color: var(--tx3); }
tr.is-saving { opacity: .6; }
</style>
