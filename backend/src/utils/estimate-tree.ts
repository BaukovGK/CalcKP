/**
 * Разбор дерева расчёта, хранящегося в `Estimate.surveyData` (Json).
 *
 * Понимает две формы:
 *  - целевую (§9, Библиотека §6.3): `tree.sections[].components[].rows[]`;
 *  - устаревшую (фаза 1): `bundles[].groups[].subgroups[].rows[]`.
 *
 * Обе поддерживаются намеренно: фронт мигрирует на дерево в рамках этапа 5,
 * а валидация статусов нужна уже сейчас и не должна зависеть от порядка работ.
 */

export interface TreeRow {
  id?: string
  name?: string
  unit?: string
  enabled?: boolean
  qtyCalc?: number | null
  qtyManual?: string | number | null
  priceCatalog?: number | null
  priceManual?: number | null
  /** Устаревшая форма хранит количество и цену строками. */
  qty?: string | number | null
  price?: string | number | null
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Собирает все строки расчёта независимо от формы хранения. */
export function extractRows(surveyData: unknown): TreeRow[] {
  if (!isObj(surveyData)) return []
  const rows: TreeRow[] = []

  // Целевая форма.
  const tree = isObj(surveyData.tree) ? surveyData.tree : null
  const sections = asArray(tree?.sections ?? surveyData.sections)
  for (const s of sections) {
    if (!isObj(s)) continue
    // Раздел выключен целиком — строки в итог не входят.
    if (s.enabled === false) continue
    for (const c of asArray(s.components)) {
      if (!isObj(c) || c.enabled === false) continue
      for (const r of asArray(c.rows)) if (isObj(r)) rows.push(r as TreeRow)
    }
  }

  // Устаревшая форма.
  for (const b of asArray(surveyData.bundles)) {
    if (!isObj(b)) continue
    for (const g of asArray(b.groups)) {
      if (!isObj(g)) continue
      for (const sg of asArray(g.subgroups)) {
        if (!isObj(sg)) continue
        for (const r of asArray(sg.rows)) if (isObj(r)) rows.push(r as TreeRow)
      }
    }
  }

  return rows
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Строка «без цены»: нет ни каталожной, ни ручной цены (Механика §5.2).
 * Выключенные строки и строки с нулевым количеством не считаются проблемой —
 * они в итог не входят.
 */
export function isRowWithoutPrice(row: TreeRow): boolean {
  if (row.enabled === false) return false

  const price = row.priceManual ?? row.priceCatalog ?? num(row.price)
  if (price != null) return false

  // Нулевое количество: строка ничего не стоит и не блокирует проверку.
  const qty = row.qtyManual != null ? num(row.qtyManual) : (row.qtyCalc ?? num(row.qty))
  if (qty == null || qty === 0) return false

  return true
}

/** Строки без цены — они блокируют переход CALC → REVIEW (Механика §10). */
export function rowsWithoutPrice(surveyData: unknown): TreeRow[] {
  return extractRows(surveyData).filter(isRowWithoutPrice)
}
