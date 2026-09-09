/**
 * Подбор марки насоса из каталога по расходу, напору и числу рабочих
 * насосов (рабочей точке одного насоса при их параллельной работе).
 *
 * ОСНОВНОЙ КРИТЕРИЙ — ПАСПОРТНАЯ КРИВАЯ. Насос годится, если при расходе
 * `flowM3h / workingPumps` его характеристика Q–H даёт напор не меньше
 * требуемого, а сам расход лежит в рабочем окне модели `capacityMinM3h` …
 * `capacityMaxM3h`. Напор при этом НЕ делится: параллельно работающие насосы
 * создают один и тот же напор, каждый — свою долю расхода.
 *
 * ПОРЯДОК ПРЕДПОЧТЕНИЯ — НАИМЕНЬШИЙ ДОСТАТОЧНЫЙ НАСОС: из подходящих берётся
 * модель с наименьшей мощностью на валу в рабочей точке, при равной мощности —
 * с большим КПД. Не «самый эффективный»: КПД сам по себе уводит в сторону
 * более крупных и дорогих машин, а инженер выбирает наименьшую, которая
 * закрывает точку.
 *
 * Остальные подходящие возвращаются в `alternatives` в том же порядке. Выбор
 * не сводится к формуле (унификация парка, запас под будущий приток, наличие
 * на складе), поэтому решение остаётся за инженером, а функция даёт цифры.
 *
 * ЗАПАС ПО НАПОРУ — ОКНО 0,5…2,0 м (требование завода). Это НЕ проектный
 * резерв: он уже заложен в требуемый напор, который приходит из опросного
 * листа. Окно закрывает другое — паспортная кривая есть обещание
 * производителя, а реальный насос может его не выдержать: износ рабочего
 * колеса, допуски изготовления, отличие фактических условий от стендовых.
 * Поэтому рабочую точку не ставят вплотную к кривой.
 *
 * Границы работают по-разному:
 *  - {@link HEAD_MARGIN_MIN_M} — ЖЁСТКАЯ отсечка. Насос, у которого кривая
 *    едва дотягивает до требуемого напора, в подбор не попадает: на объекте
 *    он до этой точки может и не дойти;
 *  - {@link HEAD_MARGIN_MAX_M} — граница ПРЕДПОЧТЕНИЯ. Запас сверх неё уже
 *    ничего не страхует и означает просто более крупную машину. Такие модели
 *    остаются кандидатами (иначе выбор мог бы оказаться пустым), но уступают
 *    попавшим в окно и помечаются `withinPreferredBand: false`.
 *
 * ПОЧЕМУ НЕ ПРЯМОУГОЛЬНИК. Раньше отбор шёл по рамке `Qmin…Qmax × 0…Hmax`, и
 * она систематически врала в обе стороны: принимала насос, который на своей
 * кривой требуемый напор при этом расходе НЕ выдаёт (`Hmax` достигается лишь
 * при Q≈0), и отвергала модели, у которых рабочая точка ниже официального
 * номинала. На эталонном ОЛ3487 (45,23 м³/ч на насос, напор 12,9 м) рамка
 * выбирала `VSL.80.37.4.5.0D`, у которого кривая в этой точке даёт 12,69 м —
 * меньше требуемого; в реальном проекте стоит `VSL.100.55.4.5.0D`, и кривая
 * его допускает (16,89 м).
 *
 * ЕСЛИ КРИВОЙ НЕТ. Она есть у 56 моделей из 61 — пять DN50/DN65 пришли из
 * вторичных источников, производитель кривых для них не отдал. Для таких
 * моделей остаётся прежняя грубая проверка по рамке, а результат помечается
 * `APPROXIMATE_MATCH`: это кандидат к ручной проверке, а не подбор.
 *
 * Каталог передаётся аргументом (по умолчанию — встроенная копия из 61
 * позиции, см. {@link DEFAULT_PUMPS}, зеркало сидированной таблицы `Pump` в
 * БД, но БЕЗ кривых). Для реального подбора передавайте каталог из БД вместе
 * с точками характеристики.
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

import { interpolateCurve, type CurvePoint, type DutyPoint } from './pump-curve'

/**
 * Минимальный запас по напору над требуемым, м (требование завода).
 *
 * Жёсткая отсечка. Страхует не рост притока (тот учтён в самом требуемом
 * напоре), а несовпадение реального насоса с паспортом: износ колеса, допуски
 * изготовления, отличие условий от стендовых.
 */
export const HEAD_MARGIN_MIN_M = 0.5

/**
 * Верхняя граница желаемого запаса, м (требование завода).
 * Не отсечка, а предпочтение: запас сверх неё уже ничего не страхует и
 * означает просто более крупную машину. Если в окно не попал никто — лучше
 * предложить избыточную, чем ничего.
 */
export const HEAD_MARGIN_MAX_M = 2.0

/** Настройка отбора; значения по умолчанию — заводское окно запаса. */
export interface PumpSelectionOptions {
  /** Жёсткий минимум запаса по напору, м. */
  minHeadMarginM?: number
  /** Верхняя граница предпочтительного запаса, м. */
  maxHeadMarginM?: number
}

export interface PumpCatalogEntry {
  /** Марка/модель насоса. */
  name: string
  /** Минимум диапазона расхода, м³/ч — нижняя граница рабочего окна. */
  capacityMinM3h: number
  /** Максимум диапазона расхода, м³/ч. */
  capacityMaxM3h: number
  /** Минимум диапазона напора, м (используется только без кривой). */
  headMinM: number
  /** Максимум диапазона напора, м (используется только без кривой). */
  headMaxM: number
  /** Диаметр напорного патрубка насоса, мм (справочно). */
  nozzleDiameterMm: number
  /**
   * Паспортная характеристика Q–H. Если задана — подбор идёт по ней, и
   * диапазоны напора не используются.
   */
  curve?: readonly CurvePoint[]
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
  { name: "Vandjord VSL.80.22.4.5.0D", capacityMinM3h: 3.65, capacityMaxM3h: 62.05, headMinM: 0, headMaxM: 12, nozzleDiameterMm: 80 },
  { name: "Vandjord VSL.80.37.4.5.0D", capacityMinM3h: 4.55, capacityMaxM3h: 77.35, headMinM: 0, headMaxM: 17, nozzleDiameterMm: 80 },
  { name: "Vandjord VSL.80.75.15.4.5.0D", capacityMinM3h: 24, capacityMaxM3h: 63.75, headMinM: 0, headMaxM: 11, nozzleDiameterMm: 80 },
  { name: "Vandjord VSL.80.75.22.4.5.0D", capacityMinM3h: 24, capacityMaxM3h: 72.25, headMinM: 0, headMaxM: 13, nozzleDiameterMm: 80 },
  { name: "Vandjord VSL.80.75.37.4.5.0D", capacityMinM3h: 24, capacityMaxM3h: 91, headMinM: 0, headMaxM: 18, nozzleDiameterMm: 80 },
  { name: "Vandjord VSL.100.75.15.4.5.0D", capacityMinM3h: 30, capacityMaxM3h: 81.6, headMinM: 0, headMaxM: 11, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.22.4.5.0D", capacityMinM3h: 4.9, capacityMaxM3h: 83.3, headMinM: 0, headMaxM: 12, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.37.4.5.0D", capacityMinM3h: 6.5, capacityMaxM3h: 110.5, headMinM: 0, headMaxM: 16, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.55.4.5.0D", capacityMinM3h: 7.5, capacityMaxM3h: 127.5, headMinM: 0, headMaxM: 19, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.75.22.4.5.0D", capacityMinM3h: 30, capacityMaxM3h: 97.75, headMinM: 0, headMaxM: 13, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.75.37.4.5.0D", capacityMinM3h: 30, capacityMaxM3h: 114.75, headMinM: 0, headMaxM: 18, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.75.55.4.5.0D", capacityMinM3h: 30, capacityMaxM3h: 137.7, headMinM: 0, headMaxM: 20, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.75.4.5.0D", capacityMinM3h: 8.6, capacityMaxM3h: 146.2, headMinM: 0, headMaxM: 24, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.110.4.5.1D", capacityMinM3h: 38, capacityMaxM3h: 161.5, headMinM: 0, headMaxM: 31, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.150.4.5.1D", capacityMinM3h: 42, capacityMaxM3h: 178.5, headMinM: 0, headMaxM: 35, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.190.4.5.1D", capacityMinM3h: 40, capacityMaxM3h: 170, headMinM: 0, headMaxM: 38, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.220.4.5.1D", capacityMinM3h: 44, capacityMaxM3h: 187, headMinM: 0, headMaxM: 44, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.100.75.75.4.5.0D", capacityMinM3h: 30, capacityMaxM3h: 158.6, headMinM: 0, headMaxM: 24, nozzleDiameterMm: 100 },
  { name: "Vandjord VSL.150.75.55.4.5.0D", capacityMinM3h: 45, capacityMaxM3h: 173.4, headMinM: 0, headMaxM: 20, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.110.2.5.0D", capacityMinM3h: 40, capacityMaxM3h: 170, headMinM: 0, headMaxM: 29, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.55.4.5.0D", capacityMinM3h: 10, capacityMaxM3h: 170, headMinM: 0, headMaxM: 16, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.75.75.4.5.0D", capacityMinM3h: 45, capacityMaxM3h: 193.8, headMinM: 0, headMaxM: 24, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.75.4.5.0D", capacityMinM3h: 12, capacityMaxM3h: 204, headMinM: 0, headMaxM: 15, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.110.4.5.1D", capacityMinM3h: 56, capacityMaxM3h: 238, headMinM: 0, headMaxM: 24, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.150.4.5.1D", capacityMinM3h: 59, capacityMaxM3h: 250.75, headMinM: 0, headMaxM: 28, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.190.4.5.1D", capacityMinM3h: 60, capacityMaxM3h: 255, headMinM: 0, headMaxM: 32, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.220.4.5.1D", capacityMinM3h: 66, capacityMaxM3h: 280.5, headMinM: 0, headMaxM: 38, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.300.4.5.1D", capacityMinM3h: 93, capacityMaxM3h: 263.5, headMinM: 0, headMaxM: 44, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.370.4.5.1D", capacityMinM3h: 99, capacityMaxM3h: 255, headMinM: 0, headMaxM: 49, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.150.450.4.5.1D", capacityMinM3h: 120, capacityMaxM3h: 340, headMinM: 0, headMaxM: 57, nozzleDiameterMm: 150 },
  { name: "Vandjord VSL.200.75.4.5.0D", capacityMinM3h: 20, capacityMaxM3h: 340, headMinM: 0, headMaxM: 12, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.110.4.5.1D", capacityMinM3h: 90, capacityMaxM3h: 390, headMinM: 0, headMaxM: 16, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.150.4.5.1D", capacityMinM3h: 98, capacityMaxM3h: 416.5, headMinM: 0, headMaxM: 21, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.190.4.5.1D", capacityMinM3h: 105, capacityMaxM3h: 446.25, headMinM: 0, headMaxM: 24, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.220.4.5.1D", capacityMinM3h: 110, capacityMaxM3h: 467.5, headMinM: 0, headMaxM: 26, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.300.4.5.1D", capacityMinM3h: 174, capacityMaxM3h: 493, headMinM: 0, headMaxM: 32, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.370.4.5.1D", capacityMinM3h: 186, capacityMaxM3h: 527, headMinM: 0, headMaxM: 39, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.450.4.5.1D", capacityMinM3h: 198, capacityMaxM3h: 561, headMinM: 0, headMaxM: 43, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.550.4.5.1D", capacityMinM3h: 198, capacityMaxM3h: 550, headMinM: 0, headMaxM: 52, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.750.4.5.1D", capacityMinM3h: 198, capacityMaxM3h: 561, headMinM: 0, headMaxM: 61, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.200.900.4.5.1D", capacityMinM3h: 189, capacityMaxM3h: 535.5, headMinM: 0, headMaxM: 68, nozzleDiameterMm: 200 },
  { name: "Vandjord VSL.250.220.4.5.1D", capacityMinM3h: 152, capacityMaxM3h: 650, headMinM: 0, headMaxM: 21, nozzleDiameterMm: 250 },
  { name: "Vandjord VSL.250.300.4.5.1D", capacityMinM3h: 240, capacityMaxM3h: 680, headMinM: 0, headMaxM: 27, nozzleDiameterMm: 250 },
  { name: "Vandjord VSL.250.370.4.5.1D", capacityMinM3h: 258, capacityMaxM3h: 731, headMinM: 0, headMaxM: 30, nozzleDiameterMm: 250 },
  { name: "Vandjord VSL.250.450.4.5.1D", capacityMinM3h: 270, capacityMaxM3h: 765, headMinM: 0, headMaxM: 33, nozzleDiameterMm: 250 },
  { name: "Vandjord VSL.250.550.4.5.1D", capacityMinM3h: 276, capacityMaxM3h: 782, headMinM: 0, headMaxM: 42, nozzleDiameterMm: 250 },
  { name: "Vandjord VSL.250.750.4.5.1D", capacityMinM3h: 300, capacityMaxM3h: 850, headMinM: 0, headMaxM: 49, nozzleDiameterMm: 250 },
  { name: "Vandjord VSL.250.900.4.5.1D", capacityMinM3h: 300, capacityMaxM3h: 850, headMinM: 0, headMaxM: 54, nozzleDiameterMm: 250 },
  { name: "Vandjord VSL.300.300.4.5.1D", capacityMinM3h: 312, capacityMaxM3h: 1040, headMinM: 0, headMaxM: 22, nozzleDiameterMm: 300 },
  { name: "Vandjord VSL.300.370.4.5.1D", capacityMinM3h: 318, capacityMaxM3h: 1040, headMinM: 0, headMaxM: 24, nozzleDiameterMm: 300 },
  { name: "Vandjord VSL.300.450.4.5.1D", capacityMinM3h: 324, capacityMaxM3h: 1040, headMinM: 0, headMaxM: 27, nozzleDiameterMm: 300 },
  { name: "Vandjord VSL.300.550.4.5.1D", capacityMinM3h: 363, capacityMaxM3h: 1040, headMinM: 0, headMaxM: 32, nozzleDiameterMm: 300 },
  { name: "Vandjord VSL.300.750.4.5.1D", capacityMinM3h: 375, capacityMaxM3h: 1040, headMinM: 0, headMaxM: 40, nozzleDiameterMm: 300 },
  { name: "Vandjord VSL.300.900.4.5.1D", capacityMinM3h: 360, capacityMaxM3h: 1040, headMinM: 0, headMaxM: 44, nozzleDiameterMm: 300 },
  { name: "Vandjord VSL.400.450.6.5.1D", capacityMinM3h: 540, capacityMaxM3h: 1560, headMinM: 0, headMaxM: 18, nozzleDiameterMm: 400 },
  { name: "Vandjord VSL.400.550.6.5.1D", capacityMinM3h: 570, capacityMaxM3h: 1560, headMinM: 0, headMaxM: 20, nozzleDiameterMm: 400 },
]

export interface PumpSelectionWarning {
  code: string
  message: string
}

/** Насос-кандидат вместе с его рабочей точкой. */
export interface PumpCandidate {
  name: string
  pump: PumpCatalogEntry
  /**
   * Рабочая точка на паспортной кривой при требуемом расходе: напор, который
   * насос там реально выдаёт, КПД и мощность. `null` — у модели нет кривой.
   */
  duty: DutyPoint | null
  /** Запас по напору над требуемым, м. Отрицательного здесь не бывает. */
  headMarginM: number | null
  /** Подобран по кривой (`true`) или по грубой рамке диапазонов (`false`). */
  byCurve: boolean
  /**
   * Запас попал в желаемое окно. `false` — насос избыточен по напору:
   * он работает, но крупнее необходимого, а запас сверх окна уже ничего
   * не страхует.
   */
  withinPreferredBand: boolean
}

export interface PumpSelectionResult {
  /** Марка подобранного насоса, либо `null`, если подходящего нет. */
  name: string | null
  /** Полная запись каталога подобранного насоса (для справки), либо `null`. */
  pump: PumpCatalogEntry | null
  /** Рабочая точка выбранного насоса, если он подобран по кривой. */
  duty: DutyPoint | null
  /** Запас по напору над требуемым у выбранного насоса, м. */
  headMarginM: number | null
  /** Расход на ОДИН насос, м³/ч (`flowM3h / workingPumps`) — то, что реально сравнивалось с каталогом. */
  flowPerPumpM3h: number
  /** Требуемый напор, м — повторён для наглядности рабочей точки. */
  requiredHeadM: number
  /** Окно запаса по напору, применённое при отборе, м. */
  headMarginBandM: { min: number; max: number }
  /**
   * Все подходящие модели в порядке предпочтения, ВКЛЮЧАЯ выбранную первым
   * элементом. Именно этот список показывается инженеру для выбора вручную.
   */
  candidates: PumpCandidate[]
  /**
   * Остальные подходящие модели — {@link candidates} без первой.
   * Оставлено для краткого показа «ещё подходят: …».
   */
  alternatives: PumpCandidate[]
  /**
   * Модели, которые до требуемого напора дотягивают, но не набирают
   * минимального запаса. По умолчанию не предлагаются — на объекте такой насос
   * до расчётной точки может и не дойти. Отдаются отдельным списком осознанно:
   * реальные проекты такие насосы ставят (ДУДС24и — ровно на кривой), и
   * инженер должен видеть, что именно отсечено и почему.
   */
  belowMargin: PumpCandidate[]
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
 * @param options Окно запаса по напору; по умолчанию заводское 0,5…2,0 м.
 */
export function selectPump(
  flowM3h: number,
  headM: number,
  workingPumps = 1,
  pumps: readonly PumpCatalogEntry[] = DEFAULT_PUMPS,
  options: PumpSelectionOptions = {},
): PumpSelectionResult {
  const minHeadMarginM = options.minHeadMarginM ?? HEAD_MARGIN_MIN_M
  const maxHeadMarginM = options.maxHeadMarginM ?? HEAD_MARGIN_MAX_M
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
  const fmt = (v: number) => Number(v.toFixed(2)).toLocaleString('ru-RU')
  const headMarginBandM = { min: minHeadMarginM, max: maxHeadMarginM }
  const empty = (): PumpSelectionResult => ({
    name: null, pump: null, duty: null, headMarginM: null,
    flowPerPumpM3h, requiredHeadM: headM, headMarginBandM,
    candidates: [], alternatives: [], belowMargin: [], warnings,
  })

  // Рабочее окно по расходу — общий фильтр: и с кривой, и без неё модель
  // должна быть рассчитана на такой расход.
  const byCapacity = pumps.filter((p) => flowPerPumpM3h >= p.capacityMinM3h && flowPerPumpM3h <= p.capacityMaxM3h)
  if (byCapacity.length === 0) {
    warnings.push({
      code: 'NO_CAPACITY_MATCH',
      message:
        `В каталоге нет насоса с рабочим диапазоном расхода, покрывающим ${fmt(flowPerPumpM3h)} м³/ч ` +
        `на один насос (приток ${fmt(flowM3h)} м³/ч на ${workingPumps} рабочих насос(а/ов)).`,
    })
    return empty()
  }

  const candidates: PumpCandidate[] = []
  /** Дотягивают до напора, но не набирают минимального запаса. */
  const belowMargin: PumpCandidate[] = []
  /** Не дают требуемого напора вовсе. */
  const tooLow: Array<{ name: string; h: number }> = []
  let withoutCurve = 0

  for (const pump of byCapacity) {
    if (pump.curve && pump.curve.length >= 2) {
      const duty = interpolateCurve(pump.curve, flowPerPumpM3h)
      // Расход внутри рабочего окна, но вне точек кривой — данных нет,
      // выдумывать напор экстраполяцией нельзя.
      if (!duty) continue
      const headMarginM = duty.h - headM
      if (duty.h < headM) {
        tooLow.push({ name: pump.name, h: duty.h })
        continue
      }
      if (headMarginM < minHeadMarginM) {
        belowMargin.push({
          name: pump.name, pump, duty, headMarginM,
          byCurve: true, withinPreferredBand: false,
        })
        continue
      }
      candidates.push({
        name: pump.name,
        pump,
        duty,
        headMarginM,
        byCurve: true,
        withinPreferredBand: headMarginM <= maxHeadMarginM,
      })
      continue
    }

    // Кривой нет — остаётся прежняя грубая рамка.
    withoutCurve++
    if (headM >= pump.headMinM && headM <= pump.headMaxM) {
      candidates.push({
        name: pump.name, pump, duty: null, headMarginM: null,
        byCurve: false, withinPreferredBand: false,
      })
    }
  }

  belowMargin.sort((a, b) => (b.headMarginM ?? 0) - (a.headMarginM ?? 0))

  if (candidates.length === 0) {
    // Кто-то дотягивает до напора, но всем не хватает запаса — это другой
    // случай, чем «никто не тянет», и лечится он иначе.
    if (belowMargin.length > 0) {
      const near = belowMargin[0]!
      warnings.push({
        code: 'ONLY_BELOW_MARGIN',
        message:
          `Требуемый напор ${fmt(headM)} м модели дают, но ни одна не набирает минимального запаса ` +
          `${fmt(minHeadMarginM)} м: ближайшая — ${near.name} (${fmt(near.duty!.h)} м, запас ` +
          `${fmt(near.headMarginM!)} м). Выберите её осознанно либо пересмотрите напор.`,
      })
      return { ...empty(), belowMargin }
    }
    warnings.push({
      code: 'NO_HEAD_MATCH',
      message: tooLow.length
        ? `При расходе ${fmt(flowPerPumpM3h)} м³/ч на насос требуемый напор ${fmt(headM)} м не выдаёт ни одна модель: ` +
          tooLow
            .sort((a, b) => b.h - a.h)
            .slice(0, 5)
            .map((t) => `${t.name} — ${fmt(t.h)} м`)
            .join(', ') +
          '. Увеличьте число рабочих насосов либо пересмотрите напор.'
        : `Ни одна модель с подходящим расходом не даёт напор ${fmt(headM)} м.`,
    })
    return empty()
  }

  // Порядок предпочтения:
  //  1. проверенные по кривой — впереди тех, у кого кривой нет;
  //  2. попавшие в желаемое окно запаса — впереди избыточных по напору;
  //  3. наименьший достаточный: меньше мощность на валу, при равной — больше КПД.
  candidates.sort((a, b) => {
    if (a.byCurve !== b.byCurve) return a.byCurve ? -1 : 1
    if (a.withinPreferredBand !== b.withinPreferredBand) return a.withinPreferredBand ? -1 : 1
    if (a.duty && b.duty) {
      if (Math.abs(a.duty.p2 - b.duty.p2) > 1e-6) return a.duty.p2 - b.duty.p2
      return b.duty.eff - a.duty.eff
    }
    // Без кривой сравнивать нечем — сохраняем порядок каталога (по DN).
    return 0
  })

  const best = candidates[0]!
  if (!best.byCurve) {
    warnings.push({
      code: 'APPROXIMATE_MATCH',
      message:
        `У модели ${best.name} нет паспортной кривой (данные из вторичного источника) — ` +
        'подбор сделан по диапазонам и требует ручной проверки по характеристике производителя.',
    })
  }
  if (withoutCurve > 0 && best.byCurve) {
    warnings.push({
      code: 'SOME_WITHOUT_CURVE',
      message: `${withoutCurve} модель(ей) с подходящим расходом проверены только по диапазонам: паспортной кривой для них нет.`,
    })
  }
  if (best.byCurve && !best.withinPreferredBand && best.headMarginM != null) {
    warnings.push({
      code: 'MARGIN_ABOVE_BAND',
      message:
        `Запас по напору ${fmt(best.headMarginM)} м выше желаемых ${fmt(maxHeadMarginM)} м: в окно ` +
        `${fmt(minHeadMarginM)}…${fmt(maxHeadMarginM)} м не попала ни одна модель, взята ближайшая. ` +
        'Насос избыточен по напору.',
    })
  }
  if (belowMargin.length > 0) {
    const near = belowMargin[0]!
    warnings.push({
      code: 'REJECTED_BY_MARGIN',
      message:
        `${belowMargin.length} модель(ей) отсечено по минимальному запасу ${fmt(minHeadMarginM)} м — ` +
        `ближайшая ${near.name} (запас ${fmt(near.headMarginM!)} м). Они доступны для выбора вручную.`,
    })
  }

  return {
    name: best.name,
    pump: best.pump,
    duty: best.duty,
    headMarginM: best.headMarginM,
    flowPerPumpM3h,
    requiredHeadM: headM,
    headMarginBandM,
    candidates,
    alternatives: candidates.slice(1),
    belowMargin,
    warnings,
  }
}
