import { api } from './client'

/**
 * Насосная станция: подбор оборудования и гидравлика (`/api/pump-station`).
 *
 * Алгоритмы живут на сервере (`backend/src/utils/pump-selection.ts`,
 * `pipe-hydraulics.ts`), а каталог насосов — в таблице `Pump`. Дублировать
 * подбор на фронте нельзя: расходятся и правила, и данные.
 */

/** Предупреждение подбора: почему результат такой или почему его нет. */
export interface PumpWarning {
  code: string
  message: string
}

export interface PumpCatalogEntry {
  name: string
  capacityMinM3h: number
  capacityMaxM3h: number
  headMinM: number
  headMaxM: number
  /** Диаметр напорного патрубка насоса, мм. */
  nozzleDiameterMm: number
}

/** Рабочая точка на паспортной кривой при требуемом расходе. */
export interface DutyPoint {
  /** Расход, м³/ч. */
  q: number
  /** Напор, который насос там реально выдаёт, м. */
  h: number
  /** Мощность на валу, кВт. */
  p2: number
  /** Потребляемая мощность, кВт. */
  p1: number
  /** КПД, %. */
  eff: number
}

/** Подходящий насос вместе с его рабочей точкой. */
export interface PumpCandidate {
  name: string
  pump: PumpCatalogEntry
  duty: DutyPoint | null
  headMarginM: number | null
  /** Проверен по паспортной кривой (`true`) или по грубым диапазонам. */
  byCurve: boolean
  /** Запас по напору попал в желаемое окно; `false` — насос избыточен. */
  withinPreferredBand: boolean
}

export interface PumpSelectionResult {
  /** Марка подобранного насоса; `null` — в каталоге подходящего нет. */
  name: string | null
  pump: PumpCatalogEntry | null
  /** Рабочая точка выбранного насоса; `null` — у модели нет кривой. */
  duty: DutyPoint | null
  /** Запас по напору над требуемым, м. */
  headMarginM: number | null
  /** Расход на ОДИН насос, м³/ч — именно он сравнивался с каталогом. */
  flowPerPumpM3h: number
  requiredHeadM: number
  /** Окно запаса по напору, применённое при отборе, м. */
  headMarginBandM: { min: number; max: number }
  /** Все подходящие модели в порядке предпочтения, включая выбранную первой. */
  candidates: PumpCandidate[]
  /** {@link candidates} без первой — для краткой строки «ещё подходят». */
  alternatives: PumpCandidate[]
  /**
   * Дотягивают до напора, но не набирают минимального запаса. По умолчанию не
   * предлагаются; инженер может выбрать такую модель осознанно.
   */
  belowMargin: PumpCandidate[]
  warnings: PumpWarning[]
}

export interface PipeDiameterResult {
  /** Ближайший больший типоразмер напорной ПЭ-трубы, мм. */
  diameterMm: number
  theoreticalDiameterMm: number
  velocityMs: number
  designVelocityMs: number
  flowPerPumpM3h: number
  warnings: PumpWarning[]
}

export const pumpStationApi = {
  /**
   * Подбор марки насоса по притоку, напору и числу рабочих насосов.
   *
   * Приток — ОБЩИЙ на станцию, м³/ч: деление на число насосов делает сервер
   * (насосы работают параллельно, напор при этом не делится).
   */
  selectPump(flowM3h: number, headM: number, workingPumps: number): Promise<PumpSelectionResult> {
    return api
      .post<PumpSelectionResult>('/pump-station/select-pump', { flowM3h, headM, workingPumps })
      .then((r) => r.data)
  },

  /** Диаметр напорного трубопровода по расходу и числу рабочих насосов. */
  dischargePipeDiameter(flowM3h: number, workingPumps: number): Promise<PipeDiameterResult> {
    return api
      .post<PipeDiameterResult>('/pump-station/discharge-pipe-diameter', { flowM3h, workingPumps })
      .then((r) => r.data)
  },
}
