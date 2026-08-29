/**
 * Подбор марки насоса из каталога по расходу, напору и числу рабочих
 * насосов (рабочей точке одного насоса при их параллельной работе).
 *
 * Критерии отбора (оба обязательны, сравниваются с расходом на ОДИН насос —
 * `flowM3h / workingPumps`, а не с общим притоком):
 *  - расход на насос попадает в диапазон `capacityMinM3h` … `capacityMaxM3h`;
 *  - напор попадает в диапазон `headMinM` … `headMaxM` насоса (напор не
 *    делится — параллельно работающие насосы создают один и тот же напор).
 *
 * Оба диапазона — прямоугольная аппроксимация паспортной характеристики
 * (кривой) насоса, а не сама кривая (полных кривых Q–H в проде не будет —
 * решение согласовано с заказчиком функции). Для каждой модели:
 *  - `headMaxM` = «Макс. напор» (напор при Q≈0, срыв потока) — безопасный
 *    потолок: любой достижимый на кривой напор при любом расходе ≤ Qmax не
 *    может превышать его;
 *  - `headMinM` = 0 — по той же логике снизу (напор при Q≈Qmax стремится к 0);
 *  - `capacityMaxM3h` = «Макс. расход» (расход при H≈0);
 *  - `capacityMinM3h` = «Номинальный расход» для 56 моделей, для которых он
 *    официально известен (DN80…DN400) — не жёсткий физический предел, а
 *    типовая нижняя граница экономичной работы; реальная рабочая точка
 *    иногда оказывается чуть ниже (см. находки в тестах).
 *
 * Каталог передаётся аргументом (по умолчанию — встроенная копия из 61
 * позиции, см. {@link DEFAULT_PUMPS}, зеркало сидированной таблицы `Pump` в
 * БД). Для реального подбора передавайте `prisma.pump.findMany()`.
 *
 * Источники данных ({@link DEFAULT_PUMPS}):
 *  - 56 моделей DN80…DN400 (2–90 кВт) — выгружены напрямую из бэкенда
 *    программы подбора производителя (VJ Select, vandjord.com/product_selection/)
 *    самим пользователем через собственный скрейпер; для каждой модели есть
 *    официальные Макс./Номинальный расход и напор — самый надёжный источник
 *    во всём модуле;
 *  - 5 моделей DN50/DN65 (0,75–3,0 кВт) — VJ Select их не отдал (в выгрузке
 *    отсутствуют), поэтому взяты из вторичных источников (карточки товара
 *    дистрибьютора dn.ru и реальные рабочие точки из проектных томов
 *    «Работа/Примеры/Проекты») и помечены как менее надёжные; без них ниже
 *    ~45 м³/ч (Qnom младшей DN80) в каталоге была бы дыра, а именно там лежат
 *    почти все реальные КНС из «Работа/Примеры» (15…35 м³/ч).
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
 * Каталог насосов по умолчанию — 61 реальная модель Vandjord VSL (погружные
 * канализационные, закрытое рабочее колесо). Зеркало сидированной таблицы
 * `Pump` (`prisma/seed-data/pumps.json`) — см. заголовок модуля про
 * происхождение данных (VJ Select для DN80+, вторичные источники для DN50/65).
 */
export const DEFAULT_PUMPS: readonly PumpCatalogEntry[] = [
  { name: "Vandjord VSL.50.075.2.5.0D", capacityMinM3h: 14, capacityMaxM3h: 25, headMinM: 0, headMaxM: 12, nozzleDiameterMm: 50 },
  { name: "Vandjord VSL.50.11.2.5.0D", capacityMinM3h: 16, capacityMaxM3h: 29, headMinM: 0, headMaxM: 18, nozzleDiameterMm: 50 },
  { name: "Vandjord VSL.50.22.2.5.0D", capacityMinM3h: 15, capacityMaxM3h: 30, headMinM: 0, headMaxM: 21, nozzleDiameterMm: 50 },
  { name: "Vandjord VSL.65.11L.2.5.0D", capacityMinM3h: 22, capacityMaxM3h: 40, headMinM: 0, headMaxM: 13, nozzleDiameterMm: 65 },
  { name: "Vandjord VSL.65.30.2.5.0D", capacityMinM3h: 30, capacityMaxM3h: 40, headMinM: 0, headMaxM: 20, nozzleDiameterMm: 65 },
  { name: "Vandjord VSL.80.22.4.5.0D", capacityMinM3h: 45, capacityMaxM3h: 73, headMinM: 0, headMaxM: 12, nozzleDiameterMm: 80 },
  { name: "Vandjord VSL.80.37.4.5.0D", capacityMinM3h: 45, capacityMaxM3h: 91, headMinM: 0, headMaxM: 17, nozzleDiameterMm: 80 },
  { name: "Vandjord VSL.80.75.15.4.5.0D", capacityMinM3h: 48, capacityMaxM3h: 75, headMinM: 0, headMaxM: 11, nozzleDiameterMm: 80 },
  { name: "Vandjord VSL.80.75.22.4.5.0D", capacityMinM3h: 48, capacityMaxM3h: 85, headMinM: 0, headMaxM: 13, nozzleDiameterMm: 80 },
  { name: "Vandjord VSL.80.75.37.4.5.0D", capacityMinM3h: 70, capacityMaxM3h: 102, headMinM: 0, headMaxM: 18, nozzleDiameterMm: 80 },
  { name: "Vandjord VSL.100.75.15.4.5.0D", capacityMinM3h: 60, capacityMaxM3h: 96, headMinM: 0, headMaxM: 11, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.22.4.5.0D", capacityMinM3h: 60, capacityMaxM3h: 98, headMinM: 0, headMaxM: 12, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.37.4.5.0D", capacityMinM3h: 60, capacityMaxM3h: 130, headMinM: 0, headMaxM: 16, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.55.4.5.0D", capacityMinM3h: 65, capacityMaxM3h: 150, headMinM: 0, headMaxM: 19, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.75.22.4.5.0D", capacityMinM3h: 70, capacityMaxM3h: 115, headMinM: 0, headMaxM: 13, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.75.37.4.5.0D", capacityMinM3h: 85, capacityMaxM3h: 135, headMinM: 0, headMaxM: 18, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.75.55.4.5.0D", capacityMinM3h: 100, capacityMaxM3h: 162, headMinM: 0, headMaxM: 20, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.75.4.5.0D", capacityMinM3h: 100, capacityMaxM3h: 172, headMinM: 0, headMaxM: 24, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.110.4.5.1D", capacityMinM3h: 100, capacityMaxM3h: 190, headMinM: 0, headMaxM: 31, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.150.4.5.1D", capacityMinM3h: 100, capacityMaxM3h: 210, headMinM: 0, headMaxM: 35, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.190.4.5.1D", capacityMinM3h: 100, capacityMaxM3h: 200, headMinM: 0, headMaxM: 38, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.220.4.5.1D", capacityMinM3h: 100, capacityMaxM3h: 220, headMinM: 0, headMaxM: 44, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.75.75.4.5.0D", capacityMinM3h: 122, capacityMaxM3h: 185, headMinM: 0, headMaxM: 24, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.150.75.55.4.5.0D", capacityMinM3h: 100, capacityMaxM3h: 204, headMinM: 0, headMaxM: 20, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.110.2.5.0D", capacityMinM3h: 100, capacityMaxM3h: 200, headMinM: 0, headMaxM: 29, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.55.4.5.0D", capacityMinM3h: 110, capacityMaxM3h: 200, headMinM: 0, headMaxM: 16, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.75.75.4.5.0D", capacityMinM3h: 130, capacityMaxM3h: 228, headMinM: 0, headMaxM: 24, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.75.4.5.0D", capacityMinM3h: 150, capacityMaxM3h: 240, headMinM: 0, headMaxM: 15, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.110.4.5.1D", capacityMinM3h: 150, capacityMaxM3h: 280, headMinM: 0, headMaxM: 24, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.150.4.5.1D", capacityMinM3h: 150, capacityMaxM3h: 295, headMinM: 0, headMaxM: 28, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.190.4.5.1D", capacityMinM3h: 150, capacityMaxM3h: 300, headMinM: 0, headMaxM: 32, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.220.4.5.1D", capacityMinM3h: 150, capacityMaxM3h: 330, headMinM: 0, headMaxM: 38, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.300.4.5.1D", capacityMinM3h: 150, capacityMaxM3h: 310, headMinM: 0, headMaxM: 44, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.370.4.5.1D", capacityMinM3h: 150, capacityMaxM3h: 300, headMinM: 0, headMaxM: 49, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.450.4.5.1D", capacityMinM3h: 150, capacityMaxM3h: 400, headMinM: 0, headMaxM: 57, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.200.75.4.5.0D", capacityMinM3h: 250, capacityMaxM3h: 400, headMinM: 0, headMaxM: 12, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.110.4.5.1D", capacityMinM3h: 300, capacityMaxM3h: 450, headMinM: 0, headMaxM: 16, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.150.4.5.1D", capacityMinM3h: 300, capacityMaxM3h: 490, headMinM: 0, headMaxM: 21, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.190.4.5.1D", capacityMinM3h: 300, capacityMaxM3h: 525, headMinM: 0, headMaxM: 24, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.220.4.5.1D", capacityMinM3h: 300, capacityMaxM3h: 550, headMinM: 0, headMaxM: 26, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.300.4.5.1D", capacityMinM3h: 300, capacityMaxM3h: 580, headMinM: 0, headMaxM: 32, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.370.4.5.1D", capacityMinM3h: 300, capacityMaxM3h: 620, headMinM: 0, headMaxM: 39, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.450.4.5.1D", capacityMinM3h: 300, capacityMaxM3h: 660, headMinM: 0, headMaxM: 43, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.550.4.5.1D", capacityMinM3h: 300, capacityMaxM3h: 660, headMinM: 0, headMaxM: 52, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.750.4.5.1D", capacityMinM3h: 300, capacityMaxM3h: 660, headMinM: 0, headMaxM: 61, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.900.4.5.1D", capacityMinM3h: 300, capacityMaxM3h: 630, headMinM: 0, headMaxM: 68, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.250.220.4.5.1D", capacityMinM3h: 500, capacityMaxM3h: 760, headMinM: 0, headMaxM: 21, nozzleDiameterMm: 250 },
  { name: "Vandjord VSL.250.300.4.5.1D", capacityMinM3h: 500, capacityMaxM3h: 800, headMinM: 0, headMaxM: 27, nozzleDiameterMm: 250 },
  { name: "Vandjord VSL.250.370.4.5.1D", capacityMinM3h: 500, capacityMaxM3h: 860, headMinM: 0, headMaxM: 30, nozzleDiameterMm: 250 },
  { name: "Vandjord VSL.250.450.4.5.1D", capacityMinM3h: 500, capacityMaxM3h: 900, headMinM: 0, headMaxM: 33, nozzleDiameterMm: 250 },
  { name: "Vandjord VSL.250.550.4.5.1D", capacityMinM3h: 500, capacityMaxM3h: 920, headMinM: 0, headMaxM: 42, nozzleDiameterMm: 250 },
  { name: "Vandjord VSL.250.750.4.5.1D", capacityMinM3h: 500, capacityMaxM3h: 1000, headMinM: 0, headMaxM: 49, nozzleDiameterMm: 250 },
  { name: "Vandjord VSL.250.900.4.5.1D", capacityMinM3h: 500, capacityMaxM3h: 1000, headMinM: 0, headMaxM: 54, nozzleDiameterMm: 250 },
  { name: "Vandjord VSL.300.300.4.5.1D", capacityMinM3h: 800, capacityMaxM3h: 1040, headMinM: 0, headMaxM: 22, nozzleDiameterMm: 300 },
  { name: "Vandjord VSL.300.370.4.5.1D", capacityMinM3h: 800, capacityMaxM3h: 1060, headMinM: 0, headMaxM: 24, nozzleDiameterMm: 300 },
  { name: "Vandjord VSL.300.450.4.5.1D", capacityMinM3h: 800, capacityMaxM3h: 1080, headMinM: 0, headMaxM: 27, nozzleDiameterMm: 300 },
  { name: "Vandjord VSL.300.550.4.5.1D", capacityMinM3h: 800, capacityMaxM3h: 1100, headMinM: 0, headMaxM: 32, nozzleDiameterMm: 300 },
  { name: "Vandjord VSL.300.750.4.5.1D", capacityMinM3h: 800, capacityMaxM3h: 1100, headMinM: 0, headMaxM: 40, nozzleDiameterMm: 300 },
  { name: "Vandjord VSL.300.900.4.5.1D", capacityMinM3h: 800, capacityMaxM3h: 1100, headMinM: 0, headMaxM: 44, nozzleDiameterMm: 300 },
  { name: "Vandjord VSL.400.450.6.5.1D", capacityMinM3h: 1200, capacityMaxM3h: 1800, headMinM: 0, headMaxM: 18, nozzleDiameterMm: 400 },
  { name: "Vandjord VSL.400.550.6.5.1D", capacityMinM3h: 1200, capacityMaxM3h: 1800, headMinM: 0, headMaxM: 20, nozzleDiameterMm: 400 },
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
  /** Расход на ОДИН насос, м³/ч (`flowM3h / workingPumps`) — то, что реально сравнивалось с каталогом. */
  flowPerPumpM3h: number
  warnings: PumpSelectionWarning[]
}

/**
 * Подобрать насос по общему притоку, напору и числу рабочих насосов.
 *
 * Насосы КНС работают параллельно на общий приток: при `workingPumps` рабочих
 * насосах каждый берёт на себя `flowM3h / workingPumps` — именно эта величина
 * (а не общий приток) сравнивается с диапазоном расхода каждой модели
 * каталога. Напор при этом НЕ делится: насосы, работающие параллельно на
 * общий трубопровод, все создают один и тот же напор, каждый — свою долю
 * расхода (как и в листе `ОЛ_НАСОСНАЯ_СТАНЦИЯ`: E51/E55 — та же логика деления
 * притока на число насосов, что и в `pump-station-dimensions.ts`/`pipe-hydraulics.ts`).
 *
 * @param flowM3h Общий приток на станцию (все рабочие насосы вместе), м³/ч. Обязателен, > 0.
 * @param headM Требуемый напор, м. Обязателен, > 0.
 * @param workingPumps Количество рабочих насосов (не считая резервных), шт.
 *   По умолчанию 1 (весь приток — на один насос, как было до этого параметра).
 * @param pumps Каталог насосов (по умолчанию {@link DEFAULT_PUMPS}).
 */
export function selectPump(
  flowM3h: number,
  headM: number,
  workingPumps = 1,
  pumps: readonly PumpCatalogEntry[] = DEFAULT_PUMPS,
): PumpSelectionResult {
  if (!(flowM3h > 0)) {
    throw new Error('flowM3h (общий приток, м³/ч) обязателен и должен быть > 0.')
  }
  if (!(headM > 0)) {
    throw new Error('headM (напор, м) обязателен и должен быть > 0.')
  }
  if (!(workingPumps > 0) || !Number.isInteger(workingPumps)) {
    throw new Error('workingPumps (количество рабочих насосов) должен быть целым числом > 0.')
  }

  const warnings: PumpSelectionWarning[] = []
  const flowPerPumpM3h = flowM3h / workingPumps

  const byCapacity = pumps.filter((p) => flowPerPumpM3h >= p.capacityMinM3h && flowPerPumpM3h <= p.capacityMaxM3h)
  if (byCapacity.length === 0) {
    warnings.push({
      code: 'NO_CAPACITY_MATCH',
      message:
        `В каталоге нет насоса с диапазоном расхода, покрывающим ${flowPerPumpM3h} м³/ч ` +
        `на один насос (приток ${flowM3h} м³/ч на ${workingPumps} рабочих насос(а/ов)).`,
    })
    return { name: null, pump: null, flowPerPumpM3h, warnings }
  }

  const matches = byCapacity.filter((p) => headM >= p.headMinM && headM <= p.headMaxM)
  if (matches.length === 0) {
    warnings.push({
      code: 'NO_HEAD_MATCH',
      message:
        `Расходу ${flowPerPumpM3h} м³/ч на насос соответствует напор ` +
        `${byCapacity.map((p) => `${p.name} (${p.headMinM}…${p.headMaxM} м)`).join(', ')}, ` +
        `а не заданные ${headM} м.`,
    })
    return { name: null, pump: null, flowPerPumpM3h, warnings }
  }

  if (matches.length > 1) {
    warnings.push({
      code: 'MULTIPLE_MATCHES',
      message: `Найдено несколько подходящих насосов (${matches.map((p) => p.name).join(', ')}) — взят первый.`,
    })
  }

  const pump = matches[0]!
  return { name: pump.name, pump, flowPerPumpM3h, warnings }
}
