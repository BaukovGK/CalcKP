/**
 * Гидравлика напорных трубопроводов насосной станции: диаметры напорного узла
 * и проверка скорости в напорном патрубке, заданном опросным листом.
 *
 * Расчёт стоит на трёх параметрах опросного листа — расход, напор, количество
 * рабочих насосов. Напор нужен подбору насоса (`pump-selection.ts`), расход и
 * число насосов — этому модулю: он делит поток по участкам и подбирает под
 * каждый трубу.
 *
 * Скорость и требуемый диаметр — по сечению потока:
 * ```
 * V = 4·Q / (π·d²)          D = √(4·Q / (π·Vрасч))
 * ```
 * Vрасч по умолчанию 1,5 м/с — середина экономического диапазона 1…2 м/с
 * (СП 32.13330).
 *
 * ❗ d — диаметр ПОТОКА, то есть ВНУТРЕННИЙ. Лист «Гидравл. расчет» эталона
 * считает скорость именно по внутреннему (`B12 = 0,16 − 2·0,0095` для трубы
 * Ø160×9,5), и здесь так же. Разница не косметическая — у ПЭ-100 SDR17 стенка
 * съедает заметную долю сечения: Ø110 даёт проход 96,8 мм.
 *
 * ТРУБА ИЗ РЯДА ПАТРУБКОВ. Подбор идёт по DN, которые есть у завода: ряд
 * патрубков мастер-книги (`nozzle-dn-series.json`) — 50, 65, 80, 100, 150,
 * 200… Опросный лист другие DN в поле не пропускает, а задвижек, обратных
 * клапанов и комплектов нитки на них нет в прайсе. Прежняя редакция брала
 * весь ряд ПЭ и рекомендовала DN125 и DN180, которые ввести нельзя: поле
 * заменило бы 125 на 150.
 *
 * СКОРОСТЬ, БЛИЖАЙШАЯ К ЦЕЛЕВОЙ. Соседние DN ряда отличаются по сечению в
 * 1,3–2 раза (DN100 → DN150 — в 2,1), и правило «наименьшая труба, где скорость
 * не выше целевой» на таком ряду уводит в заведомо тихоходную трубу: стояк
 * ОЛ3487 (45,23 м³/ч) выходил DN150 при 0,80 м/с — ниже самоочищающей. Берётся
 * DN, где скорость ближе всего к целевой, при равенстве — крупнее. На ОЛ3487
 * это стояк DN100 (1,71 м/с) и коллектор DN150 (1,61 м/с) — ровно как в
 * проекте. Скорость вне экономического диапазона помечается предупреждением.
 *
 * ВЫХОД — РАБОТА НА ОДНУ НИТКУ. Лист «Гидравл. расчет» подписан «работа на 1
 * нитку» и берёт весь приток (`D4 = ОЛ!E51/3,6`) при двух напорных в опросном
 * листе: каждая напорная линия рассчитана пропустить весь расход, когда
 * вторая отключена. Так же подобран и эталон: у ОЛ3487 и у самого шаблона
 * две напорные DN150 — это 1,61 и 1,43 м/с на одну нитку и 0,80 и 0,72 м/с,
 * если делить приток пополам. Скорость при одновременной работе всех линий
 * возвращается отдельно, для сведения.
 *
 * Материал. Скорости посчитаны по проходу ПЭ-100 SDR17 — напорный патрубок
 * станции ПЭ (втулка под фланец в комплекте нитки). Стояк и коллектор внутри
 * корпуса стальные, проход у них шире (DN150: 159×4,5 — 150 мм против 141 у
 * ПЭ), так что их скорость здесь — оценка сверху.
 *
 * @module utils/pipe-hydraulics
 */

import nozzleDn from './nozzle-dn-series.json'

/** Целевая (экономическая) скорость течения в напорном трубопроводе, м/с, по умолчанию. */
export const DEFAULT_DESIGN_VELOCITY_MS = 1.5

/**
 * Экономический диапазон скоростей в напорном трубопроводе, м/с. Ниже — в
 * линии оседает взвесь, выше — растут потери напора и гидроудар.
 */
export const ECONOMIC_VELOCITY_MS = { min: 1, max: 2 } as const

/** Типоразмер напорной ПЭ-трубы. */
export interface PePipeSize {
  /** Условный проход, мм — им оперируют опросный лист и наименования каталога. */
  dn: number
  /** Наружный диаметр, мм. */
  odMm: number
  /** Толщина стенки, мм. */
  wallMm: number
}

/**
 * Ряд ПЭ-100 SDR17 — тот же, что в БД (`PePipe`,
 * `prisma/seed-data/pipe-weights-pe.json`, 26 позиций).
 *
 * Держится здесь копией намеренно: модуль остаётся чистой функцией без БД,
 * как `pump-curve.ts`, и его можно считать в тесте без миграций. Расхождение
 * с каталогом ловит тест `pipe-hydraulics.test.ts`.
 *
 * `dn` нерегулярен и не уникален (DN 25 → ⌀32, DN 45 → ⌀50, DN 125 → и ⌀125,
 * и ⌀140) — это данные листа, а не ошибка переноса.
 */
export const PE_SDR17_SIZES: readonly PePipeSize[] = [
  { dn: 25, odMm: 32, wallMm: 2 },
  { dn: 40, odMm: 40, wallMm: 2.4 },
  { dn: 45, odMm: 50, wallMm: 3 },
  { dn: 50, odMm: 63, wallMm: 3.8 },
  { dn: 65, odMm: 75, wallMm: 4.5 },
  { dn: 80, odMm: 90, wallMm: 5.4 },
  { dn: 100, odMm: 110, wallMm: 6.6 },
  { dn: 125, odMm: 125, wallMm: 7.4 },
  { dn: 125, odMm: 140, wallMm: 8.3 },
  { dn: 150, odMm: 160, wallMm: 9.5 },
  { dn: 180, odMm: 180, wallMm: 10.7 },
  { dn: 200, odMm: 200, wallMm: 11.9 },
  { dn: 225, odMm: 225, wallMm: 13.4 },
  { dn: 250, odMm: 250, wallMm: 14.8 },
  { dn: 280, odMm: 280, wallMm: 16.6 },
  { dn: 300, odMm: 315, wallMm: 18.7 },
  { dn: 350, odMm: 355, wallMm: 21.1 },
  { dn: 400, odMm: 400, wallMm: 23.7 },
  { dn: 450, odMm: 450, wallMm: 26.7 },
  { dn: 500, odMm: 500, wallMm: 29.7 },
  { dn: 550, odMm: 560, wallMm: 33.2 },
  { dn: 600, odMm: 630, wallMm: 37.4 },
  { dn: 700, odMm: 710, wallMm: 42.1 },
  { dn: 800, odMm: 800, wallMm: 47.4 },
  { dn: 900, odMm: 900, wallMm: 53.3 },
  { dn: 1000, odMm: 1000, wallMm: 59.3 },
]

/** Наружные диаметры ряда, мм — для совместимости и подписей. */
export const STANDARD_PE_OD_MM: readonly number[] = PE_SDR17_SIZES.map((p) => p.odMm)

/**
 * DN патрубков мастер-книги — тот же ряд, что `NOZZLE_DN_SERIES` опросного
 * листа (`ntt-calculator/src/engines/dn-series.ts`); общий файл
 * `nozzle-dn-series.json` не даёт копиям разойтись.
 */
export const NOZZLE_DN_SERIES: readonly number[] = nozzleDn.series

/**
 * Трубы, из которых идёт подбор: ряд ПЭ-100 SDR17 с DN из ряда патрубков.
 * DN125, DN180, DN225 и прочие, которых нет в ряду, сюда не входят; DN ряда
 * без ПЭ-трубы (650, 750, 1100…) — тоже.
 */
export const PE_NOZZLE_SIZES: readonly PePipeSize[] = PE_SDR17_SIZES.filter((p) =>
  NOZZLE_DN_SERIES.includes(p.dn),
)

/** Внутренний диаметр (проход), мм: `Dн − 2·стенка`. */
export function innerDiameterMm(size: PePipeSize): number {
  return size.odMm - 2 * size.wallMm
}

/** Скорость потока, м/с, по расходу м³/ч и проходу мм. */
export function velocityMs(flowM3h: number, innerMm: number): number {
  return (4 * (flowM3h / 3600)) / (Math.PI * (innerMm / 1000) ** 2)
}

export interface PipeDiameterWarning {
  code: string
  message: string
}

export interface PipeDiameterResult {
  /** Наружный диаметр подобранной трубы, мм. */
  diameterMm: number
  /** Условный проход подобранной трубы, мм — он идёт в наименования и в ОЛ. */
  dn: number
  /** Толщина стенки подобранной трубы, мм. */
  wallMm: number
  /** Внутренний диаметр подобранной трубы (проход), мм. */
  innerDiameterMm: number
  /** Требуемый по скорости диаметр потока, мм — без округления до каталога. */
  theoreticalDiameterMm: number
  /** Фактическая скорость течения в подобранной трубе, м/с. */
  velocityMs: number
  /** Целевая скорость, заложенная в расчёт, м/с. */
  designVelocityMs: number
  /** Расход, который реально лёг в расчёт этого участка, м³/ч. */
  flowM3h: number
  warnings: PipeDiameterWarning[]
}

const fmt = (v: number, digits = 2) => Number(v.toFixed(digits)).toLocaleString('ru-RU')

/** Предупреждение о скорости вне экономического диапазона; `null` — в диапазоне. */
function velocityWarning(v: number): PipeDiameterWarning | null {
  const { min, max } = ECONOMIC_VELOCITY_MS
  if (v < min) {
    return {
      code: 'VELOCITY_BELOW_RANGE',
      message: `Скорость ${fmt(v)} м/с ниже экономического диапазона ${min}…${max} м/с — в линии возможен осадок.`,
    }
  }
  if (v > max) {
    return {
      code: 'VELOCITY_ABOVE_RANGE',
      message: `Скорость ${fmt(v)} м/с выше экономического диапазона ${min}…${max} м/с — растут потери напора.`,
    }
  }
  return null
}

/** Подобрать трубу ряда, скорость в которой ближе всего к целевой. */
function pickClosest(
  flowM3h: number,
  designVelocityMs: number,
  sizes: readonly PePipeSize[],
): { size: PePipeSize; theoreticalDiameterMm: number; warnings: PipeDiameterWarning[] } {
  if (sizes.length === 0) throw new Error('Ряд типоразмеров пуст — подбирать не из чего.')
  const warnings: PipeDiameterWarning[] = []
  const theoreticalDiameterMm = Math.sqrt((4 * (flowM3h / 3600)) / (Math.PI * designVelocityMs)) * 1000

  // Скорость монотонно падает с проходом, отклонение от целевой сначала
  // убывает, потом растёт — последний минимум и есть ответ. «≤», а не «<»:
  // при равном отклонении берётся труба крупнее — у неё меньше потери.
  const sorted = [...sizes].sort((a, b) => innerDiameterMm(a) - innerDiameterMm(b))
  const miss = (s: PePipeSize) => Math.abs(velocityMs(flowM3h, innerDiameterMm(s)) - designVelocityMs)
  let size = sorted[0]!
  for (const s of sorted) if (miss(s) <= miss(size)) size = s

  const largest = sorted[sorted.length - 1]!
  if (theoreticalDiameterMm > innerDiameterMm(largest)) {
    warnings.push({
      code: 'DIAMETER_ABOVE_CATALOG',
      message:
        `Требуемый проход ${theoreticalDiameterMm.toFixed(1)} мм больше максимума каталога ` +
        `(⌀${largest.odMm}, проход ${innerDiameterMm(largest).toFixed(1)} мм) — взят максимум, ` +
        `скорость будет выше целевой.`,
    })
    return { size, theoreticalDiameterMm, warnings }
  }
  const w = velocityWarning(velocityMs(flowM3h, innerDiameterMm(size)))
  if (w) warnings.push(w)
  return { size, theoreticalDiameterMm, warnings }
}

/** Собрать результат по участку с известным расходом. */
function sizeSection(
  flowM3h: number,
  designVelocityMs: number,
  sizes: readonly PePipeSize[],
): PipeDiameterResult {
  const { size, theoreticalDiameterMm, warnings } = pickClosest(flowM3h, designVelocityMs, sizes)
  const inner = innerDiameterMm(size)

  return {
    diameterMm: size.odMm,
    dn: size.dn,
    wallMm: size.wallMm,
    innerDiameterMm: inner,
    theoreticalDiameterMm,
    // Скорость — по проходу, а не по наружному: иначе она выходит оптимистичной
    // на треть и труба выглядит подходящей, когда не подходит.
    velocityMs: velocityMs(flowM3h, inner),
    designVelocityMs,
    flowM3h,
    warnings,
  }
}

function assertFlow(flowM3h: number): void {
  if (!(flowM3h > 0)) {
    throw new Error('flowM3h (общий приток, м³/ч) обязателен и должен быть > 0.')
  }
}

function assertCount(value: number, what: string): void {
  if (!(value > 0) || !Number.isInteger(value)) {
    throw new Error(`${what} должен быть целым числом > 0.`)
  }
}

function assertVelocity(designVelocityMs: number): void {
  if (!(designVelocityMs > 0)) {
    throw new Error('designVelocityMs (расчётная скорость, м/с) должен быть > 0.')
  }
}

/**
 * Диаметр внутристанционного напорного участка — того, что идёт от насоса
 * вверх (стояк на АТМ).
 *
 * Считается по притоку НА ОДИН НАСОС: у каждого насоса свой подъёмный
 * участок, и через него идёт только расход этого насоса. Та же логика
 * деления, что в `pump-selection.ts` и `pump-station-dimensions.ts` (лист
 * `ОЛ_НАСОСНАЯ_СТАНЦИЯ` делит приток на рабочие насосы: `N40 = E51/(4·P40·E55)`).
 *
 * @param flowM3h Общий приток на станцию (все рабочие насосы вместе), м³/ч.
 * @param workingPumps Количество рабочих насосов, шт (по умолчанию 1).
 * @param designVelocityMs Целевая скорость течения, м/с (по умолчанию 1,5).
 * @param sizes Ряд типоразмеров (по умолчанию {@link PE_NOZZLE_SIZES}).
 */
export function calcDischargePipeDiameterMm(
  flowM3h: number,
  workingPumps = 1,
  designVelocityMs: number = DEFAULT_DESIGN_VELOCITY_MS,
  sizes: readonly PePipeSize[] = PE_NOZZLE_SIZES,
): PipeDiameterResult & { flowPerPumpM3h: number } {
  assertFlow(flowM3h)
  assertCount(workingPumps, 'workingPumps (количество рабочих насосов)')
  assertVelocity(designVelocityMs)

  const flowPerPumpM3h = flowM3h / workingPumps
  return { ...sizeSection(flowPerPumpM3h, designVelocityMs, sizes), flowPerPumpM3h }
}

export interface PressurePipingResult {
  /**
   * Стояк насоса — от насоса до коллектора. Через него идёт расход ОДНОГО
   * насоса: приток, делённый на число рабочих.
   */
  riser: PipeDiameterResult
  /**
   * Коллектор — горизонтальная сборка, в которую сходятся все стояки. Через
   * него идёт ПОЛНЫЙ рабочий расход: рабочие насосы включаются вместе,
   * резервный их не добавляет, а замещает.
   */
  collector: PipeDiameterResult
  /**
   * Напорная линия на выходе станции — работа на одну нитку: весь приток
   * идёт через одну линию, пока другая отключена (лист «Гидравл. расчет»).
   */
  outlet: PipeDiameterResult
  /** Напорных линий на выходе, шт. */
  outletCount: number
  /**
   * Скорость в подобранной выходной линии, когда работают все напорные линии
   * сразу и приток делится поровну, м/с. При одной линии равна `outlet.velocityMs`.
   */
  outletParallelVelocityMs: number
  /**
   * Коллектор шире стояка — насосов больше одного, и сборка действительно
   * собирает потоки. При единственном рабочем насосе все три участка
   * совпадают, и различать их незачем.
   */
  collectorWiderThanRiser: boolean
}

/**
 * Диаметры напорного трубопровода станции: стояк, коллектор, напорная линия
 * на выходе.
 *
 * Подбор идёт в три шага, и этот модуль отвечает за второй и третий:
 *
 * 1. Насосы — по расходу, напору и числу рабочих (`pump-selection.ts`).
 * 2. **Напорная линия на выходе** — на весь приток: работа на одну нитку.
 * 3. **Трубопроводы внутри напорного узла** — стояк каждого насоса и
 *    коллектор, в который они сходятся.
 *
 * Схема узла (принципиальная, от завода): каждый насос → задвижка → обратный
 * клапан → коллектор; из коллектора вверх уходят выходные патрубки со своими
 * задвижками и, если он есть, аварийный трубопровод с обратным клапаном,
 * задвижкой и быстросъёмной гайкой.
 *
 * ```
 *   ⌇ аварийный   ⌇ выход 1   ⌇ выход 2
 *   ⧗ задвижка    ⧗           ⧗
 *   ▽ клапан
 *   └─────────────┴───────────┴──── коллектор (полный расход)
 *          ▲            ▲            ▲
 *          ▽ клапан     ▽            ▽
 *          ⧗ задвижка   ⧗            ⧗
 *          ⊗ насос      ⊗            ⊗   ← стояк = расход одного насоса
 * ```
 *
 * @param flowM3h Общий приток на станцию (все рабочие насосы вместе), м³/ч.
 * @param workingPumps Количество рабочих насосов, шт.
 * @param outletCount Количество напорных трубопроводов на выходе, шт.
 * @param designVelocityMs Целевая скорость течения, м/с (по умолчанию 1,5).
 * @param sizes Ряд типоразмеров (по умолчанию {@link PE_NOZZLE_SIZES}).
 */
export function selectPressurePiping(
  flowM3h: number,
  workingPumps: number,
  outletCount: number,
  designVelocityMs: number = DEFAULT_DESIGN_VELOCITY_MS,
  sizes: readonly PePipeSize[] = PE_NOZZLE_SIZES,
): PressurePipingResult {
  assertFlow(flowM3h)
  assertCount(workingPumps, 'workingPumps (количество рабочих насосов)')
  assertCount(outletCount, 'outletCount (количество напорных трубопроводов)')
  assertVelocity(designVelocityMs)

  const riser = sizeSection(flowM3h / workingPumps, designVelocityMs, sizes)
  const collector = sizeSection(flowM3h, designVelocityMs, sizes)
  const outlet = sizeSection(flowM3h, designVelocityMs, sizes)

  return {
    riser,
    collector,
    outlet,
    outletCount,
    outletParallelVelocityMs: velocityMs(flowM3h / outletCount, outlet.innerDiameterMm),
    collectorWiderThanRiser: collector.innerDiameterMm > riser.innerDiameterMm,
  }
}

/** Проверка скорости в напорной линии заданного DN. */
export interface OutletPipeCheck {
  /** DN, заданный опросным листом. */
  dn: number
  /** Наружный диаметр ПЭ-трубы этого DN, мм. */
  diameterMm: number
  wallMm: number
  /** Проход, мм — по нему считается скорость. */
  innerDiameterMm: number
  /** Расход линии при работе на одну нитку — весь приток, м³/ч. */
  flowM3h: number
  /** Скорость при работе на одну нитку, м/с. */
  velocityMs: number
  /** Напорных линий на выходе, шт. */
  outletCount: number
  /** Скорость, когда работают все линии сразу и приток делится поровну, м/с. */
  parallelVelocityMs: number
  /** Скорость при работе на одну нитку вне экономического диапазона. */
  warnings: PipeDiameterWarning[]
}

/**
 * Скорость в напорной линии того DN, что стоит в опросном листе, — то, что
 * лист «Гидравл. расчет» эталона считает для заданной трубы (`G19`: скорость
 * вне КНС по проходу Ø160×9,5). Подбор ({@link selectPressurePiping}) говорит,
 * какой DN взять; проверка — годится ли тот, что взят.
 *
 * @param flowM3h Общий приток на станцию, м³/ч.
 * @param dn DN напорного из опросного листа, мм.
 * @param outletCount Количество напорных трубопроводов на выходе, шт.
 * @param sizes Ряд типоразмеров (по умолчанию {@link PE_NOZZLE_SIZES}).
 * @returns `null` — ПЭ-трубы такого DN в ряду нет, проверять не по чему.
 */
export function checkOutletPipe(
  flowM3h: number,
  dn: number,
  outletCount: number,
  sizes: readonly PePipeSize[] = PE_NOZZLE_SIZES,
): OutletPipeCheck | null {
  assertFlow(flowM3h)
  assertCount(outletCount, 'outletCount (количество напорных трубопроводов)')
  const size = sizes.find((s) => s.dn === dn)
  if (!size) return null

  const inner = innerDiameterMm(size)
  const v = velocityMs(flowM3h, inner)
  const w = velocityWarning(v)
  return {
    dn,
    diameterMm: size.odMm,
    wallMm: size.wallMm,
    innerDiameterMm: inner,
    flowM3h,
    velocityMs: v,
    outletCount,
    parallelVelocityMs: velocityMs(flowM3h / outletCount, inner),
    warnings: w ? [w] : [],
  }
}
