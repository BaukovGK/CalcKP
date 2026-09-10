/**
 * Импорт прайса: разбор листа «НН», план изменений, проверка и выгрузка.
 * Книги собираются в памяти — БД тестам не нужна.
 */
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildPriceWorkbook, sortForExport, type ExportPriceItem } from './nn-export'
import { parseNnSheet } from './nn-sheet'
import { findPriceIssues, sheetAreaM2 } from './price-issues'
import { planImport, type ExistingPrice } from './price-import'

/** Лист в раскладке мастер-шаблона: A ключ, B группа, D наименование, F ЕИ, G…K. */
function nnSheet(rows: Array<Array<string | number | null>>, header = true): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('НН')
  if (header) {
    ws.addRow(['Для формул', 'Группа', 'Столбец1', 'Номенклатура', 'Для фильтра2', 'ЕИ', 'Цена без скидки', 'Валюта', 'Скидка, %', 'Цена, руб', 'Комментарии'])
  } else {
    ws.addRow([])
  }
  for (const r of rows) ws.addRow(r)
  return ws
}

const row = (category: string, name: string, unit: string, price: number | null, extra: Array<string | number | null> = []) =>
  [null, category, null, name, null, unit, price, 'руб', null, price, ...extra]

const db = (over: Partial<ExistingPrice> & Pick<ExistingPrice, 'name'>): ExistingPrice => ({
  id: over.name,
  category: 'Металлопрокат',
  unit: 'м',
  priceBaseRub: null,
  discountPct: null,
  currency: 'руб',
  priceRub: null,
  supplier: null,
  comment: null,
  ...over,
})

describe('parseNnSheet', () => {
  it('приводит наименования и сообщает, что исправлено', () => {
    const parsed = parseNnSheet(nnSheet([
      row('Металлопрокат ', 'Круг 5 мм 12Х18Н10Т ГOCT 5949-75', 'м', 125),
      row('Выключатели', '  ПОПЛАВКОВЫЙ ВЫКЛЮЧАТЕЛЬ  КАБЕЛЬ 10 М ', 'шт', 6000),
      row('Метизы', 'Гайка М24-7Н.Ст20 ГОСТ 5915-70 ', 'шт', 50),
    ]))
    expect(parsed.rows.map((r) => [r.category, r.name])).toEqual([
      ['Металлопрокат', 'Круг 5 мм 12Х18Н10Т ГОСТ 5949-75'],
      ['Выключатели', 'ПОПЛАВКОВЫЙ ВЫКЛЮЧАТЕЛЬ КАБЕЛЬ 10 М'],
      ['Метизы', 'Гайка М24-7Н.Ст20 ГОСТ 5915-70'],
    ])
    // Пробел по краям — не «исправление»: его обрезал и прежний импорт.
    expect(parsed.nameFixes.map((f) => f.sheetRow)).toEqual([2, 3])
    expect(parsed.columns).toBe('header')
  })

  it('повтор ключа: побеждает первая строка, обе цены — в отчёте', () => {
    const parsed = parseNnSheet(nnSheet([
      row('Металлопрокат', 'Швеллер 8-П ГОСТ 8240-97 ст3сп ГОСТ 535-2005', 'м', 732),
      row('Металлопрокат', 'Швеллер 8-П  ГОСТ 8240-97 ст3сп ГОСТ 535-2005', 'м', 930),
    ]))
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]!.priceRub).toBe(732)
    // Двойной пробел не спасает повтор: ключ сравнивается в каноническом виде.
    expect(parsed.duplicates).toEqual([
      expect.objectContaining({ sheetRow: 3, firstRow: 2, price: 930, firstPrice: 732 }),
    ])
  })

  it('без заголовков работает по номерам колонок мастер-шаблона', () => {
    const parsed = parseNnSheet(nnSheet([row('Метизы', 'Болт', 'шт', 10)], false))
    expect(parsed.columns).toBe('fixed')
    expect(parsed.rows[0]).toMatchObject({ category: 'Метизы', name: 'Болт', unit: 'шт', priceRub: 10 })
  })

  it('пустая ячейка цены — это «нет цены», а не ноль', () => {
    const parsed = parseNnSheet(nnSheet([[null, 'Метизы', null, 'Болт', null, 'шт', '', 'руб', null, '  ', null]]))
    expect(parsed.rows[0]!.priceRub).toBeNull()
    expect(parsed.rows[0]!.priceBaseRub).toBeNull()
  })

  it('строка с неполным ключом пропускается с причиной', () => {
    const parsed = parseNnSheet(nnSheet([row('Метизы', 'Болт', '', 10)]))
    expect(parsed.rows).toHaveLength(0)
    expect(parsed.skipped[0]!.reason).toContain('неполный ключ')
  })
})

describe('planImport', () => {
  const parse = (rows: Array<Array<string | number | null>>) => parseNnSheet(nnSheet(rows))

  it('новые, изменённые и прежние позиции считаются раздельно', () => {
    const plan = planImport(
      parse([
        row('Металлопрокат', 'Уголок', 'м', 900),
        row('Металлопрокат', 'Швеллер', 'м', 1000),
        row('Металлопрокат', 'Круг', 'м', 125),
      ]),
      [
        db({ name: 'Уголок', priceRub: 850, priceBaseRub: 850 }),
        db({ name: 'Круг', priceRub: 125, priceBaseRub: 125 }),
        db({ name: 'Насос', category: 'Насосы, АТМ', unit: 'шт' }),
      ],
    )
    expect(plan.changed).toEqual([expect.objectContaining({ name: 'Уголок', oldPrice: 850, newPrice: 900 })])
    expect(plan.created).toEqual([expect.objectContaining({ name: 'Швеллер', priceRub: 1000 })])
    expect(plan.unchanged).toBe(1)
    // Позиции, которых нет в файле (насос), не удаляются — только считаются.
    expect(plan.missingInFile).toBe(1)
    expect(plan.writes).toHaveLength(2)
  })

  // Пустая ячейка в файле закупок — «цену не знаю», а не «цены больше нет».
  it('пустая цена в файле не стирает цену базы', () => {
    const plan = planImport(parse([row('Металлопрокат', 'Уголок', 'м', null)]), [
      db({ name: 'Уголок', priceRub: 850, priceBaseRub: 850 }),
    ])
    expect(plan.changed).toEqual([])
    expect(plan.keptPrices).toEqual([expect.objectContaining({ name: 'Уголок', dbPrice: 850 })])
    expect(plan.writes).toEqual([])
  })

  it('поставщик из файла пишется, пустой — не стирает прежнего', () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('НН')
    ws.addRow(['Группа', 'Номенклатура', 'ЕИ', 'Цена, руб', 'Поставщик'])
    ws.addRow(['Металлопрокат', 'Уголок', 'м', 850, 'ООО «Сталь»'])
    ws.addRow(['Металлопрокат', 'Круг', 'м', 125, null])
    const parsed = parseNnSheet(ws)
    expect(parsed.columns).toBe('header')
    const plan = planImport(parsed, [
      db({ name: 'Уголок', priceRub: 850 }),
      db({ name: 'Круг', priceRub: 125, supplier: 'ИП Круглов' }),
    ])
    expect(plan.touched).toBe(1) // у уголка появился поставщик
    expect(plan.unchanged).toBe(1) // у круга пустая ячейка — поставщик остался
  })
})

describe('findPriceIssues', () => {
  const item = (name: string, unit: string, priceRub: number | null, priceBaseRub: number | null = priceRub) => ({
    category: 'Металлопрокат', name, unit, priceRub, priceBaseRub, discountPct: null,
  })

  it('площадь листа — из «толщина×ширина×длина» в наименовании', () => {
    expect(sheetAreaM2('Лист г/к Б-ПН-О-4,0х1500х3000 ГОСТ 19903-74')).toBe(4.5)
    expect(sheetAreaM2('Лист 2х1000х2000мм 12Х18Н10Т')).toBe(2)
    expect(sheetAreaM2('Уголок 50х50х5мм')).toBeNull()
  })

  it('находит отсутствующие и нулевые цены', () => {
    const issues = findPriceIssues([item('А', 'шт', null), item('Б', 'шт', 0), item('В', 'шт', 10)])
    expect(issues.map((i) => [i.index, i.kind])).toEqual([[0, 'no-price'], [1, 'zero-price']])
  })

  // «Таль ручная цепная»: 20 000 без скидки, 2 000 — цена, скидки нет.
  it('цена не сходится с ценой без скидки при пустой скидке', () => {
    const issues = findPriceIssues([item('Таль ручная цепная ТРШС 0,5т Н=12м', 'шт', 2000, 20000)])
    expect(issues[0]!.kind).toBe('base-mismatch')
  })

  it('лист за штуку и за м² расходятся в разы — опечатка; на 6 % — нет', () => {
    const issues = findPriceIssues([
      // 15 280 ₽ за лист 4,5 м² = 3 396 ₽/м², а за м² — 310,28: ошибка.
      item('Лист г/к Б-ПН-О-4,0х1500х3000', 'шт', 15280),
      item('Лист г/к Б-ПН-О-4,0х1500х3000', 'м²', 310.28),
      // 13 900 / 4,5 = 3 089 ₽/м² против 2 900: обычная разница.
      item('Лист г/к Б-ПН-О-3,0х1500х3000', 'шт', 13900),
      item('Лист г/к Б-ПН-О-3,0х1500х3000', 'м²', 2900),
    ])
    expect(issues.map((i) => [i.index, i.kind])).toEqual([[0, 'sheet-area']])
  })
})

describe('выгрузка прайса', () => {
  const items: ExportPriceItem[] = [
    { category: 'Метизы', name: 'Болт М10', unit: 'шт', priceRub: 24, priceBaseRub: 24, discountPct: null, currency: 'руб', supplier: 'ООО «Крепёж»', comment: null, updatedAt: new Date('2026-09-01') },
    { category: 'Метизы', name: 'Болт М6', unit: 'шт', priceRub: 6, priceBaseRub: 6, discountPct: null, currency: 'руб', supplier: null, comment: 'под заказ', updatedAt: new Date('2026-09-01') },
    { category: 'ФОТ', name: 'ФОТ', unit: 'чел. ч', priceRub: 1207.8, priceBaseRub: 1207.8, discountPct: null, currency: 'руб', supplier: null, comment: null, updatedAt: new Date('2026-09-01') },
    { category: 'Насосы, АТМ', name: 'Насос Vandjord VSL.50.11.2.5.0D', unit: 'шт', priceRub: null, priceBaseRub: null, discountPct: null, currency: 'руб', supplier: null, comment: null, updatedAt: new Date('2026-09-01') },
  ]

  it('порядок как в «НН»: ФОТ сверху, внутри категории числа по возрастанию', () => {
    expect(sortForExport(items).map((i) => i.name)).toEqual(['ФОТ', 'Болт М6', 'Болт М10', 'Насос Vandjord VSL.50.11.2.5.0D'])
  })

  it('выгрузка читается обратно тем же импортом без потерь', async () => {
    const wb = buildPriceWorkbook(items, { versionLabel: 'НН v2' })
    const buf = await wb.xlsx.writeBuffer()
    const back = new ExcelJS.Workbook()
    await back.xlsx.load(buf)

    const parsed = parseNnSheet(back.getWorksheet('НН')!)
    expect(parsed.columns).toBe('header')
    expect(parsed.rows.map((r) => [r.category, r.name, r.unit, r.priceRub, r.supplier ?? null, r.comment])).toEqual([
      ['ФОТ', 'ФОТ', 'чел. ч', 1207.8, null, null],
      ['Метизы', 'Болт М6', 'шт', 6, null, 'под заказ'],
      ['Метизы', 'Болт М10', 'шт', 24, 'ООО «Крепёж»', null],
      ['Насосы, АТМ', 'Насос Vandjord VSL.50.11.2.5.0D', 'шт', null, null, null],
    ])

    // Ключ VLOOKUP калькуляторов — формулой, как в листе мастер-шаблона.
    const a2 = back.getWorksheet('НН')!.getCell('A2').value as { formula: string }
    expect(a2.formula).toBe('B2&D2&F2')

    // Лист «Проверка»: насос без цены, со ссылкой на его строку в «НН».
    const chk = back.getWorksheet('Проверка')!
    expect(chk.getCell('A3').value).toBe(5)
    expect(String(chk.getCell('F3').value)).toContain('нет цены')
  })
})
