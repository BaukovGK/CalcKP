/**
 * Доставка отдельной строкой КП (раздел «2»): есть, когда пункт условий
 * говорит «стоимость включает доставку», и сумма доставки посчитана в ОЛ.
 */
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildKpDocument, buildProjectKpDocument, tableLines, type KpDocumentInput } from './kp-document'
import { renderKpXlsx } from './kp-xlsx'

const surveyWith = (delivery: Record<string, unknown> | null, form: Record<string, unknown> = {}) => ({
  form: { dn: '2600', ...form },
  ...(delivery ? { delivery } : {}),
})

const unit = (bundlesJson: unknown, over: Partial<KpDocumentInput> = {}): KpDocumentInput => ({
  estimateId: 'e1',
  estimateTitle: 'КНС 2 600×11 000 мм',
  deviceType: 'KNS',
  project: { title: 'Тест', customer: 'Заказчик', address: 'г. Москва' },
  snapshot: { version: 1, priceListVersion: 1, totalRub: 6_569_600, createdAt: new Date('2026-11-17T10:00:00Z'), bundlesJson },
  ...over,
})

describe('КП: строка доставки', () => {
  it('доставка по тарифам — строка 2.1, сумма КП с доставкой', () => {
    const doc = buildKpDocument(unit(surveyWith({ city: 'Москва', costRub: 287_900, manualRub: null })))
    expect(doc.delivery).toEqual([
      { number: '2.1', description: 'Доставка со склада поставщика до г. Москва', qty: 1, unit: 'усл.', priceRub: 287_900, totalRub: 287_900 },
    ])
    expect(doc.totalRub).toBe(6_569_600 + 287_900)
    expect(doc.vatRub).toBeCloseTo(((6_569_600 + 287_900) * 22) / 122, 2)
    expect(tableLines(doc).map((l) => l.number)).toEqual(['1.1', '2.1'])
  })

  it('своя сумма и адрес — до адреса', () => {
    const doc = buildKpDocument(
      unit(surveyWith({ city: 'Москва', costRub: 700_000, manualRub: 700_000 }, { deliveryAddress: 'г. Колпино, ул. Заводская, 5' })),
    )
    expect(doc.delivery[0]?.description).toBe('Доставка со склада поставщика до г. Колпино, ул. Заводская, 5')
    expect(doc.totalRub).toBe(7_269_600)
  })

  it('менеджер отметил «не входит» в окне выпуска — строки нет, сумма без доставки', () => {
    const doc = buildKpDocument(
      unit(surveyWith({ city: 'Москва', costRub: 287_900, manualRub: null }), { terms: { deliveryIncluded: false } }),
    )
    expect(doc.delivery).toEqual([])
    expect(doc.totalRub).toBe(6_569_600)
  })

  it('город не выбран — строки нет', () => {
    const doc = buildKpDocument(unit(surveyWith({ city: null, costRub: null, manualRub: null })))
    expect(doc.delivery).toEqual([])
    expect(doc.terms.deliveryIncluded).toBe(false)
  })

  it('КП, выпущенное до раздела «Доставка», — без строки и прежней суммой', () => {
    const doc = buildKpDocument(unit(surveyWith(null), { terms: { deliveryTo: 'Тест, г. Москва' } }))
    expect(doc.delivery).toEqual([])
    expect(doc.terms.deliveryIncluded).toBeNull()
    expect(doc.totalRub).toBe(6_569_600)
  })

  it('КП на проект — строка доставки на каждую единицу с доставкой, с названием единицы', () => {
    const a = unit(surveyWith({ city: 'Москва', costRub: 100_000, manualRub: null }))
    const b = unit(surveyWith({ city: 'Москва', costRub: 50_000, manualRub: null }), { estimateId: 'e2', estimateTitle: 'КНС 2' })
    const doc = buildProjectKpDocument({ projectId: 'p1', project: a.project, units: [a, b] })
    expect(doc.delivery.map((l) => [l.number, l.description, l.totalRub])).toEqual([
      ['2.1', 'Доставка (КНС 2 600×11 000 мм) со склада поставщика до г. Москва', 100_000],
      ['2.2', 'Доставка (КНС 2) со склада поставщика до г. Москва', 50_000],
    ])
    expect(doc.totalRub).toBe(2 * 6_569_600 + 150_000)
  })

  it('xlsx: строка доставки в таблице и в формуле общей суммы', async () => {
    const doc = buildKpDocument(unit(surveyWith({ city: 'Москва', costRub: 287_900, manualRub: null })))
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await renderKpXlsx(doc))
    const ws = wb.worksheets[0]!
    let deliveryRow = 0
    ws.eachRow((row, n) => { if (String(row.getCell(3).value ?? '').startsWith('Доставка со склада')) deliveryRow = n })
    expect(deliveryRow).toBeGreaterThan(0)
    expect(ws.getRow(deliveryRow).getCell(2).value).toBe('2.1')
    expect(ws.getRow(deliveryRow).getCell(7).value).toBe(287_900)
    let total: ExcelJS.CellFormulaValue | null = null
    ws.eachRow((row) => { if (row.getCell(2).value === 'Общая сумма:') total = row.getCell(7).value as ExcelJS.CellFormulaValue })
    expect(total).not.toBeNull()
    expect(total!.result).toBe(6_569_600 + 287_900)
    expect(total!.formula.endsWith(`:G${deliveryRow})`)).toBe(true)
  })
})
