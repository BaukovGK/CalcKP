<template>
  <div class="tpl">
    <!-- ── Топбар ── -->
    <header class="tpl-top">
      <button class="btn" @click="router.push('/')">← Проекты</button>
      <div class="tpl-head">
        <div class="tpl-title">Шаблоны — справочники материализации</div>
        <div class="tpl-sub">
          Нормы и веса, из которых строятся расчёты. Правка действует на новые
          материализации; сохранённые деревья расчётов не меняются.
        </div>
      </div>
      <div class="tpl-spacer" />
      <ThemeToggle />
    </header>

    <!-- ── Вкладки ── -->
    <nav class="tpl-tabs">
      <button
        v-for="t in TABS"
        :key="t.k"
        class="tpl-tab"
        :class="{ on: tab === t.k }"
        @click="tab = t.k"
      >
        {{ t.label }} <span class="tpl-cnt">{{ countOf(t.k) }}</span>
      </button>
    </nav>

    <div v-if="loading" class="tpl-state">Загрузка справочников…</div>
    <div v-else-if="loadError" class="tpl-state tpl-state--err">{{ loadError }}</div>

    <main v-else class="tpl-body">
      <!-- ═══ Нормы патрубков ═══ -->
      <template v-if="tab === 'nozzles'">
        <p class="tpl-hint">
          Нормы простого патрубка = ƒ(DN) — источник массы формовки гильз и фланцев
          (Библиотека A5/A6). Ключ — DN.
        </p>
        <table class="tpl-tbl">
          <thead>
            <tr>
              <th>DN</th><th>Ø нар., мм</th><th>Мин. длина, мм</th>
              <th>Мф общая, кг *</th><th>h1, мм</th><th>s1, мм</th>
              <th>Мф фланца, кг</th><th>Болт</th><th>Кол-во болтов</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in nozzleRows" :key="r.dn">
              <td class="key">{{ r.dn }}</td>
              <td><input v-model="r.odMm" class="ti num" /></td>
              <td><input v-model="r.minLengthMm" class="ti num" /></td>
              <td><input v-model="r.moldingMassKg" class="ti num ti-req" /></td>
              <td><input v-model="r.h1Mm" class="ti num" /></td>
              <td><input v-model="r.s1Mm" class="ti num" /></td>
              <td><input v-model="r.flangeMassKg" class="ti num" /></td>
              <td><input v-model="r.bolt" class="ti" /></td>
              <td><input v-model="r.boltCount" class="ti num" /></td>
              <td class="acts">
                <button class="btn-mini" title="Сохранить строку" @click="saveNozzle(r)">💾</button>
                <button class="btn-mini btn-mini--del" title="Удалить норму" @click="removeNozzle(r.dn)">✕</button>
              </td>
            </tr>
            <!-- Новая норма -->
            <tr class="new-row">
              <td><input v-model="newNozzle.dn" class="ti num" placeholder="DN" /></td>
              <td><input v-model="newNozzle.odMm" class="ti num" /></td>
              <td><input v-model="newNozzle.minLengthMm" class="ti num" /></td>
              <td><input v-model="newNozzle.moldingMassKg" class="ti num ti-req" placeholder="кг" /></td>
              <td><input v-model="newNozzle.h1Mm" class="ti num" /></td>
              <td><input v-model="newNozzle.s1Mm" class="ti num" /></td>
              <td><input v-model="newNozzle.flangeMassKg" class="ti num" /></td>
              <td><input v-model="newNozzle.bolt" class="ti" /></td>
              <td><input v-model="newNozzle.boltCount" class="ti num" /></td>
              <td class="acts"><button class="btn-mini" title="Добавить" @click="addNozzle">＋</button></td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- ═══ Веса труб GRP ═══ -->
      <template v-else-if="tab === 'weights'">
        <p class="tpl-hint">
          Вес GRP-трубы = ƒ(DN; PN трубы; SN), кг/пм. ⚠ PN здесь — PN трубы
          (автоподбор), не PN опросного листа: домен {0,6; 1; 1,6}.
        </p>
        <div class="tpl-filter">
          <label>DN
            <select v-model="weightDnFilter" class="ti">
              <option value="">все</option>
              <option v-for="d in weightDns" :key="d" :value="String(d)">{{ d }}</option>
            </select>
          </label>
          <span class="tpl-filter-cnt">показано {{ shownWeights.length }} из {{ weightRows.length }}</span>
        </div>
        <table class="tpl-tbl tpl-tbl--narrow">
          <thead>
            <tr><th>DN</th><th>PN трубы</th><th>SN</th><th>Стенка, мм</th><th>кг/пм *</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="r in shownWeights" :key="`${r.dn}|${r.pn}|${r.sn}`">
              <td class="key">{{ r.dn }}</td>
              <td class="key">{{ fmtPn(r.pn) }}</td>
              <td class="key">{{ r.sn }}</td>
              <td><input v-model="r.wallMm" class="ti num" /></td>
              <td><input v-model="r.kgPerM" class="ti num ti-req" /></td>
              <td class="acts">
                <button class="btn-mini" title="Сохранить" @click="saveWeight(r)">💾</button>
                <button class="btn-mini btn-mini--del" title="Удалить" @click="removeWeight(r)">✕</button>
              </td>
            </tr>
            <tr class="new-row">
              <td><input v-model="newWeight.dn" class="ti num" placeholder="DN" /></td>
              <td><input v-model="newWeight.pn" class="ti num" placeholder="0,6" /></td>
              <td><input v-model="newWeight.sn" class="ti num" placeholder="SN" /></td>
              <td><input v-model="newWeight.wallMm" class="ti num" /></td>
              <td><input v-model="newWeight.kgPerM" class="ti num ti-req" placeholder="кг/пм" /></td>
              <td class="acts"><button class="btn-mini" title="Добавить" @click="addWeight">＋</button></td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- ═══ Матрицы: корпус / эллиптические днища ═══ -->
      <template v-else>
        <p class="tpl-hint">
          {{ tab === 'shell'
            ? 'Вес и толщина корпуса = ƒ(Dу, L) — лист «Для расчетов».'
            : 'Формовка эллиптических днищ = ƒ(Dн, L) — лист «Для расчетов». Источник будущей автоматизации масс ЕМК.' }}
        </p>
        <div class="tpl-filter">
          <label>D, мм
            <select v-model="matrixDFilter" class="ti">
              <option v-for="d in matrixDs" :key="d" :value="String(d)">{{ d }}</option>
            </select>
          </label>
          <span class="tpl-filter-cnt">{{ shownMatrix.length }} ячеек</span>
        </div>
        <table class="tpl-tbl tpl-tbl--narrow">
          <thead>
            <tr><th>L, мм</th><th>Масса, кг *</th><th>Толщина, мм</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="r in shownMatrix" :key="`${r.d}|${r.lengthMm}`">
              <td class="key">{{ fmtInt(r.lengthMm) }}</td>
              <td><input v-model="r.massKg" class="ti num ti-req" /></td>
              <td><input v-model="r.thicknessMm" class="ti num" /></td>
              <td class="acts"><button class="btn-mini" title="Сохранить" @click="saveMatrixCell(r)">💾</button></td>
            </tr>
            <tr class="new-row">
              <td><input v-model="newCell.lengthMm" class="ti num" placeholder="L, мм" /></td>
              <td><input v-model="newCell.massKg" class="ti num ti-req" placeholder="кг" /></td>
              <td><input v-model="newCell.thicknessMm" class="ti num" /></td>
              <td class="acts"><button class="btn-mini" title="Добавить ячейку" @click="addMatrixCell">＋</button></td>
            </tr>
          </tbody>
        </table>
      </template>
    </main>

    <ToastHost />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { toast } from '@/composables/useToast'
import { refsApi } from '@/api/refs'
import { templatesApi, type MatrixKind } from '@/api/templates'

/**
 * Редактор шаблонов (роль TECHNOLOG, ТЗ §2) — этап 1.
 *
 * Шаблон = формулы (в коде) × данные (в БД). Здесь правятся ДАННЫЕ: нормы
 * патрубков, веса труб, инженерные матрицы. Конфигуратор читает их при каждой
 * материализации, поэтому правка немедленно влияет на новые расчёты; уже
 * материализованные деревья не трогаются (самодостаточность расчёта, §9.1).
 */

const router = useRouter()

type Tab = 'nozzles' | 'weights' | 'shell' | 'bottom'
const TABS: Array<{ k: Tab; label: string }> = [
  { k: 'nozzles', label: 'Нормы патрубков' },
  { k: 'weights', label: 'Веса труб GRP' },
  { k: 'shell', label: 'Матрица корпуса' },
  { k: 'bottom', label: 'Эллиптические днища' },
]
const tab = ref<Tab>('nozzles')

const loading = ref(true)
const loadError = ref<string | null>(null)

// Числа держим строками (запятая как разделитель), конвертируем при сохранении.
const s = (v: number | null | undefined): string => (v == null ? '' : String(v).replace('.', ','))
const num = (v: string): number | null => {
  const t = v.trim().replace(/\s/g, '').replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
const fmtInt = (n: number) => n.toLocaleString('ru-RU')
const fmtPn = (n: number) => String(n).replace('.', ',')

// ── Нормы патрубков ────────────────────────────────────────────────────────

interface NozzleRow {
  dn: number
  odMm: string; minLengthMm: string; moldingMassKg: string
  h1Mm: string; s1Mm: string; flangeMassKg: string; bolt: string; boltCount: string
}
const nozzleRows = ref<NozzleRow[]>([])
const newNozzle = reactive({ dn: '', odMm: '', minLengthMm: '', moldingMassKg: '', h1Mm: '', s1Mm: '', flangeMassKg: '', bolt: '', boltCount: '' })

function nozzleDto(r: Omit<NozzleRow, 'dn'>) {
  const mass = num(r.moldingMassKg)
  if (mass == null || mass <= 0) return null
  return {
    odMm: num(r.odMm), minLengthMm: num(r.minLengthMm), moldingMassKg: mass,
    h1Mm: num(r.h1Mm), s1Mm: num(r.s1Mm), flangeMassKg: num(r.flangeMassKg),
    bolt: r.bolt.trim() || null, boltCount: num(r.boltCount),
  }
}

async function saveNozzle(r: NozzleRow) {
  const dto = nozzleDto(r)
  if (!dto) { toast('Мф общая — обязательное положительное число', 'error'); return }
  try {
    await templatesApi.upsertNozzleNorm(r.dn, dto)
    toast(`Норма DN${r.dn} сохранена`, 'success')
  } catch (e) { toast(e instanceof Error ? e.message : 'Не удалось сохранить', 'error') }
}

async function addNozzle() {
  const dn = num(newNozzle.dn)
  if (dn == null || dn <= 0 || !Number.isInteger(dn)) { toast('DN — целое положительное', 'error'); return }
  if (nozzleRows.value.some((r) => r.dn === dn)) { toast(`Норма DN${dn} уже есть — правьте её строку`, 'error'); return }
  const dto = nozzleDto(newNozzle)
  if (!dto) { toast('Мф общая — обязательное положительное число', 'error'); return }
  try {
    await templatesApi.upsertNozzleNorm(dn, dto)
    toast(`Норма DN${dn} добавлена`, 'success')
    Object.assign(newNozzle, { dn: '', odMm: '', minLengthMm: '', moldingMassKg: '', h1Mm: '', s1Mm: '', flangeMassKg: '', bolt: '', boltCount: '' })
    await reload()
  } catch (e) { toast(e instanceof Error ? e.message : 'Не удалось добавить', 'error') }
}

async function removeNozzle(dn: number) {
  try {
    await templatesApi.deleteNozzleNorm(dn)
    toast(`Норма DN${dn} удалена`, 'success')
    nozzleRows.value = nozzleRows.value.filter((r) => r.dn !== dn)
  } catch (e) { toast(e instanceof Error ? e.message : 'Не удалось удалить', 'error') }
}

// ── Веса труб GRP ──────────────────────────────────────────────────────────

interface WeightRow { dn: number; pn: number; sn: number; wallMm: string; kgPerM: string }
const weightRows = ref<WeightRow[]>([])
const weightDnFilter = ref('')
const newWeight = reactive({ dn: '', pn: '', sn: '', wallMm: '', kgPerM: '' })

const weightDns = computed(() => [...new Set(weightRows.value.map((r) => r.dn))].sort((a, b) => a - b))
const shownWeights = computed(() =>
  weightDnFilter.value === '' ? weightRows.value : weightRows.value.filter((r) => String(r.dn) === weightDnFilter.value),
)

async function saveWeight(r: WeightRow) {
  const kg = num(r.kgPerM)
  if (kg == null || kg <= 0) { toast('кг/пм — обязательное положительное число', 'error'); return }
  try {
    await templatesApi.upsertPipeWeight({ dn: r.dn, pn: r.pn, sn: r.sn, wallMm: num(r.wallMm), kgPerM: kg })
    toast(`Вес (${r.dn}; ${fmtPn(r.pn)}; ${r.sn}) сохранён`, 'success')
  } catch (e) { toast(e instanceof Error ? e.message : 'Не удалось сохранить', 'error') }
}

async function addWeight() {
  const dn = num(newWeight.dn); const pn = num(newWeight.pn); const sn = num(newWeight.sn); const kg = num(newWeight.kgPerM)
  if (dn == null || pn == null || sn == null) { toast('DN, PN и SN обязательны', 'error'); return }
  if (kg == null || kg <= 0) { toast('кг/пм — обязательное положительное число', 'error'); return }
  if (weightRows.value.some((r) => r.dn === dn && r.pn === pn && r.sn === sn)) {
    toast('Такая тройка (DN; PN; SN) уже есть — правьте её строку', 'error'); return
  }
  try {
    await templatesApi.upsertPipeWeight({ dn, pn, sn, wallMm: num(newWeight.wallMm), kgPerM: kg })
    toast(`Вес (${dn}; ${fmtPn(pn)}; ${sn}) добавлен`, 'success')
    Object.assign(newWeight, { dn: '', pn: '', sn: '', wallMm: '', kgPerM: '' })
    await reload()
  } catch (e) { toast(e instanceof Error ? e.message : 'Не удалось добавить', 'error') }
}

async function removeWeight(r: WeightRow) {
  try {
    await templatesApi.deletePipeWeight(r.dn, r.pn, r.sn)
    toast(`Вес (${r.dn}; ${fmtPn(r.pn)}; ${r.sn}) удалён`, 'success')
    weightRows.value = weightRows.value.filter((x) => x !== r)
  } catch (e) { toast(e instanceof Error ? e.message : 'Не удалось удалить', 'error') }
}

// ── Инженерные матрицы ─────────────────────────────────────────────────────

interface MatrixRow { d: number; lengthMm: number; massKg: string; thicknessMm: string }
const shellRows = ref<MatrixRow[]>([])
const bottomRows = ref<MatrixRow[]>([])
const matrixDFilter = ref('')
const newCell = reactive({ lengthMm: '', massKg: '', thicknessMm: '' })

const activeMatrix = computed(() => (tab.value === 'shell' ? shellRows : bottomRows))
const activeKind = computed<MatrixKind>(() => (tab.value === 'shell' ? 'SHELL' : 'ELLIPTIC_BOTTOM'))
const matrixDs = computed(() => [...new Set(activeMatrix.value.value.map((r) => r.d))].sort((a, b) => a - b))
const shownMatrix = computed(() => {
  const d = matrixDFilter.value || String(matrixDs.value[0] ?? '')
  return activeMatrix.value.value.filter((r) => String(r.d) === d)
})

async function saveMatrixCell(r: MatrixRow) {
  const mass = num(r.massKg)
  if (mass == null || mass <= 0) { toast('Масса — обязательное положительное число', 'error'); return }
  try {
    await templatesApi.upsertMatrixCell({ kind: activeKind.value, d: r.d, lengthMm: r.lengthMm, massKg: mass, thicknessMm: num(r.thicknessMm) })
    toast(`Ячейка D${r.d} × L${fmtInt(r.lengthMm)} сохранена`, 'success')
  } catch (e) { toast(e instanceof Error ? e.message : 'Не удалось сохранить', 'error') }
}

async function addMatrixCell() {
  const d = num(matrixDFilter.value || String(matrixDs.value[0] ?? ''))
  const lengthMm = num(newCell.lengthMm)
  const mass = num(newCell.massKg)
  if (d == null) { toast('Выберите D', 'error'); return }
  if (lengthMm == null || lengthMm <= 0) { toast('L — обязательное положительное число', 'error'); return }
  if (mass == null || mass <= 0) { toast('Масса — обязательное положительное число', 'error'); return }
  try {
    await templatesApi.upsertMatrixCell({ kind: activeKind.value, d, lengthMm, massKg: mass, thicknessMm: num(newCell.thicknessMm) })
    toast(`Ячейка D${d} × L${fmtInt(lengthMm)} добавлена`, 'success')
    Object.assign(newCell, { lengthMm: '', massKg: '', thicknessMm: '' })
    await reload()
  } catch (e) { toast(e instanceof Error ? e.message : 'Не удалось добавить', 'error') }
}

// ── Загрузка ───────────────────────────────────────────────────────────────

function countOf(t: Tab): number {
  switch (t) {
    case 'nozzles': return nozzleRows.value.length
    case 'weights': return weightRows.value.length
    case 'shell': return shellRows.value.length
    case 'bottom': return bottomRows.value.length
  }
}

async function reload() {
  const [eng, weights] = await Promise.all([refsApi.engineering(), refsApi.pipeWeights()])
  nozzleRows.value = eng.nozzles.map((n) => ({
    dn: n.dn, odMm: s(n.odMm), minLengthMm: s(n.minLengthMm), moldingMassKg: s(n.moldingMassKg),
    h1Mm: s(n.h1Mm), s1Mm: s(n.s1Mm), flangeMassKg: s(n.flangeMassKg), bolt: n.bolt ?? '', boltCount: s(n.boltCount),
  }))
  weightRows.value = weights.grp.map((w) => ({ dn: w.dn, pn: w.pn, sn: w.sn, wallMm: s(w.wallMm), kgPerM: s(w.kgPerM) }))
  shellRows.value = eng.shell.map((c) => ({ d: c.d, lengthMm: c.lengthMm, massKg: s(c.massKg), thicknessMm: s(c.thicknessMm) }))
  bottomRows.value = eng.ellipticBottom.map((c) => ({ d: c.d, lengthMm: c.lengthMm, massKg: s(c.massKg), thicknessMm: s(c.thicknessMm) }))
}

onMounted(async () => {
  try {
    await reload()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Не удалось загрузить справочники'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.tpl { display: flex; flex-direction: column; height: 100vh; background: var(--bg); color: var(--text); }

.tpl-top { display: flex; align-items: center; gap: 12px; padding: 8px 14px;
  border-bottom: 2px solid var(--line); background: var(--panel); flex: none; }
.tpl-title { font-size: 14px; font-weight: 700; }
.tpl-sub { font-size: 10.5px; color: var(--muted); }
.tpl-spacer { flex: 1; }

.tpl-tabs { display: flex; gap: 4px; padding: 6px 14px; border-bottom: 1px solid var(--line);
  background: var(--panel); flex: none; }
.tpl-tab { background: transparent; border: 1px solid var(--line2); color: var(--muted);
  font-size: 11.5px; padding: 4px 10px; cursor: pointer; }
.tpl-tab:hover { color: var(--text); }
.tpl-tab.on { border-color: var(--acc); color: var(--text); background: var(--acc-bg); }
.tpl-cnt { font-size: 9.5px; color: var(--faint); }

.tpl-state { padding: 24px; font-size: 12px; color: var(--muted); }
.tpl-state--err { color: var(--acc); }

.tpl-body { flex: 1; overflow-y: auto; padding: 12px 14px; }
.tpl-hint { font-size: 11px; color: var(--muted); margin-bottom: 10px; max-width: 760px; line-height: 1.5; }

.tpl-filter { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; font-size: 11.5px; color: var(--muted); }
.tpl-filter label { display: flex; align-items: center; gap: 6px; }
.tpl-filter-cnt { font-size: 10.5px; color: var(--faint); }

.tpl-tbl { border-collapse: collapse; font-size: 12px; width: 100%; max-width: 1100px; }
.tpl-tbl--narrow { max-width: 620px; }
.tpl-tbl th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em;
  color: var(--faint); padding: 4px 6px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.tpl-tbl td { padding: 2px 4px; border-bottom: 1px solid var(--line); }
.tpl-tbl td.key { font-weight: 600; padding: 2px 8px; white-space: nowrap; }
.tpl-tbl .acts { white-space: nowrap; }

.ti { width: 100%; min-width: 52px; background: var(--cellbg); border: 1px solid var(--line2);
  color: var(--text); padding: 3px 6px; font-size: 12px; font-family: inherit; }
.ti.num { text-align: right; font-variant-numeric: tabular-nums; }
.ti-req { border-color: var(--line2); }
.ti-req:invalid, .ti-req:placeholder-shown { border-color: var(--amber); }

.new-row td { background: var(--panel2); }

.btn { background: transparent; border: 1px solid var(--line2); color: var(--muted);
  font-size: 11.5px; padding: 4px 10px; cursor: pointer; }
.btn:hover { color: var(--text); }
.btn-mini { background: transparent; border: 1px solid var(--line2); color: var(--muted);
  font-size: 11px; padding: 2px 6px; cursor: pointer; }
.btn-mini:hover { color: var(--text); border-color: var(--acc); }
.btn-mini--del:hover { color: var(--acc); border-color: var(--acc); }
</style>
