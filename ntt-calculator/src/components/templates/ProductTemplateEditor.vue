<template>
  <div ref="root" class="pe">
    <!-- ── Изделие и состояние шаблона ── -->
    <div class="pe-top">
      <div class="pe-dev">
        <button v-for="d in DEVICES" :key="d.k" class="pe-devb" :class="{ on: device === d.k }" @click="device = d.k">
          {{ d.label }}<span v-if="dirtyOf(d.k)" class="pe-dot" aria-label="есть несохранённые правки">●</span>
        </button>
      </div>
      <span v-hint="TEMPLATE_HINTS.status" class="pe-status">
        Действует:
        <b v-if="activeVersion">v{{ activeVersion }}</b>
        <b v-else>встроенный шаблон</b>
        <template v-if="activeInfo"> · {{ fmtDate(activeInfo.publishedAt) }}{{ activeInfo.publishedBy ? ` · ${activeInfo.publishedBy}` : '' }}</template>
      </span>
      <span v-hint="TEMPLATE_HINTS.builtinRevision" class="pe-status">встроенные узлы — ред. {{ currentRevision.version }} от {{ fmtRevDate(currentRevision.date) }}</span>
      <span v-hint="TEMPLATE_HINTS.draft" class="pe-draft" :class="{ dirty }">{{ draftText }}</span>
      <div class="pe-spacer" />
      <button class="btn" :disabled="busy || !dirty" @click="saveDraft">Сохранить черновик</button>
      <button v-hint="TEMPLATE_HINTS.discard" class="btn" :disabled="busy || (!hasDraft && !dirty)" @click="discardDraft">Отменить черновик</button>
      <button v-hint="TEMPLATE_HINTS.publish" class="btn btn-acc" :disabled="busy || blocking || (!hasDraft && !dirty)" @click="publishOpen = true">Опубликовать…</button>
    </div>

    <div class="pe-body">
      <!-- ── Состав: разделы и узлы ── -->
      <section class="pe-struct">
        <div v-for="(s, si) in work.sections" :key="si" class="pe-sec" :class="{ bad: issueAt(`sections[${si}].title`) }">
          <div class="pe-sech">
            <span class="pe-no">{{ si + 1 }}</span>
            <input v-model="s.title" class="ti pe-sect" placeholder="Название раздела" :aria-label="`Раздел ${si + 1}`" />
            <button v-hint="'Выше'" class="btn-mini" :disabled="si === 0" aria-label="Раздел выше" @click="moveSection(si, -1)">↑</button>
            <button v-hint="'Ниже'" class="btn-mini" :disabled="si === work.sections.length - 1" aria-label="Раздел ниже" @click="moveSection(si, 1)">↓</button>
            <button v-hint="TEMPLATE_HINTS.removeSection" class="btn-mini btn-mini--del" aria-label="Убрать раздел" @click="removeSection(si)">✕</button>
          </div>
          <div v-if="issueAt(`sections[${si}].title`)" class="pe-err">{{ issueAt(`sections[${si}].title`) }}</div>

          <div v-for="(n, ni) in s.nodes" :key="ni" class="pe-node" :class="{ cat: n.kind === 'catalog', bad: issueAt(`sections[${si}].nodes[${ni}]`) }">
            <div class="pe-nodeh">
              <span class="pe-code">{{ nodeCodes(n) }}</span>
              <span v-hint.plain="nodeTitle(n)" class="pe-nt">{{ nodeTitle(n) }}</span>
              <span v-if="n.kind === 'builtin'" v-hint="builtinHint(n.ref)" class="chip">встроенный</span>
              <span v-else v-hint="TEMPLATE_HINTS.catalogNode" class="chip chip-cat">каталог{{ catalogVersion(n.code) }}</span>
              <button v-hint="'Выше в разделе'" class="btn-mini" :disabled="ni === 0" aria-label="Узел выше" @click="moveNode(si, ni, -1)">↑</button>
              <button v-hint="'Ниже в разделе'" class="btn-mini" :disabled="ni === s.nodes.length - 1" aria-label="Узел ниже" @click="moveNode(si, ni, 1)">↓</button>
              <select v-hint="'Перенести в другой раздел'" class="ti pe-move" :value="si" aria-label="Перенести в раздел" @change="moveNodeTo(si, ni, Number(($event.target as HTMLSelectElement).value))">
                <option v-for="(t, ti) in work.sections" :key="ti" :value="ti">→ {{ ti + 1 }} {{ t.title }}</option>
              </select>
              <button v-hint="'Убрать узел из шаблона'" class="btn-mini btn-mini--del" aria-label="Убрать узел" @click="removeNode(si, ni)">✕</button>
            </div>
            <div v-if="issueAt(`sections[${si}].nodes[${ni}]`)" class="pe-err">{{ issueAt(`sections[${si}].nodes[${ni}]`) }}</div>

            <!-- Связи параметров узла каталога с полями ОЛ -->
            <div v-if="n.kind === 'catalog' && catalogNode(n.code)" class="pe-bind">
              <label class="pe-bindr">
                <span v-hint="TEMPLATE_HINTS.instanceTitle" class="pe-bk">название</span>
                <input v-model="n.title" class="ti" :placeholder="catalogNode(n.code)!.body.name" />
              </label>
              <label v-for="p in catalogNode(n.code)!.body.params" :key="p.key" class="pe-bindr" :class="{ bad: issueAt(`sections[${si}].nodes[${ni}].bindings.${p.key}`) }">
                <span v-hint="TEMPLATE_HINTS.bindings" class="pe-bk">{{ p.label }}{{ p.unit ? `, ${p.unit}` : '' }} <code>{{ p.key }}</code></span>
                <input
                  :value="n.bindings[p.key] ?? ''"
                  class="ti fx"
                  :placeholder="defaultText(p)"
                  @input="setBinding(n, p.key, ($event.target as HTMLInputElement).value)"
                />
                <span v-if="issueAt(`sections[${si}].nodes[${ni}].bindings.${p.key}`)" class="pe-err">{{ issueAt(`sections[${si}].nodes[${ni}].bindings.${p.key}`) }}</span>
              </label>
            </div>
          </div>

          <div class="pe-add">
            <select class="ti" :value="''" aria-label="Добавить встроенный узел" @change="addBuiltin(si, $event)">
              <option value="" disabled>+ встроенный узел…</option>
              <option v-for="b in freeBuiltins" :key="b.ref" :value="b.ref">{{ b.codes.join('/') }} · {{ b.title }}</option>
            </select>
            <select class="ti" :value="''" aria-label="Добавить узел каталога" @change="addCatalog(si, $event)">
              <option value="" disabled>+ узел каталога…</option>
              <option v-for="c in publishedNodes" :key="c.code" :value="c.code">{{ c.code }} · {{ c.body.name }} (v{{ c.version }})</option>
            </select>
          </div>
        </div>

        <button v-hint="TEMPLATE_HINTS.addSection" class="btn" @click="addSection">+ Раздел</button>

        <div v-if="issues.length" class="pe-issues">
          <div v-for="(i, k) in issues" :key="k" :class="i.warn ? 'warn' : 'err'">{{ i.warn ? '⚠' : '✕' }} {{ i.message }}</div>
        </div>

        <!-- ── Версии ── -->
        <div class="pe-ver">
          <div v-hint="TEMPLATE_HINTS.versions" class="pe-verh">Версии</div>
          <div v-for="v in info?.versions ?? []" :key="v.version" class="pe-verr">
            <b>v{{ v.version }}</b>
            <span class="pe-muted">{{ fmtDate(v.publishedAt) }}{{ v.publishedBy ? ` · ${v.publishedBy}` : '' }}</span>
            <span class="pe-note">{{ v.note || '' }}</span>
            <span v-if="v.version === activeVersion" class="chip chip-on">действует</span>
            <button v-else class="btn-mini" :disabled="busy" @click="activate(v.version)">сделать действующей</button>
            <button v-hint="'Загрузить состав этой версии в черновик'" class="btn-mini" @click="loadIntoWork(v.body)">в черновик</button>
          </div>
          <div class="pe-verr">
            <b>встроенный</b>
            <span class="pe-muted">состав из кода, версия 0</span>
            <span class="pe-note">ред. {{ currentRevision.version }} — {{ currentRevision.note }}</span>
            <span v-if="!activeVersion" class="chip chip-on">действует</span>
            <button v-else class="btn-mini" :disabled="busy" @click="activate(null)">сделать действующим</button>
            <button v-hint="'Загрузить встроенный состав в черновик'" class="btn-mini" @click="loadIntoWork(BUILTIN_TEMPLATES[device])">в черновик</button>
          </div>
          <details class="pe-revs">
            <summary v-hint="TEMPLATE_HINTS.builtinRevision">Редакции встроенных узлов · {{ revisions.length }}</summary>
            <div v-for="r in revisions" :key="r.version" class="pe-rev">
              <b>ред. {{ r.version }}</b>
              <span class="pe-muted">{{ fmtRevDate(r.date) }}</span>
              <span>{{ r.note }}</span>
            </div>
          </details>
        </div>
      </section>

      <!-- ── Предпросмотр ── -->
      <aside class="pe-prev">
        <details class="pe-sample">
          <summary v-hint="TEMPLATE_HINTS.sample">Пример опросного листа</summary>
          <div class="pe-sgrid">
            <label v-for="f in sampleFields" :key="f.key" class="pe-sf">
              <span>{{ f.label }}{{ f.unit ? `, ${f.unit}` : '' }}</span>
              <input v-if="f.type === 'bool'" type="checkbox" :checked="Boolean(sample[f.key])" @change="setSample(f.key, ($event.target as HTMLInputElement).checked)" />
              <select v-else-if="f.options" class="ti" :value="String(sample[f.key] ?? '')" @change="setSample(f.key, ($event.target as HTMLSelectElement).value)">
                <option v-for="o in f.options" :key="o" :value="o">{{ o }}</option>
              </select>
              <input v-else class="ti" :class="{ num: f.type === 'number' }" :value="sampleText(f.key)" @change="setSampleText(f, ($event.target as HTMLInputElement).value)" />
            </label>
          </div>
        </details>
        <FormulaPalette :vars="fieldVars" vars-title="Поля опросного листа" collapsed @insert="insert" />
        <div v-if="!base" class="pe-muted">Загрузка прайса и справочников…</div>
        <div v-else-if="preview.error" class="pe-err">Предпросмотр не собрался: {{ preview.error }}</div>
        <TreePreview v-else :tree="preview.tree" :totals="preview.totals" :diff="diff" :cost-before="baseline.totals?.costRub ?? null" />
      </aside>
    </div>

    <BaseModal :show="publishOpen" :title="`Опубликовать шаблон ${deviceLabel} v${nextVersionNo}`" :close-on-backdrop="true" @close="publishOpen = false">
      <p class="pe-mp">
        Версия станет действующей: новые расчёты соберутся по ней, а открытые старые предложат пересборку.
      </p>
      <p v-if="diff" class="pe-mp pe-muted">
        К действующей: +{{ diff.added.length }} узл., −{{ diff.removed.length }}, перенесено {{ diff.moved.length }}, новое количество у {{ diff.changedRows }} строк.
      </p>
      <p v-if="warnings" class="pe-mp pe-warn">Предупреждений проверки: {{ warnings }} — посмотрите список под составом.</p>
      <label class="pe-mnote">Что изменилось
        <textarea v-model="publishNote" rows="3" class="ti" placeholder="Например: площадка обслуживания в перекрытии" />
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
import type { DeviceType } from '@/types/device'
import BaseModal from '@/components/ui/BaseModal.vue'
import FormulaPalette from './FormulaPalette.vue'
import TreePreview from './TreePreview.vue'
import { toast } from '@/composables/useToast'
import { useFormulaTarget } from '@/composables/useFormulaTarget'
import { TEMPLATE_HINTS } from '@/hints/templates'
import { templatesApi, type CatalogNodeInfo, type ProductTemplateInfo } from '@/api/templates'
import { BUILTIN_TEMPLATES, builtinNode, builtinNodesOf } from '@/engines/code-nodes'
import { BUILTIN_REVISIONS } from '@/engines/builtin-revisions'
import type { CatalogNode, NodeParamDef } from '@/engines/node-def'
import { tryEvalExpr } from '@/engines/expr'
import { sampleSurvey } from '@/engines/template-samples'
import {
  materializeTemplate,
  surveyFieldsOf,
  validateTemplate,
  type DeviceEnv,
  type SurveyField,
  type TemplateBody,
  type TemplateNodeRef,
} from '@/engines/template-def'
import type { MaterializeContext } from '@/engines/template-kns'
import type { LoadedContext } from '@/utils/materialize-context'
import { diffTrees, settleTree, treeTotals } from '@/utils/tree-preview'

/**
 * Редактор шаблона изделия (этап 2): разделы и узлы по порядку, узлы каталога
 * со связями на поля ОЛ, предпросмотр на примере ОЛ и публикация версии.
 *
 * Правки копятся в рабочей копии по каждому изделию: переключение изделия их
 * не теряет. «Сохранить черновик» кладёт копию на сервер, «Опубликовать» делает
 * её новой действующей версией.
 */
const props = defineProps<{
  products: ProductTemplateInfo[]
  nodes: CatalogNodeInfo[]
  base: LoadedContext | null
}>()
const emit = defineEmits<{ changed: [] }>()

const root = ref<HTMLElement | null>(null)
const { insert: insertText } = useFormulaTarget(root)
function insert(text: string) {
  if (!insertText(text)) toast('Поставьте курсор в поле связи — вставка идёт туда')
}

const DEVICES: Array<{ k: DeviceType; label: string }> = [
  { k: 'KNS', label: 'КНС' },
  { k: 'EMK', label: 'Ёмкость' },
  { k: 'KOL', label: 'Колодец' },
]
const device = ref<DeviceType>('KNS')
const deviceLabel = computed(() => DEVICES.find((d) => d.k === device.value)!.label)
const busy = ref(false)

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const fmtRevDate = (iso: string) => iso.split('-').reverse().join('.')

/** Редакции встроенных узлов изделия — от новой к старой; действующая — первая. */
const revisions = computed(() => [...BUILTIN_REVISIONS[device.value]].reverse())
const currentRevision = computed(() => revisions.value[0]!)

// ── Шаблон на сервере ─────────────────────────────────────────────────────

const infoOf = (d: DeviceType) => props.products.find((p) => p.deviceType === d) ?? null
const info = computed(() => infoOf(device.value))
const activeVersion = computed(() => info.value?.activeVersion ?? 0)
const activeInfo = computed(() => info.value?.versions.find((v) => v.version === info.value?.activeVersion) ?? null)
const hasDraft = computed(() => info.value?.draft != null)
const nextVersionNo = computed(() => (info.value?.versions ?? []).reduce((m, v) => Math.max(m, v.version), 0) + 1)

function activeBodyOf(d: DeviceType): TemplateBody {
  const i = infoOf(d)
  const v = i?.activeVersion != null ? i.versions.find((x) => x.version === i.activeVersion) : null
  return v?.body ?? BUILTIN_TEMPLATES[d]
}

// ── Рабочие копии ─────────────────────────────────────────────────────────

const works = reactive<Record<DeviceType, TemplateBody>>({
  KNS: structuredClone(BUILTIN_TEMPLATES.KNS),
  EMK: structuredClone(BUILTIN_TEMPLATES.EMK),
  KOL: structuredClone(BUILTIN_TEMPLATES.KOL),
})
/** Что лежит на сервере (черновик либо действующая) — точка отсчёта «есть правки». */
const saved = reactive<Record<DeviceType, string>>({ KNS: '', EMK: '', KOL: '' })
const work = computed(() => works[device.value])

// Сериализация через реактивный прокси, не через toRaw: так вычисляемые
// «есть правки» подписываются на каждое вложенное поле копии.
const json = (b: TemplateBody) => JSON.stringify(b)
const dirtyOf = (d: DeviceType) => saved[d] !== '' && json(works[d]) !== saved[d]
const dirty = computed(() => dirtyOf(device.value))
const draftText = computed(() =>
  dirty.value ? 'есть несохранённые правки' : hasDraft.value ? 'черновик сохранён, не опубликован' : 'черновика нет — правка начнёт его',
)

function resetWork(d: DeviceType) {
  const src = infoOf(d)?.draft ?? activeBodyOf(d)
  works[d] = structuredClone(toRaw(src))
  saved[d] = JSON.stringify(src)
}

// Список с сервера обновился — рабочие копии без правок следуют за ним.
watch(
  () => props.products,
  () => {
    for (const d of DEVICES) if (!dirtyOf(d.k)) resetWork(d.k)
  },
  { immediate: true },
)

function loadIntoWork(body: TemplateBody) {
  works[device.value] = structuredClone(toRaw(body))
  toast('Состав загружен в черновик — сохраните или опубликуйте')
}

// ── Узлы ──────────────────────────────────────────────────────────────────

/** Опубликованные узлы каталога вне архива — их можно ставить в шаблон. */
const publishedNodes = computed<CatalogNode[]>(() =>
  props.nodes.flatMap((n) => {
    if (n.archived || n.activeVersion == null) return []
    const v = n.versions.find((x) => x.version === n.activeVersion)
    return v ? [{ code: n.code, version: v.version, body: v.body }] : []
  }),
)
const nodeMap = computed(() => new Map(publishedNodes.value.map((n) => [n.code, n])))
const catalogNode = (code: string) => nodeMap.value.get(code) ?? null
const catalogVersion = (code: string) => {
  const n = catalogNode(code)
  return n ? ` v${n.version}` : ' — нет'
}

const nodeCodes = (n: TemplateNodeRef) => (n.kind === 'builtin' ? (builtinNode(n.ref)?.codes.join('/') ?? '?') : n.code)
const nodeTitle = (n: TemplateNodeRef) =>
  n.kind === 'builtin' ? (builtinNode(n.ref)?.title ?? n.ref) : (n.title?.trim() || catalogNode(n.code)?.body.name || n.code)
const builtinHint = (ref: string) => {
  const b = builtinNode(ref)
  return b ? { ...TEMPLATE_HINTS.builtinNode, source: `Читает из ОЛ: ${b.reads}` } : TEMPLATE_HINTS.builtinNode
}
const defaultText = (p: NodeParamDef) =>
  p.default == null || p.default === '' ? 'нет связи — пусто' : `нет связи — ${p.type === 'bool' ? (p.default ? 'да' : 'нет') : p.default}`

const freeBuiltins = computed(() => {
  const used = new Set(work.value.sections.flatMap((s) => s.nodes.flatMap((n) => (n.kind === 'builtin' ? [n.ref] : []))))
  return builtinNodesOf(device.value).filter((b) => !used.has(b.ref))
})

// ── Правка состава ────────────────────────────────────────────────────────

function swap<T>(list: T[], i: number, j: number) {
  const [a] = list.splice(i, 1)
  list.splice(j, 0, a!)
}
function moveSection(i: number, dir: -1 | 1) {
  swap(work.value.sections, i, i + dir)
}
function removeSection(i: number) {
  if (work.value.sections[i]!.nodes.length) {
    toast('В разделе есть узлы — перенесите или уберите их', 'error')
    return
  }
  work.value.sections.splice(i, 1)
}
function addSection() {
  work.value.sections.push({ title: 'Новый раздел', nodes: [] })
}
function moveNode(si: number, ni: number, dir: -1 | 1) {
  swap(work.value.sections[si]!.nodes, ni, ni + dir)
}
function moveNodeTo(si: number, ni: number, target: number) {
  if (target === si) return
  const [n] = work.value.sections[si]!.nodes.splice(ni, 1)
  work.value.sections[target]!.nodes.push(n!)
}
function removeNode(si: number, ni: number) {
  work.value.sections[si]!.nodes.splice(ni, 1)
}
function addBuiltin(si: number, e: Event) {
  const el = e.target as HTMLSelectElement
  if (el.value) work.value.sections[si]!.nodes.push({ kind: 'builtin', ref: el.value })
  el.value = ''
}
/** Новый узел каталога: параметры с именем поля ОЛ связываются с ним сразу. */
function addCatalog(si: number, e: Event) {
  const el = e.target as HTMLSelectElement
  const node = catalogNode(el.value)
  el.value = ''
  if (!node) return
  const fields = new Set(surveyFieldsOf(device.value).map((f) => f.key))
  const bindings: Record<string, string> = {}
  for (const p of node.body.params) if (fields.has(p.key)) bindings[p.key] = p.key
  work.value.sections[si]!.nodes.push({ kind: 'catalog', code: node.code, bindings })
}
function setBinding(n: TemplateNodeRef, key: string, value: string) {
  if (n.kind !== 'catalog') return
  if (value.trim()) n.bindings[key] = value
  else delete n.bindings[key]
}

// ── Проверка ──────────────────────────────────────────────────────────────

const issues = computed(() => validateTemplate(device.value, work.value, catalogNode))
const blocking = computed(() => issues.value.some((i) => !i.warn))
const warnings = computed(() => issues.value.filter((i) => i.warn).length)
const issueMap = computed(() => {
  const m = new Map<string, string>()
  for (const i of issues.value) if (!i.warn && !m.has(i.path)) m.set(i.path, i.message)
  return m
})
const issueAt = (path: string) => issueMap.value.get(path) ?? null

// ── Предпросмотр ──────────────────────────────────────────────────────────

const samples = reactive({ KNS: sampleSurvey('KNS'), EMK: sampleSurvey('EMK'), KOL: sampleSurvey('KOL') })
const sample = computed(() => samples[device.value] as unknown as Record<string, unknown>)
const sampleFields = computed(() => surveyFieldsOf(device.value).filter((f) => f.input))
const fieldVars = computed(() => surveyFieldsOf(device.value).map((f) => ({ key: f.key, label: f.label, unit: f.unit, type: f.type })))

const sampleText = (key: string) => {
  const v = sample.value[key]
  return typeof v === 'number' ? String(v).replace('.', ',') : typeof v === 'string' ? v : ''
}
function setSample(key: string, value: unknown) {
  sample.value[key] = value
}
function setSampleText(f: SurveyField<unknown>, text: string) {
  if (f.type === 'number') {
    const v = tryEvalExpr(text)
    sample.value[f.key] = text.trim() === '' ? null : v
  } else {
    sample.value[f.key] = text
  }
}

const env = computed(() => ({ device: device.value, survey: samples[device.value] }) as DeviceEnv)

function build(ctx: MaterializeContext, body: TemplateBody, version: number) {
  try {
    const tree = settleTree(materializeTemplate(ctx, env.value, { deviceType: device.value, version, body }))
    return { tree, totals: props.base ? treeTotals(tree, props.base.rates) : null, error: null as string | null }
  } catch (e) {
    return { tree: null, totals: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Контекст предпросмотра: прайс и справочники — действующие, узлы — из списка редактора. */
const previewCtx = computed<MaterializeContext | null>(() =>
  props.base ? { ...props.base.ctx, catalogNodeOf: (code: string) => catalogNode(code) } : null,
)
const preview = computed(() =>
  previewCtx.value ? build(previewCtx.value, work.value, nextVersionNo.value) : { tree: null, totals: null, error: null },
)
const baseline = computed(() =>
  previewCtx.value ? build(previewCtx.value, activeBodyOf(device.value), activeVersion.value) : { tree: null, totals: null, error: null },
)
const diff = computed(() => (preview.value.tree && baseline.value.tree ? diffTrees(baseline.value.tree, preview.value.tree) : null))

// ── Черновик, публикация, откат ───────────────────────────────────────────

function apiMessage(e: unknown, fallback: string): string {
  const r = (e as { response?: { data?: { message?: string } } }).response
  return r?.data?.message ?? (e instanceof Error ? e.message : fallback)
}

async function saveDraft(): Promise<boolean> {
  busy.value = true
  try {
    await templatesApi.saveProductDraft(device.value, work.value)
    saved[device.value] = json(work.value)
    toast(`Черновик шаблона ${deviceLabel.value} сохранён`, 'success')
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
  busy.value = true
  try {
    if (hasDraft.value) await templatesApi.discardProductDraft(device.value)
    saved[device.value] = ''
    resetWork(device.value)
    toast('Черновик отменён', 'success')
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
  if (blocking.value) return
  if (dirty.value && !(await saveDraft())) return
  busy.value = true
  try {
    const { version } = await templatesApi.publishProduct(device.value, publishNote.value)
    publishOpen.value = false
    publishNote.value = ''
    saved[device.value] = ''
    toast(`Шаблон ${deviceLabel.value} v${version} опубликован и действует`, 'success')
    emit('changed')
  } catch (e) {
    toast(apiMessage(e, 'Не удалось опубликовать'), 'error')
  } finally {
    busy.value = false
  }
}

async function activate(version: number | null) {
  busy.value = true
  try {
    await templatesApi.activateProduct(device.value, version)
    toast(version ? `Действует версия v${version}` : 'Действует встроенный шаблон', 'success')
    emit('changed')
  } catch (e) {
    toast(apiMessage(e, 'Не удалось сменить версию'), 'error')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.pe { display: flex; flex-direction: column; gap: 10px; }
.pe-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pe-dev { display: flex; gap: 4px; }
.pe-devb { background: transparent; border: 1px solid var(--line2); color: var(--muted); font-size: 13.8px; padding: 4px 12px; cursor: pointer; }
.pe-devb.on { border-color: var(--acc); color: var(--text); background: var(--acc-bg); }
.pe-dot { color: var(--amber); margin-left: 4px; font-size: 10px; vertical-align: top; }
.pe-status { font-size: 13.2px; color: var(--muted); }
.pe-draft { font-size: 12.6px; color: var(--faint); }
.pe-draft.dirty { color: var(--amber); }
.pe-spacer { flex: 1; }

.pe-body { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 14px; align-items: start; }
@media (max-width: 1100px) { .pe-body { grid-template-columns: 1fr; } }

.pe-struct { display: flex; flex-direction: column; gap: 8px; }
.pe-sec { border: 1px solid var(--line); background: var(--panel); padding: 6px; }
.pe-sec.bad { border-color: var(--acc); }
.pe-sech { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.pe-no { font-weight: 700; min-width: 20px; text-align: right; color: var(--muted); }
.pe-sect { font-weight: 600; flex: 1; }

.pe-node { border-top: 1px solid var(--line); padding: 4px 2px 4px 26px; }
.pe-node.bad { background: color-mix(in srgb, var(--acc) 7%, transparent); }
.pe-nodeh { display: flex; align-items: center; gap: 6px; }
.pe-code { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--faint); min-width: 44px; }
.pe-nt { font-size: 13.8px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pe-nodeh .pe-move { width: 150px; min-width: 0; flex: none; font-size: 12.6px; padding: 1px 4px; }
.chip { font-size: 11.4px; border: 1px solid var(--line2); color: var(--muted); padding: 0 6px; white-space: nowrap; }
.chip-cat { border-color: var(--acc); color: var(--acc); }
.chip-on { border-color: var(--green); color: var(--green); }

.pe-bind { display: flex; flex-direction: column; gap: 3px; margin: 4px 0 2px; padding: 4px 6px; background: var(--panel2); }
.pe-bindr { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 6px; align-items: center; font-size: 12.6px; }
.pe-bindr.bad input { border-color: var(--acc); }
.pe-bindr .pe-err { grid-column: 2; }
.pe-bk { color: var(--muted); }
.pe-bk code { font-family: ui-monospace, Consolas, monospace; color: var(--faint); }

.pe-add { display: flex; gap: 6px; padding: 6px 0 0 26px; }
.pe-add .ti { width: auto; max-width: 48%; font-size: 12.6px; }

.pe-err { color: var(--acc); font-size: 12.6px; }
.pe-issues { border: 1px solid var(--line); padding: 6px 8px; font-size: 12.6px; display: flex; flex-direction: column; gap: 2px; }
.pe-issues .err { color: var(--acc); }
.pe-issues .warn { color: var(--amber); }

.pe-ver { border: 1px solid var(--line); }
.pe-verh { padding: 5px 8px; font-size: 11.4px; text-transform: uppercase; letter-spacing: .05em; color: var(--faint); border-bottom: 1px solid var(--line); }
.pe-verr { display: grid; grid-template-columns: 84px 170px minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 4px 8px; border-bottom: 1px solid var(--line); font-size: 12.6px; }
.pe-note { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pe-revs summary { padding: 5px 8px; cursor: pointer; font-size: 12.6px; color: var(--muted); }
.pe-rev { display: grid; grid-template-columns: 64px 84px minmax(0, 1fr); gap: 8px; padding: 3px 8px; border-top: 1px solid var(--line); font-size: 12.6px; }
.pe-muted { color: var(--faint); font-size: 12.6px; }
.pe-warn { color: var(--amber); }

.pe-prev { display: flex; flex-direction: column; gap: 8px; position: sticky; top: 0; }
.pe-sample { border: 1px solid var(--line); background: var(--panel2); }
.pe-sample summary { padding: 5px 8px; cursor: pointer; color: var(--muted); font-size: 13.2px; }
.pe-sgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 12px; padding: 6px 8px; max-height: 320px; overflow-y: auto; }
.pe-sf { display: grid; grid-template-columns: minmax(0, 1fr) 110px; gap: 6px; align-items: center; font-size: 12.6px; color: var(--muted); }
.pe-sf input[type='checkbox'] { justify-self: start; }

.pe-mp { font-size: 13.2px; margin-bottom: 8px; max-width: 520px; line-height: 1.45; }
.pe-mnote { display: flex; flex-direction: column; gap: 4px; font-size: 13.2px; color: var(--muted); }

.ti { width: 100%; min-width: 52px; background: var(--cellbg); border: 1px solid var(--line2); color: var(--text); padding: 3px 6px; font-size: 13.8px; font-family: inherit; }
.ti.num { text-align: right; font-variant-numeric: tabular-nums; }
.fx { font-family: ui-monospace, Consolas, monospace; font-size: 13.2px; }
.btn { background: transparent; border: 1px solid var(--line2); color: var(--muted); font-size: 13.8px; padding: 4px 10px; cursor: pointer; }
.btn:hover:not(:disabled) { color: var(--text); }
.btn:disabled { opacity: .4; cursor: default; }
.btn-acc { border-color: var(--acc); color: var(--acc); }
.btn-mini { background: transparent; border: 1px solid var(--line2); color: var(--muted); font-size: 12.6px; padding: 1px 6px; cursor: pointer; }
.btn-mini:hover:not(:disabled) { color: var(--text); border-color: var(--acc); }
.btn-mini:disabled { opacity: .35; cursor: default; }
.btn-mini--del:hover:not(:disabled) { color: var(--acc); }
</style>
