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
  pressureFlangeCount,
  pumpGuidesM,
  topSlabMassKg,
  type NozzleNorm,
} from './formulas'
import { FOT_K_LAMIN, FOT_K_MANUAL, FOT_K_MECH } from './fot'
import type { CostBucket } from './economics'
import {
  DEFAULT_HOSE_NUT_GM,
  hoseNutItem,
  HOSE_NUT_NOZZLES,
  PRESSURE_PIPE_EXTRAS,
  PRESSURE_PIPE_HOURS,
  PRESSURE_PIPE_KITS,
  type KitItem,
} from './pressure-pipe-kit'
import {
  checkValveCount,
  floatSwitchCount,
  gateValveCount,
  pipeGradeName,
  pnForWeightLookup,
  pressureGateValveCount,
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
  /** Расчётная жёсткость (5000 или 10000) — от неё вес и трудоёмкость. */
  sn: number
  /**
   * Объект по ТТ МВК: в МАРКЕ трубы жёсткость обозначается как 8000/12000
   * (та же труба плюс две нитки ровинга). На массу и габариты не влияет.
   */
  mvk?: boolean

  /** Подводящие патрубки. */
  inletDn: number
  inletCount: number
  /** Напорные патрубки. */
  outletDn: number
  outletCount: number

  pumpsWorking: number
  pumpsReserve: number
  /**
   * Марка насоса: подобрана сервером по притоку, напору и числу рабочих
   * (`/api/pump-station/select-pump`) либо введена инженером вручную.
   *
   * Пусто — подбор не дал результата или поля ОЛ не заполнены; тогда строка
   * называется обобщённо и требует ручного уточнения перед выпуском КП.
   */
  pumpModel?: string | null

  /** Арматура на подводящем. */
  valveOnInlet: boolean
  /** Аварийный трубопровод. */
  emergencyPipeline: boolean
  /**
   * Размер быстросъёмной (пожарной) гайки аварийной линии, ГМ.
   *
   * Сам аварийный трубопровод идёт тем же DN, что напорный, а гайка — нет:
   * ею определяется, чем подключится машина. В прайсе ГМ50…ГМ150 с разбросом
   * цены в восемь раз, поэтому размер задаётся в ОЛ, а не выводится.
   */
  emergencyHoseNutGm?: number
  /**
   * Расходомер на напорной линии (флаг ОЛ, блок автоматики).
   *
   * Влияет не только на сам прибор: расходомер врезается в разрыв нитки и
   * требует двух фланцевых патрубков — см. `pressureFlangeCount`.
   */
  hasFlowMeter?: boolean

  /** Теплоизоляция и её глубина, мм. */
  insulationEnabled: boolean
  insulationDepthMm: number

  /**
   * Исполнение корпуса (лист КНС, ячейка E14 — «Списки»!AI2/AI3).
   *
   * `целая` — обечайка из одной трубы, так делается по умолчанию.
   * `частями` — труба режется на сегменты и сваривается на месте: добавляются
   * сегменты со своим приданием товарного вида и ламинирование стыков.
   * В эталоне весь этот блок обнуляется при «целой трубе»
   * (`IF($E$14=Списки!$AI$2;0;…)` в строках 18–21).
   */
  pipeExecution?: 'целая' | 'частями'

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

/** Тип изделия (ТЗ §3) — определение в `types/device.ts`, здесь реэкспорт. */
export type { DeviceType } from '@/types/device'
import type { DeviceType } from '@/types/device'

export interface CalcTree {
  deviceType: DeviceType
  /**
   * Параметры ОЛ на момент материализации — расчёт самодостаточен.
   * Тип зависит от изделия: KnsSurveyParams / EmkSurveyParams / KolSurveyParams.
   */
  survey: Record<string, unknown>
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
  /**
   * Мс — масса формованных слоёв на стыке, кг, по Dу (лист «Для расчетов»,
   * J36:S143). `null` — строки нет: сетка дискретна, 1000…3000 через 100.
   *
   * Давление в ключ не входит намеренно: оба калькулятора эталона берут
   * значение при PN = 4 независимо от давления изделия (в листе под это
   * заведена отдельная колонка). Вопрос заводу открыт; когда ответят,
   * поменяется выборка, а таблица в БД уже полная.
   */
  jointLayerMassOf?(d: number): number | null
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
/** Общий генератор id узлов: переиспользуется шаблонами ЕМК и КОЛ. */
export const nextId = (prefix: string) => `${prefix}-${(++seq).toString(36)}`

/** Сбрасывает счётчик id — только для детерминированных тестов. */
export function __resetIds(): void {
  seq = 0
}

export interface RowSpec {
  kind: EngineRow['kind']
  category: EngineRow['category']
  name: string
  unit: string
  qtyCalc: number | null
  fotK?: number
  bucket?: CostBucket
  note?: string
}

export function makeRow(ctx: MaterializeContext, spec: RowSpec): CalcRowNode {
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
export function operationWithFot(
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
  const pipeName = pipeGradeName(s.dn, s.pnSurvey, s.sn, { mvk: s.mvk })

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

  // A1 (продолжение) — исполнение «труба частями»: сегменты и стыки.
  //
  // Длины сегментов эталон НЕ выводит: в листе строки 16 и 18 ждут ручного
  // ввода, потому что раскрой зависит от того, какой отрезок трубы нашёлся на
  // складе. Поэтому сегменты создаются с пустым количеством — инженер
  // разносит по ним общую длину, включая правку первой строки.
  //
  // Ламинирование стыков, наоборот, детерминировано: Мс из справочника.
  // Коэффициент ФОТ здесь 1, а не 0,56, как у прочего ламинирования, — так в
  // эталоне (строка 21: «*ламин*» → 1).
  if (s.pipeExecution === 'частями') {
    const jointMass = ctx.jointLayerMassOf?.(s.dn) ?? null
    const segmentRows: CalcRowNode[] = []

    for (const n of [2, 3]) {
      segmentRows.push(
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Собственное производство',
          name: pipeName,
          unit: 'м',
          qtyCalc: null,
          bucket: 'Труба, муфта',
          note: `Сегмент ${n} — длину введите вручную, разнеся общие ${lengthM.toLocaleString('ru-RU')} м`,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Придание изделию товарного вида',
          unit: 'чел. ч',
          qtyCalc: null,
          note: `ƒ DN/1300 × длина сегмента ${n} — введите после неё`,
        }),
      )
    }

    components.push({
      id: nextId('c'),
      nodeCode: 'A1',
      title: 'Труба частями: сегменты и стыки',
      enabled: true,
      rows: [
        ...segmentRows,
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинирование частей корпуса',
          unit: 'кг',
          qtyCalc: jointMass,
          fotK: FOT_K_MANUAL,
          note:
            jointMass == null
              ? `Мс для Dу ${s.dn} нет в справочнике — введите вручную`
              : `Мс из справочника f(Dу ${s.dn}) = ${jointMass} кг`,
        }),
      ],
    })
  }

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

  // A6 — Фланцевый патрубок под задвижку на подводящем (лист, строки 32–38).
  //
  // Номинал диктует подводящий патрубок: течение там безнапорное, но задвижка
  // всегда идёт с номинальным PN в наименовании. Масса ручной формовки фланца
  // берётся из норм листа «Для расчетов» — колонка «Мф фланца» по DN, а не по
  // диаметру гильзы: формуется фланец под арматуру, не проходное отверстие.
  //
  // ❗ Расхождение с эталоном (осознанное): лист ставит ДВА патрубка на каждый
  // подводящий (`I32 = 2×K5`), завод уточнил (2026-09-09) — один. Берём один.
  const inletFlangeNorm = ctx.nozzleNormOf?.(s.inletDn) ?? null
  const inletFlanges = s.valveOnInlet ? s.inletCount : 0
  const inletFlangeMass =
    inletFlangeNorm?.flangeMassKg != null ? inletFlangeNorm.flangeMassKg * inletFlanges : null

  components.push({
    id: nextId('c'),
    nodeCode: 'A6',
    title: `Фланцевый патрубок под задвижку на подводящем DN${s.inletDn}`,
    enabled: s.valveOnInlet,
    rows: [
      ...operationWithFot(ctx, {
        category: 'Собственное производство',
        name: 'Ручная формовка фланца для задвижки на подводящем трубопроводе',
        unit: 'кг',
        qtyCalc: inletFlangeMass,
        // В листе у этой строки k = 1 («*руч*» → 1), а не 0,56.
        fotK: FOT_K_MANUAL,
        note:
          inletFlangeMass == null
            ? `Мф фланца для DN${s.inletDn} в нормах «Для расчетов» нет — введите массу вручную`
            : `ƒ Мф фланца(DN${s.inletDn}) × ${inletFlanges} = ${inletFlangeMass.toFixed(2)} кг`,
      }),
      ...operationWithFot(ctx, {
        category: 'Собственное производство',
        name: 'Ламинирование патрубка к корпусу',
        unit: 'кг',
        qtyCalc: inletFlangeMass == null ? null : laminationMassKg(inletFlangeMass),
        fotK: FOT_K_LAMIN,
        note:
          inletFlangeMass == null
            ? 'ƒ масса фланца × 3/10 — введите после массы фланца'
            : `ƒ ${inletFlangeMass.toFixed(2)} кг × 3/10`,
      }),
    ],
  })

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

export function buildLadder(ctx: MaterializeContext, s: { depthMm: number }): CalcComponent[] {
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

export function buildSlab(ctx: MaterializeContext, s: { dn: number; depthMm: number }): CalcComponent[] {
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
          // 20х200, а не 16х100: сноска эталона под таблицей башмаков задаёт
          // «распорный анкер-болт класса 5.8 с резьбой М16 (рубашка Ø20 мм) на
          // расчётное усилие 27 500 Н» — то есть Ø20, и строки 212 (КНС) и 174
          // (колодец) называют именно «20х200». Прайс знает обе позиции, они
          // отличаются в полтора раза: 200 ₽ против 150 ₽.
          name: 'Анкерный болт распорный 20х200',
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

export function buildVent(ctx: MaterializeContext): CalcComponent[] {
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

export function buildPressurePipe(
  ctx: MaterializeContext,
  s: {
    depthMm: number
    pumpsWorking: number
    pumpsReserve: number
    outletDn: number
    outletCount: number
    emergencyPipeline?: boolean
    /** Размер быстросъёмной гайки аварийной линии, ГМ (у ЕМК и КОЛ его нет). */
    emergencyHoseNutGm?: number
    hasFlowMeter?: boolean
  },
): CalcComponent[] {
  const guides = pumpGuidesM(s.depthMm / 1000, s.pumpsWorking, s.pumpsReserve)
  const kit = PRESSURE_PIPE_KITS[s.outletDn] ?? null
  const n = s.outletCount
  const components: CalcComponent[] = []

  // Свободные фланцы: раньше это был ручной обмер — лист их не выводит. Завод
  // дал правило (2026-09-09): по патрубку у насоса, задвижки и обратного
  // клапана на каждый насос, два на расходомер и по одному на отводящий.
  // Прокладки и борт-шайбы следуют за ними, поэтому тоже стали расчётными.
  const pumps = s.pumpsWorking + s.pumpsReserve
  const meters = s.hasFlowMeter ? n : 0
  const flanges = pressureFlangeCount({
    pumpsWorking: s.pumpsWorking,
    pumpsReserve: s.pumpsReserve,
    outletCount: n,
    hasFlowMeter: Boolean(s.hasFlowMeter),
  })
  const flangeNote = `ƒ 3×насосов (${pumps}) + 2×расходомеров (${meters}) + отводящих (${n}) = ${flanges} шт`

  // C2 — комплект нитки. Соотношения внутри него заданы эталоном и от заказа
  // не зависят; якорные величины (метраж стальной трубы, число свободных
  // фланцев, отводов и тройников) снимаются с компоновки — лист их тоже не
  // выводит, поэтому они рождаются пустыми, а не выдуманными.
  //
  // Прокладок «свободных фланцев + 2» и борт-шайб «столько же, сколько
  // свободных фланцев» — оба следуют за ручным числом фланцев, поэтому тоже
  // пустые до его ввода: считать их от нуля значило бы напечатать «2 шт»
  // прокладок там, где их два десятка.
  if (kit) {
    const item = (
      k: KitItem,
      qtyCalc: number | null,
      note: string,
    ): Parameters<typeof makeRow>[1] => ({
      kind: 'МАТЕРИАЛ',
      category: k.category,
      name: k.name,
      unit: k.unit,
      qtyCalc,
      note,
    })

    components.push({
      id: nextId('c'),
      nodeCode: 'C2',
      title: `Нитка напорного трубопровода DN${s.outletDn} ×${n}`,
      enabled: true,
      rows: [
        makeRow(ctx, item(kit.peSleeve, n, `ƒ по одной на нитку, ниток ${n}`)),
        makeRow(ctx, item(kit.pePipe, 0.5 * n, `ƒ 0,5 м на втулку × ${n}`)),
        makeRow(ctx, item(kit.peWeld, n, `ƒ по одному стыку на нитку, ниток ${n}`)),
        makeRow(ctx, item(kit.steelPipe, null, 'Метраж по компоновке — введите вручную')),
        makeRow(ctx, item(kit.weldFlange, n, `ƒ по одному на нитку, ниток ${n}`)),
        makeRow(ctx, item(kit.freeFlange, flanges, flangeNote)),
        makeRow(ctx, item(kit.gasket, flanges + 2, `ƒ свободных фланцев (${flanges}) + 2`)),
        makeRow(ctx, item(kit.backingRing, flanges, `ƒ по одной на свободный фланец (${flanges})`)),
        makeRow(ctx, item(kit.elbow, null, 'Число по компоновке — введите вручную')),
        makeRow(ctx, item(kit.tee, null, 'Число по компоновке — введите вручную')),
      ],
    })
  }

  // Обвязка датчика давления — по комплекту на нитку (лист, строки 369–371).
  if (kit) {
    const { threeWayValve, ballValve, unionPipe } = PRESSURE_PIPE_EXTRAS
    components.push({
      id: nextId('c'),
      nodeCode: 'C2',
      title: 'Обвязка датчика давления',
      enabled: true,
      rows: [threeWayValve, ballValve, unionPipe].map((k) =>
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: k.category,
          name: k.name,
          unit: k.unit,
          qtyCalc: n,
          note: `ƒ по одному на нитку, ниток ${n}`,
        }),
      ),
    })
  }

  // Аварийный трубопровод — флаг ОЛ (лист, строки 361–362: `1 × ОЛ!J47`).
  //
  // `undefined` означает не «выключен», а «у изделия такого признака нет»:
  // опросные листы ЕМК и колодца про аварийный трубопровод не спрашивают, и
  // вечно выключенный блок был бы у них шумом. Поэтому у КНС компонент есть
  // всегда (включённый или нет), а у остальных изделий его нет вовсе.
  if (s.emergencyPipeline !== undefined) {
    // Состав шире, чем в листе: помимо быстросъёмной гайки и резьбового
    // патрубка завод назвал (2026-09-09) обратный клапан, задвижку и два
    // фланца. Наименования клапана и задвижки строятся по шаблону НН с
    // подстановкой DN — прайс держит ряд DN50…DN300, так что при типовом
    // напорном строка находит цену; при нетиповом останется «красной», и
    // инженер выберет позицию сам.
    // Труба аварийной линии идёт тем же DN, что напорная, а вот размер
    // быстросъёмной гайки от него не зависит — им определяется, чем
    // подключится машина, и задаётся он в опросном листе.
    const gm = s.emergencyHoseNutGm ?? DEFAULT_HOSE_NUT_GM
    const nut = hoseNutItem(gm)
    const nozzle = HOSE_NUT_NOZZLES[gm] ?? null

    const emergencyRows = [
      makeRow(ctx, {
        kind: 'МАТЕРИАЛ',
        category: nut.category,
        name: nut.name,
        unit: nut.unit,
        qtyCalc: 1,
        note: 'ƒ одна на станцию · размер из опросного листа',
      }),
      makeRow(ctx, {
        kind: 'МАТЕРИАЛ',
        category: nozzle?.category ?? 'Прочие материалы',
        name: nozzle?.name ?? `Патрубок резьбовой под гайку ГМ${gm}`,
        unit: 'шт',
        qtyCalc: 1,
        note: nozzle
          ? 'ƒ один на станцию, приваривается к трубе аварийной линии'
          : `Резьба под ГМ${gm} в прайсе не указана — подберите патрубок из каталога: ` +
            `резьба под гайку, приваривается к трубе аварийной линии DN${s.outletDn}`,
      }),
    ]

    emergencyRows.push(
      makeRow(ctx, {
        kind: 'МАТЕРИАЛ',
        category: 'Запорная арматура',
        name: `Клапан обратный фланцевый с мягким уплотнением и наклонным седлом DN${s.outletDn} PN10/16`,
        unit: 'шт',
        qtyCalc: 1,
        note: 'ƒ один на аварийную линию',
      }),
      makeRow(ctx, {
        kind: 'МАТЕРИАЛ',
        category: 'Запорная арматура',
        name: `Задвижка чугунная клиновая металл/металл DN${s.outletDn} PN10/16 клин бронза`,
        unit: 'шт',
        qtyCalc: 1,
        note: 'ƒ одна на аварийную линию',
      }),
    )

    if (kit) {
      emergencyRows.push(
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: kit.freeFlange.category,
          name: kit.freeFlange.name,
          unit: kit.freeFlange.unit,
          qtyCalc: 2,
          note: 'ƒ два фланца на аварийную линию',
        }),
      )
    }

    components.push({
      id: nextId('c'),
      nodeCode: 'C2',
      title: 'Аварийный трубопровод',
      enabled: s.emergencyPipeline,
      rows: emergencyRows,
    })
  }

  components.push({
    id: nextId('c'),
    nodeCode: 'C2',
    title: 'Направляющие насосов и работы по нитке',
    enabled: true,
    rows: [
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
      // Трудоёмкость самой нитки — норматив эталона, от диаметра и числа
      // ниток не зависит (строки 374–375). Надбавка ×1,2 за коллекторную
      // компоновку не применяется: признака «сложный» в опросном листе нет.
      makeRow(ctx, {
        kind: 'ОПЕРАЦИЯ',
        category: 'Собственное производство',
        name: 'Изготовление напорного трубопровода',
        unit: 'чел. ч',
        qtyCalc: PRESSURE_PIPE_HOURS.fabrication,
        note: 'Норматив эталона; при коллекторной компоновке ×1,2 — уточните',
      }),
      makeRow(ctx, {
        kind: 'ОПЕРАЦИЯ',
        category: 'Собственное производство',
        name: 'Монтаж напорного трубопровода',
        unit: 'чел. ч',
        qtyCalc: PRESSURE_PIPE_HOURS.installation,
        note: 'Норматив эталона; при коллекторной компоновке ×1,2 — уточните',
      }),
    ],
  })

  if (!kit) {
    components[components.length - 1]!.rows.push(
      makeRow(ctx, {
        kind: 'МАТЕРИАЛ',
        category: 'Детали трубопровода сталь',
        name: `Комплект нитки DN${s.outletDn}`,
        unit: 'шт',
        qtyCalc: null,
        note: `Комплекта для DN${s.outletDn} в эталоне нет (есть 50, 65, 80, 150) — соберите нитку из каталога`,
      }),
    )
  }

  return components
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

/**
 * Спутники болта: плоская шайба, гроверная и гайка того же типоразмера.
 *
 * В эталоне (раздел 6, строки 383–398) они выписаны для М20, М16, М12 и М6, но
 * наименования у всех строятся по одному шаблону НН, и справочник знает
 * размеры от М6 до М42 — поэтому имя собирается, а не берётся из таблицы на
 * четыре размера: фланцы дают и М24, и М27.
 *
 * @param bolt обозначение из норм патрубка, напр. «М20х90»
 */
export function fastenerSetNames(bolt: string): { washer: string; lockWasher: string; nut: string } | null {
  const m = /^М(\d+)х\d+$/.exec(bolt)
  if (!m) return null
  const d = m[1]
  return {
    washer: `Шайба 2.М${d}.12Х18Н10Т ГОСТ 11371-78 (DIN125)`,
    lockWasher: `Шайба М${d} 12Х18Н10Т ГОСТ 6402-70 (DIN 127)`,
    nut: `Гайка М${d}-6Н.5.12Х18Н10Т ГОСТ 5915-70 (DIN 934)`,
  }
}

// ─── Раздел 6: Крепёж (C3) ──────────────────────────────────────────────────

export function buildFasteners(ctx: MaterializeContext, s: { outletDn: number; outletCount: number }): CalcComponent[] {
  // Норма болтов на фланцевое соединение = f(DN) из матрицы «Для расчетов».
  const norm = ctx.nozzleNormOf?.(s.outletDn) ?? null
  const joints = s.outletCount
  const bolts = norm?.boltCount != null ? norm.boltCount * joints : null
  const set = norm?.bolt ? fastenerSetNames(norm.bolt) : null

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
        // Спутники болта. Соотношения заданы эталоном (раздел 6) и от заказа
        // не зависят: две плоские шайбы, одна гроверная и одна гайка на болт.
        // Раньше их не было вовсе — комплект собирался из каталога по памяти.
        ...(set
          ? [
              makeRow(ctx, {
                kind: 'МАТЕРИАЛ',
                category: 'Метизы',
                name: set.washer,
                unit: 'шт',
                qtyCalc: bolts == null ? null : bolts * 2,
                note: 'ƒ 2 шайбы на болт',
              }),
              makeRow(ctx, {
                kind: 'МАТЕРИАЛ',
                category: 'Метизы',
                name: set.lockWasher,
                unit: 'шт',
                qtyCalc: bolts,
                note: 'ƒ 1 гроверная шайба на болт',
              }),
              makeRow(ctx, {
                kind: 'МАТЕРИАЛ',
                category: 'Метизы',
                name: set.nut,
                unit: 'шт',
                qtyCalc: bolts,
                note: 'ƒ 1 гайка на болт',
              }),
            ]
          : []),
      ],
    },
  ]
}

// ─── Раздел 7: Оборудование (частично — насосная группа и арматура) ─────────

function buildEquipment(ctx: MaterializeContext, s: KnsSurveyParams): CalcComponent[] {
  const gates = gateValveCount(s.inletCount, s.valveOnInlet)
  const pressureGates = pressureGateValveCount(s.pumpsWorking, s.pumpsReserve, s.outletCount)
  const checkValves = checkValveCount(s.pumpsWorking, s.pumpsReserve)
  const pumps = s.pumpsWorking + s.pumpsReserve

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
        // Напорная сторона: по схеме завода на стояке каждого установленного
        // насоса стоят задвижка и обратный клапан, плюс задвижка на каждом
        // отводящем патрубке. Резервный насос обвязан как рабочий, поэтому
        // здесь считаются ВСЕ насосы: рабочие задают расход (гидравлика),
        // установленные — состав.
        //
        // Прежде здесь стоял «Кран шаровой DN{напорного}» — на схеме шаровых
        // кранов на напорной линии нет, а те, что есть в эталоне, относятся к
        // обвязке датчика давления и материализуются в разделе 5.
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Запорная арматура',
          name: `Задвижка чугунная клиновая металл/металл DN${s.outletDn} PN10/16 клин бронза`,
          unit: 'шт',
          qtyCalc: pressureGates,
          note: `ƒ = насосов (${pumps}) + отводящих (${s.outletCount}) = ${pressureGates} шт`,
        }),
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Запорная арматура',
          name: `Клапан обратный фланцевый с мягким уплотнением и наклонным седлом DN${s.outletDn} PN10/16`,
          unit: 'шт',
          qtyCalc: checkValves,
          note: `ƒ = по клапану на каждый установленный насос (${pumps})`,
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
        // цена насоса договорная. Строка рождается «красной» намеренно — так
        // же, как труба корпуса (Механика §5.2).
        //
        // Марка приходит из подбора по притоку, напору и числу рабочих
        // насосов (`/api/pump-station/select-pump`, каталог Vandjord VSL) либо
        // вводится вручную в ОЛ. Без неё в КП уходило бы «Насос (марка по
        // подбору)» — строка, по которой заказчику нечего согласовывать.
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Насосы, АТМ',
          name: s.pumpModel ? `Насос ${s.pumpModel}` : 'Насос (марка по подбору)',
          unit: 'шт',
          qtyCalc: s.pumpsWorking + s.pumpsReserve,
          note:
            `ƒ = раб ${s.pumpsWorking} + рез ${s.pumpsReserve} · цена договорная, в прайсе насосов нет` +
            (s.pumpModel ? '' : ' · марка не подобрана — уточните в опросном листе'),
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
    survey: survey as unknown as Record<string, unknown>,
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
