import type ExcelJS from 'exceljs'
import { z } from 'zod'
import { cellNum, cellStr } from './nn-sheet'

/**
 * Тарифы доставки — книга отдела закупок «Ставки доставки (руб/а/м с НДС)»
 * (квартальная, напр. «Книга 8 3 кв. 2026г.xlsx»).
 *
 * Раскладка листа:
 *   A № п/п   B Маршрут перевозки   C (год, пусто)
 *   D Ставка габаритный груз        E Ставка негабаритный груз разрешение
 *   F Ставка негабаритный груз сопровождение   G Примечание
 *
 * Колонки ищутся по заголовкам (закупщик мог вставить свою колонку); если
 * заголовков нет — работают буквы выше. «нет ставки» и пустая ячейка — null.
 */

export interface DeliveryRateRow {
  num: number | null
  city: string
  gabaritRub: number | null
  permitRub: number | null
  escortRub: number | null
  note: string | null
  sortOrder: number
}

export interface DeliveryParseResult {
  rows: DeliveryRateRow[]
  /** Строки, пропущенные с причиной: без маршрута, отрицательная ставка. */
  skipped: Array<{ sheetRow: number; reason: string }>
}

type Col = 'num' | 'city' | 'gabaritRub' | 'permitRub' | 'escortRub' | 'note'

/** Колонки книги закупок по умолчанию (1-based). */
export const DELIVERY_COLUMNS: Readonly<Record<Col, number>> = {
  num: 1,
  city: 2,
  gabaritRub: 4,
  permitRub: 5,
  escortRub: 6,
  note: 7,
}

/** Заголовок → колонка. Порядок проверок важен: «негабарит» содержит «габарит». */
function headerCol(text: string): Col | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ')
  if (t.includes('маршрут')) return 'city'
  if (t.includes('сопровожд')) return 'escortRub'
  if (t.includes('разрешен')) return 'permitRub'
  if (t.includes('габарит')) return 'gabaritRub'
  if (t.includes('примечан')) return 'note'
  if (t.startsWith('№')) return 'num'
  return null
}

/** Строка заголовков — первая из пяти, где есть «Маршрут». */
export function detectDeliveryColumns(ws: ExcelJS.Worksheet): { columns: Record<Col, number>; headerRow: number } {
  for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
    const found: Partial<Record<Col, number>> = {}
    ws.getRow(r).eachCell((cell, col) => {
      const key = headerCol(cellStr(cell))
      if (key && found[key] == null) found[key] = col
    })
    if (found.city != null) return { columns: { ...DELIVERY_COLUMNS, ...found }, headerRow: r }
  }
  return { columns: { ...DELIVERY_COLUMNS }, headerRow: 1 }
}

/** Ставка ячейки: число ≥ 0; «нет ставки», пусто, текст — null. */
function rate(cell: ExcelJS.Cell): number | null | 'negative' {
  const n = cellNum(cell)
  if (n == null) return null
  return n < 0 ? 'negative' : n
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Разбор листа тарифов. */
export function parseDeliverySheet(ws: ExcelJS.Worksheet): DeliveryParseResult {
  const { columns, headerRow } = detectDeliveryColumns(ws)
  const rows: DeliveryRateRow[] = []
  const skipped: DeliveryParseResult['skipped'] = []

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const city = clean(cellStr(row.getCell(columns.city)))
    if (!city) {
      // Пустая строка — не замечание; строка со ставками без маршрута — да.
      const hasData = [columns.gabaritRub, columns.permitRub, columns.escortRub].some((c) => cellNum(row.getCell(c)) != null)
      if (hasData) skipped.push({ sheetRow: r, reason: 'нет маршрута' })
      continue
    }
    const g = rate(row.getCell(columns.gabaritRub))
    const p = rate(row.getCell(columns.permitRub))
    const e = rate(row.getCell(columns.escortRub))
    if (g === 'negative' || p === 'negative' || e === 'negative') {
      skipped.push({ sheetRow: r, reason: 'отрицательная ставка' })
      continue
    }
    const num = cellNum(row.getCell(columns.num))
    const note = clean(cellStr(row.getCell(columns.note)))
    rows.push({
      num: num != null && Number.isInteger(num) ? num : null,
      city,
      gabaritRub: g,
      permitRub: p,
      escortRub: e,
      note: note || null,
      sortOrder: rows.length + 1,
    })
  }
  return { rows, skipped }
}

/** Тело создания и правки тарифа с экрана. */
const money = z.number().nonnegative().finite().nullable()
export const deliveryRateSchema = z.object({
  num: z.number().int().nullable().optional(),
  city: z.string().trim().min(1, 'Укажите маршрут').max(500),
  gabaritRub: money,
  permitRub: money,
  escortRub: money,
  note: z.string().trim().max(1000).nullable().optional(),
  sortOrder: z.number().int().optional(),
})
export const deliveryRatePatchSchema = deliveryRateSchema.partial()
