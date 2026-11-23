/**
 * Коэффициент наценки строки — распределение общей наценки по позициям.
 *
 * Коэффициент — множитель к сумме строки: цена строки в продаже =
 * сумма × k. По умолчанию у всех строк k = 1 + общая наценка (0,43 → 1,43),
 * и средневзвешенная наценка по строкам равна общей.
 *
 * «Оптимизировать наценку» ({@link optimizeMarkupK}) перекладывает наценку
 * с закупаемых позиций (те, что идут в Заявку на закупку, — `isPurchase`) на
 * продукцию собственного производства: закупка — к {@link PURCHASE_MARKUP_K},
 * своё производство — сколько останется, но так, чтобы средневзвешенная
 * наценка по строкам не превысила общую.
 *
 * Общая цена продажи (economics.ts, `salePriceFromCost`) от коэффициентов не
 * зависит: она по-прежнему считается от себестоимости и общей наценки.
 * Коэффициенты — разбивка этой наценки по строкам: на цену, себестоимость и
 * сумму КП не влияют, но по ним цена изделия раскладывается на подпозиции КП
 * (backend/src/utils/kp-parts.ts; Механика_калькулятора §9.2).
 */

import { isPurchase } from './row'
import type { EngineRow } from './types'

/**
 * Нижняя граница коэффициента: строка не продаётся дешевле своей суммы
 * (решение пользователя 2026-11-19). Оптимизация ниже не опускает: закупке
 * 1,05, производству ≥ 1 + наценка.
 */
export const MIN_MARKUP_K = 1

/** Целевой коэффициент закупаемой позиции: закупка «в ноль» плюс 5 %. */
export const PURCHASE_MARKUP_K = 1.05

/** Шаг коэффициента производства при оптимизации: три знака после запятой. */
const K_STEP = 1000

/**
 * Коэффициент по умолчанию — от общей наценки (доля: 0,43 → 1,43).
 * Без округления: при наценке 0,43255 k = 1,43255, иначе округление вверх
 * (1,433) подняло бы наценку по строкам выше общей. Округляет только показ
 * (Механика_калькулятора §9.2).
 */
export function defaultMarkupK(markup: number): number {
  return 1 + markup
}

/** Коэффициент строки: ручной или, если не задан, — от общей наценки. */
export function rowMarkupK(row: Pick<EngineRow, 'markupK'>, markup: number): number {
  return row.markupK ?? defaultMarkupK(markup)
}

/** Строка для распределения: id, закупка ли она и её сумма в расчёте. */
export interface MarkupRowInput {
  id: string
  category: EngineRow['category']
  /** Сумма строки (кол-во × цена) — та, что идёт в себестоимость. */
  sum: number
}

/**
 * Средневзвешенная наценка по строкам (доля): `Σ сумма×k / Σ сумма − 1`.
 * `null` — строк с суммой нет.
 */
export function weightedMarkup(rows: Array<{ sum: number; k: number }>): number | null {
  let base = 0
  let sale = 0
  for (const r of rows) {
    if (!(r.sum > 0)) continue
    base += r.sum
    sale += r.sum * r.k
  }
  return base > 0 ? sale / base - 1 : null
}

/** Вниз до шага — чтобы округление не подняло наценку выше общей. */
function floorK(k: number): number {
  return Math.floor(k * K_STEP + 1e-9) / K_STEP
}

/**
 * Оптимальные коэффициенты: закупка → {@link PURCHASE_MARKUP_K}, собственное
 * производство — максимум, при котором средневзвешенная наценка по строкам
 * не больше общей `markup`.
 *
 * Пусть S_з — сумма закупки, S_п — производства, k_о = 1 + markup. Тогда
 * k_п = (k_о·(S_з + S_п) − 1,05·S_з) / S_п, округлённый вниз до 0,001
 * (Механика_калькулятора §9.2). Верхней границы у k_п нет.
 *
 * Крайние случаи — у всех строк k_о (перекладывать нечего или некуда):
 *  - общая наценка не выше 5 %: закупке до 1,05 не дотянуться;
 *  - производства в расчёте нет (S_п = 0).
 *
 * Строки с нулевой суммой (выключенные, без цены) получают коэффициент своей
 * группы — включат их, и они встанут в общий ряд.
 */
export function optimizeMarkupK(rows: MarkupRowInput[], markup: number): Map<string, number> {
  const kAll = defaultMarkupK(markup)
  let sPurchase = 0
  let sOwn = 0
  for (const r of rows) {
    if (!(r.sum > 0)) continue
    if (isPurchase(r.category)) sPurchase += r.sum
    else sOwn += r.sum
  }

  const out = new Map<string, number>()
  if (kAll <= PURCHASE_MARKUP_K || sOwn <= 0) {
    for (const r of rows) out.set(r.id, kAll)
    return out
  }

  const kOwn = floorK(((1 + markup) * (sPurchase + sOwn) - PURCHASE_MARKUP_K * sPurchase) / sOwn)
  for (const r of rows) out.set(r.id, isPurchase(r.category) ? PURCHASE_MARKUP_K : kOwn)
  return out
}
