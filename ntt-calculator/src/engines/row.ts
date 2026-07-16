/**
 * Движок строки: двухканальный override количества и цены (Механика §5).
 *
 * Эталонные формулы (лист «Калькулятор КНС»):
 *   J = IF(флаг_раздела = "нет"; 0; ROUNDUP(IF(H = ""; I; H); 1))
 *   N = IFERROR(IF(L = ""; M * J; J * L); "")
 * где H — ручное кол-во, I — расчётное, L — ручная цена, M — цена прайса.
 */

import { tryEvalExpr } from './expr'
import { roundUpHours } from './rounding'
import { NON_PURCHASE_CATEGORIES, UNIT_HOURS, type Category, type EngineRow, type RowResult } from './types'

/**
 * Строка попадает в Заявку на закупку (Механика §5.3, эталон: колонка F).
 * Вычисляется из категории, а не хранится.
 */
export function isPurchase(category: Category): boolean {
  return !NON_PURCHASE_CATEGORIES.includes(category)
}

/**
 * Итоговое количество: `qtyManual ?? qtyCalc`, домноженное на флаг раздела и
 * тираж. Ручной ввод — выражение; некорректное трактуется как отсутствующее,
 * то есть падаем обратно на расчётное значение, а не роняем расчёт.
 */
export function resolveQty(
  row: EngineRow,
  opts: { sectionEnabled?: boolean; tirage?: number } = {},
): { qty: number; overridden: boolean } {
  const { sectionEnabled = true, tirage = 1 } = opts

  const enabled = row.enabled ?? true
  if (!enabled || !sectionEnabled) return { qty: 0, overridden: false }

  const manual = tryEvalExpr(row.qtyManual)
  const overridden = manual !== null
  const base = manual ?? row.qtyCalc ?? 0

  // ROUNDUP до 0,1 применяется к трудоёмкости: в эталоне J-колонка целиком
  // обёрнута в ROUNDUP(...;1), но для штучных материалов этоно-оп.
  const rounded = row.unit === UNIT_HOURS ? roundUpHours(base) : base

  return { qty: rounded * tirage, overridden }
}

/** Применённая цена: ручная перекрывает каталожную (Механика §5.2). */
export function resolvePrice(row: EngineRow): { price: number | null; overridden: boolean } {
  if (row.priceManual != null) return { price: row.priceManual, overridden: true }
  return { price: row.priceCatalog, overridden: false }
}

/**
 * Вычисляет строку целиком.
 *
 * Строка без цены даёт сумму 0 и помечается `missingPrice` — она блокирует
 * переход CALC → REVIEW (Механика §10) и подсвечивается красным.
 */
export function computeRow(
  row: EngineRow,
  opts: { sectionEnabled?: boolean; tirage?: number } = {},
): RowResult {
  const { qty, overridden: qtyOverridden } = resolveQty(row, opts)
  const { price, overridden: priceOverridden } = resolvePrice(row)

  const missingPrice = price == null
  const sum = missingPrice ? 0 : qty * price

  return { qty, price, sum, missingPrice, qtyOverridden, priceOverridden }
}

/**
 * Конфликт «ОЛ изменился после тюнинга» (Механика §8.3): ручной override
 * перекрывает изменившееся расчётное значение. Расчётные значения обновляются
 * всегда, ручные — никогда молча.
 */
export function hasQtyConflict(row: EngineRow, previousQtyCalc: number | null | undefined): boolean {
  if (previousQtyCalc == null || row.qtyCalc == null) return false
  if (tryEvalExpr(row.qtyManual) === null) return false
  return previousQtyCalc !== row.qtyCalc
}
