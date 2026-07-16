/**
 * Опросный лист КНС: авторасчёты (§5.6 ТЗ, прототип «Опросный лист v2»).
 *
 * КНС, ЛНС и ДНС конструктивно идентичны — один шаблон; «Тип НС» влияет на
 * подписи и входы, не на структуру (Реверс §1).
 *
 * Все функции чистые: вход — параметры ОЛ, выход — значения. Никакого Vue.
 */

import { roundUp } from './rounding'

// ─── Константы подбора глубины (Механика §13, прототип ОЛ) ──────────────────

/** Пусков насоса в час — норматив подбора эффективного объёма. */
export const STARTS_PER_HOUR = 10
/** Минимальное время между пусками, мин. */
export const MIN_CYCLE_MINUTES = 5
/** Технологический запас над рабочим уровнем, м. */
export const FREEBOARD_M = 0.3
/** Высота рамы, м (по умолчанию; в ТЗ §5.6 — поле ОЛ). */
export const DEFAULT_FRAME_H_M = 0.16
/** Минимальный уровень жидкости насоса, м (по умолчанию; поле ОЛ). */
export const DEFAULT_MIN_LEVEL_M = 0.627

/** Единицы измерения притока (прототип: переключатель с конвертацией). */
export type FlowUnit = 'l/s' | 'm3/h' | 'm3/day'

/** Приток к л/с. */
export function toLps(value: number, unit: FlowUnit): number {
  switch (unit) {
    case 'l/s':
      return value
    case 'm3/h':
      return value / 3.6
    case 'm3/day':
      return value / 86.4
  }
}

/** Приток из л/с в указанную ЕИ (для переключателя в UI). */
export function fromLps(lps: number, unit: FlowUnit): number {
  switch (unit) {
    case 'l/s':
      return lps
    case 'm3/h':
      return lps * 3.6
    case 'm3/day':
      return lps * 86.4
  }
}

export interface DepthInput {
  /** Максимальный приток. */
  flow: number
  flowUnit: FlowUnit
  /** DN корпуса, мм. */
  dn: number
  /** Количество рабочих насосов. */
  pumpsWorking: number
  /** Глубина залегания лотка подводящего патрубка, мм. */
  inletInvertMm: number | null
  /** Высота рамы, м. */
  frameHm?: number
  /** Минимальный уровень жидкости насоса, м. */
  minLevelM?: number
}

export interface DepthResult {
  /** Приток, приведённый к л/с. */
  qLps: number
  /** Эффективный объём, м³. */
  vEf: number
  /** Минимальный объём, м³. */
  vMin: number
  /** Рабочая высота, м. */
  hRab: number
  /** Суммарная расчётная высота, м. */
  hR: number
  /** Глубина подземной части, мм. `null`, если не задан лоток. */
  npodzMm: number | null
}

/**
 * Подбор глубины подземной части (фирменная механика ОЛ, live-панель).
 *
 * ```
 * Vэф   = Q·3,6 / (4 · пусков_в_час · n)
 * Vмин  = (Q·3,6 / n) · 5/60
 * hраб  = 4·Vмин / (π·(DN/1000)²)
 * hР    = hраб + 0,3 + h_рамы + h_мин
 * Нподз = ROUNDUP((лоток/1000 + hР)·1000; −2)      ← вверх до 100 мм
 * ```
 *
 * Контроль (ОЛ3487, прототип): Q 25,13 л/с · DN 3000 · n 2 · лоток 9910 мм
 * → Vэф 1,13 · Vмин 3,77 · hраб 0,533 · hР 1,620 · **Нподз 11 600 мм**.
 *
 * ⚠️ `hраб` считается от **Vмин**, а не от «Vраб», как записано в ТЗ §5.6:
 * только так воспроизводится контрольное число прототипа.
 */
export function computeDepth(input: DepthInput): DepthResult {
  const {
    flow,
    flowUnit,
    dn,
    pumpsWorking,
    inletInvertMm,
    frameHm = DEFAULT_FRAME_H_M,
    minLevelM = DEFAULT_MIN_LEVEL_M,
  } = input

  const qLps = toLps(flow, flowUnit)
  const n = pumpsWorking > 0 ? pumpsWorking : 1

  const vEf = (qLps * 3.6) / (4 * STARTS_PER_HOUR * n)
  const vMin = ((qLps * 3.6) / n) * (MIN_CYCLE_MINUTES / 60)
  const hRab = dn > 0 ? (4 * vMin) / (Math.PI * (dn / 1000) ** 2) : 0
  const hR = hRab + FREEBOARD_M + frameHm + minLevelM

  const npodzMm = inletInvertMm == null ? null : roundUp((inletInvertMm / 1000 + hR) * 1000, -2)

  return { qLps, vEf, vMin, hRab, hR, npodzMm }
}

// ─── PN / SN ─────────────────────────────────────────────────────────────────

/** PN опросного листа: корпус КНС безнапорный (README хендоффа, эталон G8). */
export const PN_SURVEY_DEFAULT = 0.1

/** Ступени SN (прототип; таблица весов знает только 2500/5000/10000). */
const SN_LADDER = [1250, 2500, 5000, 10000] as const

/**
 * SN по глубине подземной части (решение дизайн-сессии, подтверждено всеми
 * шестью реальными ОЛ):
 *
 * `> 8000 мм → 10000 · > 5000 → 5000 · > 3000 → 2500 · иначе 1250`
 *
 * Флаги «под проезжей частью» или «по ТТ МВК» поднимают SN на ступень,
 * потолок — 10000.
 */
export function snByDepth(
  depthMm: number,
  opts: { underRoadway?: boolean; mvk?: boolean } = {},
): number {
  const base = depthMm > 8000 ? 10000 : depthMm > 5000 ? 5000 : depthMm > 3000 ? 2500 : 1250

  if (!opts.underRoadway && !opts.mvk) return base

  const i = SN_LADDER.indexOf(base as (typeof SN_LADDER)[number])
  return SN_LADDER[Math.min(i + 1, SN_LADDER.length - 1)]!
}

/**
 * Автоподбор PN ТРУБЫ для поиска веса (эталон, ячейка `F7`).
 *
 * ⚠️ Это НЕ `PN_ОЛ`: в расчёте участвуют две разные PN (ТЗ §9.4).
 * `PN_ОЛ` (0,1 — безнапорный корпус) идёт только в НАИМЕНОВАНИЕ трубы;
 * `PN_трубы` — только в КЛЮЧ ПОИСКА ВЕСА.
 *
 * ```
 * F7 = IF(PN_ОЛ > 0,6 И (DN;SN) ∈ {(1200;2500), (1200;10000), (1300;2500)}; 1,6;
 *      IF(DN = 1300 И SN ∈ {5000, 10000} И PN_ОЛ ≤ 0,4;                      0,4;
 *      IF(PN_ОЛ ≤ 0,6;                                                        0,6;
 *                                                                             1)))
 * ```
 *
 * ❗ Обе спецветки эталона ведут в НЕСУЩЕСТВУЮЩИЕ ключи таблицы весов
 * (План §4.1-bis B). Ветка `0,4` при этом достижима на реальном кейсе: у КНС
 * `PN_ОЛ` = 0,1, и при DN 1300 глубже 5 м (SN 5000) поиск веса промахнётся —
 * ровно как и в самом Excel. Поведение воспроизводится намеренно: расхождение
 * с заводским файлом было бы хуже, чем воспроизведённый дефект. Промах даёт
 * «красную» строку, а не молчаливый ноль.
 */
export function pnForWeightLookup(pnSurvey: number, dn: number, sn: number): number {
  const specialFor16 = [
    [1200, 2500],
    [1200, 10000],
    [1300, 2500],
  ]
  if (pnSurvey > 0.6 && specialFor16.some(([d, s]) => d === dn && s === sn)) return 1.6
  if (dn === 1300 && (sn === 5000 || sn === 10000) && pnSurvey <= 0.4) return 0.4
  if (pnSurvey <= 0.6) return 0.6
  return 1
}

/** Марка трубы корпуса: `Труба СК/НПС-К {DN}-{PN_ОЛ}-{SN}` (Механика §5.3). */
export function pipeGradeName(dn: number, pnSurvey: number, sn: number): string {
  const pn = pnSurvey.toLocaleString('ru-RU')
  return `Труба СК/НПС-К ${dn}-${pn}-${sn}`
}

// ─── Гильзы ──────────────────────────────────────────────────────────────────

/**
 * Диаметр гильзы для прохода патрубка (эталон `K8`/`M8`):
 * `IF(DN ≥ 200; CEILING(DN+100; 100); CEILING(DN+100; 50))`.
 *
 * Тонкость первоисточника: при `DN < 100` надбавка +100 НЕ применяется.
 */
export function sleeveDiameter(nozzleDn: number): number {
  const base = nozzleDn < 100 ? nozzleDn : nozzleDn + 100
  const step = nozzleDn >= 200 ? 100 : 50
  return Math.ceil(base / step) * step
}

// ─── Арматура ────────────────────────────────────────────────────────────────

/**
 * Кол-во задвижек на подводящих (безнапорных) трубопроводах.
 *
 * `= кол-во подводящих патрубков × флаг «арматура на подводящем»`.
 * Задвижки ставятся только на безнапорные подводящие (README хендоффа).
 */
export function gateValveCount(inletCount: number, valveOnInlet: boolean): number {
  return valveOnInlet ? inletCount : 0
}

/**
 * Кол-во шаровых кранов на напорной линии.
 *
 * `= (раб + рез) + 1 коллектор + 1 при аварийном трубопроводе`.
 * Контроль (ОЛ3487): 2 раб + 1 рез + 1 коллектор = 4 (README хендоффа).
 */
export function ballValveCount(
  pumpsWorking: number,
  pumpsReserve: number,
  emergencyPipeline: boolean,
): number {
  return pumpsWorking + pumpsReserve + 1 + (emergencyPipeline ? 1 : 0)
}

/** Кол-во поплавковых выключателей: `раб + рез + 2` (Механика §7.2). */
export function floatSwitchCount(pumpsWorking: number, pumpsReserve: number): number {
  return pumpsWorking + pumpsReserve + 2
}
