/**
 * Комплектация изделия для КП — сборка из опросного листа.
 *
 * В КП попадает то, что заказчик получает: корпус, шахты и колодцы, лестницы,
 * гильзы под каждый патрубок, вентиляция, крепление, насосы, датчики, шкаф.
 * Строки расчёта (ровинг, смола, заготовки, работы) — не попадают вовсе:
 * источник комплектации — опросный лист, а не дерево (`doc/Эталон_КП_разбор.md`
 * §4, §9; решение пользователя 17.09.2026 — «из ОЛ + ручная правка»).
 *
 * Сборка даёт ЧЕРНОВИК: менеджер правит его в диалоге выпуска КП, и в
 * документ уходит правленый состав. Поэтому здесь нет попыток угадать
 * недостающее — чего в опросном листе нет, того нет и в черновике.
 *
 * Читается сохранённый `surveyData`: блок `form` (полная форма листа), блоки
 * `kns`/`emk`/`kol` (нормализованные числа материализации) и `derived`
 * (вычисленное листом — глубина, жёсткость, марка насоса). Старые снапшоты
 * половины ключей не знают, поэтому каждый читается отдельно и без него
 * черновик просто короче.
 *
 * @module utils/kp-kit
 */

import {
  BRAND,
  TU_BY_DEVICE,
  type KitItem,
  type KpDeviceType,
  type ProductSpec,
  docNumber,
} from './kp-product'
import { ringStiffnessDesignation } from './ring-stiffness'

/** Черновик позиции КП: описание изделия и его комплектация. */
export interface ProductDraft {
  spec: ProductSpec
  kit: KitItem[]
}

/** Что известно вне опросного листа. */
export interface ProductExtras {
  /** Толщина стенки корпуса, мм — ищется по прайсу труб (`PipeWeight`). */
  wallMm?: number | null
  /** Обозначение по проекту («НЕ1»): его задаёт менеджер при выпуске. */
  tag?: string | null
  /** Марка изделия: правило третьего числа заводом не задано, не выдумываем. */
  mark?: string | null
  /** ТУ изделия, если отличается от типового. */
  tu?: string | null
}

const SHT = 'шт.'
const KOMPL = 'компл.'
/** Вентиляция изделий — дефлектор ПВХ Ø110 мм (эталон: у всех изделий такой). */
const VENT = 'Система вентиляции с дефлектором ПВХ Ø110 мм'
const ANCHOR_KIT = 'Комплект крепления к бетонному основанию'
const LADDER = 'Лестница из нержавеющей стали'

// ─── Чтение опросного листа ──────────────────────────────────────────────────

type Dict = Record<string, unknown>

function isObj(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function dict(source: unknown, key: string): Dict {
  return isObj(source) && isObj(source[key]) ? (source[key] as Dict) : {}
}

/** Число из поля листа: и «2500», и «2 500», и «25,13» — одно и то же. */
function num(source: Dict, key: string): number | null {
  const v = source[key]
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const text = v.replace(/\s| /g, '').replace(',', '.')
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

function str(source: Dict, key: string): string | null {
  const v = source[key]
  if (typeof v !== 'string') return null
  const text = v.trim()
  return text === '' ? null : text
}

function bool(source: Dict, key: string): boolean {
  return source[key] === true
}

/** Целое количество ≥ 0: количество узлов дробным не бывает. */
function count(source: Dict, key: string): number {
  const n = num(source, key)
  return n != null && n > 0 ? Math.round(n) : 0
}

/** Габарит в виде документа: «11 900» — разряды неразрывным пробелом. */
function mm(value: number): string {
  return Math.round(value).toLocaleString('ru-RU').replace(/\s/g, ' ')
}

/** Добавить узел, если количество положительное: нулевых строк в КП нет. */
function push(kit: KitItem[], name: string, qty: number, unit: string = SHT): void {
  if (qty > 0) kit.push({ name, qty, unit })
}

/**
 * Тип пуска из листа — в падеже наименования: «Шкаф управления уличного
 * исполнения, с плавным пуском».
 */
const SHU_START: Readonly<Record<string, string>> = {
  'стандартный': 'со стандартным пуском',
  'плавный': 'с плавным пуском',
  'ЧП': 'с частотно-регулируемым приводом',
}

const FLOW_UNIT_LABEL: Readonly<Record<string, string>> = {
  'l/s': 'л/с',
  'm3/h': 'м³/ч',
  'm3/day': 'м³/сут',
}

/** Гильза под патрубок — по гильзе на каждый патрубок (эталон, все изделия). */
function sleeve(kit: KitItem[], role: string, dn: number | null, qty: number): void {
  if (dn == null) return
  push(kit, `Гильза из стеклокомпозита для ${role} патрубка DN ${mm(dn)}`, qty)
}

// ─── Корпус ──────────────────────────────────────────────────────────────────

/**
 * Первая строка комплектации — сам корпус с повтором характеристик заголовка
 * (эталон: диаметр, габарит, жёсткость, толщина стенки).
 */
function shellName(parts: {
  dims: string[]
  snLabel: number | null
  wallMm: number | null
  extra?: (string | null)[]
}): string {
  const tail = [
    ...parts.dims,
    parts.snLabel != null ? `жесткость не менее SN ${parts.snLabel}` : null,
    parts.wallMm != null ? `толщина стенки не менее ${docNumber(parts.wallMm)} мм` : null,
    ...(parts.extra ?? []),
  ].filter(Boolean)
  return [`Стеклокомпозитный корпус ${BRAND}`, ...tail].join(', ')
}

// ─── КНС / ЛНС / ДНС ─────────────────────────────────────────────────────────

function knsDraft(survey: unknown, extras: ProductExtras): ProductDraft {
  const form = dict(survey, 'form')
  const derived = dict(survey, 'derived')

  const dn = num(form, 'dn')
  const npodz = num(derived, 'npodzMm') ?? num(form, 'npodzManual')
  const full = num(derived, 'fullHeightMm')
  const sn = num(derived, 'sn')
  const snLabel = sn != null ? ringStiffnessDesignation(sn, { mvk: bool(form, 'mvk') }) : null
  const wallMm = extras.wallMm ?? null

  const flow = num(form, 'rashod')
  const flowUnit = FLOW_UNIT_LABEL[str(form, 'rashodUnit') ?? 'l/s'] ?? 'л/с'
  const head = num(form, 'napor')

  const nsType = (str(form, 'tipNs') ?? 'Канализационная').toLowerCase()
  const dims = [
    dn != null ? `диаметром DN ${mm(dn)} мм` : null,
    full != null ? `высотой Hполная=${mm(full)} мм` : null,
    npodz != null ? `Hподзем=${mm(npodz)} мм` : null,
  ].filter((v): v is string => Boolean(v))

  const spec: ProductSpec = {
    deviceType: 'KNS',
    kind: `Стеклокомпозитная ${nsType} насосная станция`,
    mark: extras.mark ?? null,
    tu: extras.tu ?? TU_BY_DEVICE.KNS,
    capacity: flow != null ? `производительностью ${docNumber(flow)} ${flowUnit}` : null,
    dimensions: dims.length > 0 ? dims.join(', ') : null,
    snLabel,
    wallMm,
    tag: extras.tag ?? null,
  }

  const kit: KitItem[] = []
  const insulationMm = bool(form, 'insulation') ? num(form, 'tiGlubina') : null
  push(
    kit,
    shellName({
      dims: [
        dn != null ? `D=${mm(dn)} мм` : null,
        full != null ? `Hполная=${mm(full)} мм` : null,
        npodz != null ? `Hподзем=${mm(npodz)} мм` : null,
      ].filter((v): v is string => Boolean(v)),
      snLabel,
      wallMm,
      extra: [
        'с формованным днищем с разуклонкой',
        'с рамой для крепления насосного оборудования',
        insulationMm != null ? `с утеплением на глубину ${mm(insulationMm)} мм` : null,
      ],
    }),
    1,
  )

  push(kit, 'Люк стеклокомпозитный с замком натяжным и фиксатором в открытом положении', 1, KOMPL)
  push(kit, LADDER, 1)
  sleeve(kit, 'подводящего', num(form, 'podvDn'), count(form, 'podvKol'))
  sleeve(kit, 'напорного', num(form, 'napDn'), count(form, 'napKol'))
  push(kit, VENT, 1)

  const grinder = str(form, 'drobilka') ?? 'нет'
  if (grinder === 'корзина' || grinder === 'обе') {
    push(
      kit,
      'Корзина сороулавливающая из нержавеющей стали с цепью для опускания корзины',
      1,
      KOMPL,
    )
  }
  if (grinder === 'дробилка' || grinder === 'обе') {
    push(kit, 'Дробилка канализационная', 1)
  }

  // Напорная обвязка: количества арматуры лист считает сам (`derived`) —
  // подводящие задвижки, напорные задвижки и обратные клапаны.
  const napDn = num(form, 'napDn')
  const pressureGates = count(derived, 'balls')
  const checkValves = count(derived, 'checkValves')
  const pipeParts = [
    pressureGates > 0 ? `задвижками ${pressureGates} шт.` : null,
    checkValves > 0 ? `обратными клапанами ${checkValves} шт.` : null,
  ].filter(Boolean)
  push(
    kit,
    `Напорный трубопровод${napDn != null ? ` DN ${mm(napDn)}` : ''} из нержавеющей стали` +
      (pipeParts.length > 0 ? ` с ${pipeParts.join(' и ')}` : ''),
    1,
    KOMPL,
  )
  const inletGates = count(derived, 'gates')
  const podvDn = num(form, 'podvDn')
  push(
    kit,
    `Задвижка на подводящем трубопроводе${podvDn != null ? ` DN ${mm(podvDn)}` : ''}`,
    inletGates,
  )

  if (bool(form, 'emergency')) {
    const gm = str(form, 'muftaGm')
    push(
      kit,
      `Аварийный трубопровод с быстросъёмной муфтой${gm ? ` ГМ-${gm}` : ''}`,
      1,
      KOMPL,
    )
  }

  const pumps = count(form, 'nRab') + count(form, 'nRez') + count(form, 'nZap')
  if (pumps > 0) {
    const model = str(derived, 'pumpModel') ?? str(form, 'marka')
    const duty = [
      flow != null ? `Q=${docNumber(flow)} ${flowUnit}` : null,
      head != null ? `H=${docNumber(head)} м` : null,
    ].filter(Boolean)
    const roles = [
      count(form, 'nRab') > 0 ? `${count(form, 'nRab')} раб.` : null,
      count(form, 'nRez') > 0 ? `${count(form, 'nRez')} рез.` : null,
      count(form, 'nZap') > 0 ? `${count(form, 'nZap')} зап.` : null,
    ].filter(Boolean)
    const name = [
      'Насос погружной',
      model,
      bool(form, 'vzryv') ? 'во взрывозащищённом исполнении' : null,
      duty.length > 0 ? `(${duty.join(', ')})` : null,
      roles.length > 0 ? `(${roles.join(', ')})` : null,
    ]
      .filter(Boolean)
      .join(' ')
    push(kit, name, pumps)
    push(kit, 'Направляющие для насосов из нержавеющей стали', pumps, KOMPL)
    push(kit, `Автоматическая трубная муфта${napDn != null ? ` DN ${mm(napDn)}` : ''}`, pumps)
    push(kit, 'Цепь из нержавеющей стали с кольцами для опускания насосов', pumps)
  }

  // Датчик давления — на каждый насос (эталон: два насоса, два датчика).
  if (bool(form, 'datchikiDavl')) push(kit, 'Датчик давления', Math.max(pumps, 1))
  if (bool(form, 'datchikiUrov')) {
    push(kit, 'Погружной датчик уровня (гидростатического давления)', 1)
  }
  if (bool(form, 'rashodomer')) push(kit, 'Расходомер', 1)
  if (bool(form, 'shu')) {
    const kind = str(form, 'shuTip') === 'внутренний' ? 'внутреннего' : 'уличного'
    const start = SHU_START[str(form, 'shuPusk') ?? '']
    push(kit, `Шкаф управления ${kind} исполнения${start ? `, ${start}` : ''}`, 1, KOMPL)
  }

  push(kit, ANCHOR_KIT, 1, KOMPL)
  return { spec, kit }
}

// ─── Ёмкость ─────────────────────────────────────────────────────────────────

function emkDraft(survey: unknown, extras: ProductExtras): ProductDraft {
  const form = dict(survey, 'form')
  const emk = dict(survey, 'emk')
  const derived = dict(survey, 'derived')

  const dn = num(form, 'dn') ?? num(emk, 'dn')
  const volume = num(form, 'volumeM3') ?? num(emk, 'volumeM3')
  const horizontal = (str(form, 'placement') ?? 'вертикальное') === 'горизонтальное'
  // Длина корпуса: ручная из листа, иначе вычисленная листом (`derived`).
  const lengthMm = num(form, 'lengthManual') ?? num(derived, 'lengthMm') ?? num(emk, 'pipeLengthMm')
  const sn = num(derived, 'sn') ?? num(emk, 'sn')
  const snLabel = sn != null ? ringStiffnessDesignation(sn, { mvk: bool(form, 'mvk') }) : null
  const wallMm = extras.wallMm ?? null

  const tankType = (str(form, 'tankType') ?? 'Накопительная').toLowerCase()
  const sizeWord = horizontal ? 'длиной L=' : 'высотой H='
  const dims = [
    dn != null ? `диаметром DN ${mm(dn)} мм` : null,
    lengthMm != null ? `${sizeWord}${mm(lengthMm)} мм` : null,
  ].filter((v): v is string => Boolean(v))

  const spec: ProductSpec = {
    deviceType: 'EMK',
    kind: `Стеклокомпозитная ${tankType} ёмкость`,
    mark: extras.mark ?? null,
    tu: extras.tu ?? TU_BY_DEVICE.EMK,
    capacity: volume != null ? `объемом V=${docNumber(volume)} м³` : null,
    dimensions: dims.length > 0 ? dims.join(' и ') : null,
    snLabel,
    wallMm,
    tag: extras.tag ?? null,
  }

  const kit: KitItem[] = []
  const insulationMm = bool(form, 'insulation') ? num(form, 'tiGlubina') : null
  push(
    kit,
    shellName({
      dims: [
        dn != null ? `D=${mm(dn)} мм` : null,
        lengthMm != null ? `${horizontal ? 'L' : 'H'}=${mm(lengthMm)} мм` : null,
      ].filter((v): v is string => Boolean(v)),
      snLabel,
      wallMm,
      extra: [insulationMm != null ? `с утеплением на глубину ${mm(insulationMm)} мм` : null],
    }),
    1,
  )

  // Днища — только у горизонтальной: у вертикальной плоское дно и перекрытие.
  if (horizontal) {
    const bottoms = str(form, 'bottomType') ?? 'эллиптические'
    push(kit, `Днище стеклокомпозитное (${bottoms.replace(/ие$/, 'ое')})`, 2)
  }

  if (bool(form, 'hasShaft')) {
    const shafts = Math.max(count(form, 'shaftCount'), 1)
    const shaftD = num(form, 'shaftD')
    const shaftH = num(form, 'shaftH')
    const parts = [
      shaftD != null ? `DN ${mm(shaftD)} мм` : null,
      shaftH != null ? `высотой ${mm(shaftH)} мм` : null,
      bool(form, 'hasLadder') ? 'с лестницей из нержавеющей стали' : null,
      'с люком',
    ].filter(Boolean)
    push(kit, ['Шахта обслуживания из стеклокомпозита', ...parts].join(', '), shafts)
  }

  sleeve(kit, 'подводящего', num(form, 'podvDn'), count(form, 'podvKol'))
  sleeve(kit, 'отводящего', num(form, 'otvDn'), count(form, 'otvKol'))
  if (bool(form, 'ventilation')) push(kit, VENT, 1)
  if (bool(form, 'hasValves')) {
    const podvDn = num(form, 'podvDn')
    push(kit, `Задвижка на подводящем трубопроводе${podvDn != null ? ` DN ${mm(podvDn)}` : ''}`, 1)
  }

  const grinder = str(form, 'grinder') ?? 'нет'
  if (grinder === 'корзина' || grinder === 'обе') {
    push(kit, 'Корзина сороулавливающая из нержавеющей стали с цепью', 1, KOMPL)
  }
  if (grinder === 'дробилка' || grinder === 'обе') push(kit, 'Дробилка канализационная', 1)

  if (bool(form, 'hasPumps')) {
    const pumps = count(form, 'nRab') + count(form, 'nRez')
    const model = str(form, 'marka')
    push(kit, ['Насос погружной', model].filter(Boolean).join(' '), pumps)
    push(kit, 'Направляющие для насосов из нержавеющей стали', pumps, KOMPL)
  }
  if (bool(form, 'datchikiUrov')) push(kit, 'Погружной датчик уровня', 1)
  if (bool(form, 'shu')) push(kit, 'Шкаф управления', 1, KOMPL)

  // Горизонтальная крепится стяжными ремнями, вертикальная — анкерами
  // (Реверс §: у горизонтальной перекрытия нет).
  push(
    kit,
    horizontal
      ? 'Комплект крепления к бетонному основанию (ремень стяжной, анкерные болты, башмаки)'
      : ANCHOR_KIT,
    1,
    KOMPL,
  )
  return { spec, kit }
}

// ─── Колодец ─────────────────────────────────────────────────────────────────

function kolDraft(survey: unknown, extras: ProductExtras): ProductDraft {
  const form = dict(survey, 'form')
  const kol = dict(survey, 'kol')
  const derived = dict(survey, 'derived')

  const dn = num(form, 'dn') ?? num(kol, 'dn')
  const depth = num(form, 'depthMm') ?? num(kol, 'workingDepthMm')
  const elevation = num(form, 'elevationMm') ?? num(kol, 'elevationMm') ?? 0
  const neckH = bool(form, 'hasNeck') ? (num(form, 'neckH') ?? num(kol, 'neckHeightMm')) : null
  // Полную высоту считает лист (горловина у него включает возвышение); своя
  // арифметика — для листов, сохранённых до появления блока `derived`.
  const full = num(derived, 'totalDepthMm') ?? (depth != null ? depth + (neckH ?? 0) + elevation : null)
  const underground = full != null ? full - elevation : null
  const sn = num(derived, 'sn') ?? num(kol, 'sn')
  const snLabel = sn != null ? ringStiffnessDesignation(sn, { mvk: bool(form, 'mvk') }) : null
  const wallMm = extras.wallMm ?? null

  const wellType = (str(form, 'wellType') ?? 'Смотровой').toLowerCase()
  const dims = [
    dn != null ? `диаметром D=${mm(dn)} мм` : null,
    full != null ? `высотой Hполная=${mm(full)} мм` : null,
    underground != null ? `Hподзем=${mm(underground)} мм` : null,
  ].filter((v): v is string => Boolean(v))

  const spec: ProductSpec = {
    deviceType: 'KOL',
    kind: `Стеклокомпозитный колодец ${wellType}`,
    mark: extras.mark ?? null,
    tu: extras.tu ?? TU_BY_DEVICE.KOL,
    capacity: null,
    dimensions: dims.length > 0 ? dims.join(', ') : null,
    snLabel,
    wallMm,
    tag: extras.tag ?? null,
  }

  const kit: KitItem[] = []
  const insulationMm = bool(form, 'insulation') ? num(form, 'tiGlubina') : null
  const resin = str(form, 'resin')
  push(
    kit,
    shellName({
      dims: [
        dn != null ? `D=${mm(dn)} мм` : null,
        full != null ? `Hполная=${mm(full)} мм` : null,
        underground != null ? `Hподзем=${mm(underground)} мм` : null,
      ].filter((v): v is string => Boolean(v)),
      snLabel,
      wallMm,
      extra: [
        resin && resin !== 'Стандарт' ? `смола ${resin.toLowerCase()}` : null,
        insulationMm != null ? `с утеплением на глубину ${mm(insulationMm)} мм` : null,
      ],
    }),
    1,
  )

  if (bool(form, 'hasNeck')) {
    const neckD = num(form, 'neckD') ?? num(kol, 'neckDiameterMm')
    const parts = [
      neckD != null ? `DN ${mm(neckD)} мм` : null,
      neckH != null ? `высотой ${mm(neckH)} мм` : null,
      'с люком',
    ].filter(Boolean)
    push(kit, ['Горловина из стеклокомпозита', ...parts].join(', '), 1)
  }
  if (bool(form, 'hasLadder')) push(kit, LADDER, 1)

  sleeve(kit, 'подводящего', num(form, 'podvDn'), count(form, 'podvKol'))
  sleeve(kit, 'отводящего', num(form, 'otvDn'), count(form, 'otvKol'))
  push(kit, VENT, 1)

  if (bool(form, 'hasValves')) {
    const podvDn = num(form, 'podvDn')
    push(kit, `Задвижка на подводящем трубопроводе${podvDn != null ? ` DN ${mm(podvDn)}` : ''}`, 1)
  }
  const grinder = str(form, 'grinder') ?? 'нет'
  if (grinder === 'корзина' || grinder === 'обе') {
    push(kit, 'Корзина сороулавливающая из нержавеющей стали с цепью', 1, KOMPL)
  }
  if (grinder === 'дробилка' || grinder === 'обе') push(kit, 'Дробилка канализационная', 1)
  if (bool(form, 'datchiki')) push(kit, 'Датчик уровня', 1)
  if (bool(form, 'shu')) push(kit, 'Шкаф управления', 1, KOMPL)

  push(kit, ANCHOR_KIT, 1, KOMPL)
  return { spec, kit }
}

/**
 * Ключ трубы корпуса — DN, PN и SN опросного листа.
 *
 * По нему маршрут находит толщину стенки в таблице труб (`PipeWeight`):
 * характеристика печатается в наименовании изделия, а в самом листе её нет.
 * SN здесь реальный (5000/10000), а не обозначение по ТТ МВК: в таблице труб
 * лежит он же.
 */
export function shellPipeKey(
  survey: unknown,
): { dn: number; pn: number; sn: number } | null {
  const form = dict(survey, 'form')
  const derived = dict(survey, 'derived')
  const block = { ...dict(survey, 'kns'), ...dict(survey, 'emk'), ...dict(survey, 'kol') }

  const dn = num(form, 'dn') ?? num(block, 'dn')
  const pn = num(derived, 'pn') ?? num(block, 'pnSurvey') ?? num(block, 'pn')
  const sn = num(derived, 'sn') ?? num(block, 'sn')
  if (dn == null || pn == null || sn == null) return null
  return { dn, pn, sn }
}

/**
 * Черновик позиции КП по опросному листу.
 *
 * Тип изделия неизвестен (единица заведена до появления типов или тип чужой)
 * — возвращается пустой черновик: печатать выдуманное описание хуже, чем
 * дать менеджеру заполнить состав руками.
 */
export function buildProductDraft(
  deviceType: string,
  survey: unknown,
  extras: ProductExtras = {},
): ProductDraft {
  switch (deviceType as KpDeviceType) {
    case 'KNS':
      return knsDraft(survey, extras)
    case 'EMK':
      return emkDraft(survey, extras)
    case 'KOL':
      return kolDraft(survey, extras)
    default:
      return {
        spec: {
          deviceType: 'KNS',
          kind: 'Изделие из стеклокомпозита',
          mark: extras.mark ?? null,
          tu: extras.tu ?? null,
          capacity: null,
          dimensions: null,
          snLabel: null,
          wallMm: extras.wallMm ?? null,
          tag: extras.tag ?? null,
        },
        kit: [],
      }
  }
}
