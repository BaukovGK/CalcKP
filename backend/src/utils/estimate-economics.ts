/**
 * Экономика сохранённого дерева — вторая реализация пайплайна фронта
 * (`ntt-calculator/src/engines/economics.ts`), нужная ровно для одного:
 * проверить итог КП, который прислал клиент (решение Р7, План_устранения 3.5).
 *
 * Итог документа заказчику приходит с клиента: `totals.salePriceRub` ложится
 * в `Estimate.totalRub`, оттуда — в снапшот и в печатную форму. Сервер эту
 * цифру ни разу не пересчитывал: ошибка движка, правка запроса в консоли
 * браузера или устаревшая вкладка давали КП с любым числом, и снапшот
 * «подтверждал» его.
 *
 * Две реализации одной арифметики расходятся молча — этого не допускают общие
 * примеры `kp-total.vectors.json`: их прогоняют тесты обеих сторон, как у
 * правила SN (`sn-rule.vectors.json`) и подбора глубины (`depth.vectors.json`).
 * Разбора выражений здесь по-прежнему нет: количество берётся посчитанным
 * (`qtyResolved`), а если его нет — проверка не выполняется, см.
 * {@link verifyKpTotal}.
 *
 * @module utils/estimate-economics
 */

import { extractRows, resolveRowQty, tirageOf, type TreeRow } from './estimate-tree'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

// ─── Округление (копия engines/rounding.ts) ──────────────────────────────────

/** Гасит двоичную погрешность масштабирования, как Excel: 15 значащих цифр. */
const snap = (x: number): number => Number(x.toPrecision(15))

/** Аналог `ROUNDUP(value; decimals)`: вверх от нуля. 1 → 0,1 · 0 → целое · −2 → 100. */
export function roundUp(value: number, decimals = 0): number {
  if (!Number.isFinite(value)) return value
  if (value === 0) return 0
  if (decimals >= 0) {
    const factor = 10 ** decimals
    const scaled = snap(value * factor)
    const r = value > 0 ? Math.ceil(scaled) : Math.floor(scaled)
    return snap(r / factor)
  }
  const step = 10 ** -decimals
  const scaled = snap(value / step)
  const r = value > 0 ? Math.ceil(scaled) : Math.floor(scaled)
  return snap(r * step)
}

const roundUpHours = (hours: number): number => roundUp(hours, 1)
const roundUpPrice = (rub: number): number => roundUp(rub, -2)

// ─── Константы пайплайна (копия engines/economics.ts) ────────────────────────

/** ЕИ, задающие физический смысл строки (Механика §5.3). */
const UNIT_HOURS = 'чел. ч'
const UNIT_MASS = 'кг'

/** Категории, которые не закупаются: у них «Закупка = нет» (Механика §5.3). */
const NON_PURCHASE_CATEGORIES = ['Собственное производство', 'Работы', 'ФОТ']

/** Делитель часов фитингов для ПЗР (эталон `J443`). */
const PZR_DIVISOR = 11
/** Доля массы формовки, уходящая в ацетон (эталон `J445`). */
const ACETONE_MASS_SHARE = 0.05
/** Базовая надбавка к часам в формуле СИЗ (эталон `J446`). */
const SIZ_BASE_UNITS = 302
/** Наценка по умолчанию — у дерева, сохранённого без неё. */
const DEFAULT_MARKUP = 0.43

/** Ставки экономики, зафиксированные в дереве (План_устранения 1.3). */
export interface TreeRates {
  fotRub: number
  overheadRub: number
  acetoneRub: number
  ppeRub: number
}

const RATE_KEYS: ReadonlyArray<keyof TreeRates> = ['fotRub', 'overheadRub', 'acetoneRub', 'ppeRub']

/**
 * Ставки сохранённого дерева. `null` — их там нет: дерево собрано до того, как
 * ставки стали частью расчёта, и проверять его итог не по чему.
 */
export function treeRates(surveyData: unknown): TreeRates | null {
  if (!isObj(surveyData) || !isObj(surveyData.tree) || !isObj(surveyData.tree.rates)) return null
  const src = surveyData.tree.rates
  const rates = {} as TreeRates
  for (const key of RATE_KEYS) {
    const v = src[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    rates[key] = v
  }
  return rates
}

/** Наценка сохранённого расчёта; её нет — константа движка (0,43). */
export function markupOf(surveyData: unknown): number {
  const totals = isObj(surveyData) && isObj(surveyData.totals) ? surveyData.totals : null
  const m = totals?.markup
  return typeof m === 'number' && Number.isFinite(m) ? m : DEFAULT_MARKUP
}

/** Работа участка РМУ — «изготов» в наименовании (§9.5 п.1). */
export function isRmuWork(name: string): boolean {
  return name.toLowerCase().includes('изготов')
}

/**
 * Строка формовки: ЕИ «кг» у операции или у непокупной категории
 * (План_устранения 3.8). Покупное в кг — сорбент, щебень — материал, и в массу
 * для ацетона не идёт.
 */
export function isMoldingRow(row: TreeRow): boolean {
  if (row.unit !== UNIT_MASS) return false
  return row.kind === 'ОПЕРАЦИЯ' || NON_PURCHASE_CATEGORIES.includes(row.category ?? '')
}

/** Корзины себестоимости, между которыми делятся суммы строк (Механика §9). */
type CostBucket = 'Материалы на закупку' | 'Труба, муфта' | 'Формовка' | 'Работы, ФОТ'

/**
 * Корзина строки — по ЕИ, а у массы ещё и по тому, покупная ли позиция
 * (`classifyRow` фронта). Труба и муфты своего производства помечены в дереве
 * явно (`bucket`): по ЕИ «м» и «шт» они неотличимы от прочих материалов.
 *
 * На итог деление не влияет — все корзины складываются, — но влияет на
 * ПОРЯДОК сложения, а он должен совпадать с фронтом до последнего разряда.
 */
function bucketOf(row: TreeRow): CostBucket {
  if (row.bucket === 'Труба, муфта' || row.bucket === 'Формовка' || row.bucket === 'Работы, ФОТ' || row.bucket === 'Материалы на закупку') {
    return row.bucket
  }
  if (row.unit === UNIT_HOURS) return 'Работы, ФОТ'
  if (isMoldingRow(row)) return 'Формовка'
  return 'Материалы на закупку'
}

/** Применённая цена строки: ручная перекрывает каталожную, отрицательная — нет. */
function priceOf(row: TreeRow): number | null {
  const manual = row.priceManual
  if (typeof manual === 'number' && Number.isFinite(manual) && manual >= 0) return manual
  const catalog = row.priceCatalog ?? (typeof row.price === 'number' ? row.price : null)
  return typeof catalog === 'number' && Number.isFinite(catalog) ? catalog : null
}

/**
 * Количество строки за весь тираж — как считает движок фронта (`engines/row.ts`,
 * `resolveQty`): выключенная строка даёт 0, трудоёмкость округляется вверх до
 * 0,1 ДО умножения на тираж.
 *
 * `null` — количество задано выражением, а посчитанного (`qtyResolved`) в
 * дереве нет: угадывать нельзя.
 */
function qtyOf(row: TreeRow, tirage: number): number | null {
  if (row.enabled === false) return 0
  const { qty, unresolved } = resolveRowQty(row)
  if (unresolved) return null
  if (qty == null) return 0
  // qtyResolved движок уже округлил; округление здесь — для строк, где его нет
  // (число в qtyManual или расчётное qtyCalc). Повторное ROUNDUP значения,
  // уже кратного 0,1, ничего не меняет.
  const rounded = row.unit === UNIT_HOURS ? roundUpHours(qty) : qty
  return rounded * tirage
}

/** Экономика дерева — то, что нужно для сверки итога. */
export interface TreeEconomics {
  /** Σ чел.ч работ без «изготов», вверх до 0,1. */
  hoursFittings: number
  /** Σ чел.ч работ с «изготов», вверх до 0,1. */
  hoursRmu: number
  /** Σ количества строк формовки, кг. */
  moldingMassKg: number
  /** Σ сумм строк (кол-во × цена) — все корзины, кроме считаемых от итогов. */
  rowsRub: number
  pzrHours: number
  pzrRub: number
  acetoneKg: number
  acetoneRub: number
  ppeUnits: number
  ppeRub: number
  overheadHours: number
  overheadRub: number
  /** Себестоимость с НДС: строки + ПЗР + ацетон + СИЗ + накладные. */
  costRub: number
  markup: number
  /** Цена продажи: `ROUNDUP(себестоимость × (1 + наценка); до 100 ₽)`. */
  salePriceRub: number
}

/**
 * Пересчитывает экономику по сохранённому дереву.
 *
 * @returns `null`, если количество хотя бы одной строки задано выражением, а
 *   посчитанного в дереве нет: итог тогда неизвестен, а не равен чему-то.
 */
export function economicsOfTree(surveyData: unknown, rates: TreeRates): TreeEconomics | null {
  const tirage = tirageOf(surveyData)
  const markup = markupOf(surveyData)

  let hoursFittings = 0
  let hoursRmu = 0
  let moldingMassKg = 0
  // Суммы копятся по корзинам и в том же порядке, что на фронте: сложение
  // double не ассоциативно, и другой порядок давал бы себестоимость с иным
  // двоичным хвостом. На цену продажи (вверх до 100 ₽) это почти никогда не
  // влияет — но «почти» здесь означало бы расхождение раз в сотню расчётов.
  const bucketSums: Record<CostBucket, number> = {
    'Материалы на закупку': 0,
    'Труба, муфта': 0,
    'Формовка': 0,
    'Работы, ФОТ': 0,
  }

  for (const row of extractRows(surveyData)) {
    const qty = qtyOf(row, tirage)
    if (qty == null) return null
    if (qty === 0) continue

    if (row.unit === UNIT_HOURS) {
      if (isRmuWork(row.name ?? '')) hoursRmu += qty
      else hoursFittings += qty
    }
    if (isMoldingRow(row)) moldingMassKg += qty

    const price = priceOf(row)
    if (price != null) bucketSums[bucketOf(row)] += qty * price
  }

  hoursFittings = roundUpHours(hoursFittings)
  hoursRmu = roundUpHours(hoursRmu)

  // ПЗР считается ТОЛЬКО от часов фитингов (эталон J443) и входит в «Работы,
  // ФОТ», а не в «Прочие»; на итог деление по корзинам не влияет.
  const pzrHours = roundUpHours(hoursFittings / PZR_DIVISOR)
  const pzrRub = pzrHours * rates.fotRub

  const acetoneKg = roundUpHours(moldingMassKg * ACETONE_MASS_SHARE)
  const acetoneRub = acetoneKg * rates.acetoneRub

  const ppeUnits = roundUp(hoursFittings + SIZ_BASE_UNITS, 0)
  const ppeRub = ppeUnits * rates.ppeRub

  const overheadHours = roundUpHours(hoursFittings + pzrHours)
  const overheadRub = overheadHours * rates.overheadRub

  // Порядок слагаемых — как в `computeEconomics`: пять корзин подряд, ПЗР
  // внутри «Работ, ФОТ», прочие — ацетон плюс СИЗ плюс накладные.
  const costRub =
    bucketSums['Материалы на закупку'] +
    bucketSums['Труба, муфта'] +
    bucketSums['Формовка'] +
    (bucketSums['Работы, ФОТ'] + pzrRub) +
    (acetoneRub + ppeRub + overheadRub)
  const salePriceRub = roundUpPrice(costRub * (1 + markup))

  return {
    hoursFittings,
    hoursRmu,
    moldingMassKg,
    rowsRub: bucketSums['Материалы на закупку'] + bucketSums['Труба, муфта'] + bucketSums['Формовка'] + bucketSums['Работы, ФОТ'],
    pzrHours,
    pzrRub,
    acetoneKg,
    acetoneRub,
    ppeUnits,
    ppeRub,
    overheadHours,
    overheadRub,
    costRub,
    markup,
    salePriceRub,
  }
}

/** Почему итог не сверялся. */
export type TotalSkipReason =
  /** У дерева нет ставок экономики: собрано до того, как их стали фиксировать. */
  | 'NO_RATES'
  /** Количество строки задано выражением, а посчитанного в дереве нет. */
  | 'UNRESOLVED_ROWS'
  /** Расчёт пришёл без итога — сверять не с чем. */
  | 'NO_CLIENT_TOTAL'

export type TotalCheck =
  /** Итог пересчитан: сошёлся (`ok`) или нет. */
  | { ok: boolean; serverTotal: number; clientTotal: number; skipped?: undefined }
  /** Проверить было нечем — выпуск КП это не останавливает. */
  | { ok: true; skipped: TotalSkipReason; serverTotal?: undefined; clientTotal?: undefined }

/**
 * Сверяет итог, присланный расчётом, с пересчитанным по сохранённому дереву
 * (решение Р7).
 *
 * Сравнение точное: обе стороны округляют цену продажи вверх до 100 ₽ одной и
 * той же функцией и считают по одному и тому же дереву — экран расчёта
 * сохраняет его перед выпуском КП. Допуск «в пределах шага» пропустил бы
 * ровно то, ради чего проверка и сделана.
 *
 * Старые деревья не проверяются, а не отклоняются: у них нет ни ставок, ни
 * посчитанных количеств, и запрет выпуска КП по ним был бы не защитой, а
 * потерей работоспособности.
 */
export function verifyKpTotal(surveyData: unknown, clientTotal: number | null | undefined): TotalCheck {
  const rates = treeRates(surveyData)
  if (!rates) return { ok: true, skipped: 'NO_RATES' }
  if (typeof clientTotal !== 'number' || !Number.isFinite(clientTotal)) {
    return { ok: true, skipped: 'NO_CLIENT_TOTAL' }
  }

  const economics = economicsOfTree(surveyData, rates)
  if (!economics) return { ok: true, skipped: 'UNRESOLVED_ROWS' }

  return {
    ok: economics.salePriceRub === clientTotal,
    serverTotal: economics.salePriceRub,
    clientTotal,
  }
}
