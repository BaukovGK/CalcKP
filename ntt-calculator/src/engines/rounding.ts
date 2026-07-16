/**
 * Округление, совместимое с Excel-функцией ROUNDUP.
 *
 * Единственный источник истины по округлению во всём движке (Механика §12.6:
 * балансные константы задаются один раз). ROUNDUP встречается в трёх местах
 * с разным шагом: чел.ч — до 0,1; СИЗ — до 1; цена продажи — до 100 ₽.
 */

/**
 * Гасит двоичную погрешность масштабирования, как это делает Excel
 * («косметическое» округление до 15 значащих цифр).
 *
 * Без этого движок завышал бы трудоёмкость: 10 кг × 0,28 = 2.8000000000000003,
 * и наивный `Math.ceil(x * 10) / 10` дал бы 2,9 вместо 2,8 — то есть лишние
 * 0,1 чел.ч на ровном месте. Случай не теоретический: массы 2,5 / 5 / 10 кг
 * с коэффициентами 0,28 и 0,56 (§9.3) отказывают именно так.
 */
function snap(x: number): number {
  return Number(x.toPrecision(15))
}

/**
 * Аналог `ROUNDUP(value; decimals)` из Excel: округление ВВЕРХ (от нуля)
 * до указанного числа знаков после запятой.
 *
 * @param decimals  1 → до 0,1 · 0 → до целого · −2 → до 100
 *
 * ```
 * roundUp(56.3909, 1)     // 56.4   — ПЗР, чел.ч
 * roundUp(922.3, 0)       // 923    — СИЗ, ед.
 * roundUp(16592919.2, -2) // 16593000 — цена продажи, ₽
 * ```
 */
export function roundUp(value: number, decimals = 0): number {
  if (!Number.isFinite(value)) return value
  if (value === 0) return 0

  // Множитель берём целым (10**|decimals|), а не дробным (10**-2 = 0.01 неточно
  // в double) — иначе теряется точность на шаге деления.
  if (decimals >= 0) {
    const factor = 10 ** decimals
    const scaled = snap(value * factor)
    const r = value > 0 ? Math.ceil(scaled) : Math.floor(scaled)
    return snap(r / factor)
  }

  const step = 10 ** -decimals
  const scaled = snap(value / step)
  const r = value > 0 ? Math.ceil(scaled) : Math.floor(scaled)
  return snap(r * step)
}

/** ROUNDUP до 0,1 — трудоёмкость в чел.ч (§9.3, Механика §13). */
export const roundUpHours = (hours: number): number => roundUp(hours, 1)

/** ROUNDUP до 100 ₽ — цена продажи (§9.5 п.8). */
export const roundUpPrice = (rub: number): number => roundUp(rub, -2)
