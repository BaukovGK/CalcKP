/**
 * Гидравлический подбор диаметра напорного трубопровода насосной станции.
 *
 * Источник метода: лист «Гидравл. расчет» из примеров ОЛ считает диаметр
 * напорного трубопровода как ВХОДНОЙ параметр (заранее выбранную трубу) и
 * лишь проверяет скорость `V = 4·Q/(π·D²)` — готовой формулы «диаметр из
 * расхода» там нет. Здесь используется обратная, стандартная гидравлическая
 * формула — расчётный диаметр по целевой (экономической) скорости течения:
 * ```
 * D = √(4·Q / (π·Vрасч))
 * ```
 * с округлением вверх до ближайшего типоразмера напорной ПЭ-трубы (тот же
 * ряд, что в БД: `PePipe`, `prisma/seed-data/pipe-weights-pe.json`).
 *
 * Vрасч по умолчанию — 1,5 м/с (экономическая скорость для напорных
 * канализационных трубопроводов, SP 32.13330, диапазон 1–2 м/с). Реальные
 * листы иногда берут трубу крупнее расчётной (для запаса/унификации патрубка
 * КНС) — это уже инженерный выбор поверх гидравлики, не входит в эту функцию.
 *
 * @module utils/pipe-hydraulics
 */

/** Целевая (экономическая) скорость течения в напорном трубопроводе, м/с, по умолчанию. */
export const DEFAULT_DESIGN_VELOCITY_MS = 1.5

/** Стандартный ряд наружных диаметров напорных ПЭ-труб, мм (ПЭ-100 SDR17). */
export const STANDARD_PE_OD_MM: readonly number[] = [
  32, 40, 50, 63, 75, 90, 110, 125, 140, 160, 180, 200, 225, 250, 280, 315,
  355, 400, 450, 500, 560, 630, 710, 800, 900, 1000,
]

export interface PipeDiameterWarning {
  code: string
  message: string
}

export interface PipeDiameterResult {
  /** Диаметр напорного трубопровода, мм — ближайший больший типоразмер из каталога. */
  diameterMm: number
  /** Расчётный (теоретический, без округления до каталога) диаметр, мм. */
  theoreticalDiameterMm: number
  /** Фактическая скорость течения при выбранном диаметре, м/с. */
  velocityMs: number
  /** Целевая скорость, заложенная в расчёт, м/с. */
  designVelocityMs: number
  /** Расход на ОДИН насос, м³/ч (`flowM3h / workingPumps`) — то, что реально легло в расчёт. */
  flowPerPumpM3h: number
  warnings: PipeDiameterWarning[]
}

/**
 * Рассчитать диаметр напорного трубопровода насосной станции по расходу.
 *
 * Внутренний напорный трубопровод в КНС — это отдельный подъёмный участок на
 * КАЖДЫЙ насос (см. лист `ОЛ_НАСОСНАЯ_СТАНЦИЯ`: скорость там считается по
 * B4 = E51/(3.6·E55), т.е. по притоку на один насос, не по общему притоку на
 * станцию). Поэтому диаметр считается по `flowM3h / workingPumps`, а не по
 * общему притоку — та же логика деления, что и в `pump-selection.ts` и
 * `pump-station-dimensions.ts`.
 *
 * @param flowM3h Общий приток на станцию (все рабочие насосы вместе), м³/ч. Обязателен, > 0.
 * @param workingPumps Количество рабочих насосов (не считая резервных), шт.
 *   По умолчанию 1 (весь приток — на один насос, как было до этого параметра).
 * @param designVelocityMs Целевая скорость течения, м/с (по умолчанию 1,5).
 * @param standardSizesMm Ряд стандартных диаметров для округления, мм
 *   (по умолчанию — каталог ПЭ-труб {@link STANDARD_PE_OD_MM}).
 */
export function calcDischargePipeDiameterMm(
  flowM3h: number,
  workingPumps = 1,
  designVelocityMs: number = DEFAULT_DESIGN_VELOCITY_MS,
  standardSizesMm: readonly number[] = STANDARD_PE_OD_MM,
): PipeDiameterResult {
  if (!(flowM3h > 0)) {
    throw new Error('flowM3h (общий приток, м³/ч) обязателен и должен быть > 0.')
  }
  if (!(workingPumps > 0) || !Number.isInteger(workingPumps)) {
    throw new Error('workingPumps (количество рабочих насосов) должен быть целым числом > 0.')
  }
  if (!(designVelocityMs > 0)) {
    throw new Error('designVelocityMs (расчётная скорость, м/с) должен быть > 0.')
  }

  const warnings: PipeDiameterWarning[] = []

  const flowPerPumpM3h = flowM3h / workingPumps
  const flowM3s = flowPerPumpM3h / 3600
  const theoreticalDiameterM = Math.sqrt((4 * flowM3s) / (Math.PI * designVelocityMs))
  const theoreticalDiameterMm = theoreticalDiameterM * 1000

  const sorted = [...standardSizesMm].sort((a, b) => a - b)
  let diameterMm = sorted.find((d) => d >= theoreticalDiameterMm)
  if (diameterMm == null) {
    diameterMm = sorted[sorted.length - 1]
    warnings.push({
      code: 'DIAMETER_ABOVE_CATALOG',
      message:
        `Расчётный диаметр ${theoreticalDiameterMm.toFixed(1)} мм больше максимума каталога ` +
        `(${diameterMm} мм) — взят максимум, скорость будет выше целевой.`,
    })
  }

  const velocityMs = (4 * flowM3s) / (Math.PI * (diameterMm / 1000) ** 2)

  return { diameterMm, theoreticalDiameterMm, velocityMs, designVelocityMs, flowPerPumpM3h, warnings }
}
