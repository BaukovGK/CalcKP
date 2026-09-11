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
 * Почему ручной ввод строки не принят (План_устранения, 1.5):
 *  - `unparsed` — выражение количества не разобралось;
 *  - `negative` — количество или цена меньше нуля (решение Р4): скидка —
 *    через наценку, а не строкой с минусом.
 *
 * Непринятый ввод в расчёт не идёт — там расчётное количество и цена
 * прайса, — но и не пропадает молча: ячейка подсвечена ошибкой.
 */
export type InputIssue = 'unparsed' | 'negative'

/** Ручное количество строки: значение, если принято, иначе — почему нет. */
export function manualQty(row: Pick<EngineRow, 'qtyManual'>): { value: number | null; issue: InputIssue | null } {
  const text = row.qtyManual
  if (text == null || String(text).trim() === '') return { value: null, issue: null }
  const value = tryEvalExpr(String(text))
  if (value === null) return { value: null, issue: 'unparsed' }
  if (value < 0) return { value: null, issue: 'negative' }
  return { value, issue: null }
}

/**
 * Итоговое количество: `qtyManual ?? qtyCalc`, домноженное на флаг раздела и
 * тираж. Ручной ввод — выражение; неразобранное или отрицательное в расчёт
 * не идёт — берётся расчётное, а `issue` говорит почему (`manualQty`).
 */
export function resolveQty(
  row: EngineRow,
  opts: { sectionEnabled?: boolean; tirage?: number } = {},
): { qty: number; overridden: boolean; issue: InputIssue | null } {
  const { sectionEnabled = true, tirage = 1 } = opts

  const { value: manual, issue } = manualQty(row)
  const enabled = row.enabled ?? true
  if (!enabled || !sectionEnabled) return { qty: 0, overridden: false, issue }

  const overridden = manual !== null
  const base = manual ?? row.qtyCalc ?? 0

  // ROUNDUP до 0,1 применяется к трудоёмкости: в эталоне J-колонка целиком
  // обёрнута в ROUNDUP(...;1), но для штучных материалов этоно-оп.
  const rounded = row.unit === UNIT_HOURS ? roundUpHours(base) : base

  return { qty: rounded * tirage, overridden, issue }
}

/**
 * Применённая цена: ручная перекрывает каталожную (Механика §5.2). Ручная
 * меньше нуля не принимается (решение Р4) — в расчёте цена прайса.
 */
export function resolvePrice(row: EngineRow): { price: number | null; overridden: boolean; issue: InputIssue | null } {
  if (row.priceManual != null && row.priceManual < 0) return { price: row.priceCatalog, overridden: false, issue: 'negative' }
  if (row.priceManual != null) return { price: row.priceManual, overridden: true, issue: null }
  return { price: row.priceCatalog, overridden: false, issue: null }
}

/**
 * Вычисляет строку целиком.
 *
 * Строка без цены даёт сумму 0 и помечается `missingPrice` — она не даёт
 * выпустить КП (гейт `POST /api/estimates/:id/kp`, Механика §10) и
 * подсвечивается красным.
 */
export function computeRow(
  row: EngineRow,
  opts: { sectionEnabled?: boolean; tirage?: number } = {},
): RowResult {
  const { qty, overridden: qtyOverridden, issue: qtyIssue } = resolveQty(row, opts)
  const { price, overridden: priceOverridden, issue: priceIssue } = resolvePrice(row)

  const missingPrice = price == null
  const sum = missingPrice ? 0 : qty * price

  return { qty, price, sum, missingPrice, qtyOverridden, priceOverridden, qtyIssue, priceIssue }
}

/**
 * Конфликт «ОЛ изменился после тюнинга» (Механика §8.3): ручной override
 * перекрывает изменившееся расчётное значение. Расчётные значения обновляются
 * всегда, ручные — никогда молча.
 */
export function hasQtyConflict(row: EngineRow, previousQtyCalc: number | null | undefined): boolean {
  if (previousQtyCalc == null || row.qtyCalc == null) return false
  // Непринятый ручной ввод (не разобран, меньше нуля) расчётное не
  // перекрывает — конфликтовать нечему.
  if (manualQty(row).value === null) return false
  return previousQtyCalc !== row.qtyCalc
}
