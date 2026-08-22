/**
 * Подбор марки насоса из каталога по расходу и напору (рабочей точке).
 *
 * По томам проекта (папка «Работа/Примеры/Проекты», особенно
 * ИМИП-ДУДС24и-П-В0100-ТКР.02.01.03.ДК.ТХ.pdf): «необходимо выполнить
 * гидравлический расчёт для определения напора для подбора насосного
 * оборудования» — реальный подбор ведётся программой производителя (Vandjord,
 * VJ Select) по пересечению характеристики насоса с характеристикой сети,
 * т.е. ПО РАСХОДУ И НАПОРУ ВМЕСТЕ, а не по расходу и диаметру патрубка (как
 * было в предыдущей версии этого модуля). Диаметр патрубка — атрибут
 * конкретного насоса (справочно в результате), а не критерий отбора: в одном
 * из томов внутренний напорный трубопровод в КНС сделан на DN65 при насосе с
 * патрубком DN50 — узел собирается через переходник, диаметры не обязаны
 * совпадать 1-в-1.
 *
 * Критерии отбора (оба обязательны):
 *  - расход попадает в диапазон `capacityMinM3h` … `capacityMaxM3h` насоса;
 *  - напор попадает в диапазон `headMinM` … `headMaxM` насоса.
 *
 * Оба диапазона — прямоугольная аппроксимация паспортной характеристики
 * (кривой) насоса, а не сама кривая: полных кривых Q–H в проде не будет (по
 * договорённости с заказчиком функции), только диапазоны по каталогу.
 *
 * Каталог передаётся аргументом (по умолчанию — встроенная копия из 6
 * позиций, см. {@link DEFAULT_PUMPS}, зеркало сидированной таблицы `Pump` в
 * БД). Для реального подбора передавайте `prisma.pump.findMany()`.
 *
 * @module utils/pump-selection
 */

export interface PumpCatalogEntry {
  /** Марка/модель насоса. */
  name: string
  /** Минимум диапазона расхода, м³/ч. */
  capacityMinM3h: number
  /** Максимум диапазона расхода, м³/ч. */
  capacityMaxM3h: number
  /** Минимум диапазона напора, м. */
  headMinM: number
  /** Максимум диапазона напора, м. */
  headMaxM: number
  /** Диаметр напорного патрубка насоса, мм (справочно). */
  nozzleDiameterMm: number
}

/**
 * Каталог насосов по умолчанию — 6 реальных моделей Vandjord VSL (погружные
 * канализационные, закрытое рабочее колесо), найденных в томах проекта
 * (зеркало сидированной таблицы `Pump`, `prisma/seed-data/pumps.json`).
 *
 * Диапазоны DN80/100/200×2 взяты из паспортов VJ Select (поля «Номинальный
 * расход/напор» … «Макс. расход/напор»), скорректированы вниз там, где
 * реальная рабочая точка проекта оказалась ниже номинала (напр. DN100:
 * реальные 45,36 и 50,59 м³/ч ниже каталожного номинала 65 м³/ч — граница
 * снижена, иначе диапазон не покрывал бы фактические проекты).
 * Диапазоны DN50/DN65 — по единственной найденной в томах рабочей точке
 * (полного паспорта с макс. расходом/напором для них в изученных документах
 * нет) — это демонстрационные значения, не официальный каталог производителя.
 */
export const DEFAULT_PUMPS: readonly PumpCatalogEntry[] = [
  { name: 'Vandjord VSL.50.22.2.5.0D', capacityMinM3h: 15, capacityMaxM3h: 30, headMinM: 13.5, headMaxM: 20.5, nozzleDiameterMm: 50 },
  { name: 'Vandjord VSL.65.30.2.5.0D', capacityMinM3h: 30, capacityMaxM3h: 40, headMinM: 15, headMaxM: 20, nozzleDiameterMm: 65 },
  { name: 'Vandjord VSL.80.37.4.5.0D', capacityMinM3h: 40, capacityMaxM3h: 91, headMinM: 12.5, headMaxM: 17, nozzleDiameterMm: 80 },
  { name: 'Vandjord VSL.100.55.4.5.0D', capacityMinM3h: 45, capacityMaxM3h: 150, headMinM: 12.5, headMaxM: 19, nozzleDiameterMm: 100 },
  { name: 'Vandjord VSL.200.190.4.5.1D', capacityMinM3h: 300, capacityMaxM3h: 525, headMinM: 12, headMaxM: 24, nozzleDiameterMm: 200 },
  { name: 'Vandjord VSL.200.220.4.5.1D', capacityMinM3h: 250, capacityMaxM3h: 550, headMinM: 17, headMaxM: 26, nozzleDiameterMm: 200 },
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
 * Подобрать насос по расходу и напору (рабочей точке).
 *
 * @param flowM3h Расход, м³/ч. Обязателен, > 0.
 * @param headM Требуемый напор, м. Обязателен, > 0.
 * @param pumps Каталог насосов (по умолчанию {@link DEFAULT_PUMPS}).
 */
export function selectPump(
  flowM3h: number,
  headM: number,
  pumps: readonly PumpCatalogEntry[] = DEFAULT_PUMPS,
): PumpSelectionResult {
  if (!(flowM3h > 0)) {
    throw new Error('flowM3h (расход, м³/ч) обязателен и должен быть > 0.')
  }
  if (!(headM > 0)) {
    throw new Error('headM (напор, м) обязателен и должен быть > 0.')
  }

  const warnings: PumpSelectionWarning[] = []

  const byCapacity = pumps.filter((p) => flowM3h >= p.capacityMinM3h && flowM3h <= p.capacityMaxM3h)
  if (byCapacity.length === 0) {
    warnings.push({
      code: 'NO_CAPACITY_MATCH',
      message: `В каталоге нет насоса с диапазоном расхода, покрывающим ${flowM3h} м³/ч.`,
    })
    return { name: null, pump: null, warnings }
  }

  const matches = byCapacity.filter((p) => headM >= p.headMinM && headM <= p.headMaxM)
  if (matches.length === 0) {
    warnings.push({
      code: 'NO_HEAD_MATCH',
      message:
        `Расходу ${flowM3h} м³/ч соответствует напор ` +
        `${byCapacity.map((p) => `${p.name} (${p.headMinM}…${p.headMaxM} м)`).join(', ')}, ` +
        `а не заданные ${headM} м.`,
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
