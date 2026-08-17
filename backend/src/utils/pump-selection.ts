/**
 * Подбор марки насоса из каталога по расходу и диаметру напорного патрубка.
 *
 * Критерии отбора (оба обязательны):
 *  - расход попадает в диапазон производительности насоса (`capacityMinM3h`
 *    … `capacityMaxM3h` включительно);
 *  - диаметр патрубка насоса совпадает С ТОЧНОСТЬЮ до мм с заданным (в отличие
 *    от диапазона производительности это не интервал, а типоразмер фланца).
 *
 * Каталог передаётся аргументом (по умолчанию — встроенная копия из 6 позиций,
 * см. {@link DEFAULT_PUMPS}, зеркало сидированной таблицы `Pump` в БД). Для
 * реального подбора передавайте `prisma.pump.findMany()`.
 *
 * @module utils/pump-selection
 */

export interface PumpCatalogEntry {
  /** Марка/модель насоса. */
  name: string
  /** Минимум диапазона производительности, м³/ч. */
  capacityMinM3h: number
  /** Максимум диапазона производительности, м³/ч. */
  capacityMaxM3h: number
  /** Диаметр напорного патрубка насоса, мм. */
  nozzleDiameterMm: number
}

/**
 * Каталог насосов по умолчанию — 6 позиций, зеркало сидированной таблицы
 * `Pump` (`prisma/seed-data/pumps.json`). Диапазоны производительности не
 * перекрываются и вместе покрывают 5…700 м³/ч; патрубки — стандартный ряд
 * фланцевых DN дренажных/канализационных насосов.
 */
export const DEFAULT_PUMPS: readonly PumpCatalogEntry[] = [
  { name: 'GROSSEN GS 65', capacityMinM3h: 5, capacityMaxM3h: 24, nozzleDiameterMm: 65 },
  { name: 'GROSSEN GS 80', capacityMinM3h: 24, capacityMaxM3h: 44, nozzleDiameterMm: 80 },
  { name: 'GROSSEN GS 100', capacityMinM3h: 44, capacityMaxM3h: 90, nozzleDiameterMm: 100 },
  { name: 'GROSSEN GS 150', capacityMinM3h: 90, capacityMaxM3h: 250, nozzleDiameterMm: 150 },
  { name: 'GROSSEN GS 200', capacityMinM3h: 250, capacityMaxM3h: 450, nozzleDiameterMm: 200 },
  { name: 'GROSSEN GS 250', capacityMinM3h: 450, capacityMaxM3h: 700, nozzleDiameterMm: 250 },
]

export interface PumpSelectionWarning {
  code: string
  message: string
}

export interface PumpSelectionResult {
  /** Марка подобранного насоса, либо `null`, если подходящего нет. */
  name: string | null
  /** Полная запись каталога подобранного насоса (для справки), либо `null`. */
  pump: PumpCatalogEntry | null
  warnings: PumpSelectionWarning[]
}

/**
 * Подобрать насос по расходу и диаметру патрубка.
 *
 * @param flowM3h Расход (производительность), м³/ч. Обязателен, > 0.
 * @param nozzleDiameterMm Требуемый диаметр напорного патрубка, мм. Обязателен, > 0.
 * @param pumps Каталог насосов (по умолчанию {@link DEFAULT_PUMPS}).
 */
export function selectPump(
  flowM3h: number,
  nozzleDiameterMm: number,
  pumps: readonly PumpCatalogEntry[] = DEFAULT_PUMPS,
): PumpSelectionResult {
  if (!(flowM3h > 0)) {
    throw new Error('flowM3h (расход, м³/ч) обязателен и должен быть > 0.')
  }
  if (!(nozzleDiameterMm > 0)) {
    throw new Error('nozzleDiameterMm (диаметр патрубка, мм) обязателен и должен быть > 0.')
  }

  const warnings: PumpSelectionWarning[] = []

  const byCapacity = pumps.filter((p) => flowM3h >= p.capacityMinM3h && flowM3h <= p.capacityMaxM3h)
  if (byCapacity.length === 0) {
    warnings.push({
      code: 'NO_CAPACITY_MATCH',
      message: `В каталоге нет насоса с диапазоном производительности, покрывающим ${flowM3h} м³/ч.`,
    })
    return { name: null, pump: null, warnings }
  }

  const matches = byCapacity.filter((p) => p.nozzleDiameterMm === nozzleDiameterMm)
  if (matches.length === 0) {
    warnings.push({
      code: 'NO_NOZZLE_MATCH',
      message:
        `Расходу ${flowM3h} м³/ч соответствует патрубок ` +
        `${byCapacity.map((p) => `${p.name} (⌀${p.nozzleDiameterMm} мм)`).join(', ')}, ` +
        `а не заданный ⌀${nozzleDiameterMm} мм.`,
    })
    return { name: null, pump: null, warnings }
  }

  if (matches.length > 1) {
    warnings.push({
      code: 'MULTIPLE_MATCHES',
      message: `Найдено несколько подходящих насосов (${matches.map((p) => p.name).join(', ')}) — взят первый.`,
    })
  }

  const pump = matches[0]!
  return { name: pump.name, pump, warnings }
}
