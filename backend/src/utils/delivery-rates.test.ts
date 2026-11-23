import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { deliveryRateSchema, parseDeliverySheet } from './delivery-rates'

/** Лист в раскладке книги закупок «Книга 8 3 кв. 2026г.». */
function sheet(rows: unknown[][]): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Перевозки')
  ws.addRow([
    '№ п/п', 'Маршрут перевозки', '2023г.',
    'Ставка габаритный груз (руб/ам с НДС)',
    'Ставка негабаритный груз разрешение (руб/ам с НДС)',
    'Ставка негабаритный груз сопровождение (руб/ам с НДС)',
    'Примечание',
  ])
  for (const r of rows) ws.addRow(r)
  return ws
}

describe('разбор книги тарифов доставки', () => {
  it('ставки, «нет ставки» и примечание', () => {
    const { rows, skipped } = parseDeliverySheet(sheet([
      [1, 'Москва', null, 65450, 150000, 157000, 'негабарит 3,5*4,5'],
      [4, 'Тюмень ', null, 535000, 'нет ставки', 'нет ставки', 'только с Разрешением'],
      [null, null, null, null, null, null, null],
      [118, 'Покровское  -  Стрешнево', null, 'нет ставки', 210000, 'нет ставки', null],
    ]))
    expect(skipped).toEqual([])
    expect(rows).toEqual([
      { num: 1, city: 'Москва', gabaritRub: 65450, permitRub: 150000, escortRub: 157000, note: 'негабарит 3,5*4,5', sortOrder: 1 },
      { num: 4, city: 'Тюмень', gabaritRub: 535000, permitRub: null, escortRub: null, note: 'только с Разрешением', sortOrder: 2 },
      { num: 118, city: 'Покровское - Стрешнево', gabaritRub: null, permitRub: 210000, escortRub: null, note: null, sortOrder: 3 },
    ])
  })

  it('колонки — по заголовкам, даже если закупщик вставил свою', () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Лист1')
    ws.addRow(['Маршрут перевозки', 'Комментарий закупки', 'Ставка негабаритный груз сопровождение', 'Ставка габаритный груз', 'Ставка негабаритный груз разрешение', 'Примечание'])
    ws.addRow(['Тула', 'x', 185000, 115000, 165500, null])
    expect(parseDeliverySheet(ws).rows[0]).toMatchObject({ city: 'Тула', gabaritRub: 115000, permitRub: 165500, escortRub: 185000 })
  })

  it('ставка без маршрута и отрицательная — пропуск с причиной', () => {
    const { rows, skipped } = parseDeliverySheet(sheet([
      [5, null, null, 1000, null, null, null],
      [6, 'Тула', null, -1, null, null, null],
    ]))
    expect(rows).toEqual([])
    expect(skipped).toEqual([
      { sheetRow: 2, reason: 'нет маршрута' },
      { sheetRow: 3, reason: 'отрицательная ставка' },
    ])
  })

  it('тело запроса: маршрут обязателен, ставка неотрицательна или null', () => {
    expect(deliveryRateSchema.safeParse({ city: ' ', gabaritRub: 1, permitRub: null, escortRub: null }).success).toBe(false)
    expect(deliveryRateSchema.safeParse({ city: 'Тула', gabaritRub: -5, permitRub: null, escortRub: null }).success).toBe(false)
    expect(deliveryRateSchema.safeParse({ city: 'Тула', gabaritRub: 115000, permitRub: null, escortRub: null }).success).toBe(true)
  })
})
