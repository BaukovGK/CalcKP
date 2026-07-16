/**
 * Экономический итоговый блок (§9.5 ТЗ, Механика §9).
 *
 * Единый пайплайн для всех типов изделий. Сверено с первоисточником
 * («Шаблон 3.0.xlsx», лист «Калькулятор КНС», строки 441–458):
 *
 *   J441 = ROUNDUP(Σ чел.ч без «изготов»; 0,1)      часы участка фитингов
 *   J442 = ROUNDUP(Σ чел.ч с «изготов»; 0,1)        часы участка РМУ
 *   J443 = ROUNDUP(J441 / 11; 0,1)                  ПЗР, чел.ч
 *   J445 = ROUNDUP(масса_формовки × 0,05; 0,1)      ацетон, кг
 *   J446 = ROUNDUP(J441 + 302; 0)                   СИЗ, ед.   ← НЕ ПЗР!
 *   J447 = ROUNDUP(J441 + J443; 0,1)                накладные, чел.ч
 *   N449 = N454 + N451 + N452 + N455 + N453         себестоимость = 5 корзин
 *   N457 = ROUNDUP(N449 × (1 + наценка); −2)        цена продажи
 *   N458 = (N457 − N449) / N457                     рентабельность
 *
 * Экономический хвост — не компонент, а глобальный пайплайн над всеми
 * строками расчёта (Библиотека §1.4).
 */

import { computeRow } from './row'
import { roundUp, roundUpHours, roundUpPrice } from './rounding'
import { UNIT_HOURS, UNIT_MASS, type EngineRow } from './types'

/** Корзины себестоимости (Механика §9, README хендоффа). */
export type CostBucket =
  | 'Материалы на закупку'
  | 'Труба, муфта'
  | 'Формовка'
  | 'Работы, ФОТ'
  | 'Прочие затраты'

export const COST_BUCKETS: readonly CostBucket[] = [
  'Материалы на закупку',
  'Труба, муфта',
  'Формовка',
  'Работы, ФОТ',
  'Прочие затраты',
]

/**
 * Базовая надбавка к часам в формуле СИЗ, ед.
 *
 * Захардкожена в эталоне: `J446 = ROUNDUP(J441 + 302;)`. Ранее ТЗ §9.5 и
 * Механика §9 описывали формулу как `ROUNDUP(часы + ПЗР)` — это НЕ
 * соответствует первоисточнику: ПЗР в ней не участвует вообще.
 *
 * ❓ Физический смысл константы требует уточнения у завода (План §4.1-bis A).
 */
export const SIZ_BASE_UNITS = 302

/** Делитель часов фитингов для ПЗР (Механика §13). */
export const PZR_DIVISOR = 11

/** Доля массы формовки, уходящая в ацетон (Механика §13). */
export const ACETONE_MASS_SHARE = 0.05

/** Наценка по умолчанию — константа во всех 6 реальных файлах (Реверс §8.7). */
export const DEFAULT_MARKUP = 0.43

/**
 * Ставки. Механика §9: «Ставки — позиции прайса, а не константы кода:
 * обновление прайса меняет экономику всех новых расчётов».
 *
 * В эталоне они лежат литералами в колонке L (канал ручного override) —
 * здесь это осознанно исправлено: значения приходят из прайса.
 */
export interface Rates {
  /** «ФОТ / ФОТ / чел. ч». Актуальная — 1207,8 ₽/чел.ч. */
  fotRub: number
  /** Ставка накладных, ₽/чел.ч. Актуальная — 1584,73. */
  overheadRub: number
  /** Цена ацетона, ₽/кг. Актуальная — 109,4. */
  acetoneRub: number
  /** Цена СИЗ и РМ, ₽/ед. Актуальная — 122. */
  ppeRub: number
}

/** Агрегаты по строкам расчёта — вход экономического пайплайна. */
export interface RowAggregate {
  /** Σ чел.ч работ БЕЗ «изготов» в наименовании. */
  hoursFittings: number
  /** Σ чел.ч работ С «изготов» в наименовании. */
  hoursRmu: number
  /** Σ кол-ва строк с ЕИ «кг». */
  moldingMassKg: number
  /** Суммы строк по корзинам (без «Прочих» — они вычисляются). */
  bucketSums: Record<Exclude<CostBucket, 'Прочие затраты'>, number>
}

/**
 * Корзина строки.
 *
 * Определяется ЕДИНИЦЕЙ ИЗМЕРЕНИЯ, а не категорией — так устроен эталон:
 * `N441` суммирует по `K = "чел. ч"`, `K452` — по массе. Механика §5.3:
 * «ЕИ определяет физический смысл: кг — формовка/ламинат, чел. ч — труд».
 *
 * Показательный случай: строка «Монтаж поплавковых выключателей» имеет
 * категорию «Собственное производство», но ЕИ «чел. ч» — и идёт в труд,
 * а не в формовку.
 *
 * Труба и муфта корпуса выделяются отдельной корзиной и помечаются явно
 * (`row.bucket`), поскольку по ЕИ («м», «шт») неотличимы от прочих материалов.
 */
export function classifyRow(row: EngineRow & { bucket?: CostBucket }): Exclude<CostBucket, 'Прочие затраты'> {
  if (row.bucket && row.bucket !== 'Прочие затраты') return row.bucket
  if (row.unit === UNIT_HOURS) return 'Работы, ФОТ'
  if (row.unit === UNIT_MASS) return 'Формовка'
  return 'Материалы на закупку'
}

/** Работа относится к участку РМУ, если в наименовании есть «изготов» (§9.5 п.1). */
export function isRmuWork(name: string): boolean {
  return name.toLowerCase().includes('изготов')
}

/** Собирает агрегаты по дереву строк. */
export function aggregateRows(
  rows: Array<EngineRow & { bucket?: CostBucket }>,
  opts: { sectionEnabled?: (row: EngineRow) => boolean; tirage?: number } = {},
): RowAggregate {
  const { sectionEnabled, tirage = 1 } = opts

  let hoursFittings = 0
  let hoursRmu = 0
  let moldingMassKg = 0
  const bucketSums: RowAggregate['bucketSums'] = {
    'Материалы на закупку': 0,
    'Труба, муфта': 0,
    Формовка: 0,
    'Работы, ФОТ': 0,
  }

  for (const row of rows) {
    const res = computeRow(row, { sectionEnabled: sectionEnabled?.(row) ?? true, tirage })
    if (res.qty === 0) continue

    if (row.unit === UNIT_HOURS) {
      if (isRmuWork(row.name)) hoursRmu += res.qty
      else hoursFittings += res.qty
    }
    if (row.unit === UNIT_MASS) moldingMassKg += res.qty

    bucketSums[classifyRow(row)] += res.sum
  }

  return {
    hoursFittings: roundUpHours(hoursFittings),
    hoursRmu: roundUpHours(hoursRmu),
    moldingMassKg,
    bucketSums,
  }
}

/**
 * Цена продажи от себестоимости (эталон N457):
 * `ROUNDUP(себестоимость × (1 + наценка); −2)` — округление вверх до 100 ₽.
 */
export function salePriceFromCost(costRub: number, markup: number): number {
  return roundUpPrice(costRub * (1 + markup))
}

/** Рентабельность (эталон N458): `(цена − себестоимость) / цена`, доля. */
export function profitabilityFromCost(costRub: number, salePriceRub: number): number {
  return salePriceRub > 0 ? (salePriceRub - costRub) / salePriceRub : 0
}

/** Результат экономического пайплайна. */
export interface Economics {
  hoursFittings: number
  hoursRmu: number
  moldingMassKg: number

  /** ПЗР: часы и рубли (входит в корзину «Работы, ФОТ», НЕ в «Прочие»). */
  pzrHours: number
  pzrRub: number

  acetoneKg: number
  acetoneRub: number

  ppeUnits: number
  ppeRub: number

  overheadHours: number
  overheadRub: number

  buckets: Record<CostBucket, number>
  /** Себестоимость с НДС: НДС «зашит» в цены прайса, отдельно не выделяется. */
  costRub: number
  markup: number
  salePriceRub: number
  /** Рентабельность, доля (0,3007 = 30,07%). */
  profitability: number
}

/**
 * Экономический пайплайн поверх агрегатов.
 *
 * @param markup доля наценки (0,43 = 43%)
 */
export function computeEconomics(
  agg: RowAggregate,
  rates: Rates,
  opts: { markup?: number } = {},
): Economics {
  const markup = opts.markup ?? DEFAULT_MARKUP

  // ПЗР: считается ТОЛЬКО от часов фитингов (эталон J443).
  const pzrHours = roundUpHours(agg.hoursFittings / PZR_DIVISOR)
  const pzrRub = pzrHours * rates.fotRub

  const acetoneKg = roundUpHours(agg.moldingMassKg * ACETONE_MASS_SHARE)
  const acetoneRub = acetoneKg * rates.acetoneRub

  // СИЗ: часы фитингов + 302 (константа шаблона), ROUNDUP до целого.
  const ppeUnits = roundUp(agg.hoursFittings + SIZ_BASE_UNITS, 0)
  const ppeRub = ppeUnits * rates.ppeRub

  const overheadHours = roundUpHours(agg.hoursFittings + pzrHours)
  const overheadRub = overheadHours * rates.overheadRub

  const buckets: Record<CostBucket, number> = {
    'Материалы на закупку': agg.bucketSums['Материалы на закупку'],
    'Труба, муфта': agg.bucketSums['Труба, муфта'],
    Формовка: agg.bucketSums.Формовка,
    // ПЗР входит в «Работы, ФОТ» (эталон N453 = N441 + N443 + N442).
    'Работы, ФОТ': agg.bucketSums['Работы, ФОТ'] + pzrRub,
    // «Прочие» = ацетон + СИЗ + накладные (эталон N455), БЕЗ ПЗР.
    'Прочие затраты': acetoneRub + ppeRub + overheadRub,
  }

  const costRub = COST_BUCKETS.reduce((s, b) => s + buckets[b], 0)
  const salePriceRub = salePriceFromCost(costRub, markup)
  const profitability = profitabilityFromCost(costRub, salePriceRub)

  return {
    hoursFittings: agg.hoursFittings,
    hoursRmu: agg.hoursRmu,
    moldingMassKg: agg.moldingMassKg,
    pzrHours,
    pzrRub,
    acetoneKg,
    acetoneRub,
    ppeUnits,
    ppeRub,
    overheadHours,
    overheadRub,
    buckets,
    costRub,
    markup,
    salePriceRub,
    profitability,
  }
}
