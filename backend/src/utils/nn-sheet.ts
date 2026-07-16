import type ExcelJS from 'exceljs'

/**
 * Разбор листа «НН» (прайс) из книги мастер-шаблона.
 *
 * Единственное место, где зафиксировано соответствие колонок — им пользуются и
 * импорт (`POST /api/prices/import`), и экстрактор сидов (`tools/extract-refs`).
 *
 * Колонки (проверено по шапке листа, Реверс §9.1):
 *   A ключ (формула)  B Группа        D Номенклатура   F ЕИ
 *   G Цена без скидки H Валюта        I Скидка, %      J Цена, руб  ← её тянет VLOOKUP
 *   K Комментарии     L/M курсы (не используются)
 *
 * Колонки «Поставщик» в листе нет — при импорте supplier не заполняется.
 */

export const NN_COLUMNS = {
  category: 2,
  name: 4,
  unit: 6,
  priceBaseRub: 7,
  currency: 8,
  discountPct: 9,
  priceRub: 10,
  comment: 11,
} as const

export interface NnRow {
  category: string
  name: string
  unit: string
  priceBaseRub: number | null
  discountPct: number | null
  currency: string
  priceRub: number | null
  comment: string | null
  /** Номер строки в листе — для внятных сообщений об ошибках. */
  sheetRow: number
}

export interface NnParseResult {
  rows: NnRow[]
  /** Строки, пропущенные из-за неполного ключа или запрещённого символа. */
  skipped: Array<{ sheetRow: number; reason: string }>
  /** Дубли ключа (категория, наименование, ЕИ): побеждает первая — как VLOOKUP. */
  duplicates: Array<{ sheetRow: number; key: string; firstRow: number }>
}

function raw(cell: ExcelJS.Cell): unknown {
  const v = cell?.value
  if (v == null) return null
  if (typeof v === 'object') {
    if ('result' in v) return (v as { result: unknown }).result
    if ('richText' in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('')
    if ('text' in v) return (v as { text: string }).text
    return null
  }
  return v
}

export function cellStr(cell: ExcelJS.Cell): string {
  const v = raw(cell)
  return v == null ? '' : String(v).trim()
}

export function cellNum(cell: ExcelJS.Cell): number | null {
  const v = raw(cell)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    // В книге встречаются числа строкой с запятой-разделителем («0,193 »).
    const n = Number(v.replace(/\s/g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Ключ прайса — тройка (категория, наименование, ЕИ): VLOOKUP(C&D&K,…). */
export const lookupKeyOf = (category: string, name: string, unit: string): string =>
  `${category}:${name}:${unit}`

export function parseNnSheet(ws: ExcelJS.Worksheet): NnParseResult {
  const rows: NnRow[] = []
  const skipped: NnParseResult['skipped'] = []
  const duplicates: NnParseResult['duplicates'] = []
  const seen = new Map<string, number>()

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const category = cellStr(row.getCell(NN_COLUMNS.category))
    const name = cellStr(row.getCell(NN_COLUMNS.name))
    const unit = cellStr(row.getCell(NN_COLUMNS.unit))

    if (!category || !name || !unit) {
      // Неполный ключ — позиция недостижима и в самом Excel: VLOOKUP по
      // склейке «категория+наименование+ЕИ» не совпадёт ни с чем.
      if (category || name || unit) {
        skipped.push({ sheetRow: r, reason: `неполный ключ (категория/наименование/ЕИ): «${category}»/«${name}»/«${unit}»` })
      }
      continue
    }

    // Символ «~» запрещён в наименованиях (наследие VLOOKUP, ТЗ §9.8).
    if (name.includes('~')) {
      skipped.push({ sheetRow: r, reason: `символ «~» в наименовании: ${name}` })
      continue
    }

    const key = lookupKeyOf(category, name, unit)
    const first = seen.get(key)
    if (first != null) {
      duplicates.push({ sheetRow: r, key, firstRow: first })
      continue
    }
    seen.set(key, r)

    rows.push({
      category,
      name,
      unit,
      priceBaseRub: cellNum(row.getCell(NN_COLUMNS.priceBaseRub)),
      discountPct: cellNum(row.getCell(NN_COLUMNS.discountPct)),
      currency: cellStr(row.getCell(NN_COLUMNS.currency)) || 'руб',
      priceRub: cellNum(row.getCell(NN_COLUMNS.priceRub)),
      comment: cellStr(row.getCell(NN_COLUMNS.comment)) || null,
      sheetRow: r,
    })
  }

  return { rows, skipped, duplicates }
}
