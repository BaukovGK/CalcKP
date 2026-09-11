<template>
  <div ref="root" class="ne">
    <!-- ── Список узлов ── -->
    <aside class="ne-list">
      <div class="ne-new">
        <input v-model="newCode" class="ti" placeholder="код, напр. B5" aria-label="Код нового узла" @keydown.enter="createNode" />
        <button v-hint="TEMPLATE_HINTS.code" class="btn" :disabled="busy" @click="createNode">+ Узел</button>
      </div>
      <div class="ne-filter">
        <select v-model="tagFilter" class="ti" aria-label="Рубрика">
          <option value="">все рубрики</option>
          <option v-for="t in NODE_TAGS" :key="t" :value="t">{{ t }}</option>
        </select>
        <label class="ne-chk"><input v-model="showArchived" type="checkbox" /> архив</label>
      </div>
      <button
        v-for="n in shownNodes"
        :key="n.code"
        class="ne-item"
        :class="{ on: n.code === selected, off: n.archived }"
        @click="select(n.code)"
      >
        <span class="ne-code">{{ n.code }}</span>
        <span class="ne-name">{{ bodyOf(n).name || '(без названия)' }}</span>
        <span class="ne-state">{{ stateText(n) }}<span v-if="dirtyOf(n.code)" class="ne-dot">●</span></span>
      </button>
      <div v-if="!shownNodes.length" class="ne-empty">
        Своих узлов пока нет. Узел — строки с формулами от параметров: площадка, нестандартная обвязка, типовой комплект.
      </div>
    </aside>

    <!-- ── Редактор узла ── -->
    <section v-if="current && work" class="ne-ed">
      <div class="ne-top">
        <span class="ne-title">{{ current.code }} · {{ work.name || 'новый узел' }}</span>
        <span class="ne-muted">{{ statusText }}</span>
        <div class="ne-spacer" />
        <button class="btn" :disabled="busy || !dirty" @click="saveDraft">Сохранить черновик</button>
        <button v-hint="discardHint" class="btn" :disabled="busy || (!current.draft && !dirty)" @click="discardDraft">Отменить черновик</button>
        <button v-hint="TEMPLATE_HINTS.archive" class="btn" :disabled="busy || current.activeVersion == null" @click="toggleArchive">{{ current.archived ? 'Вернуть из архива' : 'В архив' }}</button>
        <button v-hint="TEMPLATE_HINTS.publish" class="btn btn-acc" :disabled="busy || blocking || (!current.draft && !dirty)" @click="publishOpen = true">Опубликовать…</button>
      </div>
      <div v-if="usedIn.length" v-hint="TEMPLATE_HINTS.usedIn" class="ne-used">Стоит в шаблонах: {{ usedIn.join(', ') }}</div>

      <div class="ne-head">
        <label><span v-hint="TEMPLATE_HINTS.code">Код</span><input :value="work.code" class="ti" disabled /></label>
        <label><span v-hint="TEMPLATE_HINTS.tag">Рубрика</span>
          <select v-model="work.tag" class="ti"><option v-for="t in NODE_TAGS" :key="t" :value="t">{{ t }}</option></select>
        </label>
        <label class="wide" :class="{ bad: issueAt('name') }"><span v-hint="TEMPLATE_HINTS.nodeName">Название</span><input v-model="work.name" class="ti" placeholder="Площадка обслуживания Ø{d}" /></label>
        <label class="wide" :class="{ bad: issueAt('enabledBy') }"><span v-hint="TEMPLATE_HINTS.enabledBy">Включается, если</span><input v-model="work.enabledBy" class="ti fx" placeholder="пусто — всегда" /></label>
        <label class="full"><span>Описание</span><input v-model="work.description" class="ti" placeholder="что это за узел и когда он нужен" /></label>
      </div>
      <div v-for="p in ['name', 'enabledBy']" :key="p" class="ne-err">{{ issueAt(p) }}</div>

      <!-- Параметры -->
      <div class="ne-block">
        <div class="ne-bh"><span v-hint="TEMPLATE_HINTS.params">Параметры</span><button class="btn-mini" @click="addParam">+ параметр</button></div>
        <table v-if="work.params.length" class="ne-tbl">
          <thead><tr><th>Имя</th><th>Подпись</th><th>Тип</th><th>По умолчанию</th><th>ЕИ</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(p, i) in work.params" :key="i" :class="{ bad: paramBad(i) }">
              <td><input v-model="p.key" class="ti fx" placeholder="d" /></td>
              <td><input v-model="p.label" class="ti" placeholder="DN корпуса" /></td>
              <td>
                <select :value="p.type" class="ti" @change="setParamType(p, ($event.target as HTMLSelectElement).value as NodeParamType)">
                  <option value="number">число</option><option value="bool">да/нет</option><option value="text">текст</option>
                </select>
              </td>
              <td>
                <input v-if="p.type === 'bool'" type="checkbox" :checked="p.default === true" @change="p.default = ($event.target as HTMLInputElement).checked" />
                <input v-else class="ti" :class="{ num: p.type === 'number' }" :value="defaultInput(p)" @change="setDefault(p, ($event.target as HTMLInputElement).value)" />
              </td>
              <td><input v-model="p.unit" class="ti" placeholder="мм" /></td>
              <td class="acts"><button v-hint="'Убрать параметр'" class="btn-mini btn-mini--del" aria-label="Убрать параметр" @click="work.params.splice(i, 1)">✕</button></td>
            </tr>
          </tbody>
        </table>
        <div v-for="(m, i) in paramErrors" :key="i" class="ne-err">{{ m }}</div>
      </div>

      <!-- Строки -->
      <div class="ne-block">
        <div class="ne-bh"><span v-hint="TEMPLATE_HINTS.rows">Строки</span><button class="btn-mini" @click="addRow">+ строка</button></div>
        <table class="ne-tbl ne-rows">
          <thead>
            <tr>
              <th>Тип</th><th>Категория</th><th>Наименование</th><th>ЕИ</th>
              <th><span v-hint="TEMPLATE_HINTS.qty">Количество</span></th>
              <th><span v-hint="TEMPLATE_HINTS.fotK">k ФОТ</span></th>
              <th><span v-hint="TEMPLATE_HINTS.when">Условие</span></th>
              <th><span v-hint="TEMPLATE_HINTS.rowNote">Примечание</span></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(r, i) in work.rows" :key="i">
              <tr :class="{ bad: rowBad(i) }">
                <td>
                  <select v-model="r.kind" class="ti"><option value="МАТЕРИАЛ">материал</option><option value="ОПЕРАЦИЯ">операция</option></select>
                </td>
                <td>
                  <select v-model="r.category" class="ti"><option v-for="c in ROW_CATEGORIES" :key="c" :value="c">{{ c }}</option></select>
                </td>
                <td><input v-model="r.name" class="ti" :list="`ne-names-${i}`" placeholder="как в прайсе" /><datalist :id="`ne-names-${i}`"><option v-for="nm in namesIn(r.category)" :key="nm" :value="nm" /></datalist></td>
                <td><input v-model="r.unit" class="ti ne-unit" /></td>
                <td><input v-model="r.qty" class="ti fx" placeholder="пусто — ввод в расчёте" /></td>
                <td><input class="ti num ne-k" :value="r.fotK == null ? '' : String(r.fotK).replace('.', ',')" :disabled="!massOp(r)" :placeholder="massOp(r) ? String(fotCoeffByName(r.name)).replace('.', ',') : '—'" @change="setFotK(r, ($event.target as HTMLInputElement).value)" /></td>
                <td><input v-model="r.when" class="ti fx" placeholder="всегда" /></td>
                <td><input v-model="r.note" class="ti" /></td>
                <td class="acts">
                  <button class="btn-mini" :disabled="i === 0" aria-label="Строка выше" @click="moveRow(i, -1)">↑</button>
                  <button class="btn-mini" :disabled="i === work.rows.length - 1" aria-label="Строка ниже" @click="moveRow(i, 1)">↓</button>
                  <button class="btn-mini btn-mini--del" aria-label="Убрать строку" @click="work.rows.splice(i, 1)">✕</button>
                </td>
              </tr>
              <tr v-for="m in rowIssues(i)" :key="m.path + m.message" class="ne-rowerr"><td colspan="9" :class="m.warn ? 'warn' : 'err'">{{ m.warn ? '⚠' : '✕' }} {{ m.message }}</td></tr>
            </template>
          </tbody>
        </table>
        <div v-if="issueAt('rows')" class="ne-err">{{ issueAt('rows') }}</div>
      </div>

      <div class="ne-bottom">
        <!-- Предпросмотр -->
        <div class="ne-prev">
          <div class="ne-bh"><span v-hint="TEMPLATE_HINTS.preview">Предпросмотр</span></div>
          <div v-if="work.params.length" class="ne-vals">
            <label v-for="p in work.params" :key="p.key">
              <span>{{ p.label || p.key }}{{ p.unit ? `, ${p.unit}` : '' }}</span>
              <input v-if="p.type === 'bool'" type="checkbox" :checked="valueOf(p) === true" @change="values[p.key] = ($event.target as HTMLInputElement).checked" />
              <input v-else class="ti" :class="{ num: p.type === 'number' }" :value="valueText(p)" @change="setValue(p, ($event.target as HTMLInputElement).value)" />
            </label>
          </div>
          <div v-if="!base" class="ne-muted">Загрузка прайса…</div>
          <TreePreview v-else :tree="previewTree" :totals="previewTotals" :open-all="true" sum-only />
        </div>
        <FormulaPalette :vars="paramVars" vars-title="Параметры узла" @insert="insert" />
      </div>

      <!-- Версии -->
      <div v-if="current.versions.length" class="ne-ver">
        <div v-hint="TEMPLATE_HINTS.versions" class="ne-bh">Версии</div>
        <div v-for="v in current.versions" :key="v.version" class="ne-verr">
          <b>v{{ v.version }}</b>
          <span class="ne-muted">{{ fmtDate(v.publishedAt) }}{{ v.publishedBy ? ` · ${v.publishedBy}` : '' }}</span>
          <span class="ne-note">{{ v.note || '' }}</span>
          <span v-if="v.version === current.activeVersion" class="chip chip-on">действует</span>
          <button v-else class="btn-mini" :disabled="busy" @click="activate(v.version)">сделать действующей</button>
          <button class="btn-mini" @click="loadIntoWork(v.body)">в черновик</button>
        </div>
      </div>
    </section>
    <section v-else class="ne-ed ne-muted">Выберите узел слева или заведите новый: код — буква и номер, например B5.</section>

    <BaseModal :show="publishOpen" :title="`Опубликовать узел ${current?.code ?? ''} v${nextVersionNo}`" :close-on-backdrop="true" @close="publishOpen = false">
      <p class="ne-mp">Версия станет действующей: шаблоны и вставка в расчёт возьмут её. Готовые расчёты не меняются.</p>
      <p v-if="usedIn.length" class="ne-mp ne-warn">Узел стоит в шаблонах: {{ usedIn.join(', ') }} — после публикации проверьте их связи.</p>
      <label class="ne-mnote">Что изменилось
        <textarea v-model="publishNote" rows="3" class="ti" />
      </label>
      <template #footer>
        <button class="btn" @click="publishOpen = false">Отмена</button>
        <button class="btn btn-acc" :disabled="busy" @click="publish">Опубликовать</button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, toRaw, watch } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import FormulaPalette from './FormulaPalette.vue'
import TreePreview from './TreePreview.vue'
import { toast } from '@/composables/useToast'
import { useFormulaTarget } from '@/composables/useFormulaTarget'
import { TEMPLATE_HINTS } from '@/hints/templates'
import { templatesApi, type CatalogNodeInfo, type ProductTemplateInfo } from '@/api/templates'
import { RESERVED_NODE_CODES } from '@/engines/code-nodes'
import { fotCoeffByName } from '@/engines/fot'
import { tryEvalExpr } from '@/engines/expr'
import {
  blankNodeDef,
  defaultParams,
  materializeNode,
  NODE_CODE_RE,
  NODE_TAGS,
  validateNodeDef,
  type NodeDefBody,
  type NodeParamDef,
  type NodeParamType,
  type NodeParamValues,
  type NodeRowDef,
} from '@/engines/node-def'
import { templateCatalogCodes } from '@/engines/template-def'
import { CATEGORIES, UNIT_MASS } from '@/engines/types'
import type { CalcTree } from '@/engines/template-kns'
import type { LoadedContext } from '@/utils/materialize-context'
import { settleTree, treeTotals } from '@/utils/tree-preview'

/**
 * Редактор узлов каталога (этап 2): параметры, строки с генераторами
 * наименований и формулами количеств, предпросмотр с ценами прайса,
 * публикация версии, архив.
 */
const props = defineProps<{
  nodes: CatalogNodeInfo[]
  products: ProductTemplateInfo[]
  base: LoadedContext | null
}>()
const emit = defineEmits<{ changed: [] }>()

const root = ref<HTMLElement | null>(null)
const { insert: insertText } = useFormulaTarget(root)
function insert(text: string) {
  if (!insertText(text)) toast('Поставьте курсор в поле формулы — вставка идёт туда')
}

const ROW_CATEGORIES = CATEGORIES.filter((c) => c !== 'ФОТ')
const busy = ref(false)
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// ── Список ────────────────────────────────────────────────────────────────

const selected = ref<string | null>(null)
const tagFilter = ref('')
const showArchived = ref(false)
const newCode = ref('')

const activeBody = (n: CatalogNodeInfo) => n.versions.find((v) => v.version === n.activeVersion)?.body ?? null
const bodyOf = (n: CatalogNodeInfo): NodeDefBody => works[n.code] ?? n.draft ?? activeBody(n) ?? blankNodeDef(n.code)
const stateText = (n: CatalogNodeInfo) =>
  n.archived ? 'архив' : n.activeVersion == null ? 'черновик' : n.draft ? `v${n.activeVersion} · черновик` : `v${n.activeVersion}`

const shownNodes = computed(() =>
  props.nodes.filter((n) => (showArchived.value || !n.archived) && (!tagFilter.value || bodyOf(n).tag === tagFilter.value)),
)
const current = computed(() => props.nodes.find((n) => n.code === selected.value) ?? null)

// ── Рабочие копии ─────────────────────────────────────────────────────────

const works = reactive<Record<string, NodeDefBody>>({})
const saved = reactive<Record<string, string>>({})
const work = computed(() => (selected.value ? (works[selected.value] ?? null) : null))

// Через реактивный прокси, не через toRaw: иначе «есть правки» не видит вложенных полей.
const dirtyOf = (code: string) => code in works && JSON.stringify(works[code]) !== saved[code]
const dirty = computed(() => (selected.value ? dirtyOf(selected.value) : false))

function resetWork(n: CatalogNodeInfo) {
  const src = n.draft ?? activeBody(n) ?? blankNodeDef(n.code)
  works[n.code] = structuredClone(toRaw(src))
  saved[n.code] = JSON.stringify(src)
}

function select(code: string) {
  selected.value = code
  const n = props.nodes.find((x) => x.code === code)
  if (n && !(code in works)) resetWork(n)
  resetValues()
}

// Список с сервера обновился: копии без правок следуют за ним, выбранный узел
// (в том числе только что заведённый или опубликованный) получает копию.
watch(
  () => props.nodes,
  (list) => {
    for (const n of list) if (n.code in works && !dirtyOf(n.code)) resetWork(n)
    const cur = selected.value ? list.find((n) => n.code === selected.value) : undefined
    if (selected.value && !cur) selected.value = null
    if (cur && !(cur.code in works)) {
      resetWork(cur)
      resetValues()
    }
    if (!selected.value && list.length) select(list[0]!.code)
  },
  { immediate: true },
)

function loadIntoWork(body: NodeDefBody) {
  if (!selected.value) return
  works[selected.value] = structuredClone(toRaw(body))
  toast('Версия загружена в черновик — сохраните или опубликуйте')
}

const statusText = computed(() => {
  const n = current.value
  if (!n) return ''
  const act = n.activeVersion == null ? 'не публиковался' : `действует v${n.activeVersion}`
  return `${act}${n.archived ? ' · в архиве' : ''}${dirty.value ? ' · есть несохранённые правки' : n.draft ? ' · черновик сохранён' : ''}`
})
const discardHint = computed(() =>
  current.value?.activeVersion == null
    ? { ...TEMPLATE_HINTS.discard, text: 'Узел ещё не публиковался: отмена черновика удалит его из каталога.' }
    : TEMPLATE_HINTS.discard,
)
const nextVersionNo = computed(() => (current.value?.versions ?? []).reduce((m, v) => Math.max(m, v.version), 0) + 1)

/** Шаблоны, где стоит узел: действующие версии и черновики. */
const usedIn = computed(() => {
  const code = selected.value
  if (!code) return []
  const out: string[] = []
  const label = { KNS: 'КНС', EMK: 'ЕМК', KOL: 'колодец' } as const
  for (const p of props.products) {
    const act = p.versions.find((v) => v.version === p.activeVersion)?.body
    if (act && templateCatalogCodes(act).includes(code)) out.push(`${label[p.deviceType]} v${p.activeVersion}`)
    if (p.draft && templateCatalogCodes(p.draft).includes(code)) out.push(`${label[p.deviceType]} (черновик)`)
  }
  return out
})

// ── Правка ────────────────────────────────────────────────────────────────

function addParam() {
  work.value?.params.push({ key: '', label: '', type: 'number', unit: '' })
}
function setParamType(p: NodeParamDef, t: NodeParamType) {
  p.type = t
  p.default = t === 'bool' ? false : t === 'text' ? '' : null
}
const defaultInput = (p: NodeParamDef) =>
  p.default == null ? '' : typeof p.default === 'number' ? String(p.default).replace('.', ',') : String(p.default)
function setDefault(p: NodeParamDef, text: string) {
  if (p.type === 'number') p.default = text.trim() === '' ? null : tryEvalExpr(text)
  else p.default = text
}
function addRow() {
  work.value?.rows.push({ kind: 'МАТЕРИАЛ', category: 'Прочие материалы', name: '', unit: 'шт', qty: '' })
}
function moveRow(i: number, dir: -1 | 1) {
  const rows = work.value!.rows
  const [r] = rows.splice(i, 1)
  rows.splice(i + dir, 0, r!)
}
const massOp = (r: NodeRowDef) => r.kind === 'ОПЕРАЦИЯ' && r.unit.trim() === UNIT_MASS
function setFotK(r: NodeRowDef, text: string) {
  r.fotK = text.trim() === '' ? null : tryEvalExpr(text)
}
// Коэффициент ФОТ имеет смысл только у операции в кг: сменили тип или ЕИ —
// лишний коэффициент снимается, нужный подставляется по наименованию.
watch(
  () => work.value?.rows.map((r) => `${r.kind}|${r.unit}`).join(),
  () => {
    for (const r of work.value?.rows ?? []) {
      if (!massOp(r) && r.fotK != null) r.fotK = null
      if (massOp(r) && r.fotK == null) r.fotK = fotCoeffByName(r.name)
    }
  },
)

/** Наименования прайса в категории строки — подсказка поля наименования. */
const namesByCategory = computed(() => {
  const m = new Map<string, string[]>()
  for (const p of props.base?.catalog ?? []) {
    const list = m.get(p.category) ?? []
    list.push(p.name)
    m.set(p.category, list)
  }
  return m
})
const namesIn = (category: string) => namesByCategory.value.get(category) ?? []

// ── Проверка ──────────────────────────────────────────────────────────────

const issues = computed(() => (work.value ? validateNodeDef(work.value, { reservedCodes: RESERVED_NODE_CODES }) : []))
const blocking = computed(() => issues.value.some((i) => !i.warn))
const issueAt = (path: string) => issues.value.find((i) => i.path === path && !i.warn)?.message ?? null
const paramBad = (i: number) => issues.value.some((x) => !x.warn && x.path.startsWith(`params[${i}]`))
const paramErrors = computed(() => issues.value.filter((i) => !i.warn && i.path.startsWith('params[')).map((i) => i.message))
const rowBad = (i: number) => issues.value.some((x) => !x.warn && x.path.startsWith(`rows[${i}]`))
const rowIssues = (i: number) => issues.value.filter((x) => x.path.startsWith(`rows[${i}].`))

// ── Предпросмотр ──────────────────────────────────────────────────────────

const values = reactive<NodeParamValues>({})
function resetValues() {
  for (const k of Object.keys(values)) delete values[k]
  if (work.value) Object.assign(values, defaultParams(work.value))
}
const valueOf = (p: NodeParamDef) => (p.key in values ? values[p.key] : (p.default ?? null))
const valueText = (p: NodeParamDef) => {
  const v = valueOf(p)
  return typeof v === 'number' ? String(v).replace('.', ',') : typeof v === 'string' ? v : ''
}
function setValue(p: NodeParamDef, text: string) {
  values[p.key] = p.type === 'number' ? (text.trim() === '' ? null : tryEvalExpr(text)) : text
}
const paramVars = computed(() =>
  (work.value?.params ?? []).filter((p) => p.key).map((p) => ({ key: p.key, label: p.label || p.key, unit: p.unit, type: p.type })),
)

const previewTree = computed<CalcTree | null>(() => {
  if (!props.base || !work.value) return null
  const comp = materializeNode(props.base.ctx, { body: work.value, version: nextVersionNo.value }, values)
  return settleTree({
    deviceType: 'KNS',
    survey: {},
    priceListVersion: props.base.priceListVersion,
    sections: [{ id: 'prev', code: '·', title: 'Узел в расчёте', enabled: true, components: [comp] }],
  })
})
const previewTotals = computed(() => (previewTree.value && props.base ? treeTotals(previewTree.value, props.base.rates) : null))

// ── Сервер ────────────────────────────────────────────────────────────────

function apiMessage(e: unknown, fallback: string): string {
  const r = (e as { response?: { data?: { message?: string } } }).response
  return r?.data?.message ?? (e instanceof Error ? e.message : fallback)
}

async function createNode() {
  const code = newCode.value.trim()
  if (!NODE_CODE_RE.test(code)) { toast('Код — буква, дальше буквы, цифры, точка или дефис, до 16 знаков', 'error'); return }
  if (RESERVED_NODE_CODES.has(code.toUpperCase())) { toast(`Код ${code} занят встроенным узлом`, 'error'); return }
  if (props.nodes.some((n) => n.code === code)) { toast(`Узел ${code} уже есть — выберите его в списке`, 'error'); return }
  busy.value = true
  try {
    await templatesApi.createNode(blankNodeDef(code))
    newCode.value = ''
    selected.value = code
    toast(`Узел ${code} заведён черновиком`, 'success')
    emit('changed')
  } catch (e) {
    toast(apiMessage(e, 'Не удалось завести узел'), 'error')
  } finally {
    busy.value = false
  }
}

async function saveDraft(): Promise<boolean> {
  const code = selected.value
  if (!code || !work.value) return false
  busy.value = true
  try {
    await templatesApi.saveNodeDraft(code, work.value)
    saved[code] = JSON.stringify(toRaw(work.value))
    toast(`Черновик узла ${code} сохранён`, 'success')
    emit('changed')
    return true
  } catch (e) {
    toast(apiMessage(e, 'Не удалось сохранить черновик'), 'error')
    return false
  } finally {
    busy.value = false
  }
}

async function discardDraft() {
  const n = current.value
  if (!n) return
  busy.value = true
  try {
    if (n.draft || n.activeVersion == null) await templatesApi.discardNodeDraft(n.code)
    delete works[n.code]
    delete saved[n.code]
    toast(n.activeVersion == null ? `Узел ${n.code} удалён` : 'Черновик отменён', 'success')
    emit('changed')
  } catch (e) {
    toast(apiMessage(e, 'Не удалось отменить черновик'), 'error')
  } finally {
    busy.value = false
  }
}

const publishOpen = ref(false)
const publishNote = ref('')

async function publish() {
  const code = selected.value
  if (!code || blocking.value) return
  if (dirty.value && !(await saveDraft())) return
  busy.value = true
  try {
    const { version } = await templatesApi.publishNode(code, publishNote.value)
    publishOpen.value = false
    publishNote.value = ''
    delete works[code]
    delete saved[code]
    toast(`Узел ${code} v${version} опубликован`, 'success')
    emit('changed')
  } catch (e) {
    toast(apiMessage(e, 'Не удалось опубликовать'), 'error')
  } finally {
    busy.value = false
  }
}

async function toggleArchive() {
  const n = current.value
  if (!n) return
  busy.value = true
  try {
    await templatesApi.archiveNode(n.code, !n.archived)
    toast(n.archived ? `Узел ${n.code} возвращён из архива` : `Узел ${n.code} в архиве`, 'success')
    emit('changed')
  } catch (e) {
    toast(apiMessage(e, 'Не удалось'), 'error')
  } finally {
    busy.value = false
  }
}

async function activate(version: number) {
  const n = current.value
  if (!n) return
  busy.value = true
  try {
    await templatesApi.activateNode(n.code, version)
    toast(`Узел ${n.code}: действует v${version}`, 'success')
    emit('changed')
  } catch (e) {
    toast(apiMessage(e, 'Не удалось сменить версию'), 'error')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.ne { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 14px; align-items: start; }
.ne-list { display: flex; flex-direction: column; gap: 4px; position: sticky; top: 0; }
.ne-new, .ne-filter { display: flex; gap: 6px; align-items: center; }
.ne-chk { font-size: 12.6px; color: var(--muted); white-space: nowrap; display: flex; gap: 4px; align-items: center; }
.ne-item { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 0 8px; text-align: left; background: transparent;
  border: 1px solid var(--line); color: var(--text); padding: 5px 8px; cursor: pointer; font: inherit; font-size: 13.2px; }
.ne-item:hover { border-color: var(--line2); }
.ne-item.on { border-color: var(--acc); background: var(--acc-bg); }
.ne-item.off { opacity: .6; }
.ne-code { font-family: ui-monospace, Consolas, monospace; color: var(--acc); grid-row: span 2; }
.ne-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ne-state { font-size: 11.4px; color: var(--faint); }
.ne-dot { color: var(--amber); margin-left: 4px; }
.ne-empty { font-size: 12.6px; color: var(--faint); line-height: 1.5; padding: 6px 2px; }

.ne-ed { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.ne-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ne-title { font-size: 15px; font-weight: 700; }
.ne-spacer { flex: 1; }
.ne-used { font-size: 12.6px; color: var(--amber); }
.ne-muted { color: var(--faint); font-size: 12.6px; }
.ne-warn { color: var(--amber); }

.ne-head { display: grid; grid-template-columns: 110px 220px minmax(0, 1fr) minmax(0, 1fr); gap: 6px 10px; }
.ne-head label { display: flex; flex-direction: column; gap: 3px; font-size: 12.6px; color: var(--muted); }
.ne-head label.full { grid-column: 1 / -1; }
.ne-head label.bad input { border-color: var(--acc); }
.ne-err { color: var(--acc); font-size: 12.6px; }
.ne-err:empty { display: none; }

.ne-block { border: 1px solid var(--line); padding: 6px; overflow-x: auto; }
.ne-bh { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; font-size: 11.4px;
  text-transform: uppercase; letter-spacing: .05em; color: var(--faint); }
.ne-tbl { border-collapse: collapse; width: 100%; font-size: 13.2px; }
.ne-tbl th { text-align: left; font-size: 11.4px; font-weight: 400; color: var(--faint); padding: 2px 4px; white-space: nowrap; }
.ne-tbl td { padding: 1px 3px; vertical-align: top; }
.ne-tbl tr.bad td { background: color-mix(in srgb, var(--acc) 7%, transparent); }
.ne-rows td:nth-child(1) { min-width: 104px; }
.ne-rows td:nth-child(2) { min-width: 150px; }
.ne-rows td:nth-child(3) { min-width: 260px; }
.ne-rows td:nth-child(5) { min-width: 180px; }
.ti.ne-unit { width: 64px; min-width: 0; }
.ti.ne-k { width: 60px; min-width: 0; }
.ne-rowerr td { font-size: 12px; padding: 0 4px 3px; }
.ne-rowerr .err { color: var(--acc); }
.ne-rowerr .warn { color: var(--amber); }
.acts { white-space: nowrap; }

.ne-bottom { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 12px; align-items: start; }
@media (max-width: 1200px) { .ne-bottom { grid-template-columns: 1fr; } }
.ne-prev { border: 1px solid var(--line); padding: 6px; }
.ne-vals { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 12px; margin-bottom: 6px; }
.ne-vals label { display: grid; grid-template-columns: minmax(0, 1fr) 110px; gap: 6px; align-items: center; font-size: 12.6px; color: var(--muted); }

.ne-ver { border: 1px solid var(--line); padding: 6px; }
.ne-verr { display: grid; grid-template-columns: 50px 170px minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 3px 0; border-top: 1px solid var(--line); font-size: 12.6px; }
.ne-note { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip { font-size: 11.4px; border: 1px solid var(--line2); color: var(--muted); padding: 0 6px; white-space: nowrap; }
.chip-on { border-color: var(--green); color: var(--green); }

.ne-mp { font-size: 13.2px; margin-bottom: 8px; max-width: 520px; line-height: 1.45; }
.ne-mnote { display: flex; flex-direction: column; gap: 4px; font-size: 13.2px; color: var(--muted); }

.ti { width: 100%; min-width: 52px; background: var(--cellbg); border: 1px solid var(--line2); color: var(--text); padding: 3px 6px; font-size: 13.2px; font-family: inherit; }
.ti:disabled { opacity: .55; }
.ti.num { text-align: right; font-variant-numeric: tabular-nums; }
.fx { font-family: ui-monospace, Consolas, monospace; }
.btn { background: transparent; border: 1px solid var(--line2); color: var(--muted); font-size: 13.8px; padding: 4px 10px; cursor: pointer; white-space: nowrap; }
.btn:hover:not(:disabled) { color: var(--text); }
.btn:disabled { opacity: .4; cursor: default; }
.btn-acc { border-color: var(--acc); color: var(--acc); }
.btn-mini { background: transparent; border: 1px solid var(--line2); color: var(--muted); font-size: 12.6px; padding: 1px 6px; cursor: pointer; }
.btn-mini:hover:not(:disabled) { color: var(--text); border-color: var(--acc); }
.btn-mini:disabled { opacity: .35; cursor: default; }
.btn-mini--del:hover:not(:disabled) { color: var(--acc); }
</style>
