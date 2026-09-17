/**
 * Печатная форма КП собирается и открывается: docx — zip с документом, PDF —
 * настоящий PDF с кириллицей, xlsx — книга, которую можно прочитать обратно.
 *
 * Вёрстку docx и PDF эти тесты не проверяют (для этого её надо смотреть
 * глазами), но ловят то, что ломается молча: несобираемый документ, пустой
 * буфер, потерю шрифта с кириллицей. У xlsx проверяется и раскладка: книга
 * читается обратно, и видно, что в каких ячейках лежит.
 */
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildKpDocument, type KpDocumentInput } from './kp-document'
import { renderKpDocx } from './kp-docx'
import { renderKpPdf } from './kp-pdf'
import { renderKpXlsx } from './kp-xlsx'

/** Опросный лист КНС — как его сохраняет экран ОЛ. */
const survey = {
  totals: { tirage: 2, salePriceRub: 2_400_000 },
  form: {
    tipNs: 'Канализационная',
    dn: '3000',
    vozv: '300',
    mvk: true,
    insulation: true,
    tiGlubina: '2000',
    podvDn: '250',
    podvKol: '1',
    napDn: '150',
    napKol: '2',
    rashod: '25,13',
    rashodUnit: 'l/s',
    napor: '12,9',
    nRab: '2',
    nRez: '1',
    nZap: '0',
    drobilka: 'корзина',
    shu: true,
    shuTip: 'уличный',
    shuPusk: 'плавный',
    datchikiDavl: true,
    datchikiUrov: true,
    rashodomer: true,
  },
  derived: {
    npodzMm: 11600,
    fullHeightMm: 11900,
    sn: 10000,
    pn: 0.1,
    gates: 1,
    balls: 3,
    checkValves: 2,
    pumpModel: 'VSL.100.55.4.5.0D',
  },
}

const input: KpDocumentInput = {
  estimateId: '1a2b3c4d-0000-0000-0000-000000000000',
  estimateTitle: 'КНС 3 000×11 900 мм',
  deviceType: 'KNS',
  wallMm: 55.1,
  number: 'КП-0042',
  project: { title: 'Очистные сооружения', customer: 'ООО «Заказчик»', address: 'г. Москва' },
  signature: { signerName: 'И.О. Фамилия' },
  executor: { name: 'П.П. Петров', email: 'petrov@example.test' },
  snapshot: {
    version: 3,
    priceListVersion: 5,
    totalRub: 2_400_000,
    createdAt: new Date('2026-09-17T09:00:00Z'),
    bundlesJson: survey,
  },
}

describe('печать КП', () => {
  const doc = buildKpDocument(input)

  it('позиция несёт описание изделия, количество, цену и сумму', () => {
    const position = doc.positions[0]!

    expect(position.description).toContain('Стеклокомпозитная канализационная насосная станция')
    expect(position.description).toContain('SN12000') // обозначение по ТТ МВК
    expect(position.description).toContain('В комплекте:')
    expect(position.qty).toBe(2)
    expect(position.priceRub).toBe(1_200_000)
    expect(position.totalRub).toBe(2_400_000)
  })

  it('docx собирается и остаётся документом Word', async () => {
    const body = await renderKpDocx(doc)

    expect(body.length).toBeGreaterThan(5_000)
    // Сигнатура zip: .docx — это архив с word/document.xml внутри.
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('PDF собирается и открывается', async () => {
    const body = await renderKpPdf(doc)

    expect(body.length).toBeGreaterThan(5_000)
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(body.subarray(-6).toString('latin1')).toContain('EOF')
  })

  it('xlsx собирается и читается обратно книгой', async () => {
    const ws = await sheetOf(doc)

    expect(ws.name).toBe('КП')
    // Документ живёт в B…G: колонка A — служебный отступ образца.
    expect(ws.getColumn(1).width).toBeLessThan(4)
    expect(ws.getColumn(3).width).toBeGreaterThan(50) // наименование — самая широкая
  })

  it('шапка таблицы — подписи колонок образца', async () => {
    const ws = await sheetOf(doc)
    const head = headRow(ws)

    expect(row(ws, head)).toEqual([
      '№',
      'Наименование номенклатуры',
      'Кол-во',
      'Ед. изм.',
      'Цена, руб.',
      'Сумма, руб.',
    ])
  })

  it('строка позиции: номер текстом, количество, цена и сумма числами', async () => {
    const ws = await sheetOf(doc)
    const at = headRow(ws) + 1
    const cells = ws.getRow(at)

    expect(cells.getCell(2).value).toBe('1.1')
    // Номер — текст: числом Excel показал бы «1,1».
    expect(cells.getCell(2).numFmt).toBe('@')
    expect(String(cells.getCell(3).value)).toContain('В комплекте:')
    expect(cells.getCell(3).alignment?.wrapText).toBe(true)
    expect(cells.getCell(4).value).toBe(2)
    expect(cells.getCell(5).value).toBe('компл.')
    expect(cells.getCell(6).value).toBe(1_200_000)
    expect(cells.getCell(7).value).toBe(2_400_000)
    expect(cells.getCell(7).numFmt).toBe('# ##0.00')
  })

  it('итог — формулой СУММ по колонке сумм, и она сходится со снапшотом', async () => {
    const ws = await sheetOf(doc)
    const at = rowWith(ws, 'Общая сумма:')
    const cells = ws.getRow(at)

    const total = cells.getCell(7).value as { formula: string; result: number }
    expect(total.formula).toMatch(/^SUM\(G\d+:G\d+\)$/)
    // Значение в ячейке — точная сумма снапшота, а не произведение округлённой
    // цены на количество.
    expect(total.result).toBe(doc.totalRub)
  })

  it('длинное описание растягивается на объединённые строки, а не режется', async () => {
    const ws = await sheetOf(doc)
    const at = headRow(ws) + 1
    const used = rowWith(ws, 'Общая сумма:') - at

    // Описание КНС — под две тысячи знаков, в 409 пт высоты строки оно не
    // влезает: позиция занимает несколько строк листа, как в образце.
    expect(used).toBeGreaterThan(1)
    // Текст при этом целый и лежит в одной ячейке — границы посередине нет.
    expect(String(ws.getCell(`C${at}`).value)).toBe(doc.positions[0]!.description)

    for (let c = 2; c <= 7; c++) {
      const cell = ws.getRow(at + 1).getCell(c)
      expect(cell.isMerged).toBe(true)
      expect(cell.master.row).toBe(at)
    }

    // Ни одна строка не выходит за предел высоты, а вместе они вмещают текст.
    let sum = 0
    for (let i = 0; i < used; i++) {
      const h = ws.getRow(at + i).height
      expect(h).toBeLessThanOrEqual(409)
      sum += h
    }
    expect(sum).toBeGreaterThan(409)
  })

  it('условия печатаются девятью пунктами', async () => {
    const ws = await sheetOf(doc)
    const numbered: string[] = []
    ws.eachRow((r) => {
      const v = r.getCell(2).value
      if (typeof v === 'string' && /^[1-9]\. /.test(v)) numbered.push(v)
    })

    expect(numbered).toHaveLength(9)
    expect(numbered[0]).toContain('НДС 22 %')
    expect(numbered[2]).toContain('ГОСТ Р 54560-2015')
  })

  it('лист готов к печати: A4, подгонка по ширине, без сетки', async () => {
    const ws = await sheetOf(doc)

    expect(ws.pageSetup.orientation).toBe('portrait')
    expect(ws.pageSetup.fitToWidth).toBe(1)
    expect(ws.pageSetup.fitToHeight).toBe(0)
    // Служебных колонок правее G на печать не выходит.
    expect(ws.pageSetup.printArea).toMatch(/^A1:G\d+$/)
    expect(ws.views[0]?.showGridLines).toBe(false)
  })
})

/** Книгу читаем обратно тем же ExcelJS: так виден результат, а не намерение. */
async function sheetOf(doc: Parameters<typeof renderKpXlsx>[0]): Promise<ExcelJS.Worksheet> {
  const body = await renderKpXlsx(doc)
  expect(body.subarray(0, 2).toString('latin1')).toBe('PK')

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(body)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('в книге нет листов')
  return ws
}

/** Номер строки с шапкой таблицы. */
function headRow(ws: ExcelJS.Worksheet): number {
  return rowWith(ws, '№')
}

/** Номер первой строки, у которой в колонке B ровно такой текст. */
function rowWith(ws: ExcelJS.Worksheet, text: string): number {
  let at = 0
  ws.eachRow((r, i) => {
    if (at === 0 && r.getCell(2).value === text) at = i
  })
  if (at === 0) throw new Error(`строка «${text}» не найдена`)
  return at
}

/** Колонки B…G строки значениями. */
function row(ws: ExcelJS.Worksheet, at: number): unknown[] {
  const r = ws.getRow(at)
  return [2, 3, 4, 5, 6, 7].map((c) => r.getCell(c).value)
}
