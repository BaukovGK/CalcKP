/**
 * Шаблон изделия как данные (Библиотека §1.3, §3, §6.2).
 *
 * «Шаблон изделия = сборка верхнего уровня с биндингами параметров на поля
 * ОЛ» (Библиотека §1.5). Здесь он и есть такой: разделы по порядку, в каждом —
 * ссылки на узлы. Узел бывает встроенный (формулы — код, engines/code-nodes.ts)
 * или узел каталога, заведённый технологом (engines/node-def.ts); у второго
 * параметры связаны с полями ОЛ биндингами — формулами над полями ОЛ.
 *
 * Шаблон версионируется: встроенный — версия 0, каждая публикация технолога —
 * следующая версия. Код, которым собираются встроенные узлы, версионируется
 * отдельно — редакциями (engines/builtin-revisions.ts). Материализация пишет
 * обе версии в дерево расчёта (`CalcTree.templateVersion`,
 * `CalcTree.builtinRevision`), а снапшот КП — в свою запись: по ним видно,
 * каким составом и каким кодом посчитано выпущенное КП.
 */

import type { DeviceType } from '@/types/device'
import { PIPE_MATERIALS } from '@/types/survey'
import { pipeLengthM } from './formulas'
import {
  checkFormula,
  evalFormulaText,
  type FormulaRefs,
  type Scope,
  type ScopeValue,
  type VarKind,
} from './node-expr'
import { materializeNode, type CatalogNode, type NodeDefBody, type NodeParamValues } from './node-def'
import { BUILTIN_TEMPLATES, builtinNode, builtinNodesOf, type DeviceSurvey } from './code-nodes'
import { builtinRevision } from './builtin-revisions'
import { computeEmkGeometry, computeKolGeometry } from './survey-emk-kol'
import { emkLadderHeightMm } from './template-emk-kol'
import {
  GRP_PIPE_MATERIAL,
  knsBasketOn,
  nextId,
  stationHeightM,
  type CalcComponent,
  type CalcSection,
  type CalcTree,
  type MaterializeContext,
} from './template-kns'

// ─── Модель ──────────────────────────────────────────────────────────────────

/** Ссылка на узел в разделе шаблона. */
export type TemplateNodeRef =
  /** Встроенный узел: читает ОЛ сам, биндингов нет. */
  | { kind: 'builtin'; ref: string }
  /**
   * Узел каталога: параметр → формула над полями ОЛ («dn», «depthMm / 1000»,
   * «hasBasket»). Параметр без биндинга берёт значение по умолчанию.
   */
  | { kind: 'catalog'; code: string; title?: string; bindings: Record<string, string> }

export interface TemplateSectionDef {
  title: string
  nodes: TemplateNodeRef[]
}

/** Тело шаблона — то, что правит технолог и что хранит версия шаблона. */
export interface TemplateBody {
  sections: TemplateSectionDef[]
}

/** Шаблон, по которому собирается изделие. Версия 0 — встроенный. */
export interface ProductTemplate {
  deviceType: DeviceType
  version: number
  body: TemplateBody
}

/** Встроенный шаблон изделия — версия 0. */
export function builtinTemplate(device: DeviceType): ProductTemplate {
  return { deviceType: device, version: 0, body: BUILTIN_TEMPLATES[device] }
}

/** Изделие и его параметры ОЛ — вход материализации. */
export type DeviceEnv = { [D in DeviceType]: { device: D; survey: DeviceSurvey[D] } }[DeviceType]

// ─── Поля ОЛ для биндингов ───────────────────────────────────────────────────

export interface SurveyField<S> {
  key: string
  label: string
  unit?: string
  type: VarKind
  /** Поле вводится в ОЛ (а не выводится из других): его правит форма предпросмотра. */
  input?: boolean
  /** Допустимые значения текстового поля — выпадающий список предпросмотра. */
  options?: readonly string[]
  get(s: S): ScopeValue
}

type Fields<S> = ReadonlyArray<SurveyField<S>>

const num = <S,>(key: keyof S & string, label: string, unit?: string): SurveyField<S> => ({
  key, label, unit, type: 'number', input: true, get: (s) => (s[key] as ScopeValue) ?? null,
})
const bool = <S,>(key: keyof S & string, label: string): SurveyField<S> => ({
  key, label, type: 'bool', input: true, get: (s) => Boolean(s[key]),
})

const KNS_FIELDS: Fields<DeviceSurvey['KNS']> = [
  num('dn', 'DN корпуса', 'мм'),
  num('depthMm', 'Глубина подземной части Нподз', 'мм'),
  num('elevationMm', 'Возвышение над землёй', 'мм'),
  { key: 'heightM', label: 'Высота станции: Нподз + возвышение', unit: 'м', type: 'number', get: (s) => stationHeightM(s) },
  { key: 'lengthM', label: 'Длина трубы корпуса', unit: 'м', type: 'number', get: (s) => pipeLengthM(s.depthMm) },
  num('pnSurvey', 'PN опросного листа', 'МПа'),
  num('sn', 'Кольцевая жёсткость SN', 'Па'),
  bool('mvk', 'Объект по ТТ МВК'),
  { key: 'pipeExecution', label: 'Исполнение корпуса', type: 'text', input: true, options: ['целая', 'частями'], get: (s) => s.pipeExecution ?? 'целая' },
  { key: 'pipeParts', label: 'Корпус частями', type: 'bool', get: (s) => s.pipeExecution === 'частями' },
  num('inletDn', 'DN подводящего патрубка', 'мм'),
  num('inletCount', 'Подводящих патрубков', 'шт'),
  num('inletTrayDepthMm', 'Глубина лотка подводящего', 'мм'),
  num('outletDn', 'DN напорного патрубка', 'мм'),
  num('outletCount', 'Напорных патрубков', 'шт'),
  ...materialFields<DeviceSurvey['KNS']>('напорной'),
  num('pumpsWorking', 'Рабочих насосов', 'шт'),
  num('pumpsReserve', 'Резервных насосов', 'шт'),
  num('pumpsSpare', 'Запасных насосов на склад', 'шт'),
  { key: 'pumps', label: 'Установленных насосов: рабочие + резервные', unit: 'шт', type: 'number', get: (s) => s.pumpsWorking + s.pumpsReserve },
  { key: 'pumpModel', label: 'Марка насоса', type: 'text', input: true, get: (s) => s.pumpModel ?? '' },
  // Задвижка на подводящем у КНС есть всегда; поле оставлено для биндингов.
  { key: 'valveOnInlet', label: 'Задвижка на подводящем — есть всегда', type: 'bool', get: () => true },
  bool('emergencyPipeline', 'Аварийный трубопровод'),
  bool('hasFlowMeter', 'Расходомер'),
  bool('hasControlCabinet', 'Шкаф управления'),
  { key: 'controlCabinetType', label: 'Тип шкафа', type: 'text', input: true, options: ['внутренний', 'уличный'], get: (s) => s.controlCabinetType ?? '' },
  { key: 'controlCabinetStart', label: 'Пуск насосов', type: 'text', input: true, options: ['стандартный', 'плавный', 'ЧП'], get: (s) => s.controlCabinetStart ?? '' },
  bool('hasPressureSensors', 'Датчики давления'),
  bool('hasLevelSensor', 'Датчик уровня'),
  bool('insulationEnabled', 'Теплоизоляция'),
  num('insulationDepthMm', 'Глубина теплоизоляции', 'мм'),
  // Корзина или дробилка есть всегда: без того и другого — корзина.
  { key: 'hasBasket', label: 'Корзина для мусора', type: 'bool', input: true, get: (s) => knsBasketOn(s) },
  bool('hasGrinder', 'Дробилка'),
]

const emkGeo = (s: DeviceSurvey['EMK']) => computeEmkGeometry(s)

/**
 * Материал подходящих труб: под стеклокомпозитную трубу патрубок
 * стеклопластиковый (buildSleeveNozzles). Пусто — как у расчётов до
 * появления поля: гильза под проход трубы.
 *
 * @param outlet как изделие зовёт вторую трубу: «напорной» у КНС, «отводящей» у ёмкости и колодца
 */
function materialFields<S extends DeviceSurvey[DeviceType]>(outlet: string): Fields<S> {
  const cap = outlet[0]!.toUpperCase() + outlet.slice(1)
  return [
    { key: 'inletMaterial', label: 'Материал подводящей трубы', type: 'text', input: true, options: PIPE_MATERIALS, get: (s) => s.inletMaterial ?? '' },
    { key: 'outletMaterial', label: `Материал ${outlet} трубы`, type: 'text', input: true, options: PIPE_MATERIALS, get: (s) => s.outletMaterial ?? '' },
    { key: 'inletGrp', label: 'Подводящая труба стеклокомпозитная', type: 'bool', get: (s) => s.inletMaterial === GRP_PIPE_MATERIAL },
    { key: 'outletGrp', label: `${cap} труба стеклокомпозитная`, type: 'bool', get: (s) => s.outletMaterial === GRP_PIPE_MATERIAL },
  ]
}

const EMK_FIELDS: Fields<DeviceSurvey['EMK']> = [
  num('dn', 'DN корпуса', 'мм'),
  num('volumeM3', 'Объём', 'м³'),
  { key: 'placement', label: 'Расположение', type: 'text', input: true, options: ['вертикальное', 'горизонтальное'], get: (s) => s.placement },
  { key: 'horizontal', label: 'Горизонтальная ёмкость', type: 'bool', get: (s) => s.placement === 'горизонтальное' },
  { key: 'installation', label: 'Установка', type: 'text', input: true, options: ['подземная', 'наземная', 'в помещении'], get: (s) => s.installation },
  { key: 'tankType', label: 'Тип ёмкости', type: 'text', input: true, options: ['Накопительная', 'Химстойкая', 'Аккумулирующая', 'Питьевая', 'С насосным оборудованием'], get: (s) => s.tankType },
  { key: 'bottomType', label: 'Днища горизонтальной', type: 'text', input: true, options: ['эллиптические', 'цилиндрические'], get: (s) => s.bottomType ?? 'эллиптические' },
  num('pnSurvey', 'PN опросного листа', 'МПа'),
  { key: 'sn', label: 'Кольцевая жёсткость SN', unit: 'Па', type: 'number', input: true, get: (s) => s.sn ?? emkGeo(s).sn ?? 2500 },
  num('pipeLengthMm', 'Длина трубы из ОЛ (пусто — из объёма)', 'мм'),
  { key: 'lengthM', label: 'Длина трубы корпуса', unit: 'м', type: 'number', get: (s) => (emkGeo(s).pipeLengthMm ?? 0) / 1000 },
  { key: 'overallLengthMm', label: 'Габаритная длина', unit: 'мм', type: 'number', get: (s) => emkGeo(s).overallLengthMm ?? 0 },
  { key: 'ladderHeightM', label: 'Высота лестницы', unit: 'м', type: 'number', get: (s) => emkLadderHeightMm(s, emkGeo(s)) / 1000 },
  // Пустые «Лестница» и «Вентиляция» — «да»: так узлы и строятся.
  { key: 'hasLadder', label: 'Лестница', type: 'bool', input: true, get: (s) => s.hasLadder ?? true },
  { key: 'ventilation', label: 'Вентиляция', type: 'bool', input: true, get: (s) => s.ventilation ?? true },
  bool('hasShaft', 'Шахта обслуживания'),
  { key: 'shaftCount', label: 'Шахт обслуживания', unit: 'шт', type: 'number', input: true, get: (s) => emkGeo(s).shaftCount },
  { key: 'shaftDiameterMm', label: 'Ø шахты', unit: 'мм', type: 'number', input: true, get: (s) => emkGeo(s).shaftDiameterMm },
  { key: 'shaftHeightMm', label: 'Высота шахты', unit: 'мм', type: 'number', input: true, get: (s) => emkGeo(s).shaftHeightMm },
  num('inletDn', 'DN подводящего патрубка', 'мм'),
  num('inletCount', 'Подводящих патрубков', 'шт'),
  num('inletTrayDepthMm', 'Глубина лотка подводящего', 'мм'),
  num('outletDn', 'DN отводящего патрубка', 'мм'),
  num('outletCount', 'Отводящих патрубков', 'шт'),
  ...materialFields<DeviceSurvey['EMK']>('отводящей'),
  bool('hasPumps', 'Насосное оборудование'),
  num('pumpsWorking', 'Рабочих насосов', 'шт'),
  num('pumpsReserve', 'Резервных насосов', 'шт'),
  { key: 'pumps', label: 'Установленных насосов: рабочие + резервные', unit: 'шт', type: 'number', get: (s) => s.pumpsWorking + s.pumpsReserve },
  { key: 'pumpModel', label: 'Марка насосов', type: 'text', input: true, get: (s) => s.pumpModel ?? '' },
  bool('valveOnInlet', 'Арматура на подводящем'),
  bool('hasControlCabinet', 'Шкаф управления'),
  bool('hasLevelSensor', 'Датчики уровня'),
  bool('hasBasket', 'Корзина для мусора'),
  bool('insulationEnabled', 'Теплоизоляция'),
  num('insulationDepthMm', 'Глубина теплоизоляции', 'мм'),
]

const kolGeo = (s: DeviceSurvey['KOL']) => computeKolGeometry(s)

const KOL_FIELDS: Fields<DeviceSurvey['KOL']> = [
  num('dn', 'DN корпуса', 'мм'),
  num('workingDepthMm', 'Глубина рабочей части', 'мм'),
  num('elevationMm', 'Возвышение над землёй', 'мм'),
  { key: 'totalDepthMm', label: 'Полная глубина с горловиной', unit: 'мм', type: 'number', get: (s) => kolGeo(s).totalDepthMm },
  // Труба корпуса — рабочая часть; без горловины — с возвышением (эталон H5).
  { key: 'lengthM', label: 'Длина трубы корпуса', unit: 'м', type: 'number', get: (s) => kolGeo(s).shellLengthMm / 1000 },
  { key: 'neckLengthM', label: 'Длина трубы горловины: h + возвышение', unit: 'м', type: 'number', get: (s) => kolGeo(s).neckHeightMm / 1000 },
  num('pnSurvey', 'PN опросного листа', 'МПа'),
  { key: 'sn', label: 'Кольцевая жёсткость SN', unit: 'Па', type: 'number', input: true, get: (s) => s.sn ?? kolGeo(s).sn ?? 2500 },
  bool('underRoadway', 'Под проезжей частью'),
  { key: 'hasLadder', label: 'Лестница', type: 'bool', input: true, get: (s) => s.hasLadder ?? true },
  bool('hasNeck', 'Горловина'),
  num('neckHeightMm', 'Высота горловины', 'мм'),
  num('neckDiameterMm', 'Ø горловины', 'мм'),
  num('inletDn', 'DN подводящего патрубка', 'мм'),
  num('inletCount', 'Подводящих патрубков', 'шт'),
  num('inletTrayDepthMm', 'Глубина лотка подводящего', 'мм'),
  num('outletDn', 'DN отводящего патрубка', 'мм'),
  num('outletCount', 'Отводящих патрубков', 'шт'),
  ...materialFields<DeviceSurvey['KOL']>('отводящей'),
  bool('hasBasket', 'Корзина для мусора'),
  bool('hasGrinder', 'Дробилка'),
  bool('insulationEnabled', 'Теплоизоляция'),
  num('insulationDepthMm', 'Глубина теплоизоляции', 'мм'),
]

/** Поля ОЛ, доступные биндингам шаблона, — по изделиям. */
export const SURVEY_FIELDS: { readonly [D in DeviceType]: Fields<DeviceSurvey[D]> } = {
  KNS: KNS_FIELDS,
  EMK: EMK_FIELDS,
  KOL: KOL_FIELDS,
}

/** Поля ОЛ изделия без привязки к типу параметров — для редактора. */
export function surveyFieldsOf(device: DeviceType): ReadonlyArray<SurveyField<unknown>> {
  return SURVEY_FIELDS[device] as ReadonlyArray<SurveyField<unknown>>
}

/** Значения полей ОЛ — область видимости биндингов. */
export function surveyScope(env: DeviceEnv): Scope {
  const out: Record<string, ScopeValue> = {}
  for (const f of surveyFieldsOf(env.device)) out[f.key] = f.get(env.survey)
  return out
}

/** Типы полей ОЛ — для проверки биндингов. */
export function surveyFieldKinds(device: DeviceType): Map<string, VarKind> {
  return new Map(surveyFieldsOf(device).map((f) => [f.key, f.type]))
}

// ─── Биндинги ────────────────────────────────────────────────────────────────

/**
 * Параметры экземпляра узла из биндингов. Числовой параметр — результат
 * формулы; логический — «не 0»; текстовый — значение текстового поля ОЛ, если
 * биндинг назван его именем, иначе сам текст биндинга. Пустой биндинг,
 * пустое поле ОЛ и ошибка — значение по умолчанию.
 */
export function bindParams(
  body: Pick<NodeDefBody, 'params'>,
  bindings: Readonly<Record<string, string>>,
  scope: Scope,
  refs: FormulaRefs = {},
): NodeParamValues {
  const out: NodeParamValues = {}
  for (const p of body.params) {
    const src = bindings[p.key]?.trim()
    if (!src) continue
    if (p.type === 'text') {
      const v = scope[src]
      out[p.key] = typeof v === 'string' ? v : src
      continue
    }
    try {
      const v = evalFormulaText(src, scope, refs)
      if (v == null) continue
      out[p.key] = p.type === 'bool' ? v !== 0 : v
    } catch {
      // Биндинг с ошибкой не публикуется (validateTemplate); у старой версии
      // узла с переименованным полем параметр берёт умолчание.
    }
  }
  return out
}

// ─── Материализация ──────────────────────────────────────────────────────────

/**
 * Узел шаблона — в компоненты расчёта, каждому — ключ `slot`
 * (см. CalcComponent.slot).
 *
 * @param occurrence который по счёту в шаблоне узел каталога с этим кодом:
 *   один узел каталога может стоять в шаблоне несколько раз
 */
function materializeRef(
  ctx: MaterializeContext,
  env: DeviceEnv,
  ref: TemplateNodeRef,
  scope: Scope,
  occurrence: number,
): CalcComponent[] {
  if (ref.kind === 'builtin') {
    const node = builtinNode(ref.ref)
    if (!node || node.device !== env.device) return []
    const built = (node.build as (c: MaterializeContext, s: unknown) => CalcComponent[])(ctx, env.survey)
    return built.map((c, i) => ({ ...c, slot: `${ref.ref}#${c.slot ?? i}` }))
  }
  // Узла нет среди опубликованных (в архиве, не опубликован) — не строим:
  // публикация шаблона с таким узлом запрещена, сюда попадают только
  // исключения, и молчаливый пропуск честнее выдуманных строк.
  const node = ctx.catalogNodeOf?.(ref.code)
  if (!node) return []
  return [{ ...materializeNode(ctx, node, bindParams(node.body, ref.bindings, scope, ctx), { title: ref.title }), slot: `cat:${ref.code}#${occurrence}` }]
}

/**
 * Материализует изделие по шаблону: разделы по порядку, в разделе — узлы по
 * порядку. Номер раздела — его место в шаблоне.
 *
 * Сначала строятся все узлы, потом разделы: так id строк и компонентов идут
 * в том же порядке, что до шаблонов-данных, и встроенный шаблон даёт дерево,
 * неотличимое от прежнего.
 */
export function materializeTemplate(ctx: MaterializeContext, env: DeviceEnv, template: ProductTemplate): CalcTree {
  const scope = surveyScope(env)
  // Узел каталога может стоять в шаблоне не раз: номер вхождения — часть ключа.
  const seen = new Map<string, number>()
  const occurrenceOf = (ref: TemplateNodeRef): number => {
    if (ref.kind !== 'catalog') return 0
    const n = seen.get(ref.code) ?? 0
    seen.set(ref.code, n + 1)
    return n
  }
  const built = template.body.sections.map((s) => s.nodes.flatMap((ref) => materializeRef(ctx, env, ref, scope, occurrenceOf(ref))))
  const sections: CalcSection[] = template.body.sections.map((s, i) => ({
    id: nextId('s'),
    code: String(i + 1),
    title: s.title,
    enabled: true,
    components: built[i] ?? [],
  }))
  return {
    deviceType: env.device,
    survey: env.survey as unknown as Record<string, unknown>,
    priceListVersion: ctx.priceListVersion,
    templateVersion: template.version,
    builtinRevision: builtinRevision(env.device),
    sections,
  }
}

// ─── Проверка ────────────────────────────────────────────────────────────────

export interface TemplateIssue {
  /** Где: «sections[2]», «sections[0].nodes[3].bindings.h». */
  path: string
  message: string
  warn?: boolean
}

/**
 * Проверка шаблона перед публикацией.
 *
 * @param catalogNodeOf опубликованный узел каталога по коду (null — нет/архив)
 */
export function validateTemplate(
  device: DeviceType,
  body: TemplateBody,
  catalogNodeOf: (code: string) => CatalogNode | null,
): TemplateIssue[] {
  const issues: TemplateIssue[] = []
  const err = (path: string, message: string) => issues.push({ path, message })
  const warn = (path: string, message: string) => issues.push({ path, message, warn: true })
  const fields = surveyFieldKinds(device)

  if (!body.sections.length) err('sections', 'В шаблоне нет ни одного раздела')
  const titles = new Set<string>()
  const usedBuiltin = new Set<string>()

  body.sections.forEach((s, si) => {
    const at = `sections[${si}]`
    const title = s.title.trim()
    if (!title) err(`${at}.title`, 'Название раздела обязательно')
    else if (titles.has(title.toLowerCase())) err(`${at}.title`, `Раздел «${title}» повторяется`)
    titles.add(title.toLowerCase())

    const compTitles = new Set<string>()
    s.nodes.forEach((n, ni) => {
      const nat = `${at}.nodes[${ni}]`
      if (n.kind === 'builtin') {
        const b = builtinNode(n.ref)
        if (!b || b.device !== device) { err(nat, `Встроенного узла «${n.ref}» у этого изделия нет`); return }
        if (usedBuiltin.has(n.ref)) err(nat, `Узел «${b.title}» уже стоит в шаблоне — его строки задвоились бы`)
        usedBuiltin.add(n.ref)
        return
      }
      const node = catalogNodeOf(n.code)
      if (!node) { err(nat, `Узел каталога ${n.code} не опубликован или в архиве`); return }
      const title = (n.title?.trim() || node.body.name).toLowerCase()
      if (compTitles.has(title)) {
        warn(nat, `Два узла «${n.title?.trim() || node.body.name}» в разделе: при пересборке ручные правки второго перейдут к первому — задайте экземпляру своё название`)
      }
      compTitles.add(title)
      const params = new Map(node.body.params.map((p) => [p.key, p]))
      for (const [key, src] of Object.entries(n.bindings)) {
        const bat = `${nat}.bindings.${key}`
        const p = params.get(key)
        if (!p) { err(bat, `У узла ${n.code} v${node.version} нет параметра «${key}»`); continue }
        if (!src.trim() || p.type === 'text') continue
        const e = checkFormula(src, fields)
        if (e) err(bat, `${p.label}: ${e}`)
      }
    })
  })

  for (const b of builtinNodesOf(device)) {
    if (!usedBuiltin.has(b.ref)) warn('sections', `Встроенный узел «${b.title}» не входит в шаблон — его строк в расчётах не будет`)
  }
  return issues
}

/** Коды узлов каталога, на которые ссылается шаблон. */
export function templateCatalogCodes(body: TemplateBody): string[] {
  return [...new Set(body.sections.flatMap((s) => s.nodes.flatMap((n) => (n.kind === 'catalog' ? [n.code] : []))))]
}
