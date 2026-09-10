<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <button class="back-link" @click="router.push('/')">← Проекты</button>
        <div class="logo" style="margin-top:4px">Реестр цен</div>
      </div>
      <div class="sidebar-scroll" style="flex:1">
        <div class="nav-section pr-cats-h">
          <span>Категории</span>
          <button v-if="catFilter.size" class="pr-cats-all" @click="clearCategories">все</button>
        </div>
        <!-- Категории — фильтр на несколько сразу: отмеченные складываются.
             Счётчик — сколько строк категории проходит остальные фильтры
             (поиск, «без цены», «с замечаниями»). -->
        <label
          v-for="c in categoryList" :key="c.name"
          class="pr-cat"
          :class="{ on: catFilter.has(c.name), empty: c.count === 0 }"
        >
          <input type="checkbox" :checked="catFilter.has(c.name)" @change="toggleCategory(c.name)" />
          <span class="pr-cat-n">{{ c.name }}</span>
          <span v-hint.plain="PRICE_FILTER_HINTS.categoryCount" class="pr-cat-c">{{ c.count }}</span>
        </label>
      </div>
      <div class="sidebar-footer">
        <ThemeToggle />
      </div>
    </aside>

    <div class="main-col">
      <div class="topbar">
        <div class="tb-title">Реестр цен</div>
        <span v-if="versionLabel" v-hint.plain="versionTitle" class="pr-ver">{{ versionLabel }}</span>
        <div class="tb-spacer"></div>
        <div class="pr-count">{{ countText }}</div>
      </div>

      <div class="pr-toolbar">
        <!-- Содержимое панели — в тех же пределах, что таблица: иначе на
             широком экране кнопки выгрузки уезжали бы от неё к краю окна. -->
        <div class="pr-toolbar-in">
        <div class="pr-search-w">
          <input
            ref="searchEl"
            v-model="search"
            class="fi pr-search"
            v-hint="PRICE_FILTER_HINTS.search"
            placeholder="Поиск: наименование, поставщик — слова через пробел"
            @keydown.escape="search = ''"
          />
          <button v-if="search" v-hint="'Очистить поиск'" class="pr-search-x" aria-label="Очистить поиск" @click="search = ''">✕</button>
        </div>
        <button v-hint="PRICE_FILTER_HINTS.noPrice" class="chip-f chip-red" :class="{ on: noPrice }" @click="noPrice = !noPrice">
          ● без цены · {{ noPriceCount }}
        </button>
        <button v-hint="PRICE_FILTER_HINTS.issues" class="chip-f chip-amber" :class="{ on: withIssues }" @click="withIssues = !withIssues">
          ⚠ с замечаниями · {{ issuesCount }}
        </button>
        <button v-if="anyFilter" class="btn btn-g" @click="resetFilters">Сбросить фильтры</button>

        <div class="pr-tb-spacer"></div>

        <!-- Экспорт и импорт прайса (ТЗ §7). Доступ — ADMIN и BUYER (бэк
             проверяет тоже). Импорт двухшаговый: сначала проверка файла —
             что изменится, — и только потом запись. -->
        <template v-if="canImport">
          <button v-hint="PRICE_FILTER_HINTS.export" class="btn btn-g" :disabled="exporting" @click="onExport">
            {{ exporting ? 'Выгружаем…' : 'Экспорт в xlsx' }}
          </button>
          <input
            ref="fileEl"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            @change="onFile"
          />
          <button v-hint="PRICE_FILTER_HINTS.import" class="btn btn-g" :disabled="importing" @click="fileEl?.click()">
            {{ importing ? 'Проверяем файл…' : 'Импорт из xlsx' }}
          </button>
        </template>
        </div>
      </div>

      <!-- Итог проверки или импорта: держим на экране, а не тостом — цифры
           и списки нужно прочитать до того, как согласиться. -->
      <div v-if="report" class="pr-imp" :class="{ 'pr-imp--preview': report.dryRun }">
        <div class="pr-imp-h">
          <template v-if="report.dryRun">Проверка файла «{{ reportFile }}» — в прайс ещё ничего не записано</template>
          <template v-else-if="report.version != null">Импорт применён · версия прайса v{{ report.version }}</template>
          <template v-else>Импорт применён · цены не менялись, версия прайса прежняя</template>
          <button v-hint="'Закрыть отчёт'" class="pr-imp-x" aria-label="Закрыть отчёт" @click="closeReport">✕</button>
        </div>
        <div class="pr-imp-row">
          <span>новых позиций <b>{{ report.created }}</b></span>
          <span>{{ report.dryRun ? 'цен изменится' : 'цен изменено' }} <b>{{ report.updated }}</b></span>
          <span v-if="report.touched">прочих правок <b>{{ report.touched }}</b></span>
          <span>без изменений <b>{{ report.unchanged }}</b></span>
          <span :class="{ 'is-warn': report.keptPrice > 0 }">пустая цена в файле — оставлена прежняя <b>{{ report.keptPrice }}</b></span>
          <span v-hint="'Позиции прайса, которых нет в файле, не удаляются'">нет в файле, останутся <b>{{ report.missingInFile }}</b></span>
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
                <td class="pr-imp-num">{{ c.oldPrice != null ? fmtPrice(c.oldPrice) : '—' }}</td>
                <td class="pr-imp-num">→ {{ c.newPrice != null ? fmtPrice(c.newPrice) : '—' }}</td>
                <td class="pr-imp-num" :class="deltaClass(c.oldPrice, c.newPrice)">{{ delta(c.oldPrice, c.newPrice) }}</td>
              </tr>
            </table>
          </div>
        </details>

        <details v-if="report.createdItems.length" class="pr-imp-d">
          <summary>Новые позиции ({{ report.createdItems.length }})</summary>
          <div v-for="c in report.createdItems" :key="c.sheetRow" class="pr-imp-i">
            стр. {{ c.sheetRow }} · {{ c.category }} · {{ c.name }} [{{ c.unit }}] · {{ c.priceRub != null ? fmtPrice(c.priceRub) + ' ₽' : 'без цены' }}
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
              · цены {{ d.firstPrice != null ? fmtPrice(d.firstPrice) : '—' }} (взята) и {{ d.price != null ? fmtPrice(d.price) : '—' }}
            </template>
          </div>
          <p class="pr-imp-note">Берётся первая строка — так же ведёт себя VLOOKUP в Excel. Лишнюю строку стоит убрать из листа.</p>
        </details>

        <details v-if="report.keptPrices.length" class="pr-imp-d">
          <summary class="is-warn">Пустая цена в файле ({{ report.keptPrices.length }})</summary>
          <div v-for="k in report.keptPrices" :key="k.sheetRow" class="pr-imp-i">
            стр. {{ k.sheetRow }} · {{ k.name }} [{{ k.unit }}] · в прайсе остаётся {{ fmtPrice(k.dbPrice) }} ₽
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

      <div class="calc-area pr-area">
        <div v-if="loading" class="dash-state">
          <div class="dash-state-txt">Загрузка прайс-листа…</div>
        </div>
        <div v-else-if="loadError" class="dash-state">
          <div class="dash-state-txt dash-err">{{ loadError }}</div>
          <button class="btn btn-g" @click="load()">Повторить</button>
        </div>
        <div v-else-if="sorted.length === 0" class="dash-state">
          <div class="dash-state-txt">Под фильтры не подходит ни одна позиция.</div>
          <button v-if="anyFilter" class="btn btn-g" @click="resetFilters">Сбросить фильтры</button>
        </div>
        <template v-else>
          <!-- Одна таблица на весь прайс: шапка прилипает, категории — строками-
               заголовками. Выводится порциями: все 1 100 строк разом рисовались
               четверть секунды на каждое изменение фильтра.
               Ширина ограничена: на широком экране цена уезжала от
               наименования на полтора метра, и строку было не прочесть.
               Узкие колонки заданы жёстко, наименование получает остаток. -->
          <table class="pr-table">
            <colgroup>
              <col />
              <col class="pr-col-unit" />
              <col class="pr-col-price" />
              <col class="pr-col-supplier" />
              <col class="pr-col-date" />
              <col class="pr-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th v-hint.plain="PRICE_COLUMN_HINTS.name" class="pr-th-sort" :aria-sort="ariaSort('name')" @click="setSort('name')">Наименование{{ arrow('name') }}</th>
                <th v-hint.plain="PRICE_COLUMN_HINTS.unit" class="pr-unit">ЕИ</th>
                <th v-hint.plain="PRICE_COLUMN_HINTS.price" class="pr-th-sort pr-num" :aria-sort="ariaSort('price')" @click="setSort('price')">Цена, ₽{{ arrow('price') }}</th>
                <th v-hint.plain="PRICE_COLUMN_HINTS.supplier" class="pr-supplier">Поставщик</th>
                <th v-hint.plain="PRICE_COLUMN_HINTS.updated" class="pr-th-sort pr-date" :aria-sort="ariaSort('updated')" @click="setSort('updated')">Обновлено{{ arrow('updated') }}</th>
                <th class="pr-actions"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="line in lines" :key="line.kind === 'group' ? 'g:' + line.category : line.item.id">
                <tr v-if="line.kind === 'group'" class="pr-grp">
                  <td colspan="6">{{ line.category }} <span class="pr-grp-c">{{ line.total }}</span></td>
                </tr>
                <tr
                  v-else
                  v-hint.row="editingId === line.item.id ? null : priceRowHint(line.item, { canEdit })"
                  :class="{ 'pr-row--edit': editingId === line.item.id, 'pr-row--editable': canEdit }"
                  @dblclick="onRowDblClick(line.item)"
                >
                  <td class="pr-name">
                    {{ line.item.name }}
                    <span v-if="line.item.issue" class="pr-issue" :aria-label="line.item.issue">⚠</span>
                    <div v-if="line.item.comment" class="pr-comment">{{ line.item.comment }}</div>
                  </td>
                  <td class="pr-unit">{{ line.item.unit }}</td>
                  <td class="pr-num">
                    <input
                      v-if="editingId === line.item.id"
                      :ref="setPriceInput"
                      v-model="editPrice"
                      class="fi pr-inp num"
                      @keydown.enter="saveEdit(line.item.id)"
                      @keydown.escape="cancelEdit"
                    />
                    <span
                      v-else
                      class="pr-price-val"
                      :class="{ 'pr-price--none': line.item.priceRub == null, 'pr-price--ro': !canEdit }"
                      @click="startEdit(line.item)"
                    >{{ line.item.priceRub != null ? fmtPrice(line.item.priceRub) : 'нет цены' }}</span>
                  </td>
                  <td class="pr-supplier">
                    <input
                      v-if="editingId === line.item.id"
                      v-model="editSupplier"
                      class="fi pr-inp"
                      placeholder="Поставщик"
                      @keydown.enter="saveEdit(line.item.id)"
                      @keydown.escape="cancelEdit"
                    />
                    <span v-else class="pr-sup-val" :class="{ 'pr-price--ro': !canEdit }" @click="startEdit(line.item)">
                      {{ line.item.supplier || '—' }}
                    </span>
                  </td>
                  <td class="pr-date">{{ fmtDate(line.item.updatedAt) }}</td>
                  <td class="pr-actions">
                    <template v-if="editingId === line.item.id">
                      <button v-hint="'Сохранить (Enter)'" class="btn btn-am pr-save-btn" :disabled="saving" aria-label="Сохранить" @click="saveEdit(line.item.id)">✓</button>
                      <button v-hint="'Отменить (Esc)'" class="btn btn-g pr-save-btn" aria-label="Отменить" @click="cancelEdit">✕</button>
                    </template>
                    <button v-else-if="canEdit" v-hint="'Изменить цену и поставщика — или двойной щелчок по строке'" class="pr-edit-btn" aria-label="Изменить цену и поставщика" @click="startEdit(line.item)">✎</button>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>

          <div v-if="hidden > 0" class="pr-more">
            <span>показано {{ fmtInt(shown) }} из {{ fmtInt(sorted.length) }}</span>
            <button class="btn" @click="limit += PAGE">Показать ещё {{ Math.min(PAGE, hidden) }}</button>
            <button class="btn btn-g" @click="limit = Number.POSITIVE_INFINITY">Показать все</button>
          </div>
        </template>
      </div>
    </div>
  </div>

  <ToastHost />
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { pricesApi, type ImportResult, type PriceItem } from '@/api/prices'
import { refsApi } from '@/api/refs'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { toast } from '@/composables/useToast'
import { tryEvalExpr } from '@/engines/expr'
import { useAuthStore } from '@/stores/auth'
import { PRICE_COLUMN_HINTS, PRICE_FILTER_HINTS, priceRowHint } from '@/hints/prices'
import {
  countByCategory,
  haystack,
  matches,
  orderCategories,
  sortItems,
  withGroups,
  type RegistryFilter,
  type RegistrySort,
  type RegistrySortKey,
} from '@/utils/price-registry'

type RegistryPrice = PriceItem & { issue?: string | null }

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const canEdit = computed(() => auth.role === 'ADMIN' || auth.role === 'BUYER')

/** Импорт прайса — те же роли, что и правка цены (бэк проверяет тоже). */
const canImport = canEdit

const items = ref<RegistryPrice[]>([])
const loading = ref(false)
const loadError = ref('')
const versionLabel = ref('')
const versionTitle = ref('')

// ── Форматы ─────────────────────────────────────────────────────────────────

const fmtPrice = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const fmtInt = (n: number) => n.toLocaleString('ru-RU')

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

// ── Фильтры ─────────────────────────────────────────────────────────────────
// Состояние фильтров живёт и в адресе страницы (?q=…&cat=…&f=…): после правки
// цены, обновления страницы или возврата «назад» выборка та же.

const search = ref('')
const catFilter = ref<Set<string>>(new Set())
const noPrice = ref(false)
const withIssues = ref(false)
const sort = ref<RegistrySort>({ key: 'name', dir: 1 })

/** Строк за один раз: все 1 100 разом рисовались четверть секунды на каждое изменение. */
const PAGE = 200
const limit = ref(PAGE)

const filter = computed<RegistryFilter>(() => ({
  query: search.value,
  categories: catFilter.value,
  noPrice: noPrice.value,
  issues: withIssues.value,
}))

/** Строка поиска по позиции — считается один раз на загрузку, а не на каждую букву. */
const index = computed(() => items.value.map((item) => ({ item, hay: haystack(item) })))

/** Проходят поиск и категории, без флагов — для счётчиков на флагах. */
const scope = computed(() =>
  index.value.filter(({ item, hay }) => matches(item, hay, { ...filter.value, noPrice: false, issues: false })),
)
/** Проходят поиск и флаги, без категорий — для счётчиков у категорий. */
const base = computed(() =>
  index.value.filter(({ item, hay }) => matches(item, hay, filter.value, { ignoreCategories: true })),
)
const visible = computed(() =>
  catFilter.value.size === 0 ? base.value.map((x) => x.item) : base.value.filter((x) => catFilter.value.has(x.item.category)).map((x) => x.item),
)
const sorted = computed(() => sortItems(visible.value, sort.value))
const lines = computed(() => withGroups(sorted.value, limit.value))
const shown = computed(() => Math.min(limit.value, sorted.value.length))
const hidden = computed(() => sorted.value.length - shown.value)

const noPriceCount = computed(() => scope.value.filter((x) => x.item.priceRub == null).length)
const issuesCount = computed(() => scope.value.filter((x) => x.item.issue).length)

const categoryList = computed(() => {
  const counts = countByCategory(base.value.map((x) => x.item))
  return orderCategories(items.value.map((i) => i.category)).map((name) => ({ name, count: counts.get(name) ?? 0 }))
})

const anyFilter = computed(() => !!search.value.trim() || catFilter.value.size > 0 || noPrice.value || withIssues.value)

const countText = computed(() => {
  const total = items.value.length
  if (!anyFilter.value) return `${fmtInt(total)} ${plural(total, 'позиция', 'позиции', 'позиций')}`
  return `найдено ${fmtInt(sorted.value.length)} из ${fmtInt(total)}`
})

function toggleCategory(name: string) {
  const next = new Set(catFilter.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  catFilter.value = next
}
function clearCategories() {
  catFilter.value = new Set()
}
function resetFilters() {
  search.value = ''
  catFilter.value = new Set()
  noPrice.value = false
  withIssues.value = false
}

function setSort(key: RegistrySortKey) {
  sort.value = sort.value.key === key
    ? { key, dir: sort.value.dir === 1 ? -1 : 1 }
    // Дату смотрят «свежие сверху», наименование и цену — по возрастанию.
    : { key, dir: key === 'updated' ? -1 : 1 }
}
function arrow(key: RegistrySortKey): string {
  return sort.value.key === key ? (sort.value.dir === 1 ? ' ↑' : ' ↓') : ''
}
function ariaSort(key: RegistrySortKey): 'ascending' | 'descending' | 'none' {
  return sort.value.key === key ? (sort.value.dir === 1 ? 'ascending' : 'descending') : 'none'
}

// Новая выборка — снова с первой порции.
watch([filter, sort], () => { limit.value = PAGE })

// ── Адрес страницы ↔ фильтры ────────────────────────────────────────────────

function readQuery() {
  const q = route.query
  search.value = typeof q.q === 'string' ? q.q : ''
  catFilter.value = new Set(typeof q.cat === 'string' && q.cat ? q.cat.split('|') : [])
  const flags = typeof q.f === 'string' ? q.f.split(',') : []
  noPrice.value = flags.includes('noprice')
  withIssues.value = flags.includes('issues')
}

let queryTimer: ReturnType<typeof setTimeout> | null = null
watch(filter, (f) => {
  if (queryTimer) clearTimeout(queryTimer)
  // Поиск пишется в адрес с паузой: иначе каждая буква — запись в историю.
  queryTimer = setTimeout(() => {
    const flags = [f.noPrice && 'noprice', f.issues && 'issues'].filter(Boolean).join(',')
    const query: Record<string, string> = {}
    if (f.query.trim()) query.q = f.query.trim()
    // Разделитель «|»: в названиях категорий бывает запятая («Насосы, АТМ»).
    if (f.categories.size) query.cat = [...f.categories].join('|')
    if (flags) query.f = flags
    void router.replace({ query })
  }, 300)
})

// ── Загрузка ────────────────────────────────────────────────────────────────

/**
 * @param silent без экрана загрузки — после правки цены: замечания к ценам
 *   считает сервер, и они могли поменяться, а прокрутка должна остаться.
 */
async function load(opts: { silent?: boolean } = {}) {
  if (!opts.silent) loading.value = true
  loadError.value = ''
  try {
    items.value = (await pricesApi.list()) as RegistryPrice[]
  } catch (e: unknown) {
    loadError.value = e instanceof Error ? e.message : 'Ошибка загрузки'
  } finally {
    loading.value = false
  }
}

async function loadVersion() {
  try {
    const v = await refsApi.priceVersion()
    versionLabel.value = `прайс v${v.version}${v.label ? ' · ' + v.label : ''}`
    versionTitle.value = v.createdAt ? `Версия прайса от ${new Date(v.createdAt).toLocaleString('ru-RU')}` : ''
  } catch {
    // Подпись версии — справочно; без неё экран работает.
  }
}

// ── Правка цены и поставщика ────────────────────────────────────────────────

const editingId = ref<string | null>(null)
const editPrice = ref('')
const editSupplier = ref('')
const saving = ref(false)
let priceInput: HTMLInputElement | null = null
/** Поле цены редактируемой строки: оно одно, но стоит внутри v-for. */
function setPriceInput(el: unknown) {
  priceInput = el instanceof HTMLInputElement ? el : null
}

function startEdit(item: RegistryPrice) {
  if (!canEdit.value) return
  editingId.value = item.id
  editPrice.value = item.priceRub != null ? String(item.priceRub).replace('.', ',') : ''
  editSupplier.value = item.supplier ?? ''
  void nextTick(() => {
    priceInput?.focus()
    priceInput?.select()
  })
}

/**
 * Двойной щелчок в любом месте строки — правка цены и поставщика. Строка,
 * которая уже правится, не сбрасывается: двойной щелчок в поле ввода
 * выделяет слово и не должен терять набранное.
 */
function onRowDblClick(item: RegistryPrice) {
  if (!canEdit.value || editingId.value === item.id) return
  // Двойной щелчок выделяет слово в наименовании — снимаем выделение, фокус
  // уходит в поле цены.
  window.getSelection()?.removeAllRanges()
  startEdit(item)
}

function cancelEdit() {
  editingId.value = null
}

async function saveEdit(id: string) {
  // Цена разбирается тем же парсером, что поля ОЛ и расчёта: «1 207,8» и
  // «1200*1,2» — числа.
  const price = editPrice.value.trim() === '' ? undefined : tryEvalExpr(editPrice.value)
  if (price === null || (price !== undefined && price < 0)) {
    toast('Цена не разобралась — введите число', 'error')
    return
  }
  saving.value = true
  try {
    const updated = await pricesApi.patch(id, {
      priceRub: price,
      supplier: editSupplier.value.trim() || undefined,
    })
    const idx = items.value.findIndex((i) => i.id === id)
    if (idx !== -1) items.value[idx] = { ...items.value[idx], ...updated }
    editingId.value = null
    // Замечания к ценам (лист против м², цена без скидки) считает сервер —
    // перечитываем тихо, без экрана загрузки.
    void load({ silent: true })
  } catch (err) {
    toast(errorMessage(err, 'Не удалось сохранить цену'), 'error')
  } finally {
    saving.value = false
  }
}

// ── Импорт и экспорт ────────────────────────────────────────────────────────

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
    await Promise.all([load(), loadVersion()])
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

// ── Клавиатура ──────────────────────────────────────────────────────────────

const searchEl = ref<HTMLInputElement | null>(null)

/** «/» — к поиску, как в большинстве списков; в полях ввода не срабатывает. */
function onKey(e: KeyboardEvent) {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  e.preventDefault()
  searchEl.value?.focus()
}

onMounted(() => {
  readQuery()
  document.addEventListener('keydown', onKey)
  void load()
  void loadVersion()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  if (queryTimer) clearTimeout(queryTimer)
})
</script>

<style scoped>
/* ── Боковая панель: категории ── */
.pr-cats-h { display: flex; align-items: baseline; justify-content: space-between; padding-right: 8px; }
.pr-cats-all { background: transparent; border: none; color: var(--acc); font-size: 11.4px; text-transform: none; letter-spacing: 0; padding: 0; }
.pr-cats-all:hover { text-decoration: underline; }
.pr-cat {
  display: flex; align-items: center; gap: 7px; padding: 4px 8px; font-size: 13.2px; color: var(--tx2);
  cursor: pointer; user-select: none;
}
.pr-cat:hover { background: var(--bg3); color: var(--tx1); }
.pr-cat input { accent-color: var(--acc); margin: 0; flex-shrink: 0; }
.pr-cat-n { flex: 1; min-width: 0; line-height: 1.25; }
.pr-cat-c { font-size: 11.4px; color: var(--faint); font-variant-numeric: tabular-nums; }
.pr-cat.on { color: var(--acc); font-weight: 600; }
.pr-cat.on .pr-cat-c { color: var(--acc); }
.pr-cat.empty { opacity: .45; }

/* ── Шапка и панель фильтров ── */
.pr-ver { font-size: 12px; color: var(--faint); margin-left: 6px; }
.pr-count { font-size: 12px; color: var(--tx3); font-variant-numeric: tabular-nums; }
/* Предельная ширина рабочей колонки: таблица, панель фильтров и отчёт
 * импорта не растягиваются шире — строку прайса читают слева направо, от
 * наименования к цене, и глазу нельзя ехать через весь экран. */
.main-col { --pr-max: 1280px; }
.pr-toolbar { padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg1); flex-shrink: 0; }
.pr-toolbar-in { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; max-width: var(--pr-max); }
.pr-search-w { position: relative; flex: 1 1 320px; min-width: 220px; max-width: 560px; }
.pr-search { width: 100%; padding-right: 26px; }
.pr-search-x { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); background: transparent; border: none; color: var(--faint); font-size: 13.2px; padding: 2px 5px; }
.pr-search-x:hover { color: var(--text); }
.pr-tb-spacer { flex: 1; }
.chip-f { background: transparent; border: 1px solid var(--line2); color: var(--muted); font-size: 12.6px; padding: 3px 8px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.chip-f:hover { color: var(--text); }
.chip-red.on { border-color: var(--acc); color: var(--acc); background: var(--acc-bg); }
.chip-amber.on { border-color: var(--amber); color: var(--amber); background: var(--amber-bg); }

/* ── Отчёт импорта ── */
.pr-imp { margin: 8px 12px; border: 1px solid var(--line2); background: var(--panel); padding: 8px 10px; max-width: var(--pr-max); }
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

/* ── Таблица ── */
.pr-area { padding: 0 12px 24px; }
.pr-table { width: 100%; max-width: var(--pr-max); table-layout: fixed; border-collapse: collapse; font-size: 13.2px; }
.pr-col-unit { width: 64px; }
.pr-col-price { width: 132px; }
.pr-col-supplier { width: 220px; }
.pr-col-date { width: 96px; }
.pr-col-actions { width: 76px; }
.pr-table th {
  text-align: left; padding: 6px 10px; font-size: 10.8px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
  color: var(--tx3); background: var(--bg1); border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 2; white-space: nowrap;
}
.pr-th-sort { cursor: pointer; user-select: none; }
.pr-th-sort:hover { color: var(--text); }
.pr-table td { padding: 5px 10px; border-bottom: 1px solid var(--border); color: var(--tx2); vertical-align: middle; }
.pr-table tbody tr:not(.pr-grp):hover td { background: var(--bg3); }
.pr-grp td {
  font-size: 10.8px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--accent);
  padding: 12px 10px 4px; background: var(--bg); border-bottom: 1px solid var(--border);
}
.pr-grp-c { color: var(--faint); font-weight: 500; letter-spacing: 0; margin-left: 4px; }
.pr-row--edit td { background: var(--bg3); }
.pr-row--editable { cursor: default; }

.pr-name { line-height: 1.35; overflow-wrap: anywhere; }
.pr-issue { color: var(--amber); cursor: help; margin-left: 4px; }
.pr-comment { font-size: 11.4px; color: var(--faint); margin-top: 1px; }
.pr-unit { font-size: 11.4px; color: var(--tx3); white-space: nowrap; }
.pr-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.pr-price-val { cursor: pointer; font-size: 13.2px; font-weight: 600; color: var(--accent); }
.pr-price-val:hover { text-decoration: underline; }
.pr-price--none { color: var(--acc); font-weight: 500; font-size: 12px; }
.pr-price--ro { cursor: default; }
.pr-price--ro:hover { text-decoration: none; }
.pr-supplier { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-sup-val { cursor: pointer; }
.pr-sup-val:hover { text-decoration: underline; color: var(--tx1); }
.pr-date { font-size: 11.4px; color: var(--tx3); white-space: nowrap; font-variant-numeric: tabular-nums; }
.pr-actions { white-space: nowrap; text-align: right; }

.pr-inp { padding: 2px 5px; font-size: 13.2px; height: 24px; width: 100%; }
.pr-num .pr-inp { text-align: right; }
.pr-save-btn { padding: 2px 7px; font-size: 13.2px; height: 24px; min-width: 0; }
.pr-edit-btn {
  background: transparent; border: none; color: var(--tx3); font-size: 15.6px;
  cursor: pointer; padding: 2px 4px; transition: color .12s;
}
.pr-edit-btn:hover { color: var(--accent); }

.pr-more { display: flex; align-items: center; gap: 10px; padding: 12px 0; max-width: var(--pr-max); font-size: 12.6px; color: var(--faint); font-variant-numeric: tabular-nums; }

.nav-section { font-size: 10.8px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--tx3); padding: 10px 8px 4px; }

.dash-state    { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; opacity: .6; }
.dash-state-txt { font-size: 14.4px; color: var(--tx3); }
.dash-err      { color: var(--danger); }
</style>
