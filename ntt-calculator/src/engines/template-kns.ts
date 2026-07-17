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
  anchorCount,
  bottomMassKg,
  cutoutHours,
  insulation,
  ladder,
  laminationMassKg,
  marketableAppearanceHours,
  pipeLengthM,
  pumpGuidesM,
  topSlabMassKg,
  type NozzleNorm,
} from './formulas'
import { FOT_K_LAMIN, FOT_K_MANUAL, FOT_K_MECH } from './fot'
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
  /**
   * Строка добавлена инженером вручную. Строки шаблона удалять нельзя —
   * только выключать; удалять можно лишь добавленные (Механика §12.5).
   */
  isCustom?: boolean
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
  /**
   * Нормы простого патрубка по DN (лист «Для расчетов»). `null` — нормы нет:
   * сетка дискретна, интерполировать нормы формовки недопустимо.
   */
  nozzleNormOf?(dn: number): NozzleNorm | null
  priceListVersion: number
}

/**
 * Толщина защитного слоя ламинации теплоизоляции, мм.
 *
 * У КНС — 5 мм, у колодца — 4 мм (Реверс §4.3). В прайсе это две разные
 * позиции, и толщина входит в наименование, поэтому константа задаётся здесь,
 * а не в формуле: она нужна и для массы, и для ключа поиска цены.
 */
const INSULATION_LAYER_MM = 5

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
        // Категория «Собственное производство», а НЕ «Работы»: в прайсе НН
        // категория «Работы» пуста (0 позиций из 1040) — весь труд лежит в
        // «Собственном производстве». Строка с «Работы» всегда была бы красной.
        category: 'Собственное производство',
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
  // Наименования и категории — ДОСЛОВНО из прайса НН: ключ поиска это тройка
  // (категория, наименование, ЕИ), и любое расхождение даёт «красную» строку.
  const nozzles: Array<{ title: string; dn: number; count: number; cutoutName: string }> = [
    {
      title: 'Патрубок подводящий',
      dn: s.inletDn,
      count: s.inletCount,
      cutoutName: 'Прорезка отверстия под гильзу входящего патрубка',
    },
    {
      title: 'Патрубок напорный',
      dn: s.outletDn,
      count: s.outletCount,
      cutoutName: 'Прорезка отверстия под гильзу напорного патрубка (ов)',
    },
  ]

  for (const n of nozzles) {
    if (n.count <= 0) continue
    const sleeve = sleeveDiameter(n.dn)
    // Нормы приходят через контекст: движок остаётся чистым от БД.
    const norm = ctx.nozzleNormOf?.(sleeve) ?? null
    const sleeveMass = norm ? norm.moldingMassKg * n.count : null
    components.push({
      id: nextId('c'),
      nodeCode: 'A5',
      title: `${n.title} DN${n.dn} ×${n.count}`,
      enabled: true,
      rows: [
        // Гильза в прайсе — «Формовка гильз» в КГ, а не штучная позиция.
        // ❗ Масса формовки = f(DN) берётся из матрицы листа «Для расчетов»,
        // которая пока не извлечена (План: этап 1 извлёк прайс и веса труб).
        // До извлечения количество остаётся ручным вводом: молча подставить
        // выдуманную массу было бы хуже пустой строки.
        // Масса формовки гильзы — из норм листа «Для расчетов» по ДИАМЕТРУ
        // ГИЛЬЗЫ (формуется она, а не патрубок). ФОТ-спутник обязателен для
        // каждой операции с ЕИ «кг» (Механика §6).
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Формовка гильз',
          unit: 'кг',
          qtyCalc: sleeveMass,
          fotK: FOT_K_MANUAL,
          note:
            sleeveMass == null
              ? `Гильза Ø${sleeve} мм (CEILING(DN${n.dn}+100)) ×${n.count} · нормы формовки для Ø${sleeve} в матрице «Для расчетов» нет — введите массу вручную`
              : `ƒ Мф(Ø${sleeve}) × ${n.count} = ${sleeveMass.toFixed(2)} кг · гильза = CEILING(DN${n.dn}+100)`,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: n.cutoutName,
          unit: 'чел. ч',
          qtyCalc: cutoutHours(sleeve, n.count),
          note: `ƒ Ø${sleeve}·π/1000 × 0,5 чел.ч/м × ${n.count}`,
        }),
      ],
    })
  }

  // A9 — Теплоизоляция: включается флагом ОЛ (Механика §7.2).
  const ins = insulation(s.dn, s.insulationDepthMm, { protectiveThickness: INSULATION_LAYER_MM / 1000 })
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
        // Наименование в НН — с префиксом «Теплоизоляция - » (750 ₽/м²).
        // README хендоффа приводит его без префикса и с ценой 890 — это данные
        // мок-прототипа, а не прайса.
        name: 'Теплоизоляция - Изофом ППЭ ОР 15 1,5х40',
        unit: 'м²',
        qtyCalc: ins.totalM2,
        note: `ƒ π·(DN/1000)·h + π·(DN/2000)² = ${ins.totalM2.toFixed(1)} м²`,
      }),
      // В прайсе две позиции, различающиеся толщиной слоя: «5 мм» и «4 мм».
      // Это подтверждает Реверс §4.3 (S·0,005·1850 у КНС, 0,004 у колодца) —
      // толщина зашита в наименование, поэтому имя выводится из параметра.
      ...operationWithFot(ctx, {
        category: 'Собственное производство',
        name: `Защитный слой ламинации ${INSULATION_LAYER_MM} мм на теплоизоляцию`,
        unit: 'кг',
        qtyCalc: ins.protectiveLayerKg,
        fotK: FOT_K_LAMIN,
      }),
      makeRow(ctx, {
        kind: 'ОПЕРАЦИЯ',
        category: 'Собственное производство',
        name: 'Монтаж теплоизоляции',
        unit: 'чел. ч',
        qtyCalc: ins.mountingHours,
        note: 'ƒ 1 чел.ч на 1 м²',
      }),
    ],
  })

  return components
}

// ─── Раздел 2: Лестница (Библиотека B1) ─────────────────────────────────────

function buildLadder(ctx: MaterializeContext, s: KnsSurveyParams): CalcComponent[] {
  const heightM = s.depthMm / 1000
  const l = ladder(heightM)

  return [
    {
      id: nextId('c'),
      nodeCode: 'B1',
      title: 'Лестница нержавеющая',
      enabled: true,
      rows: [
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Изготовление Лестницы',
          unit: 'чел. ч',
          qtyCalc: l.fabricationHours,
          note: `ƒ 1,25 × H (${heightM.toFixed(1)} м)`,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Монтаж Лестницы',
          unit: 'чел. ч',
          qtyCalc: l.mountingHours,
          note: 'ƒ изготовление / 2',
        }),
      ],
    },
  ]
}

// ─── Раздел 3: Перекрытие, площадка, несущие балки (B2, B6) ─────────────────

function buildSlab(ctx: MaterializeContext, s: KnsSurveyParams): CalcComponent[] {
  const slabMass = topSlabMassKg(s.dn)
  // Наружный диаметр ≈ DN + 300 (по геометрии формовки, Реверс §4.3).
  const outerD = (s.dn + 300) / 1000
  const anchors = anchorCount(outerD, s.depthMm / 1000)

  return [
    {
      id: nextId('c'),
      nodeCode: 'B2',
      title: 'Перекрытие верхнее',
      enabled: true,
      rows: [
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Механическая формовка верхнего перекрытия',
          unit: 'кг',
          qtyCalc: slabMass,
          fotK: FOT_K_MECH,
          note: `ƒ π·((DN+300)/2000)²·0,006·1850 = ${slabMass.toFixed(1)} кг`,
        }),
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинирование верхнего перекрытия',
          unit: 'кг',
          qtyCalc: laminationMassKg(slabMass),
          fotK: FOT_K_LAMIN,
          note: 'ƒ масса перекрытия × 3/10',
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Прорезка люков (горловин) в стеклокомпозитном перекрытии',
          unit: 'чел. ч',
          // Кол-во люков в ОЛ не задаётся — типовой один; уточняется вручную.
          qtyCalc: cutoutHours(800, 1),
          note: 'ƒ Ø800·π/1000 × 0,5 чел.ч · один люк типовой, уточните вручную',
        }),
      ],
    },
    {
      id: nextId('c'),
      nodeCode: 'B6',
      title: 'Анкерное крепление против всплытия',
      enabled: true,
      rows: [
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Метизы',
          name: 'Анкерный болт распорный 16х100',
          unit: 'шт',
          qtyCalc: Math.ceil(anchors),
          note: `ƒ (глубина·1000·9,8·π·Дн²/4)/27500, Дн ${outerD.toFixed(2)} м → ${anchors.toFixed(1)} → ${Math.ceil(anchors)} шт`,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Монтаж анкерных болтов к плите перекрытия',
          unit: 'чел. ч',
          qtyCalc: Math.ceil(anchors) * 0.5,
          note: 'ƒ 0,5 чел.ч на анкер',
        }),
      ],
    },
  ]
}

// ─── Раздел 4: Вентиляционный стояк (C1) ────────────────────────────────────

function buildVent(ctx: MaterializeContext): CalcComponent[] {
  // Ø вентстояка в ОЛ не задаётся; типовой ПЭ Ду110 — под него есть дефлектор.
  const VENT_D = 110

  return [
    {
      id: nextId('c'),
      nodeCode: 'C1',
      title: 'Вентиляционный стояк ПЭ Ду110',
      enabled: true,
      rows: [
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Детали труб_да ПЭ ПВХ PPR',
          name: 'Дефлектор ПВХ Ду110',
          unit: 'шт',
          qtyCalc: 1,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Прорезка отверстия вентиляции в перекрытии',
          unit: 'чел. ч',
          qtyCalc: cutoutHours(VENT_D, 1),
          note: `ƒ Ø${VENT_D}·π/1000 × 0,5 чел.ч`,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Монтаж вентиляционного стояка',
          unit: 'чел. ч',
          qtyCalc: 3,
          note: 'ƒ норматив 3 чел.ч (Библиотека C1)',
        }),
      ],
    },
  ]
}

// ─── Раздел 5: Напорный трубопровод (C2) ────────────────────────────────────

function buildPressurePipe(ctx: MaterializeContext, s: KnsSurveyParams): CalcComponent[] {
  const guides = pumpGuidesM(s.depthMm / 1000, s.pumpsWorking, s.pumpsReserve)

  return [
    {
      id: nextId('c'),
      nodeCode: 'C2',
      title: `Нитка напорного трубопровода DN${s.outletDn} ×${s.outletCount}`,
      enabled: true,
      rows: [
        // Состав ниток — САМАЯ вариативная часть между заказами (Реверс §4.2:
        // 55–109 строк). Материализуем только то, что считается из ОЛ;
        // отводы, тройники и фланцы инженер добавляет из каталога.
        //
        // «Направляющие насосов» в прайсе — это ТРУД (изготовление + монтаж),
        // а не метраж материала: категория «Собственное производство», ЕИ
        // «чел. ч». Длина направляющих (guides, м) идёт нормативом на труд.
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Изготовление направляющих насосов',
          unit: 'чел. ч',
          // Норматив: ~0,25 чел.ч на 1 м направляющих (совпадает с B5 «0,5 на
          // башмак» удвоенно на изготовление+монтаж; уточняется вручную).
          qtyCalc: guides * 0.25,
          note: `ƒ L·(раб+рез)·2 = ${guides.toFixed(1)} м · 0,25 чел.ч/м · норматив, уточните`,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Монтаж направляющих насосов',
          unit: 'чел. ч',
          qtyCalc: guides * 0.25,
          note: 'ƒ как изготовление',
        }),
      ],
    },
  ]
}

/**
 * Полное наименование болта из марки норм.
 *
 * Нормы дают краткую марку «М20х90», а в прайсе НН имя полное и единообразное:
 * «Болт М20-6gх90.58.12Х18Н10Т ГОСТ 7798-70 (DIN 931, DIN 933)». Проверено:
 * все четыре марки норм (М16х80, М20х90, М24х100, М27х110) находятся по
 * этому шаблону.
 */
export function boltFullName(bolt: string): string {
  const m = /^М(\d+)х(\d+)$/.exec(bolt)
  if (!m) return `Болт ${bolt}`
  return `Болт М${m[1]}-6gх${m[2]}.58.12Х18Н10Т ГОСТ 7798-70 (DIN 931, DIN 933)`
}

// ─── Раздел 6: Крепёж (C3) ──────────────────────────────────────────────────

function buildFasteners(ctx: MaterializeContext, s: KnsSurveyParams): CalcComponent[] {
  // Норма болтов на фланцевое соединение = f(DN) из матрицы «Для расчетов».
  const norm = ctx.nozzleNormOf?.(s.outletDn) ?? null
  const joints = s.outletCount
  const bolts = norm?.boltCount != null ? norm.boltCount * joints : null

  return [
    {
      id: nextId('c'),
      nodeCode: 'C3',
      title: 'Крепёжный комплект фланцевых соединений',
      enabled: true,
      rows: [
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Метизы',
          // Полное наименование болта из прайса: у каждого DN своя марка
          // (М16х80…М27х110), а имя строится по единому шаблону НН
          // «Болт {М}-6gх{L}.58.12Х18Н10Т ГОСТ 7798-70 (DIN 931, DIN 933)».
          name: norm?.bolt ? boltFullName(norm.bolt) : 'Болт фланцевого соединения',
          unit: 'шт',
          qtyCalc: bolts,
          note:
            bolts == null
              ? `Норма крепежа для DN${s.outletDn} в матрице «Для расчетов» не найдена — введите вручную`
              : `ƒ ${norm!.boltCount} отв. × ${joints} соединений = ${bolts} шт (${norm!.bolt})`,
        }),
      ],
    },
  ]
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
        // Наименование в НН содержит полную спецификацию
        // («…металл/металл DN50 PN10/16 клин бронза»), и позиции есть не для
        // всех DN. Подбор конкретной позиции — за инженером: он выбирает её
        // из прайса. Количество при этом посчитано.
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Запорная арматура',
          name: `Задвижка чугунная клиновая металл/металл DN${s.inletDn} PN10/16 клин бронза`,
          unit: 'шт',
          qtyCalc: gates,
          note: `ƒ = подводящих (${s.inletCount}) × флаг «арматура на подводящем»`,
        }),
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Прочее оборудование',
          name: `Кран шаровой DN${s.outletDn}`,
          unit: 'шт',
          qtyCalc: balls,
          note: `ƒ = (раб ${s.pumpsWorking} + рез ${s.pumpsReserve}) + коллектор 1${s.emergencyPipeline ? ' + аварийный 1' : ''}`,
        }),
      ],
    },
    {
      id: nextId('c'),
      nodeCode: 'D1',
      title: 'Насосная группа',
      enabled: true,
      rows: [
        // В категории «Насосы, АТМ» прайс НН НЕ содержит ни одной позиции:
        // насос подбирается под проект (марка из гидравлического расчёта),
        // цена договорная. Строка рождается «красной» намеренно — так же, как
        // труба корпуса (Механика §5.2).
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Насосы, АТМ',
          name: 'Насос (марка по подбору)',
          unit: 'шт',
          qtyCalc: s.pumpsWorking + s.pumpsReserve,
          note: `ƒ = раб ${s.pumpsWorking} + рез ${s.pumpsReserve} · цена договорная, в прайсе насосов нет`,
        }),
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Выключатели',
          // Наименование в НН — капсом и с длиной кабеля.
          name: 'ПОПЛАВКОВЫЙ ВЫКЛЮЧАТЕЛЬ  КАБЕЛЬ 10 М',
          unit: 'шт',
          qtyCalc: floatSwitchCount(s.pumpsWorking, s.pumpsReserve),
          note: 'ƒ = раб + рез + 2',
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Монтаж Поплавковых выключателей',
          unit: 'чел. ч',
          qtyCalc: floatSwitchCount(s.pumpsWorking, s.pumpsReserve),
          note: 'ƒ 1 чел.ч — 1 выключатель',
        }),
      ],
    },
  ]
}

// ─── Материализация ──────────────────────────────────────────────────────────

/**
 * «Создать расчёт» из ОЛ: материализует шаблон КНС в дерево расчёта.
 *
 * Материализуется всё, что ВЫВОДИТСЯ из опросного листа. То, чего в ОЛ нет
 * (схема ниток напорного трубопровода, кол-во люков, состав площадки),
 * инженер добавляет из каталога: «число строк внутри разделов — прежде всего
 * "Напорный трубопровод" и "Оборудование" — меняется от расчёта к расчёту»
 * (Реверс §10). Раздел 5 в реальных файлах занимает 55–109 строк, и вывести
 * их из ОЛ нечем.
 */
export function materializeKns(ctx: MaterializeContext, survey: KnsSurveyParams): CalcTree {
  const byCode: Record<string, CalcComponent[]> = {
    '1': buildKorpus(ctx, survey),
    '2': buildLadder(ctx, survey),
    '3': buildSlab(ctx, survey),
    '4': buildVent(ctx),
    '5': buildPressurePipe(ctx, survey),
    '6': buildFasteners(ctx, survey),
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
