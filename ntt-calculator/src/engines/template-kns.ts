/**
 * Шаблон изделия КНС и материализация из опросного листа
 * (§9.1 ТЗ, Механика §7.1, Библиотека §3).
 *
 * Реальный расчёт — не свободное дерево, а шаблонная спецификация: каркас
 * фиксирован, количества считаются формулами из ОЛ, цены тянутся из прайса,
 * инженер точечно переопределяет (§9.1).
 *
 * КНС/ЛНС/ДНС — ОДИН шаблон: изделия конструктивно идентичны, тип НС влияет
 * на подписи и входы, не на структуру (Реверс §1).
 *
 * Материализация (Библиотека §6.2): вставка копирует состав в расчёт с
 * ЗАФИКСИРОВАННЫМИ расчётными значениями, применёнными ценами и
 * коэффициентами. Расчёт самодостаточен — изменения каталога и прайса влияют
 * только на новые вставки.
 */

import {
  bottomMassKg,
  cutoutHours,
  insulation,
  laminationMassKg,
  marketableAppearanceHours,
  pipeLengthM,
} from './formulas'
import { FOT_K_LAMIN, FOT_K_MECH } from './fot'
import type { CostBucket } from './economics'
import {
  ballValveCount,
  floatSwitchCount,
  gateValveCount,
  pipeGradeName,
  pnForWeightLookup,
  sleeveDiameter,
} from './survey-kns'
import type { EngineRow } from './types'

// ─── Параметры ОЛ, от которых материализуется шаблон ────────────────────────

export interface KnsSurveyParams {
  /** DN корпуса, мм. */
  dn: number
  /** Глубина подземной части (Нподз), мм. */
  depthMm: number
  /** PN опросного листа (для КНС — 0,1, безнапорный). Идёт в НАИМЕНОВАНИЕ. */
  pnSurvey: number
  /** Номинальная жёсткость. */
  sn: number

  /** Подводящие патрубки. */
  inletDn: number
  inletCount: number
  /** Напорные патрубки. */
  outletDn: number
  outletCount: number

  pumpsWorking: number
  pumpsReserve: number

  /** Арматура на подводящем. */
  valveOnInlet: boolean
  /** Аварийный трубопровод. */
  emergencyPipeline: boolean

  /** Теплоизоляция и её глубина, мм. */
  insulationEnabled: boolean
  insulationDepthMm: number

  /** Кол-во корпусов (тираж). */
  tirage?: number
}

// ─── Материализованное дерево (Библиотека §6.3) ─────────────────────────────

export interface CalcRowNode extends EngineRow {
  /** Явная корзина итогов, если по ЕИ неотличима (труба/муфта). */
  bucket?: CostBucket
}

export interface CalcComponent {
  id: string
  /** Код узла каталога (A1…D5) — справочно, для аудита состава. */
  nodeCode?: string
  title: string
  enabled: boolean
  rows: CalcRowNode[]
}

export interface CalcSection {
  id: string
  /** Номер раздела «1»…«7» — порядок фиксирован (Реверс §4.2). */
  code: string
  title: string
  enabled: boolean
  components: CalcComponent[]
}

export interface CalcTree {
  deviceType: 'KNS'
  /** Параметры ОЛ на момент материализации — расчёт самодостаточен. */
  survey: KnsSurveyParams
  /** Версия прайса, применённая при материализации (ТЗ §3). */
  priceListVersion: number
  sections: CalcSection[]
}

/**
 * Контекст материализации: справочники приходят снаружи, движок остаётся
 * чистым и тестируемым без БД.
 */
export interface MaterializeContext {
  /** Цена по тройке (категория, наименование, ЕИ). `null` — промах прайса. */
  priceOf(category: string, name: string, unit: string): number | null
  /** Вес трубы кг/пм по (DN; PN_ТРУБЫ; SN). `null` — промах справочника. */
  pipeWeightOf(dn: number, pn: number, sn: number): number | null
  priceListVersion: number
}

/** Каркас 7 разделов КНС — порядок фиксирован (§9.1 ТЗ). */
export const KNS_SECTIONS: ReadonlyArray<{ code: string; title: string }> = [
  { code: '1', title: 'Корпус' },
  { code: '2', title: 'Лестница' },
  { code: '3', title: 'Перекрытие, площадка, несущие балки' },
  { code: '4', title: 'Вентиляционный стояк' },
  { code: '5', title: 'Напорный трубопровод' },
  { code: '6', title: 'Крепёж' },
  { code: '7', title: 'Оборудование и запорная арматура' },
]

// ─── Хелперы построения строк ───────────────────────────────────────────────

let seq = 0
const nextId = (prefix: string) => `${prefix}-${(++seq).toString(36)}`

/** Сбрасывает счётчик id — только для детерминированных тестов. */
export function __resetIds(): void {
  seq = 0
}

interface RowSpec {
  kind: EngineRow['kind']
  category: EngineRow['category']
  name: string
  unit: string
  qtyCalc: number | null
  fotK?: number
  bucket?: CostBucket
  note?: string
}

function makeRow(ctx: MaterializeContext, spec: RowSpec): CalcRowNode {
  return {
    id: nextId('r'),
    kind: spec.kind,
    category: spec.category,
    name: spec.name,
    unit: spec.unit,
    qtyCalc: spec.qtyCalc,
    qtyManual: null,
    // Материализация ФИКСИРУЕТ применённую цену (Библиотека §6.2).
    priceCatalog: ctx.priceOf(spec.category, spec.name, spec.unit),
    priceManual: null,
    fotK: spec.fotK,
    bucket: spec.bucket,
    enabled: true,
    note: spec.note,
  }
}

/** Операция + парный ФОТ-спутник: ФОТ — производная, не отдельный ввод. */
function operationWithFot(
  ctx: MaterializeContext,
  spec: Omit<RowSpec, 'kind'> & { fotK: number },
): CalcRowNode[] {
  const op = makeRow(ctx, { ...spec, kind: 'ОПЕРАЦИЯ' })
  const fot: CalcRowNode = {
    id: nextId('r'),
    kind: 'ФОТ',
    category: 'ФОТ',
    name: 'ФОТ',
    unit: 'чел. ч',
    qtyCalc: 0, // проставит recalcFotSatellites
    qtyManual: null,
    priceCatalog: ctx.priceOf('ФОТ', 'ФОТ', 'чел. ч'),
    priceManual: null,
    fotK: spec.fotK,
    parentId: op.id,
    enabled: true,
  }
  return [op, fot]
}

// ─── Раздел 1: Корпус ────────────────────────────────────────────────────────

function buildKorpus(ctx: MaterializeContext, s: KnsSurveyParams): CalcComponent[] {
  const lengthM = pipeLengthM(s.depthMm)
  const components: CalcComponent[] = []

  // A1 — Обечайка корпуса.
  const pnPipe = pnForWeightLookup(s.pnSurvey, s.dn, s.sn)
  const kgPerM = ctx.pipeWeightOf(s.dn, pnPipe, s.sn)
  const pipeName = pipeGradeName(s.dn, s.pnSurvey, s.sn)

  components.push({
    id: nextId('c'),
    nodeCode: 'A1',
    title: 'Обечайка корпуса',
    enabled: true,
    rows: [
      {
        ...makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Собственное производство',
          name: pipeName,
          unit: 'м',
          qtyCalc: lengthM,
          bucket: 'Труба, муфта',
          note:
            kgPerM == null
              ? `Вес трубы не найден в справочнике (DN ${s.dn}; PN ${pnPipe}; SN ${s.sn})`
              : `${kgPerM} кг/пм · PN трубы ${pnPipe} (автоподбор)`,
        }),
        // Цена трубы корпуса договорная — типовое место ручного ввода
        // (Механика §5.2). Строка рождается «красной» намеренно.
        priceCatalog: null,
      },
      makeRow(ctx, {
        kind: 'ОПЕРАЦИЯ',
        category: 'Работы',
        name: 'Придание изделию товарного вида',
        unit: 'чел. ч',
        qtyCalc: marketableAppearanceHours(s.dn, lengthM),
      }),
    ],
  })

  // A2 — Днище формованное + ламинирование, каждое со своим ФОТ.
  const bottom = bottomMassKg(s.dn)
  components.push({
    id: nextId('c'),
    nodeCode: 'A2',
    title: 'Днище',
    enabled: true,
    rows: [
      ...operationWithFot(ctx, {
        category: 'Собственное производство',
        name: 'Механическое формованное дно',
        unit: 'кг',
        qtyCalc: bottom,
        fotK: FOT_K_MECH,
      }),
      ...operationWithFot(ctx, {
        category: 'Собственное производство',
        name: 'Ламинирование дна к фальшполу',
        unit: 'кг',
        qtyCalc: laminationMassKg(bottom),
        fotK: FOT_K_LAMIN,
      }),
    ],
  })

  // A5 — Патрубки: подводящие и напорные, каждый со своей гильзой.
  const nozzles: Array<{ title: string; dn: number; count: number }> = [
    { title: 'Патрубок подводящий', dn: s.inletDn, count: s.inletCount },
    { title: 'Патрубок напорный', dn: s.outletDn, count: s.outletCount },
  ]

  for (const n of nozzles) {
    if (n.count <= 0) continue
    const sleeve = sleeveDiameter(n.dn)
    components.push({
      id: nextId('c'),
      nodeCode: 'A5',
      title: `${n.title} DN${n.dn} ×${n.count}`,
      enabled: true,
      rows: [
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Собственное производство',
          name: `Стеклокомпозитная гильза Ø${sleeve}`,
          unit: 'шт',
          qtyCalc: n.count,
          note: `Ø гильзы = CEILING(DN${n.dn}+100) = ${sleeve} мм`,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Работы',
          name: 'Прорезка отверстия',
          unit: 'чел. ч',
          qtyCalc: cutoutHours(sleeve, n.count),
        }),
      ],
    })
  }

  // A9 — Теплоизоляция: включается флагом ОЛ (Механика §7.2).
  const ins = insulation(s.dn, s.insulationDepthMm)
  components.push({
    id: nextId('c'),
    nodeCode: 'A9',
    title: 'Теплоизоляция корпуса',
    // Выключённый узел не удаляется: строки остаются «призраками», включение
    // обратно восстанавливает всё, включая overrides (Механика §7.2).
    enabled: s.insulationEnabled,
    rows: [
      makeRow(ctx, {
        kind: 'МАТЕРИАЛ',
        category: 'Прочие материалы',
        name: 'Изофом ППЭ ОР 15 1,5х40',
        unit: 'м²',
        qtyCalc: ins.totalM2,
      }),
      ...operationWithFot(ctx, {
        category: 'Собственное производство',
        name: 'Защитный слой ламинации теплоизоляции',
        unit: 'кг',
        qtyCalc: ins.protectiveLayerKg,
        fotK: FOT_K_LAMIN,
      }),
      makeRow(ctx, {
        kind: 'ОПЕРАЦИЯ',
        category: 'Работы',
        name: 'Монтаж теплоизоляции',
        unit: 'чел. ч',
        qtyCalc: ins.mountingHours,
      }),
    ],
  })

  return components
}

// ─── Раздел 7: Оборудование (частично — насосная группа и арматура) ─────────

function buildEquipment(ctx: MaterializeContext, s: KnsSurveyParams): CalcComponent[] {
  const gates = gateValveCount(s.inletCount, s.valveOnInlet)
  const balls = ballValveCount(s.pumpsWorking, s.pumpsReserve, s.emergencyPipeline)

  return [
    {
      id: nextId('c'),
      nodeCode: 'C4',
      title: 'Узел запорной арматуры',
      enabled: true,
      rows: [
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Запорная арматура',
          name: `Задвижка чугунная клиновая DN${s.inletDn}`,
          unit: 'шт',
          qtyCalc: gates,
          note: `= кол-во подводящих (${s.inletCount}) × флаг «арматура на подводящем»`,
        }),
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Запорная арматура',
          name: `Кран шаровой DN${s.outletDn}`,
          unit: 'шт',
          qtyCalc: balls,
          note: `= (раб ${s.pumpsWorking} + рез ${s.pumpsReserve}) + 1 коллектор${s.emergencyPipeline ? ' + 1 аварийный' : ''}`,
        }),
      ],
    },
    {
      id: nextId('c'),
      nodeCode: 'D1',
      title: 'Насосная группа',
      enabled: true,
      rows: [
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Насосы, АТМ',
          name: 'Насос',
          unit: 'шт',
          qtyCalc: s.pumpsWorking + s.pumpsReserve,
        }),
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Выключатели',
          name: 'Поплавковый выключатель',
          unit: 'шт',
          qtyCalc: floatSwitchCount(s.pumpsWorking, s.pumpsReserve),
          note: '= раб + рез + 2',
        }),
      ],
    },
  ]
}

// ─── Материализация ──────────────────────────────────────────────────────────

/**
 * «Создать расчёт» из ОЛ: материализует шаблон КНС в дерево расчёта.
 *
 * Разделы 2–6 создаются каркасом без строк — их состав сильно варьирует между
 * заказами (прежде всего «Напорный трубопровод», Реверс §4.2), инженер
 * наполняет их вручную. Это осознанное ограничение Фазы 1, зафиксированное
 * в задаче: «остальные разделы — каркас с ручными строками».
 */
export function materializeKns(ctx: MaterializeContext, survey: KnsSurveyParams): CalcTree {
  const byCode: Record<string, CalcComponent[]> = {
    '1': buildKorpus(ctx, survey),
    '7': buildEquipment(ctx, survey),
  }

  const sections: CalcSection[] = KNS_SECTIONS.map((s) => ({
    id: nextId('s'),
    code: s.code,
    title: s.title,
    enabled: true,
    components: byCode[s.code] ?? [],
  }))

  return {
    deviceType: 'KNS',
    survey,
    priceListVersion: ctx.priceListVersion,
    sections,
  }
}

/** Все строки дерева единым списком — вход агрегатора экономики. */
export function flattenRows(tree: CalcTree): CalcRowNode[] {
  return tree.sections.flatMap((s) => s.components.flatMap((c) => c.rows))
}

/**
 * Включён ли раздел/компонент для конкретной строки: выключение любого уровня
 * обнуляет количество (Механика §7.2).
 */
export function sectionEnabledFor(tree: CalcTree): (row: EngineRow) => boolean {
  const map = new Map<string, boolean>()
  for (const s of tree.sections) {
    for (const c of s.components) {
      for (const r of c.rows) map.set(r.id, s.enabled && c.enabled)
    }
  }
  return (row) => map.get(row.id) ?? true
}
