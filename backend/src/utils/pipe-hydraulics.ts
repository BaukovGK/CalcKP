/**
 * Гидравлика напорных трубопроводов насосной станции: диаметр напорного
 * участка и диаметры выходных патрубков.
 *
 * Расчёт стоит на трёх параметрах опросного листа — расход, напор, количество
 * рабочих насосов. Напор нужен подбору насоса (`pump-selection.ts`), расход и
 * число насосов — этому модулю: он делит поток по участкам и подбирает под
 * каждый ближайшую подходящую трубу.
 *
 * Диаметр считается по целевой (экономической) скорости течения:
 * ```
 * D = √(4·Q / (π·Vрасч))
 * ```
 * Vрасч по умолчанию 1,5 м/с (СП 32.13330, экономический диапазон 1…2 м/с).
 *
 * ❗ D в этой формуле — диаметр ПОТОКА, то есть ВНУТРЕННИЙ. Лист «Гидравл.
 * расчет» эталона считает скорость именно по внутреннему
 * (`B12 = 0,16 − 2·0,0095` для трубы Ø160×9,5), и здесь так же: труба
 * подбирается по внутреннему диаметру, а не по наружному. Разница не
 * косметическая — у ПЭ-100 SDR17 стенка съедает заметную долю сечения: Ø110
 * даёт проход 96,8 мм, и подбор «по наружному» выдавал бы трубу, которая
 * целевую скорость не держит.
 *
 * Функция даёт МИНИМАЛЬНЫЙ типоразмер, проходящий по целевой скорости.
 * Реальные листы отклоняются от него в обе стороны, и обе — инженерный выбор
 * поверх гидравлики: где-то берут трубу крупнее (запас, унификация с
 * патрубком КНС), где-то мельче. Эталон ОЛ3487 — как раз второй случай: там
 * стояк DN100 и коллектор DN150, то есть скорости 1,71 и 1,61 м/с. Это внутри
 * экономического диапазона СП 32.13330 (1…2 м/с), но выше нашего умолчания;
 * чтобы прийти к тем же диаметрам, достаточно поднять `designVelocityMs`.
 *
 * @module utils/pipe-hydraulics
 */

/** Целевая (экономическая) скорость течения в напорном трубопроводе, м/с, по умолчанию. */
export const DEFAULT_DESIGN_VELOCITY_MS = 1.5

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

/** Внутренний диаметр (проход), мм: `Dн − 2·стенка`. */
export function innerDiameterMm(size: PePipeSize): number {
  return size.odMm - 2 * size.wallMm
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

/** Подобрать наименьшую трубу ряда, чей ПРОХОД не меньше требуемого. */
function pickByInner(
  flowM3s: number,
  designVelocityMs: number,
  sizes: readonly PePipeSize[],
): { size: PePipeSize; theoreticalDiameterMm: number; warnings: PipeDiameterWarning[] } {
  const warnings: PipeDiameterWarning[] = []
  const theoreticalDiameterMm = Math.sqrt((4 * flowM3s) / (Math.PI * designVelocityMs)) * 1000

  const sorted = [...sizes].sort((a, b) => innerDiameterMm(a) - innerDiameterMm(b))
  let size = sorted.find((s) => innerDiameterMm(s) >= theoreticalDiameterMm)
  if (size == null) {
    size = sorted[sorted.length - 1]!
    warnings.push({
      code: 'DIAMETER_ABOVE_CATALOG',
      message:
        `Требуемый проход ${theoreticalDiameterMm.toFixed(1)} мм больше максимума каталога ` +
        `(⌀${size.odMm}, проход ${innerDiameterMm(size).toFixed(1)} мм) — взят максимум, ` +
        `скорость будет выше целевой.`,
    })
  }
  return { size, theoreticalDiameterMm, warnings }
}

/** Собрать результат по участку с известным расходом. */
function sizeSection(
  flowM3h: number,
  designVelocityMs: number,
  sizes: readonly PePipeSize[],
): PipeDiameterResult {
  const flowM3s = flowM3h / 3600
  const { size, theoreticalDiameterMm, warnings } = pickByInner(flowM3s, designVelocityMs, sizes)
  const inner = innerDiameterMm(size)

  return {
    diameterMm: size.odMm,
    dn: size.dn,
    wallMm: size.wallMm,
    innerDiameterMm: inner,
    theoreticalDiameterMm,
    // Скорость — по проходу, а не по наружному: иначе она выходит оптимистичной
    // на треть и труба выглядит подходящей, когда не подходит.
    velocityMs: (4 * flowM3s) / (Math.PI * (inner / 1000) ** 2),
    designVelocityMs,
    flowM3h,
    warnings,
  }
}

/**
 * Диаметр внутристанционного напорного участка — того, что идёт от насоса
 * вверх (стояк на АТМ).
 *
 * Считается по притоку НА ОДИН НАСОС: в КНС это отдельный подъёмный участок
 * на каждый насос (лист `ОЛ_НАСОСНАЯ_СТАНЦИЯ`: скорость там по
 * `B4 = E51/(3,6·E55)`, то есть по притоку на один насос). Та же логика
 * деления, что в `pump-selection.ts` и `pump-station-dimensions.ts`.
 *
 * @param flowM3h Общий приток на станцию (все рабочие насосы вместе), м³/ч.
 * @param workingPumps Количество рабочих насосов, шт (по умолчанию 1).
 * @param designVelocityMs Целевая скорость течения, м/с (по умолчанию 1,5).
 * @param sizes Ряд типоразмеров (по умолчанию {@link PE_SDR17_SIZES}).
 */
export function calcDischargePipeDiameterMm(
  flowM3h: number,
  workingPumps = 1,
  designVelocityMs: number = DEFAULT_DESIGN_VELOCITY_MS,
  sizes: readonly PePipeSize[] = PE_SDR17_SIZES,
): PipeDiameterResult & { flowPerPumpM3h: number } {
  if (!(flowM3h > 0)) {
    throw new Error('flowM3h (общий приток, м³/ч) обязателен и должен быть > 0.')
  }
  if (!(workingPumps > 0) || !Number.isInteger(workingPumps)) {
    throw new Error('workingPumps (количество рабочих насосов) должен быть целым числом > 0.')
  }
  if (!(designVelocityMs > 0)) {
    throw new Error('designVelocityMs (расчётная скорость, м/с) должен быть > 0.')
  }

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
   * Выходной патрубок станции. Расход — полный, делённый на число напорных
   * трубопроводов: при одном выходе через него идёт всё, при двух — половина.
   */
  outlet: PipeDiameterResult
  /**
   * Коллектор шире стояка — насосов больше одного, и сборка действительно
   * собирает потоки. При единственном рабочем насосе все три участка
   * совпадают, и различать их незачем.
   */
  collectorWiderThanRiser: boolean
}

/**
 * Диаметры напорного трубопровода станции: стояк, коллектор, выходной патрубок.
 *
 * Подбор идёт в три шага, и этот модуль отвечает за второй и третий:
 *
 * 1. Насосы — по расходу, напору и числу рабочих (`pump-selection.ts`).
 * 2. **Выходной патрубок** — по расходу рабочих насосов, делённому на число
 *    напорных трубопроводов (их бывает один или два).
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
 * @param sizes Ряд типоразмеров (по умолчанию {@link PE_SDR17_SIZES}).
 */
export function selectPressurePiping(
  flowM3h: number,
  workingPumps: number,
  outletCount: number,
  designVelocityMs: number = DEFAULT_DESIGN_VELOCITY_MS,
  sizes: readonly PePipeSize[] = PE_SDR17_SIZES,
): PressurePipingResult {
  if (!(flowM3h > 0)) {
    throw new Error('flowM3h (общий приток, м³/ч) обязателен и должен быть > 0.')
  }
  if (!(workingPumps > 0) || !Number.isInteger(workingPumps)) {
    throw new Error('workingPumps (количество рабочих насосов) должен быть целым числом > 0.')
  }
  if (!(outletCount > 0) || !Number.isInteger(outletCount)) {
    throw new Error('outletCount (количество напорных трубопроводов) должен быть целым числом > 0.')
  }
  if (!(designVelocityMs > 0)) {
    throw new Error('designVelocityMs (расчётная скорость, м/с) должен быть > 0.')
  }

  const riser = sizeSection(flowM3h / workingPumps, designVelocityMs, sizes)
  const collector = sizeSection(flowM3h, designVelocityMs, sizes)

  return {
    riser,
    collector,
    outlet: sizeSection(flowM3h / outletCount, designVelocityMs, sizes),
    collectorWiderThanRiser: collector.innerDiameterMm > riser.innerDiameterMm,
  }
}
