import type ExcelJS from 'exceljs'
import { normalizePriceName, normalizePriceText } from './price-name'

/**
 * Разбор листа «НН» (прайс) — книги мастер-шаблона, книги отдела закупок или
 * выгрузки из самого приложения (`GET /api/prices/export`).
 *
 * Единственное место, где зафиксировано соответствие колонок: им пользуются
 * импорт (`POST /api/prices/import`), консольный импорт
 * (`tools/import-prices`) и экстрактор сидов (`tools/extract-refs`).
 *
 * Колонки ищутся по заголовкам первой строки: выгрузка добавляет
 * «Поставщик», а закупщик мог вставить свою колонку — жёсткие номера тогда
 * съехали бы. Если заголовков нет, работают номера листа мастер-шаблона
 * (Реверс §9.1):
 *   A ключ (формула)  B Группа        D Номенклатура   F ЕИ
 *   G Цена без скидки H Валюта        I Скидка, %      J Цена, руб  ← её тянет VLOOKUP
 *   K Комментарии     L/M курсы (не используются)
 *
 * Наименования, категории и ЕИ приводятся к каноническому виду
 * (utils/price-name.ts) — дубли и совпадения ищутся уже по нему.
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

/** Заголовки колонок — те же, что в листе мастер-шаблона и в выгрузке. */
export const NN_HEADERS = {
  category: 'Группа',
  name: 'Номенклатура',
  unit: 'ЕИ',
  priceBaseRub: 'Цена без скидки',
  currency: 'Валюта',
  discountPct: 'Скидка, %',
  priceRub: 'Цена, руб',
  comment: 'Комментарии',
  supplier: 'Поставщик',
} as const

type ColumnKey = keyof typeof NN_HEADERS
export type NnColumns = Record<Exclude<ColumnKey, 'supplier'>, number> & { supplier: number | null }

export interface NnRow {
  category: string
  name: string
  unit: string
  priceBaseRub: number | null
  discountPct: number | null
  currency: string
  priceRub: number | null
  comment: string | null
  /**
   * Поставщик: `undefined` — колонки в листе нет (лист мастер-шаблона), и
   * импорт поставщика не трогает; `null` — колонка есть, ячейка пуста.
   */
  supplier?: string | null
  /** Номер строки в листе — для внятных сообщений об ошибках. */
  sheetRow: number
}

export interface NnDuplicate {
  sheetRow: number
  key: string
  firstRow: number
  /** Цена повтора и цена первой строки: разные — это вопрос к закупкам. */
  price: number | null
  firstPrice: number | null
}

export interface NnParseResult {
  rows: NnRow[]
  /** Строки, пропущенные из-за неполного ключа или запрещённого символа. */
  skipped: Array<{ sheetRow: number; reason: string }>
  /** Дубли ключа (категория, наименование, ЕИ): побеждает первая — как VLOOKUP. */
  duplicates: NnDuplicate[]
  /**
   * Наименования, исправленные нормализацией сверх обрезки пробелов по
   * краям: двойные и неразрывные пробелы, латиница на месте кириллицы.
   */
  nameFixes: Array<{ sheetRow: number; from: string; to: string }>
  /** Как найдены колонки: по заголовкам или по номерам мастер-шаблона. */
  columns: 'header' | 'fixed'
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

/** Текст ячейки как есть — без обрезки: её делает нормализация. */
function cellRaw(cell: ExcelJS.Cell): string {
  const v = raw(cell)
  return v == null ? '' : String(v)
}

export function cellStr(cell: ExcelJS.Cell): string {
  return cellRaw(cell).trim()
}

export function cellNum(cell: ExcelJS.Cell): number | null {
  const v = raw(cell)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    // В книге встречаются числа строкой с запятой-разделителем («0,193 »).
    const n = Number(v.replace(/\s/g, '').replace(',', '.'))
    return v.trim() !== '' && Number.isFinite(n) ? n : null
  }
  return null
}

/** Ключ прайса — тройка (категория, наименование, ЕИ): VLOOKUP(C&D&K,…). */
export const lookupKeyOf = (category: string, name: string, unit: string): string =>
  `${category}:${name}:${unit}`

const headerKey = (s: string) => normalizePriceText(s).toLowerCase()

/**
 * Колонки листа: по заголовкам первой строки, если нашлись обязательные
 * (группа, номенклатура, ЕИ, цена), иначе — номера мастер-шаблона.
 */
export function detectColumns(ws: ExcelJS.Worksheet): { columns: NnColumns; mode: 'header' | 'fixed' } {
  const wanted = new Map(Object.entries(NN_HEADERS).map(([k, h]) => [headerKey(h), k as ColumnKey]))
  const found: Partial<Record<ColumnKey, number>> = {}
  ws.getRow(1).eachCell((cell, col) => {
    const key = wanted.get(headerKey(cellRaw(cell)))
    if (key && found[key] == null) found[key] = col
  })

  const required: ColumnKey[] = ['category', 'name', 'unit', 'priceRub']
  if (required.every((k) => found[k] != null)) {
    return {
      mode: 'header',
      columns: {
        category: found.category!,
        name: found.name!,
        unit: found.unit!,
        priceRub: found.priceRub!,
        priceBaseRub: found.priceBaseRub ?? 0,
        currency: found.currency ?? 0,
        discountPct: found.discountPct ?? 0,
        comment: found.comment ?? 0,
        supplier: found.supplier ?? null,
      },
    }
  }
  return { mode: 'fixed', columns: { ...NN_COLUMNS, supplier: null } }
}

export function parseNnSheet(ws: ExcelJS.Worksheet): NnParseResult {
  const rows: NnRow[] = []
  const skipped: NnParseResult['skipped'] = []
  const duplicates: NnDuplicate[] = []
  const nameFixes: NnParseResult['nameFixes'] = []
  const seen = new Map<string, NnRow>()
  const { columns, mode } = detectColumns(ws)
  // Колонка 0 — «нет такой колонки»: у ExcelJS нумерация с единицы.
  const at = (row: ExcelJS.Row, col: number) => (col > 0 ? row.getCell(col) : null)

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const rawName = cellRaw(row.getCell(columns.name))
    const category = normalizePriceText(cellRaw(row.getCell(columns.category)))
    const name = normalizePriceName(rawName)
    const unit = normalizePriceText(cellRaw(row.getCell(columns.unit)))

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

    if (name !== rawName.trim()) nameFixes.push({ sheetRow: r, from: rawName.trim(), to: name })

    const priceCell = at(row, columns.priceRub)
    const priceRub = priceCell ? cellNum(priceCell) : null
    const key = lookupKeyOf(category, name, unit)
    const first = seen.get(key)
    if (first) {
      duplicates.push({ sheetRow: r, key, firstRow: first.sheetRow, price: priceRub, firstPrice: first.priceRub })
      continue
    }

    const baseCell = at(row, columns.priceBaseRub)
    const discountCell = at(row, columns.discountPct)
    const currencyCell = at(row, columns.currency)
    const commentCell = at(row, columns.comment)
    const supplierCell = columns.supplier != null ? row.getCell(columns.supplier) : null

    const parsed: NnRow = {
      category,
      name,
      unit,
      priceBaseRub: baseCell ? cellNum(baseCell) : null,
      discountPct: discountCell ? cellNum(discountCell) : null,
      currency: (currencyCell ? normalizePriceText(cellRaw(currencyCell)) : '') || 'руб',
      priceRub,
      comment: (commentCell ? normalizePriceText(cellRaw(commentCell)) : '') || null,
      sheetRow: r,
    }
    if (supplierCell) parsed.supplier = normalizePriceText(cellRaw(supplierCell)) || null
    seen.set(key, parsed)
    rows.push(parsed)
  }

  return { rows, skipped, duplicates, nameFixes, columns: mode }
}
