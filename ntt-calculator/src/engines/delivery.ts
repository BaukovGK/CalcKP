/**
 * Расчёт доставки изделия до объекта.
 *
 * Два справочника:
 *  - «Таблица ограничений по погрузке линейных труб на а/транспорт
 *    (L = 13 600 мм)» — сколько изделий данного Ду и длины помещается в одну
 *    машину ({@link PIPES_PER_TRUCK_12M}, {@link LENGTH_FACTOR}); константа
 *    кода — геометрия кузова от квартала не меняется;
 *  - тарифы доставки по маршрутам (книга отдела закупок, таблица
 *    `DeliveryRate`, экран «Тарифы доставки») — ставки за машину с НДС.
 *
 * Правила (постановка заказчика, 08.11.2026):
 *  1. Число машин под изделие — по таблице ограничений.
 *  2. Диаметр больше 2,4 м — груз негабаритный: к габаритной ставке машины
 *     под изделие добавляется «негабаритный груз, сопровождение»; если в
 *     примечании маршрута «только с разрешением» — ещё и «разрешение».
 *  3. Длина КНС больше 12 м — закладывается ещё одна машина (того же класса,
 *     что и под корпус).
 *  4. К КНС всегда добавляется одна габаритная машина — комплектующие.
 *
 * Функции чистые: ни сети, ни Vue — экран ОЛ зовёт {@link knsDelivery}.
 */

/** Длины столбцов таблицы ограничений, м (12 м — полная длина кузова). */
export const LOADING_LENGTHS_M = [2, 3, 4, 6, 12] as const
export type LoadingLengthM = (typeof LOADING_LENGTHS_M)[number]

/**
 * Изделий длиной 12 м в одной машине по Ду, мм (столбец «Длина 12 м» таблицы
 * ограничений). От Ду 1500 и больше — одно изделие на машину.
 */
export const PIPES_PER_TRUCK_12M: ReadonlyArray<readonly [dnMm: number, perTruck: number]> = [
  [300, 42], [350, 36], [400, 25], [450, 20], [500, 16],
  [600, 9], [700, 9], [800, 6], [900, 4], [1000, 4], [1100, 4],
  [1200, 3], [1300, 2], [1400, 2], [1500, 1],
  [1600, 1], [1700, 1], [1800, 1], [1900, 1], [2000, 1], [2100, 1], [2200, 1],
  [2300, 1], [2400, 1], [2500, 1], [2600, 1], [2700, 1], [2800, 1], [2900, 1], [3000, 1],
]

/**
 * Коротких изделий в машине — кратно 12-метровым (формулы таблицы:
 * D = B×2, F = B×3, H = B×4, J = B×6).
 */
export const LENGTH_FACTOR: Readonly<Record<LoadingLengthM, number>> = { 12: 1, 6: 2, 4: 3, 3: 4, 2: 6 }

/** Диаметр, с которого груз негабаритный, мм: «больше 2,4 м». */
export const OVERSIZE_DIAMETER_MM = 2400

/** Длина кузова под изделие, м: длиннее — ещё одна машина. */
export const MAX_LOAD_LENGTH_M = 12

/** Примечание маршрута, при котором к негабариту добавляется ставка разрешения. */
const PERMIT_NOTE = /только\s+с\s+разрешени/i

/** Ставки маршрута (строка `DeliveryRate`). null — «нет ставки». */
export interface DeliveryRate {
  id?: string
  city: string
  gabaritRub: number | null
  permitRub: number | null
  escortRub: number | null
  note: string | null
}

/** Нужна ли по маршруту ставка разрешения — по примечанию книги. */
export function permitRequired(rate: Pick<DeliveryRate, 'note'> | null | undefined): boolean {
  return PERMIT_NOTE.test(rate?.note ?? '')
}

/** Столбец таблицы под длину изделия: наименьший, куда оно ложится; длиннее 12 м — 12 м. */
export function loadingLengthM(lengthM: number): LoadingLengthM {
  return LOADING_LENGTHS_M.find((l) => lengthM <= l) ?? 12
}

/**
 * Изделий в одной машине по Ду и длине. Ду не из ряда таблицы — берётся
 * ближайший больший (в машину влезет не больше, чем у него); больше 3000 —
 * одно изделие.
 */
export function itemsPerTruck(dnMm: number, lengthM: number): number {
  const row = PIPES_PER_TRUCK_12M.find(([dn]) => dnMm <= dn)
  const per12 = row ? row[1] : 1
  return per12 * LENGTH_FACTOR[loadingLengthM(lengthM)]
}

/** Изделие, которое везём. */
export interface DeliveryInput {
  /** Диаметр изделия, мм. */
  diameterMm: number
  /** Длина изделия (в машине оно лежит), мм. */
  lengthMm: number
  /** Изделий, шт. По умолчанию одно. */
  quantity?: number
  /** Добавить габаритную машину под комплектующие (у КНС — всегда). */
  componentsTruck?: boolean
}

/** Машины по классам. */
export interface TruckPlan {
  /** Машин под изделия по таблице ограничений. */
  productTrucks: number
  /** Ещё машин, потому что изделие длиннее 12 м. */
  extraLengthTrucks: number
  /** Габаритных машин под комплектующие. */
  componentsTrucks: number
  /** Изделие негабаритное (диаметр больше 2,4 м). */
  oversize: boolean
  /** Изделий в машине по таблице ограничений. */
  perTruck: number
  /** Итого машин. */
  total: number
}

/** Сколько и каких машин нужно — без денег. */
export function planTrucks(input: DeliveryInput): TruckPlan {
  const quantity = Math.max(1, Math.ceil(input.quantity ?? 1))
  const lengthM = input.lengthMm / 1000
  const perTruck = itemsPerTruck(input.diameterMm, lengthM)
  const productTrucks = Math.ceil(quantity / perTruck)
  const extraLengthTrucks = lengthM > MAX_LOAD_LENGTH_M ? productTrucks : 0
  const componentsTrucks = input.componentsTruck ? 1 : 0
  return {
    productTrucks,
    extraLengthTrucks,
    componentsTrucks,
    oversize: input.diameterMm > OVERSIZE_DIAMETER_MM,
    perTruck,
    total: productTrucks + extraLengthTrucks + componentsTrucks,
  }
}

/** Столбец тарифа. */
export type RateColumn = 'gabaritRub' | 'escortRub' | 'permitRub'

/** Подписи столбцов — как в книге закупок. */
export const RATE_COLUMN_LABELS: Readonly<Record<RateColumn, string>> = {
  gabaritRub: 'Габаритный груз',
  escortRub: 'Негабаритный груз, сопровождение',
  permitRub: 'Негабаритный груз, разрешение',
}

/** Строка расчёта: столбец тарифа × машин. */
export interface DeliveryLine {
  column: RateColumn
  label: string
  trucks: number
  /** Ставка за машину, ₽; null — по маршруту нет ставки. */
  rateRub: number | null
  sumRub: number | null
}

export interface DeliveryResult {
  plan: TruckPlan
  permitRequired: boolean
  lines: DeliveryLine[]
  /** Итог, ₽; null — какой-то нужной ставки по маршруту нет. */
  totalRub: number | null
  /** Ставки, которых по маршруту нет, а они нужны. */
  missing: string[]
}

/**
 * Стоимость доставки по маршруту.
 *
 * Каждая машина — по ставке «габаритный груз». К машинам под негабаритное
 * изделие ставки складываются: габарит + «сопровождение», а при «только с
 * разрешением» — ещё и «разрешение» (уточнение заказчика 08.11.2026).
 */
export function calcDelivery(input: DeliveryInput, rate: DeliveryRate): DeliveryResult {
  const plan = planTrucks(input)
  const permit = permitRequired(rate)
  const productAll = plan.productTrucks + plan.extraLengthTrucks
  // Габаритная ставка — у каждой машины; негабаритные сверх неё платят
  // сопровождение (и разрешение, если маршрут без него не пускает).
  const gabaritTrucks = plan.componentsTrucks + productAll
  const oversizeTrucks = plan.oversize ? productAll : 0

  const lines: DeliveryLine[] = []
  const add = (column: RateColumn, trucks: number) => {
    if (trucks <= 0) return
    const rateRub = rate[column]
    lines.push({
      column,
      label: RATE_COLUMN_LABELS[column],
      trucks,
      rateRub,
      sumRub: rateRub == null ? null : rateRub * trucks,
    })
  }
  add('gabaritRub', gabaritTrucks)
  add('escortRub', oversizeTrucks)
  if (permit) add('permitRub', oversizeTrucks)

  const missing = lines.filter((l) => l.rateRub == null).map((l) => l.label)
  const totalRub = missing.length ? null : lines.reduce((s, l) => s + (l.sumRub ?? 0), 0)
  return { plan, permitRequired: permit, lines, totalRub, missing }
}

/**
 * Доставка КНС: одна станция, корпус лежит в машине — длина изделия равна
 * полной высоте корпуса; комплектующие — всегда отдельной габаритной машиной.
 */
export function knsDelivery(dnMm: number, fullHeightMm: number, rate: DeliveryRate): DeliveryResult {
  return calcDelivery({ diameterMm: dnMm, lengthMm: fullHeightMm, quantity: 1, componentsTruck: true }, rate)
}

/**
 * Маршрут, выбранный в ОЛ: по id, а если строку пересоздал импорт книги —
 * по названию города (id после импорта другие).
 */
export function findRate<T extends DeliveryRate>(rates: readonly T[], id: string, city: string): T | null {
  return rates.find((r) => r.id && r.id === id) ?? (city ? rates.find((r) => r.city === city) : undefined) ?? null
}

/** Признаки, что маршрут книги тарифов — не просто город (как в backend/utils/kp-terms.ts). */
const NOT_A_CITY = /обл\.?|област|кра[йя]|республик|р-н|район|(^|\s)ст\.|станц|ГРЭС|ТЭС|ТКО|ТБО|МПК|порт|,|\s-\s|\(|\d/i

/**
 * Пункт назначения для КП: «Москва» → «г. Москва»; «Пермский край»,
 * «Солнечногорск, МО» — как есть. Та же функция, что на сервере.
 */
export function deliveryPlace(city: string): string {
  const c = city.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  if (!c) return c
  if (/^(г\.|город\s)/i.test(c) || NOT_A_CITY.test(c)) return c
  return `г. ${c}`
}
