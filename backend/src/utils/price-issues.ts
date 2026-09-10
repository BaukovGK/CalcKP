/**
 * Проверка прайса: позиции, на которые стоит посмотреть закупкам.
 *
 * Только то, что определяется по самим данным и почти не даёт ложных
 * срабатываний:
 *  - нет цены — такая строка в расчёте «красная» и блокирует КП;
 *  - цена ноль;
 *  - цена не сходится с ценой без скидки при пустой скидке — в листе «НН»
 *    так выглядит опечатка при вводе («Таль» — 20 000 без скидки, 2 000 цена);
 *  - лист, у которого есть цена и за штуку, и за м², а они расходятся больше
 *    чем на 40 % после пересчёта по площади из наименования («4,0х1500х3000»).
 *    Порог выбран так, чтобы разница «целый лист против раскроя» (обычно
 *    до 30 %) не срабатывала, а опечатки в разы — срабатывали.
 */

export interface PriceIssueInput {
  category: string
  name: string
  unit: string
  priceRub: number | null
  priceBaseRub: number | null
  discountPct: number | null
}

export type PriceIssueKind = 'no-price' | 'zero-price' | 'base-mismatch' | 'sheet-area'

export interface PriceIssue {
  /** Номер позиции во входном массиве. */
  index: number
  kind: PriceIssueKind
  message: string
}

/** Порог расхождения цены листа и цены за м², доля. */
export const SHEET_AREA_TOLERANCE = 0.4

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

/** Площадь листа, м², из «толщина×ширина×длина» в наименовании; `null` — не нашлась. */
export function sheetAreaM2(name: string): number | null {
  const m = name.match(/\d+(?:[.,]\d+)?\s*[хx×]\s*(\d{3,4})\s*[хx×]\s*(\d{3,4})/)
  if (!m) return null
  const area = (Number(m[1]) * Number(m[2])) / 1e6
  return area > 0 ? area : null
}

export function findPriceIssues(items: PriceIssueInput[]): PriceIssue[] {
  const out: PriceIssue[] = []
  const perM2 = new Map<string, number>()
  items.forEach((p) => {
    if (p.unit === 'м²' && p.priceRub != null && p.priceRub > 0) perM2.set(`${p.category}|${p.name}`, p.priceRub)
  })

  items.forEach((p, index) => {
    if (p.priceRub == null) {
      out.push({ index, kind: 'no-price', message: 'нет цены — строка в расчёте «красная», КП не выпустить' })
      return
    }
    if (p.priceRub === 0) {
      out.push({ index, kind: 'zero-price', message: 'цена 0' })
      return
    }

    if (p.priceBaseRub != null && p.priceBaseRub > 0) {
      const discount = p.discountPct ?? 0
      const expected = p.priceBaseRub * (1 - discount / 100)
      if (Math.abs(expected - p.priceRub) > Math.max(0.01, expected * 0.01)) {
        out.push({
          index,
          kind: 'base-mismatch',
          message: discount
            ? `цена ${fmt(p.priceRub)} не сходится с ценой без скидки ${fmt(p.priceBaseRub)} при скидке ${fmt(discount)} %`
            : `цена ${fmt(p.priceRub)} не равна цене без скидки ${fmt(p.priceBaseRub)}, а скидка не указана`,
        })
      }
    }

    if (p.unit === 'шт') {
      const m2 = perM2.get(`${p.category}|${p.name}`)
      const area = sheetAreaM2(p.name)
      if (m2 != null && area != null) {
        const sheetPerM2 = p.priceRub / area
        const diff = Math.abs(sheetPerM2 - m2) / Math.min(sheetPerM2, m2)
        if (diff > SHEET_AREA_TOLERANCE) {
          out.push({
            index,
            kind: 'sheet-area',
            message:
              `лист ${fmt(p.priceRub)} ₽ при площади ${fmt(area)} м² — это ${fmt(Math.round(sheetPerM2))} ₽/м², ` +
              `а цена за м² ${fmt(m2)} ₽: одна из двух цен, похоже, с ошибкой`,
          })
        }
      }
    }
  })
  return out
}
