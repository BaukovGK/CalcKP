/**
 * Подбор кольцевой жёсткости корпуса насосной станции (SN, Па).
 *
 * Правило (матрица 2×2 по глубине подводящего патрубка и признаку МГЭ):
 * ```
 * (глубина + 2) >  7 м:  МГЭ=false → SN 10000 · МГЭ=true → SN 12000
 * (глубина + 2) <= 7 м:  МГЭ=false → SN  5000 · МГЭ=true → SN  8000
 * ```
 * Ровно на границе (глубина + 2 = 7) действует ветка «<= 7».
 *
 * @module utils/ring-stiffness
 */

/** Кольцевая жёсткость SN, Па, по правилу глубина+МГЭ. */
export const RING_STIFFNESS_PA = {
  deep: { mgeFalse: 10000, mgeTrue: 12000 },
  shallow: { mgeFalse: 5000, mgeTrue: 8000 },
} as const

/** Порог глубины (после прибавления запаса 2 м), м. */
export const DEPTH_THRESHOLD_M = 7
/** Запас, прибавляемый к глубине патрубка перед сравнением с порогом, м. */
export const DEPTH_MARGIN_M = 2

/**
 * Рассчитать кольцевую жёсткость корпуса SN, Па.
 *
 * @param mge Признак МГЭ (булев).
 * @param inletPipeDepthM Глубина подводящего патрубка, м (≥ 0).
 */
export function calcRingStiffnessPa(mge: boolean, inletPipeDepthM: number): number {
  if (!(inletPipeDepthM >= 0)) {
    throw new Error('inletPipeDepthM (глубина подводящего патрубка, м) должна быть ≥ 0.')
  }

  const isDeep = inletPipeDepthM + DEPTH_MARGIN_M > DEPTH_THRESHOLD_M
  const branch = isDeep ? RING_STIFFNESS_PA.deep : RING_STIFFNESS_PA.shallow
  return mge ? branch.mgeTrue : branch.mgeFalse
}
