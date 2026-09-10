/**
 * Связь цен строк расчёта с полями опросного листа (EngineRow.priceBinding).
 *
 * Цена трубы корпуса (₽/м.п.) и цена насоса (₽/шт) вводятся в ОЛ и живут в
 * расчёте ручной ценой своих строк. Модуль знает, какое поле ОЛ стоит за какой
 * связью и как найти связанные строки в сохранённом дереве, — в том числе в
 * деревьях, построенных до появления связи.
 */

import type { PriceBinding } from './types'

/**
 * Поля ОЛ по связям: имя в форме, где цена лежит строкой ввода, и в
 * параметрах материализации ЕМК/КОЛ, где она числом.
 */
export const PRICE_BINDING_FIELDS: Record<PriceBinding, { formField: 'pipePrice' | 'pumpPrice'; paramsField: string }> = {
  pipePrice: { formField: 'pipePrice', paramsField: 'pipePriceRub' },
  pumpPrice: { formField: 'pumpPrice', paramsField: 'pumpPriceRub' },
}

/** Строка сохранённого дерева — в том объёме, который здесь нужен. */
interface SavedRow {
  kind?: string
  category?: string
  unit?: string
  bucket?: string
  priceManual?: number | null
  priceBinding?: PriceBinding
}

interface SavedTree {
  sections?: Array<{ code?: string; components?: Array<{ rows?: SavedRow[] }> }>
}

/**
 * Связанная строка дерева: помеченная связью либо, у деревьев, построенных до
 * её появления, узнанная по приметам.
 *
 * Приметы старых деревьев: труба корпуса — первая строка ЕИ «м» корзины
 * «Труба, муфта» в разделе 1 (материализуется раньше сегментов и шахты);
 * насос — строка категории «Насосы, АТМ».
 */
function findBound(tree: SavedTree, binding: PriceBinding): SavedRow | null {
  const sections = tree.sections ?? []
  const rows = sections.flatMap((s) => (s.components ?? []).flatMap((c) => c.rows ?? []))

  const marked = rows.find((r) => r.priceBinding === binding)
  if (marked) return marked

  if (binding === 'pipePrice') {
    const first = sections.find((s) => s.code === '1')
    const pipe = (first?.components ?? [])
      .flatMap((c) => c.rows ?? [])
      .find((r) => r.bucket === 'Труба, муфта' && r.unit === 'м')
    return pipe ?? null
  }
  return rows.find((r) => r.category === 'Насосы, АТМ') ?? null
}

/**
 * Цены связанных строк из сохранённого дерева — для полей ОЛ.
 *
 * Нужны при открытии ОЛ, если в форме поля пусты: у расчётов, где цену трубы
 * или насоса вводили в самом расчёте до появления полей, иначе первый же
 * пересчёт из ОЛ собрал бы дерево с пустым полем — и цена бы пропала.
 *
 * @returns значения полей формы строкой; поля без цены в дереве не возвращаются
 */
export function boundPricesFromTree(tree: unknown): Partial<Record<'pipePrice' | 'pumpPrice', string>> {
  if (!tree || typeof tree !== 'object') return {}
  const out: Partial<Record<'pipePrice' | 'pumpPrice', string>> = {}
  for (const binding of Object.keys(PRICE_BINDING_FIELDS) as PriceBinding[]) {
    const price = findBound(tree as SavedTree, binding)?.priceManual
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      out[PRICE_BINDING_FIELDS[binding].formField] = String(price)
    }
  }
  return out
}
