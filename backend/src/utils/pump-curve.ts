/**
 * Паспортная характеристика насоса Q–H и рабочая точка на ней.
 *
 * Кривая задана 9–10 точками выгрузки VJ Select. Между точками — линейная
 * интерполяция: сплайн здесь не нужен, шаг по расходу мелкий (5–10 % диапазона),
 * а сама кривая гладкая и монотонно убывающая.
 *
 * Экстраполяции нет намеренно. За пределами крайних точек паспорт ничего не
 * обещает, а продолжение прямой ушло бы в отрицательный напор — лучше честно
 * сказать «вне кривой», чем выдать выдуманное число в подбор оборудования.
 *
 * @module utils/pump-curve
 */

/** Точка паспортной характеристики. */
export interface CurvePoint {
  /** Расход, м³/ч. */
  q: number
  /** Напор, м. */
  h: number
  /** Мощность на валу, кВт. */
  p2: number
  /** Потребляемая мощность, кВт. */
  p1: number
  /** КПД, %. */
  eff: number
}

/** Значения характеристики в конкретной точке по расходу. */
export interface DutyPoint {
  q: number
  h: number
  p2: number
  p1: number
  eff: number
}

/**
 * Значения кривой при заданном расходе.
 *
 * Возвращает `null`, если расход вне диапазона точек кривой или точек меньше
 * двух — интерполировать не по чему.
 *
 * @param points Точки кривой; порядок произвольный, функция отсортирует.
 * @param q Расход, м³/ч.
 */
export function interpolateCurve(points: readonly CurvePoint[], q: number): DutyPoint | null {
  if (points.length < 2 || !Number.isFinite(q)) return null

  const pts = [...points].sort((a, b) => a.q - b.q)
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  if (q < first.q || q > last.q) return null

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    if (q < a.q || q > b.q) continue

    const span = b.q - a.q
    // Совпадающие точки по расходу: берём левую, делить на ноль нечем.
    const t = span === 0 ? 0 : (q - a.q) / span
    return {
      q,
      h: a.h + t * (b.h - a.h),
      p2: a.p2 + t * (b.p2 - a.p2),
      p1: a.p1 + t * (b.p1 - a.p1),
      eff: a.eff + t * (b.eff - a.eff),
    }
  }

  return null
}

/**
 * Расход, при котором кривая даёт заданный напор, — точка пересечения с
 * горизонталью H.
 *
 * Нужна для оценки, где насос окажется, если требуемый напор задан жёстко.
 * Кривая невозрастающая, поэтому пересечение не более одного; при нескольких
 * совпадениях (горизонтальный участок) возвращается наименьший расход.
 */
export function flowAtHead(points: readonly CurvePoint[], h: number): number | null {
  if (points.length < 2 || !Number.isFinite(h)) return null

  const pts = [...points].sort((a, b) => a.q - b.q)
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const hi = Math.max(a.h, b.h)
    const lo = Math.min(a.h, b.h)
    if (h > hi || h < lo) continue

    const span = a.h - b.h
    if (span === 0) return a.q
    return a.q + ((a.h - h) / span) * (b.q - a.q)
  }

  return null
}
