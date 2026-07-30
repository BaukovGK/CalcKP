/**
 * Подбор кольцевой жёсткости корпуса насосной станции (SN, Па).
 *
 * Правило (матрица 2×2 по глубине подводящего патрубка и признаку ТТ МВК):
 * ```
 * (глубина + 2) >  7 м:  МВК=false → SN 10000 · МВК=true → SN 12000
 * (глубина + 2) <= 7 м:  МВК=false → SN  5000 · МВК=true → SN  8000
 * ```
 * Ровно на границе (глубина + 2 = 7) действует ветка «<= 7».
 *
 * SN 8000 и 12000 — обозначения для заказчика по требованиям МВК: та же труба,
 * что 5000 и 10000, с двумя дополнительными нитками ровинга. По массе и
 * габаритам трубы одинаковы, поэтому вес берётся из строк 5000 и 10000
 * справочника без поправок.
 *
 * @module utils/ring-stiffness
 */

/** Кольцевая жёсткость SN, Па, по правилу глубина + ТТ МВК. */
export const RING_STIFFNESS_PA = {
  deep: { mvkFalse: 10000, mvkTrue: 12000 },
  shallow: { mvkFalse: 5000, mvkTrue: 8000 },
} as const

/** Порог глубины (после прибавления запаса 2 м), м. */
export const DEPTH_THRESHOLD_M = 7
/** Запас, прибавляемый к глубине патрубка перед сравнением с порогом, м. */
export const DEPTH_MARGIN_M = 2

/**
 * Рассчитать кольцевую жёсткость корпуса SN, Па.
 *
 * @param mvk Признак «по ТТ МВК» (булев).
 * @param inletPipeDepthM Глубина подводящего патрубка, м (≥ 0).
 */
export function calcRingStiffnessPa(mvk: boolean, inletPipeDepthM: number): number {
  if (!(inletPipeDepthM >= 0)) {
    throw new Error('inletPipeDepthM (глубина подводящего патрубка, м) должна быть ≥ 0.')
  }

  const isDeep = inletPipeDepthM + DEPTH_MARGIN_M > DEPTH_THRESHOLD_M
  const branch = isDeep ? RING_STIFFNESS_PA.deep : RING_STIFFNESS_PA.shallow
  return mvk ? branch.mvkTrue : branch.mvkFalse
}
