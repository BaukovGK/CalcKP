/**
 * Расчёт габаритов насосной станции (КНС / ЛНС / ДНС): диаметр и высота корпуса.
 *
 * Воспроизводит арифметику листа `ОЛ_НАСОСНАЯ_СТАНЦИЯ`, столбцы M–R (Vэф, Vмин,
 * Vраб=Vмин, hраб, hР, Нподз) — формулы сверены по трём реальным опросным листам
 * из «Работа/Примеры». Заданный набор входных параметров не включает количество
 * насосов, поэтому здесь `capacityM3h` считается производительностью ОДНОГО
 * рабочего насоса — при нескольких насосах в станции делите общий приток на их
 * число перед вызовом (как в оригинале: `Vэф = Q/(4·пусков·n)`, `n` = E55).
 *
 * Контрольный пример (ОЛ3487 «КНС Пехотная»: DN3000, общий приток 90,468 м³/ч
 * на 2 насоса → 45,234 м³/ч на насос, лоток подводящего 9,910 м, N47=0,627):
 * ```
 * calcPumpStationDimensions({
 *   inletPipeHeightM: 9.910, mvkRequired: true,
 *   capacityM3h: 45.234, diameterMm: 3000, minPumpLevelM: 0.627,
 * })
 * // → heightMm 11600 (совпадает с Нподз листа ОЛ поячеечно, до 7-го знака)
 * ```
 * Те же дефолты (пусков/час, поминутная работа, высота рамы, мин. уровень) — что
 * в `ntt-calculator/src/engines/survey-kns.ts` (`computeDepth`); здесь отдельный
 * модуль, т.к. бэкенд и фронтенд — разные пакеты без общего кода.
 *
 * Подбор толщины стенки корпуса и подбор/проверка кольцевой жёсткости SN —
 * ответственность ДРУГОЙ программы (эти данные приходят извне). Здесь
 * `ringStiffnessPa` — необязательный сквозной параметр: функция его не
 * проверяет и не использует в расчёте, а только возвращает обратно вместе
 * с габаритами (чтобы не терять значение при передаче дальше по цепочке).
 *
 * Производственный диапазон корпусов и минимум по ТТ МВК — из ТЗ (не выводятся
 * из Excel-примеров, т.к. в них уже готовые изделия, а не правила подбора).
 *
 * @module utils/pump-station-dimensions
 */

/* ────────────────────────────  Производственные ограничения  ──────────────────────────── */

/** Диапазон выпускаемых круглых корпусов, мм. */
export const CORPUS_DN_MIN_MM = 1800
export const CORPUS_DN_MAX_MM = 3200

/** Минимальный диаметр корпуса при требованиях по ТТ МВК, мм. */
export const MVK_DN_MIN_MM = 2600

/** Типоряд номинальных диаметров корпуса, мм (шаг производства + макс. 3200). */
export const STANDARD_DN_MM: readonly number[] = [
  1800, 1900, 2000, 2200, 2400, 2500, 2600, 2700, 3000, 3200,
]

/** Дефолты из шаблона опросного листа (совпадают с `survey-kns.ts` на фронтенде). */
export const DEFAULTS = {
  /** Число пусков насоса в час (ячейка Q40 листа ОЛ). */
  startsPerHour: 10,
  /** Поминутная работа, мин (ячейка P41). */
  perMinuteRunMin: 5,
  /** Высота рамы насосов, м (ячейка N50). */
  pumpFrameHeightM: 0.16,
  /** Запас над рабочей зоной на поплавки, м (константа «+0,3» в hР). */
  floatReserveM: 0.3,
  /** Мин. уровень жидкости для работы насоса, м (ячейка N47, паспорт насоса). */
  minPumpLevelM: 0.627,
} as const

/* ────────────────────────────  Входные и выходные типы  ──────────────────────────── */

export interface PumpStationInput {
  /* — Обязательные — */

  /** Высота (глубина залегания) подводящего патрубка, м. Ячейка E41/1000. */
  inletPipeHeightM: number
  /** Требования по ТТ МВК — при true диаметр корпуса поднимается до ≥ 2,6 м. */
  mvkRequired: boolean
  /** Производительность (максимальный приток), м³/ч. Ячейка E51. */
  capacityM3h: number

  /* — Необязательные (допустимо не задавать) — */

  /** Диаметр корпуса, мм. Если не задан — подбирается автоматически. Ячейка E20. */
  diameterMm?: number
  /** Мин. уровень жидкости для работы насоса, м (из паспорта насоса). Ячейка N47. */
  minPumpLevelM?: number
  /** Поминутная работа, мин. Ячейка P41. */
  perMinuteRunMin?: number
  /** Количество пусков насоса в час. Ячейка Q40. */
  startsPerHour?: number
  /**
   * Кольцевая (номинальная) жёсткость корпуса SN, Па — сквозной параметр.
   * Подбор и проверка SN — ответственность другой программы; здесь значение
   * не используется в расчёте, а только переносится в результат.
   */
  ringStiffnessPa?: number
}

export interface PumpStationWarning {
  code: string
  message: string
}

export interface PumpStationDimensions {
  /** Диаметр корпуса, мм (задан или подобран). */
  diameterMm: number
  /** Диаметр подобран автоматически (на входе не был задан). */
  diameterAssumed: boolean

  /** Высота подземной части Нподз, мм — габарит изделия по высоте (округлено вверх до 100 мм). */
  heightMm: number

  /** Высота рабочей зоны hраб, м. */
  workingZoneHeightM: number
  /** Объём рабочей зоны Vраб, м³ (= Vмин, минутный объём). */
  workingZoneVolumeM3: number
  /** Эффективный объём Vэф, м³ (по нормативу пусков в час) — для справки. */
  effectiveVolumeM3: number

  /** Кольцевая жёсткость SN, Па — то же значение, что было на входе (или null). */
  ringStiffnessPa: number | null

  warnings: PumpStationWarning[]
}

/* ────────────────────────────  Вспомогательные функции  ──────────────────────────── */

/** Округление вверх до кратного шага (аналог Excel `ROUNDUP(x, -2)` при step=100). */
export function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step
}

/**
 * Подбор/валидация номинального диаметра корпуса, мм.
 *
 * Правила: производство выпускает круглые корпуса 1800…3200 мм; при
 * требованиях по ТТ МВК — не менее 2600 мм. Если диаметр не задан, берётся
 * минимально допустимый стандартный DN (2600 при МВК, иначе 1800).
 */
export function resolveDiameterMm(
  mvkRequired: boolean,
  diameterMm: number | undefined,
  warnings: PumpStationWarning[],
): { diameterMm: number; assumed: boolean } {
  const floorMm = mvkRequired ? MVK_DN_MIN_MM : CORPUS_DN_MIN_MM

  if (diameterMm == null) {
    const picked = STANDARD_DN_MM.find((d) => d >= floorMm) ?? floorMm
    warnings.push({
      code: 'DN_ASSUMED',
      message:
        `Диаметр не задан — принят минимально допустимый DN ${picked} мм` +
        (mvkRequired ? ' (по требованиям МВК ≥ 2600 мм).' : '.'),
    })
    return { diameterMm: picked, assumed: true }
  }

  let dn = diameterMm
  if (mvkRequired && dn < MVK_DN_MIN_MM) {
    warnings.push({
      code: 'DN_BELOW_MVK',
      message: `Заданный DN ${diameterMm} мм меньше минимума по МВК — поднят до ${MVK_DN_MIN_MM} мм.`,
    })
    dn = MVK_DN_MIN_MM
  }
  if (dn < CORPUS_DN_MIN_MM) {
    warnings.push({
      code: 'DN_BELOW_RANGE',
      message: `DN ${dn} мм ниже выпускаемого диапазона — поднят до ${CORPUS_DN_MIN_MM} мм.`,
    })
    dn = CORPUS_DN_MIN_MM
  }
  if (dn > CORPUS_DN_MAX_MM) {
    warnings.push({
      code: 'DN_ABOVE_RANGE',
      message: `DN ${dn} мм выше выпускаемого диапазона (макс. ${CORPUS_DN_MAX_MM} мм).`,
    })
  }
  return { diameterMm: dn, assumed: false }
}

/* ────────────────────────────  Основной расчёт  ──────────────────────────── */

/**
 * Рассчитать габариты насосной станции: диаметр и высоту корпуса.
 *
 * Порядок (лист `ОЛ_НАСОСНАЯ_СТАНЦИЯ`, столбцы M–R):
 * ```
 * Vэф  = Q / (4 · пусков_в_час)
 * Vмин = Q · (поминутная_работа / 60)
 * Vраб = Vмин
 * hраб = 4 · Vраб / (π · D²)                       ← высота рабочей зоны
 * hР   = hраб + запас_на_поплавки + высота_рамы + мин_уровень_насоса
 * Нподз = ROUNDUP((высота_патрубка + hР) · 1000; −2 )
 * ```
 * где `Q` — производительность, приведённая к м³/ч на один насос (здесь принят
 * один рабочий насос — количество насосов вне заданного набора параметров).
 *
 * Толщину стенки и годность/подбор SN эта функция не считает — см. заголовок
 * модуля.
 *
 * @param input Входные параметры (см. {@link PumpStationInput}).
 */
export function calcPumpStationDimensions(input: PumpStationInput): PumpStationDimensions {
  const warnings: PumpStationWarning[] = []

  if (!(input.inletPipeHeightM >= 0)) {
    throw new Error('inletPipeHeightM (высота подводящего патрубка, м) обязателен и должен быть ≥ 0.')
  }
  if (!(input.capacityM3h > 0)) {
    throw new Error('capacityM3h (производительность, м³/ч) обязателен и должен быть > 0.')
  }

  // — Диаметр —
  const { diameterMm, assumed } = resolveDiameterMm(input.mvkRequired, input.diameterMm, warnings)
  const dMeters = diameterMm / 1000

  // — Объёмы рабочей зоны (один рабочий насос — количество насосов не входит в заданный набор параметров) —
  const startsPerHour = input.startsPerHour ?? DEFAULTS.startsPerHour
  const perMinuteRunMin = input.perMinuteRunMin ?? DEFAULTS.perMinuteRunMin

  const effectiveVolumeM3 = input.capacityM3h / (4 * startsPerHour)
  const workingZoneVolumeM3 = input.capacityM3h * (perMinuteRunMin / 60) // Vраб = Vмин (N42 = N41 листа ОЛ)

  // — Высоты —
  const workingZoneHeightM = (4 * workingZoneVolumeM3) / (Math.PI * dMeters * dMeters)
  const minPumpLevelM = input.minPumpLevelM ?? DEFAULTS.minPumpLevelM
  const totalWorkingHeightM = workingZoneHeightM + DEFAULTS.floatReserveM + DEFAULTS.pumpFrameHeightM + minPumpLevelM

  const heightM = input.inletPipeHeightM + totalWorkingHeightM
  const heightMm = roundUpTo(heightM * 1000, 100)

  return {
    diameterMm,
    diameterAssumed: assumed,
    heightMm,
    workingZoneHeightM,
    workingZoneVolumeM3,
    effectiveVolumeM3,
    ringStiffnessPa: input.ringStiffnessPa ?? null,
    warnings,
  }
}
