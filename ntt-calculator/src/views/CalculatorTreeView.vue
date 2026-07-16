<template>
  <div class="cw">
    <!-- ── Топбар ── -->
    <header class="tb">
      <div class="tb-l">
        <span class="tb-t">Расчёт: {{ st.estimate?.title ?? '—' }}</span>
        <RouterLink class="tb-lnk" :to="{ name: 'survey-kns' }">← Опросный лист</RouterLink>
        <span class="badge">{{ st.estimate?.status ?? 'DRAFT' }}</span>
      </div>
      <div class="tb-r">
        <button class="tb-prob" :class="{ on: filters.problems }" :title="'показать только проблемные строки'" @click="toggleProblems">
          ● {{ st.missingPriceIds.size }} без цены · ⚠ {{ st.conflictIds.size }} конфликт
        </button>
        <span class="tb-pl">НН v{{ st.tree?.priceListVersion ?? 1 }}</span>
        <button class="btn" :disabled="saving" @click="onSave">{{ saving ? 'Сохраняем…' : 'Сохранить' }}</button>
        <button class="btn btn-acc" :disabled="kpBusy" @click="onKp">Сформировать КП</button>
        <button class="btn" :title="'Переключить тему'" @click="toggle">{{ theme === 'dark' ? '☾' : '☀' }}</button>
      </div>
    </header>

    <!-- ── Фильтры ── -->
    <div class="fl">
      <input v-model="filters.q" class="fl-q" placeholder="поиск по наименованию" />
      <button class="chip-f chip-red" :class="{ on: filters.missing }" @click="filters.missing = !filters.missing">
        ● без цены · {{ st.missingPriceIds.size }}
      </button>
      <button class="chip-f chip-amber" :class="{ on: filters.conflict }" @click="filters.conflict = !filters.conflict">
        ⚠ конфликты · {{ st.conflictIds.size }}
      </button>
      <button class="chip-f chip-blue" :class="{ on: filters.override }" @click="filters.override = !filters.override">
        override · {{ st.overrideIds.size }}
      </button>
      <button v-if="anyFilter" class="fl-clear" @click="clearFilters">сбросить ✕</button>
      <label class="fl-chk"><input v-model="filters.ghosts" type="checkbox" /><span>выключенные</span></label>
      <span class="fl-cnt">показано {{ shownCount }} из {{ st.rows.length }}</span>
    </div>

    <div v-if="st.loading" class="state">Загрузка расчёта…</div>
    <div v-else-if="st.error" class="state state-err">{{ st.error }}</div>

    <div v-else class="body">
      <!-- ── Дерево сборок ── -->
      <nav class="tree">
        <div
          v-for="sec in st.tree?.sections ?? []"
          :key="sec.code"
          class="tr-s"
          :class="{ active: activeSec === sec.code, off: !sec.enabled }"
        >
          <label class="tr-chk" @click.stop>
            <input :checked="sec.enabled" type="checkbox" @change="st.toggleSection(sec.code)" />
          </label>
          <button class="tr-n" @click="goSection(sec.code)">
            <span class="tr-t">{{ sec.code }} {{ sec.title }}</span>
            <span class="tr-sum" :class="{ struck: !sec.enabled }">{{ sectionSum(sec.code) }}</span>
          </button>
          <span v-if="secProblems(sec.code).red" class="bdg bdg-red">● {{ secProblems(sec.code).red }}</span>
          <span v-if="secProblems(sec.code).amber" class="bdg bdg-amber">⚠ {{ secProblems(sec.code).amber }}</span>
        </div>
      </nav>

      <!-- ── Таблица ── -->
      <main ref="tableEl" class="tbl" @scroll="onScroll">
        <div class="th">
          <div>Категория</div><div>Наименование</div><div class="num">Кол-во</div><div>ЕИ</div>
          <div class="num">Цена, ₽</div><div class="num">Сумма, ₽</div><div>Примечание</div>
        </div>

        <template v-for="sec in visibleSections" :key="sec.code">
          <div :id="`grp-${sec.code}`" class="gh" :class="{ off: !sec.enabled }">
            {{ sec.code }} · {{ sec.title }}
            <span class="gh-sum">{{ sectionSum(sec.code) }}</span>
          </div>

          <template v-for="c in sec.components" :key="c.id">
            <div v-if="visibleRows(c).length" class="ch">
              └ {{ c.title }}
              <span class="ch-sum">{{ componentSum(c) }}</span>
            </div>
            <CalcTableRow
              v-for="row in visibleRows(c)"
              :key="row.id"
              :row="row"
              :res="st.results.get(row.id)!"
              :conflict="st.conflictIds.has(row.id)"
              :prev-calc="prevCalcOf(row.id)"
              :fot-k="st.fotKOf(row)"
              :disabled="!sec.enabled || !c.enabled"
              @qty="st.setQtyManual"
              @price="st.setPriceManual"
              @reset-qty="st.resetQty"
              @reset-price="st.resetPrice"
              @keep="st.keepOverride"
              @drop="st.dropOverride"
              @nav="onNav"
            />
          </template>

          <div v-if="!sec.components.length" class="empty">
            Раздел без строк — состав сильно варьирует между заказами, строки добавляются вручную
          </div>
        </template>
      </main>

      <!-- ── Панель итогов ── -->
      <aside class="tot">
        <div class="tot-h">Итоги</div>

        <div v-for="b in buckets" :key="b.k" class="tot-r">
          <span>{{ b.k }}</span><span class="num">{{ fmtInt(b.v) }}</span>
        </div>

        <div class="tot-r tot-cost">
          <span>Себестоимость</span><span class="num">{{ fmtInt(e.costRub) }}</span>
        </div>

        <div class="tot-r">
          <span>Наценка ✎</span>
          <input v-model="markupText" class="tot-in num" @change="onMarkup" />
        </div>

        <div class="tot-r tot-price">
          <span>ЦЕНА ПРОДАЖИ</span><span class="num">{{ fmtInt(e.salePriceRub) }}</span>
        </div>

        <div class="tot-r">
          <span>Рентабельность</span>
          <span class="num" :style="{ color: rentColor }">{{ rentText }}</span>
        </div>

        <div class="tot-r">
          <span>Корпусов</span>
          <input v-model="tirageText" class="tot-in num" @change="onTirage" />
        </div>
        <div v-if="st.tirage >= 2" class="tot-r tot-n">
          <span>за {{ st.tirage }} корп.</span><span class="num">{{ fmtInt(e.salePriceRub) }}</span>
        </div>

        <!-- Разложение «Прочих»: прототип его не показывает, но без него
             непонятно, откуда берётся сумма (§9.5). -->
        <details class="tot-d">
          <summary>Прочие — из чего</summary>
          <div class="tot-r tot-s"><span>ПЗР ({{ fmt(e.pzrHours) }} чел.ч)</span><span class="num">{{ fmtInt(e.pzrRub) }}</span></div>
          <div class="tot-r tot-s"><span>Ацетон ({{ fmt(e.acetoneKg) }} кг)</span><span class="num">{{ fmtInt(e.acetoneRub) }}</span></div>
          <div class="tot-r tot-s"><span>СИЗ ({{ fmtInt(e.ppeUnits) }} ед.)</span><span class="num">{{ fmtInt(e.ppeRub) }}</span></div>
          <div class="tot-r tot-s"><span>Накладные ({{ fmt(e.overheadHours) }} чел.ч)</span><span class="num">{{ fmtInt(e.overheadRub) }}</span></div>
          <div class="tot-note">ПЗР входит в «Работы, ФОТ», а не в «Прочие»</div>
        </details>

        <div class="tot-legend">Enter — применить · ↑↓ по строкам · ←→ кол-во ⇄ цена · Esc — отмена</div>
      </aside>
    </div>

    <ToastHost />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import CalcTableRow from '@/components/calculator/CalcTableRow.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { useCalcTreeStore } from '@/stores/calcTree'
import { useTheme } from '@/composables/useTheme'
import { toast } from '@/composables/useToast'
import { COST_BUCKETS } from '@/engines/economics'
import { tryEvalExpr } from '@/engines/expr'
import type { CalcComponent, CalcRowNode } from '@/engines/template-kns'
import { api } from '@/api/client'

const route = useRoute()
const st = useCalcTreeStore()
const { theme, toggle } = useTheme()

const saving = ref(false)
const kpBusy = ref(false)
const activeSec = ref('1')
const tableEl = ref<HTMLElement | null>(null)

const filters = reactive({ q: '', missing: false, conflict: false, override: false, ghosts: false, problems: false })

const markupText = ref('0,43')
const tirageText = ref('1')

const e = computed(() => st.economics)

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
const fmtInt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })

const buckets = computed(() => COST_BUCKETS.map((k) => ({ k, v: e.value.buckets[k] })))

const rentText = computed(() => `${(e.value.profitability * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`)
const rentColor = computed(() => {
  const p = e.value.profitability * 100
  return p >= 25 ? 'var(--green)' : p >= 15 ? 'var(--amber)' : 'var(--acc)'
})

const anyFilter = computed(() => filters.q !== '' || filters.missing || filters.conflict || filters.override)

function clearFilters() {
  filters.q = ''
  filters.missing = filters.conflict = filters.override = filters.problems = false
}
function toggleProblems() {
  filters.problems = !filters.problems
  filters.missing = filters.conflict = filters.problems
}

/** Фильтрация строк компонента — единое правило для таблицы и счётчика. */
function visibleRows(c: CalcComponent): CalcRowNode[] {
  return c.rows.filter((r) => {
    const res = st.results.get(r.id)
    if (!res) return false
    if (!filters.ghosts && res.qty === 0 && !st.enabledFor(r)) return false
    if (filters.q && !r.name.toLowerCase().includes(filters.q.toLowerCase())) return false

    const chips = filters.missing || filters.conflict || filters.override
    if (!chips) return true
    return (
      (filters.missing && st.missingPriceIds.has(r.id)) ||
      (filters.conflict && st.conflictIds.has(r.id)) ||
      (filters.override && st.overrideIds.has(r.id))
    )
  })
}

const visibleSections = computed(() => st.tree?.sections ?? [])
const shownCount = computed(() =>
  visibleSections.value.reduce((s, sec) => s + sec.components.reduce((n, c) => n + visibleRows(c).length, 0), 0),
)

function sumOf(rows: CalcRowNode[]): number {
  return rows.reduce((s, r) => s + (st.results.get(r.id)?.sum ?? 0), 0)
}
function sectionSum(code: string): string {
  const sec = st.tree?.sections.find((s) => s.code === code)
  if (!sec) return '—'
  const v = sumOf(sec.components.flatMap((c) => c.rows))
  return v >= 1e6 ? `${(v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млн` : fmtInt(v)
}
function componentSum(c: CalcComponent): string {
  return fmtInt(sumOf(c.rows))
}

function secProblems(code: string) {
  const sec = st.tree?.sections.find((s) => s.code === code)
  if (!sec) return { red: 0, amber: 0 }
  const ids = sec.components.flatMap((c) => c.rows.map((r) => r.id))
  return {
    red: ids.filter((id) => st.missingPriceIds.has(id)).length,
    amber: ids.filter((id) => st.conflictIds.has(id)).length,
  }
}

const prevCalcOf = (id: string): number | null => {
  const r = st.rows.find((x) => x.id === id)
  return r?.qtyCalc ?? null
}

function goSection(code: string) {
  activeSec.value = code
  document.getElementById(`grp-${code}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Scrollspy: активна группа, ближайшая к верху таблицы. */
function onScroll() {
  const el = tableEl.value
  if (!el) return
  const top = el.getBoundingClientRect().top
  for (const sec of visibleSections.value) {
    const n = document.getElementById(`grp-${sec.code}`)
    if (n && n.getBoundingClientRect().top - top <= 40) activeSec.value = sec.code
  }
}

/** Клавиатура: Enter — вниз, ↑↓ по строкам, ←→ кол-во ⇄ цена, Esc — отмена. */
function onNav(ev: KeyboardEvent, _id: string, col: 'qty' | 'price') {
  const cells = [...(tableEl.value?.querySelectorAll<HTMLInputElement>('.cell') ?? [])]
  const i = cells.indexOf(ev.target as HTMLInputElement)
  if (i < 0) return
  const step = 2 // в строке две ячейки: кол-во и цена
  const go = (j: number) => { cells[j]?.focus(); ev.preventDefault() }

  if (ev.key === 'Enter' || ev.key === 'ArrowDown') go(i + step)
  else if (ev.key === 'ArrowUp') go(i - step)
  else if (ev.key === 'ArrowRight' && col === 'qty') go(i + 1)
  else if (ev.key === 'ArrowLeft' && col === 'price') go(i - 1)
  else if (ev.key === 'Escape') (ev.target as HTMLInputElement).blur()
}

function onMarkup() {
  const v = tryEvalExpr(markupText.value)
  if (v == null || v < 0) { toast('Наценка должна быть числом ≥ 0', 'error'); markupText.value = String(st.markup).replace('.', ','); return }
  st.markup = v
}
function onTirage() {
  const v = tryEvalExpr(tirageText.value)
  if (v == null || v < 1) { toast('Корпусов — целое число ≥ 1', 'error'); tirageText.value = String(st.tirage); return }
  st.tirage = Math.floor(v)
  tirageText.value = String(st.tirage)
}

async function onSave() {
  saving.value = true
  try {
    await st.save()
    toast('Расчёт сохранён', 'success')
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Не удалось сохранить', 'error')
  } finally {
    saving.value = false
  }
}

/**
 * Выпуск КП — точка фиксации процесса (ТЗ §4.3 v1.5): гейт по красным строкам
 * и снапшот делает бэк. Печатная форма — заглушка, ждём образец.
 */
async function onKp() {
  if (!st.estimate) return
  kpBusy.value = true
  try {
    await st.save()
    const { data } = await api.post(`/estimates/${st.estimate.id}/kp`)
    toast(`КП сформировано · снапшот v${data.snapshot.version} (прайс v${data.snapshot.priceListVersion})`, 'success')
  } catch (err) {
    const r = (err as { response?: { data?: { code?: string; count?: number; message?: string } } }).response
    if (r?.data?.code === 'ROWS_WITHOUT_PRICE') {
      toast(r.data.message ?? 'Есть строки без цены', 'error')
      filters.missing = true // сразу показываем, что чинить
    } else {
      toast(r?.data?.message ?? 'Не удалось сформировать КП', 'error')
    }
  } finally {
    kpBusy.value = false
  }
}

watch(() => st.markup, (v) => { markupText.value = String(v).replace('.', ',') }, { immediate: true })

onMounted(() => {
  const id = route.params.id
  if (typeof id === 'string' && id) void st.load(id)
})
</script>

<style scoped>
.cw { display: flex; flex-direction: column; height: 100vh; background: var(--bg); color: var(--text); }

.tb { display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 7px 12px; border-bottom: 2px solid var(--line); background: var(--panel); flex: none; }
.tb-l { display: flex; align-items: center; gap: 12px; min-width: 0; }
.tb-t { font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-lnk { font-size: 11px; color: var(--muted); text-decoration: none; }
.tb-lnk:hover { color: var(--text); }
.badge { font-size: 9.5px; border: 1px solid var(--line2); color: var(--muted); padding: 1px 6px; }
.tb-r { display: flex; align-items: center; gap: 7px; flex: none; }
.tb-prob { background: transparent; border: 1px solid var(--line2); color: var(--muted); font-size: 11px; padding: 4px 9px; }
.tb-prob.on { border-color: var(--amber); color: var(--amber); }
.tb-pl { font-size: 10.5px; color: var(--faint); }
.btn { background: transparent; border: 1px solid var(--line2); color: var(--muted); font-size: 11.5px; padding: 4px 10px; }
.btn:hover:not(:disabled) { color: var(--text); }
.btn:disabled { opacity: .4; }
.btn-acc { border-color: var(--acc); color: var(--acc); }

.fl { display: flex; align-items: center; gap: 8px; padding: 6px 12px;
  border-bottom: 1px solid var(--line); background: var(--panel); flex: none; }
.fl-q { width: 200px; background: var(--cellbg); border: 1px solid var(--line2); color: var(--text); padding: 4px 8px; font-size: 11.5px; font-family: inherit; }
.chip-f { background: transparent; border: 1px solid var(--line2); color: var(--muted); font-size: 10.5px; padding: 3px 8px; }
.chip-red.on { border-color: var(--acc); color: var(--acc); background: var(--acc-bg); }
.chip-amber.on { border-color: var(--amber); color: var(--amber); background: var(--amber-bg); }
.chip-blue.on { border-color: var(--blue); color: var(--blue); background: var(--blue-bg); }
.fl-clear { background: transparent; border: none; color: var(--blue); font-size: 11px; text-decoration: underline; }
.fl-chk { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--muted); }
.fl-cnt { margin-left: auto; font-size: 10.5px; color: var(--faint); }

.state { padding: 24px; color: var(--muted); font-size: 12px; }
.state-err { color: var(--acc); }

.body { flex: 1; display: flex; min-height: 0; }

/* Дерево сборок */
.tree { width: 224px; flex: none; border-right: 1px solid var(--line); background: var(--panel); overflow-y: auto; padding: 6px 0; }
.tr-s { display: flex; align-items: center; gap: 4px; padding: 0 8px 0 0; border-left: 3px solid transparent; }
.tr-s.active { border-left-color: var(--acc); background: var(--panel2); }
.tr-s.off { opacity: .5; }
.tr-chk { padding: 0 4px 0 6px; display: flex; }
.tr-n { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  background: transparent; border: none; color: inherit; text-align: left; padding: 6px 2px; }
.tr-t { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.tr-sum { font-size: 10px; color: var(--muted); }
.tr-sum.struck { text-decoration: line-through; }
.bdg { font-size: 9px; padding: 0 4px; white-space: nowrap; }
.bdg-red { color: var(--acc); }
.bdg-amber { color: var(--amber); }

/* Таблица */
.tbl { flex: 1; overflow: auto; min-width: 0; }
.th, .gh, .ch { display: grid; grid-template-columns: 104px minmax(180px, 1fr) 96px 52px 96px 100px 168px; gap: 8px; padding: 0 8px; }
.th { position: sticky; top: 0; z-index: 3; height: 25px; align-items: center;
  background: var(--panel2); border-bottom: 1px solid var(--line2);
  font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); }
.th .num { text-align: right; }
.gh { position: sticky; top: 25px; z-index: 2; height: 26px; align-items: center;
  background: var(--panel); border-bottom: 1px solid var(--line2);
  font-size: 11px; font-weight: 700; grid-template-columns: 1fr auto; }
.gh.off { opacity: .5; }
.gh-sum { font-size: 10.5px; font-weight: 400; color: var(--muted); }
.ch { grid-template-columns: 1fr auto; height: 22px; align-items: center; font-size: 10.5px; color: var(--muted); background: var(--cellbg); }
.ch-sum { font-size: 10px; color: var(--faint); }
.empty { padding: 10px 14px; font-size: 11px; color: var(--faint); font-style: italic; }

/* Итоги */
.tot { width: 264px; flex: none; border-left: 2px solid var(--line); background: var(--panel);
  padding: 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 5px; }
.tot-h { font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); }
.tot-r { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11.5px; }
.tot-r > span:first-child { color: var(--muted); }
.tot-cost { border-top: 2px solid var(--line2); padding-top: 5px; margin-top: 3px; font-weight: 700; }
.tot-cost > span:first-child { color: var(--text); }
.tot-price { font-size: 15px; font-weight: 700; }
.tot-price > span:first-child { color: var(--text); }
.tot-n { color: var(--muted); }
.tot-in { width: 62px; text-align: right; background: var(--cellbg); border: 1px solid var(--line2);
  color: var(--text); padding: 2px 6px; font-size: 12px; font-family: inherit; }
.tot-d { margin-top: 4px; border-top: 1px solid var(--line); padding-top: 5px; }
.tot-d summary { font-size: 10.5px; color: var(--faint); cursor: pointer; }
.tot-s { font-size: 10.5px; margin-top: 3px; }
.tot-note { font-size: 9.5px; color: var(--faint); margin-top: 4px; }
.tot-legend { margin-top: auto; font-size: 9.5px; color: var(--faint); line-height: 1.5; }

@media (max-width: 1100px) { .tree { display: none; } }
</style>
