<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <button class="back-link" @click="router.push('/')">← Проекты</button>
        <div class="logo" style="margin-top:4px">Реестр цен</div>
      </div>
      <div class="sidebar-scroll" style="flex:1">
        <div class="nav-section">Категории</div>
        <button
          class="nav-link"
          :class="{ 'nav-link--active': selectedCat === '' }"
          @click="selectedCat = ''"
        >Все</button>
        <button
          v-for="cat in categories" :key="cat"
          class="nav-link"
          :class="{ 'nav-link--active': selectedCat === cat }"
          @click="selectedCat = cat"
        >{{ cat }}</button>
      </div>
      <div class="sidebar-footer">
        <ThemeToggle />
      </div>
    </aside>

    <div class="main-col">
      <div class="topbar">
        <div class="tb-title">Реестр цен</div>
        <div class="tb-spacer"></div>
        <div style="font-size:12px;color:var(--tx3)">{{ filtered.length }} позиций</div>
      </div>

      <div class="pr-toolbar">
        <input class="fi pr-search" v-model="search" placeholder="Поиск по наименованию…" />
        <button class="btn btn-g" @click="search = ''; selectedCat = ''">Сбросить</button>

        <div class="pr-tb-spacer"></div>

        <!-- Экспорт и импорт прайса (ТЗ §7). Доступ — ADMIN и BUYER (бэк
             проверяет тоже). Импорт двухшаговый: сначала проверка файла —
             что изменится, — и только потом запись. -->
        <template v-if="canImport">
          <button class="btn btn-g" :disabled="exporting" title="Лист «НН» в раскладке мастер-шаблона и лист «Проверка» с замечаниями" @click="onExport">
            {{ exporting ? 'Выгружаем…' : 'Экспорт в xlsx' }}
          </button>
          <input
            ref="fileEl"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            @change="onFile"
          />
          <button class="btn btn-g" :disabled="importing" title="Лист «НН» книги закупок, мастер-шаблона или выгрузки" @click="fileEl?.click()">
            {{ importing ? 'Проверяем файл…' : 'Импорт из xlsx' }}
          </button>
        </template>
      </div>

      <!-- Итог проверки или импорта: держим на экране, а не тостом — цифры
           и списки нужно прочитать до того, как согласиться. -->
      <div v-if="report" class="pr-imp" :class="{ 'pr-imp--preview': report.dryRun }">
        <div class="pr-imp-h">
          <template v-if="report.dryRun">Проверка файла «{{ reportFile }}» — в прайс ещё ничего не записано</template>
          <template v-else-if="report.version != null">Импорт применён · версия прайса v{{ report.version }}</template>
          <template v-else>Импорт применён · цены не менялись, версия прайса прежняя</template>
          <button class="pr-imp-x" title="Закрыть" @click="closeReport">✕</button>
        </div>
        <div class="pr-imp-row">
          <span>новых позиций <b>{{ report.created }}</b></span>
          <span>{{ report.dryRun ? 'цен изменится' : 'цен изменено' }} <b>{{ report.updated }}</b></span>
          <span v-if="report.touched">прочих правок <b>{{ report.touched }}</b></span>
          <span>без изменений <b>{{ report.unchanged }}</b></span>
          <span :class="{ 'is-warn': report.keptPrice > 0 }">пустая цена в файле — оставлена прежняя <b>{{ report.keptPrice }}</b></span>
          <span title="Позиции прайса, которых нет в файле, не удаляются">нет в файле, останутся <b>{{ report.missingInFile }}</b></span>
          <span>исправлено наименований <b>{{ report.nameFixes }}</b></span>
          <span :class="{ 'is-warn': report.skipped > 0 }">пропущено строк <b>{{ report.skipped }}</b></span>
        </div>

        <div v-if="report.dryRun" class="pr-imp-act">
          <button class="btn btn-am" :disabled="applying || !hasWrites" @click="applyImport">
            {{ applying ? 'Записываем…' : hasWrites ? 'Применить импорт' : 'Менять нечего' }}
          </button>
          <button class="btn btn-g" :disabled="applying" @click="closeReport">Отмена</button>
        </div>

        <details v-if="report.changes.length" class="pr-imp-d" open>
          <summary>{{ report.dryRun ? 'Цены изменятся' : 'Цены изменены' }} ({{ report.changes.length }})</summary>
          <div class="pr-imp-scroll">
            <table class="pr-imp-t">
              <tr v-for="c in report.changes" :key="c.sheetRow">
                <td class="pr-imp-row-n">стр. {{ c.sheetRow }}</td>
                <td>{{ c.name }}</td>
                <td class="pr-unit">{{ c.unit }}</td>
                <td class="pr-imp-num">{{ c.oldPrice != null ? fmt(c.oldPrice) : '—' }}</td>
                <td class="pr-imp-num">→ {{ c.newPrice != null ? fmt(c.newPrice) : '—' }}</td>
                <td class="pr-imp-num" :class="deltaClass(c.oldPrice, c.newPrice)">{{ delta(c.oldPrice, c.newPrice) }}</td>
              </tr>
            </table>
          </div>
        </details>

        <details v-if="report.createdItems.length" class="pr-imp-d">
          <summary>Новые позиции ({{ report.createdItems.length }})</summary>
          <div v-for="c in report.createdItems" :key="c.sheetRow" class="pr-imp-i">
            стр. {{ c.sheetRow }} · {{ c.category }} · {{ c.name }} [{{ c.unit }}] · {{ c.priceRub != null ? fmt(c.priceRub) + ' ₽' : 'без цены' }}
          </div>
        </details>

        <!-- Повторы и пропуски не заминаем: это данные закупок, и о них надо
             знать (План §4.1-bis C, D). Повтор с другой ценой — вопрос, какая
             из двух верна. -->
        <details v-if="report.duplicates.length" class="pr-imp-d" :open="conflicts > 0">
          <summary :class="{ 'is-warn': conflicts > 0 }">
            Повторы в файле ({{ report.duplicates.length }}){{ conflicts ? ' · с разными ценами — ' + conflicts : '' }}
          </summary>
          <div v-for="d in report.duplicates" :key="d.sheetRow" class="pr-imp-i" :class="{ 'is-warn': d.price !== d.firstPrice }">
            стр. {{ d.sheetRow }} повторяет стр. {{ d.firstRow }} · {{ d.key.replace(/:/g, ' · ') }}
            <template v-if="d.price !== d.firstPrice">
              · цены {{ d.firstPrice != null ? fmt(d.firstPrice) : '—' }} (взята) и {{ d.price != null ? fmt(d.price) : '—' }}
            </template>
          </div>
          <p class="pr-imp-note">Берётся первая строка — так же ведёт себя VLOOKUP в Excel. Лишнюю строку стоит убрать из листа.</p>
        </details>

        <details v-if="report.keptPrices.length" class="pr-imp-d">
          <summary class="is-warn">Пустая цена в файле ({{ report.keptPrices.length }})</summary>
          <div v-for="k in report.keptPrices" :key="k.sheetRow" class="pr-imp-i">
            стр. {{ k.sheetRow }} · {{ k.name }} [{{ k.unit }}] · в прайсе остаётся {{ fmt(k.dbPrice) }} ₽
          </div>
        </details>

        <details v-if="report.nameFixSamples.length" class="pr-imp-d">
          <summary>Исправленные наименования (примеры)</summary>
          <p class="pr-imp-note">Двойные и неразрывные пробелы, латиница на месте кириллицы («ГOCT», «108x8») — в прайс записывается исправленное.</p>
          <div v-for="f in report.nameFixSamples" :key="f.sheetRow" class="pr-imp-i">
            стр. {{ f.sheetRow }} · {{ f.to }}
          </div>
        </details>

        <details v-if="report.skippedRows.length" class="pr-imp-d">
          <summary class="is-warn">Пропущенные строки ({{ report.skippedRows.length }})</summary>
          <div v-for="srow in report.skippedRows" :key="srow.sheetRow" class="pr-imp-i">
            стр. {{ srow.sheetRow }}: {{ srow.reason }}
          </div>
        </details>
      </div>

      <div class="calc-area">
        <div v-if="loading" class="dash-state">
          <div class="dash-state-txt">Загрузка прайс-листа…</div>
        </div>
        <div v-else-if="loadError" class="dash-state">
          <div class="dash-state-txt dash-err">{{ loadError }}</div>
          <button class="btn btn-g" @click="load">Повторить</button>
        </div>
        <div v-else-if="filtered.length === 0" class="dash-state">
          <div class="dash-state-txt">Ничего не найдено.</div>
        </div>
        <template v-else>
          <template v-for="cat in visibleCats" :key="cat">
            <div class="pr-cat-hdr">{{ cat }}</div>
            <table class="pr-table">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th>Ед.</th>
                  <th>Цена, ₽</th>
                  <th>Поставщик</th>
                  <th>Обновлено</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in byCat(cat)" :key="item.id">
                  <td>{{ item.name }}</td>
                  <td class="pr-unit">{{ item.unit }}</td>
                  <td class="pr-price">
                    <template v-if="editingId === item.id">
                      <input
                        class="fi pr-inp"
                        type="number"
                        step="0.01"
                        min="0"
                        v-model.number="editPrice"
                        @keydown.enter="saveEdit(item.id)"
                        @keydown.escape="cancelEdit"
                        ref="priceInputRef"
                      />
                    </template>
                    <span v-else class="pr-price-val" @click="startEdit(item)">
                      {{ item.priceRub != null ? fmt(item.priceRub) : '—' }}
                    </span>
                  </td>
                  <td class="pr-supplier">
                    <template v-if="editingId === item.id">
                      <input
                        class="fi pr-inp"
                        v-model="editSupplier"
                        placeholder="Поставщик"
                        @keydown.enter="saveEdit(item.id)"
                        @keydown.escape="cancelEdit"
                      />
                    </template>
                    <span v-else class="pr-sup-val" @click="startEdit(item)">
                      {{ item.supplier || '—' }}
                    </span>
                  </td>
                  <td class="pr-date">{{ fmtDate(item.updatedAt) }}</td>
                  <td class="pr-actions">
                    <template v-if="editingId === item.id">
                      <button class="btn btn-am pr-save-btn" :disabled="saving" @click="saveEdit(item.id)">✓</button>
                      <button class="btn btn-g  pr-save-btn" @click="cancelEdit">✕</button>
                    </template>
                    <button v-else class="pr-edit-btn" @click="startEdit(item)">✎</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </template>
        </template>
      </div>
    </div>
  </div>

    <ToastHost />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { pricesApi, type ImportResult, type PriceItem } from '@/api/prices'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import { fmt } from '@/engines/format'
import { useAuthStore } from '@/stores/auth'
import ToastHost from '@/components/ui/ToastHost.vue'
import { toast } from '@/composables/useToast'

const router = useRouter()
const auth   = useAuthStore()
const canEdit = computed(() => auth.role === 'ADMIN' || auth.role === 'BUYER')

/** Импорт прайса — те же роли, что и правка цены (бэк проверяет тоже). */
const canImport = canEdit

const items    = ref<PriceItem[]>([])
const loading  = ref(false)
const loadError = ref('')
const search    = ref('')

const fileEl = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const applying = ref(false)
const exporting = ref(false)
/** Отчёт проверки файла или применённого импорта. */
const report = ref<ImportResult | null>(null)
/** Файл, прошедший проверку: его же и применяем — второй выбор не нужен. */
const pendingFile = ref<File | null>(null)
const reportFile = computed(() => pendingFile.value?.name ?? '')

/** Есть ли что записывать: иначе кнопка «Применить» ничего бы не сделала. */
const hasWrites = computed(() => {
  const r = report.value
  return !!r && r.created + r.updated + r.touched > 0
})
/** Повторы ключа с разными ценами — вопрос закупкам, какая из двух верна. */
const conflicts = computed(() => report.value?.duplicates.filter((d) => d.price !== d.firstPrice).length ?? 0)

function errorMessage(err: unknown, fallback: string): string {
  const r = (err as { response?: { data?: { message?: string } } }).response
  return r?.data?.message ?? (err instanceof Error ? err.message : fallback)
}

/** Шаг 1: файл проверяется без записи — видно, что изменится. */
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  importing.value = true
  report.value = null
  pendingFile.value = file
  try {
    report.value = await pricesApi.import(file, { dryRun: true })
  } catch (err) {
    pendingFile.value = null
    toast(errorMessage(err, 'Не удалось проверить файл'), 'error')
  } finally {
    importing.value = false
    // Сбрасываем input: иначе повторный выбор того же файла не даст события.
    input.value = ''
  }
}

/** Шаг 2: запись того, что показала проверка. */
async function applyImport() {
  const file = pendingFile.value
  if (!file) return
  applying.value = true
  try {
    const res = await pricesApi.import(file)
    report.value = res
    pendingFile.value = null
    toast(
      res.version != null
        ? 'Прайс обновлён: версия v' + res.version + ', новых ' + res.created + ', цен изменено ' + res.updated
        : 'Импорт применён: цены не менялись',
      'success',
    )
    // Перечитываем: цены изменились, а на экране остались прежние.
    await load()
  } catch (err) {
    toast(errorMessage(err, 'Импорт не удался'), 'error')
  } finally {
    applying.value = false
  }
}

function closeReport() {
  report.value = null
  pendingFile.value = null
}

/** Изменение цены в процентах — со знаком; у позиции без прежней цены — «новая». */
function delta(oldPrice: number | null, newPrice: number | null): string {
  if (oldPrice == null || oldPrice === 0) return newPrice != null ? 'новая' : ''
  if (newPrice == null) return ''
  const pct = ((newPrice - oldPrice) / oldPrice) * 100
  return (pct > 0 ? '+' : '') + pct.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' %'
}
function deltaClass(oldPrice: number | null, newPrice: number | null): string {
  if (oldPrice == null || newPrice == null || oldPrice === 0) return ''
  return newPrice > oldPrice ? 'pr-up' : 'pr-down'
}

async function onExport() {
  exporting.value = true
  try {
    const blob = await pricesApi.exportXlsx()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Прайс_НН_' + new Date().toISOString().slice(0, 10) + '.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    toast(errorMessage(err, 'Не удалось выгрузить прайс'), 'error')
  } finally {
    exporting.value = false
  }
}
const selectedCat = ref('')

const editingId   = ref<string | null>(null)
const editPrice   = ref<number | null>(null)
const editSupplier = ref('')
const saving      = ref(false)
const priceInputRef = ref<HTMLInputElement | null>(null)

async function load() {
  loading.value = true; loadError.value = ''
  try {
    items.value = await pricesApi.list()
  } catch (e: unknown) {
    loadError.value = e instanceof Error ? e.message : 'Ошибка загрузки'
  } finally {
    loading.value = false
  }
}

const categories = computed(() => [...new Set(items.value.map(i => i.category))].sort())

const filtered = computed(() => {
  let list = items.value
  if (selectedCat.value) list = list.filter(i => i.category === selectedCat.value)
  const q = search.value.toLowerCase()
  if (q) list = list.filter(i => i.name.toLowerCase().includes(q) || (i.supplier ?? '').toLowerCase().includes(q))
  return list
})

const visibleCats = computed(() => [...new Set(filtered.value.map(i => i.category))].sort())

function byCat(cat: string) {
  return filtered.value.filter(i => i.category === cat)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function startEdit(item: PriceItem) {
  if (!canEdit.value) return
  editingId.value  = item.id
  editPrice.value  = item.priceRub
  editSupplier.value = item.supplier ?? ''
  nextTick(() => priceInputRef.value?.focus())
}

function cancelEdit() {
  editingId.value = null
}

async function saveEdit(id: string) {
  saving.value = true
  try {
    const updated = await pricesApi.patch(id, {
      priceRub:  editPrice.value   ?? undefined,
      supplier:  editSupplier.value.trim() || undefined,
    })
    const idx = items.value.findIndex(i => i.id === id)
    if (idx !== -1) items.value[idx] = updated
    editingId.value = null
  } catch {
    // keep editing open on error
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.pr-tb-spacer { flex: 1; }
.pr-hint { font-size: 12px; color: var(--faint); }
.pr-imp { margin: 8px 12px; border: 1px solid var(--line2); background: var(--panel); padding: 8px 10px; }
.pr-imp-h { display: flex; align-items: center; font-size: 13.8px; font-weight: 600; margin-bottom: 6px; }
.pr-imp-x { margin-left: auto; background: transparent; border: none; color: var(--faint); font-size: 14.4px; }
.pr-imp-row { display: flex; gap: 16px; font-size: 13.2px; color: var(--muted); flex-wrap: wrap; }
.pr-imp-row .is-warn { color: var(--amber); }
.pr-imp-d { margin-top: 6px; }
.pr-imp-d summary { font-size: 12.6px; color: var(--faint); cursor: pointer; }
.pr-imp-i { font-size: 12.6px; color: var(--muted); margin-top: 3px; }
.pr-imp-note { font-size: 12px; color: var(--faint); margin-top: 6px; }
.pr-imp--preview { border-color: var(--amber); }
.pr-imp-act { display: flex; gap: 6px; margin: 8px 0 2px; }
.pr-imp-d summary.is-warn, .pr-imp-i.is-warn { color: var(--amber); }
.pr-imp-scroll { max-height: 280px; overflow: auto; }
.pr-imp-t { border-collapse: collapse; font-size: 12.6px; margin-top: 4px; width: 100%; }
.pr-imp-t td { padding: 2px 8px 2px 0; color: var(--muted); vertical-align: top; }
.pr-imp-row-n { white-space: nowrap; color: var(--faint); width: 60px; }
.pr-imp-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; width: 90px; }
.pr-imp-t .pr-up { color: var(--danger); }
.pr-imp-t .pr-down { color: var(--green); }

.pr-toolbar { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg1); flex-shrink: 0; }
.pr-search  { flex: 1; min-width: 0; }

.pr-cat-hdr {
  font-size: 10.8px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: var(--accent); font-family: Archivo, system-ui, sans-serif;
  padding: 10px 14px 4px; border-bottom: 1px solid var(--border);
}

.pr-table {
  width: 100%; border-collapse: collapse; font-size: 13.2px;
}
.pr-table th {
  text-align: left; padding: 4px 10px; font-size: 10.8px; font-weight: 600;
  color: var(--tx3); background: var(--bg1); border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 1;
}
.pr-table td {
  padding: 5px 10px; border-bottom: 1px solid var(--border); color: var(--tx2); vertical-align: middle;
}
.pr-table tr:hover td { background: var(--bg3); }

.pr-unit     { font-family: Archivo, system-ui, sans-serif; font-size: 10.8px; color: var(--tx3); white-space: nowrap; width: 40px; }
.pr-price    { width: 110px; }
.pr-price-val { cursor: pointer; font-family: Archivo, system-ui, sans-serif; font-size: 13.2px; font-weight: 600; color: var(--accent); }
.pr-price-val:hover { text-decoration: underline; }
.pr-supplier  { width: 160px; }
.pr-sup-val   { cursor: pointer; }
.pr-sup-val:hover { text-decoration: underline; color: var(--tx1); }
.pr-date      { font-size: 10.8px; color: var(--tx3); font-family: Archivo, system-ui, sans-serif; width: 70px; white-space: nowrap; }
.pr-actions   { width: 70px; white-space: nowrap; }

.pr-inp      { padding: 2px 5px; font-size: 13.2px; height: 24px; width: 100%; }
.pr-save-btn { padding: 2px 7px; font-size: 13.2px; height: 24px; min-width: 0; }
.pr-edit-btn {
  background: transparent; border: none; color: var(--tx3); font-size: 15.6px;
  cursor: pointer; padding: 2px 4px; transition: color .12s;
}
.pr-edit-btn:hover { color: var(--accent); }

.nav-section { font-size: 10.8px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--tx3); padding: 10px 8px 4px; }
.nav-link    { display: block; width: 100%; text-align: left; padding: 5px 8px; border-radius: 4px; font-size: 13.2px; color: var(--tx2); cursor: pointer; background: transparent; border: none; transition: background .12s, color .12s; }
.nav-link:hover    { background: var(--bg3); color: var(--tx1); }
.nav-link--active  { background: var(--bg3); color: var(--accent); font-weight: 600; }

.dash-state    { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; opacity: .6; }
.dash-state-txt { font-size: 14.4px; color: var(--tx3); }
.dash-err      { color: var(--danger); }
</style>
