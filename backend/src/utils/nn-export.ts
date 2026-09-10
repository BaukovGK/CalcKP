import ExcelJS from 'exceljs'
import { NN_HEADERS } from './nn-sheet'
import { findPriceIssues, type PriceIssueInput } from './price-issues'

/**
 * Выгрузка прайса в книгу с листом «НН» — в раскладке листа мастер-шаблона.
 *
 * Раскладка та же, чтобы выгрузку можно было:
 *  - вставить в свою книгу закупок поверх листа «НН» — колонки A…K совпадут,
 *    и формулы калькуляторов (VLOOKUP по колонке A) продолжат работать;
 *  - поправить и загрузить обратно тем же импортом: разбор ищет колонки по
 *    заголовкам, поэтому лишние колонки справа ему не мешают.
 *
 * Справа к листу добавлены «Поставщик» (его в «НН» нет, а в приложении он
 * ведётся; импорт читает его обратно) и «Обновлено» — только для сведения.
 *
 * Второй лист, «Проверка», — позиции, на которые стоит посмотреть
 * (utils/price-issues.ts), со ссылкой на строку листа «НН».
 */

export interface ExportPriceItem extends PriceIssueInput {
  currency: string
  supplier: string | null
  comment: string | null
  updatedAt: Date
}

/** Порядок категорий — как в листе «НН»: ставки и своё производство сверху. */
const FIRST_CATEGORIES = ['ФОТ', 'Собственное производство']

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })

/**
 * Порядок строк выгрузки. Внутри категории — по наименованию с учётом чисел:
 * «Болт М6», «Болт М8», «Болт М10», а не «М10», «М6», «М8».
 */
export function sortForExport<T extends { category: string; name: string; unit: string }>(items: T[]): T[] {
  const rank = (c: string) => {
    const i = FIRST_CATEGORIES.indexOf(c)
    return i === -1 ? FIRST_CATEGORIES.length : i
  }
  return [...items].sort(
    (a, b) =>
      rank(a.category) - rank(b.category) ||
      collator.compare(a.category, b.category) ||
      collator.compare(a.name, b.name) ||
      collator.compare(a.unit, b.unit),
  )
}

/** Колонки листа «НН» выгрузки: заголовок, ширина, откуда значение. */
const COLUMNS = [
  { header: 'Для формул', width: 14 },
  { header: NN_HEADERS.category, width: 24 },
  { header: 'Столбец1', width: 4 },
  { header: NN_HEADERS.name, width: 70 },
  { header: 'Для фильтра2', width: 4 },
  { header: NN_HEADERS.unit, width: 8 },
  { header: NN_HEADERS.priceBaseRub, width: 14 },
  { header: NN_HEADERS.currency, width: 8 },
  { header: NN_HEADERS.discountPct, width: 10 },
  { header: NN_HEADERS.priceRub, width: 14 },
  { header: NN_HEADERS.comment, width: 30 },
  { header: NN_HEADERS.supplier, width: 24 },
  { header: 'Обновлено', width: 12 },
] as const

export function buildPriceWorkbook(items: ExportPriceItem[], meta: { versionLabel: string | null }): ExcelJS.Workbook {
  const sorted = sortForExport(items)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'НТТ Калькулятор'
  wb.created = new Date()

  const ws = wb.addWorksheet('НН', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }))
  const head = ws.getRow(1)
  head.font = { bold: true }
  head.alignment = { vertical: 'middle', wrapText: true }

  sorted.forEach((p, i) => {
    const r = i + 2
    const row = ws.getRow(r)
    // Колонка A — ключ VLOOKUP калькуляторов: «Группа&Номенклатура&ЕИ».
    // Формулой, как в листе мастер-шаблона, с готовым значением.
    row.getCell(1).value = { formula: `B${r}&D${r}&F${r}`, result: `${p.category}${p.name}${p.unit}` }
    row.getCell(2).value = p.category
    row.getCell(4).value = p.name
    row.getCell(6).value = p.unit
    row.getCell(7).value = p.priceBaseRub
    row.getCell(8).value = p.currency
    row.getCell(9).value = p.discountPct
    row.getCell(10).value = p.priceRub
    row.getCell(11).value = p.comment
    row.getCell(12).value = p.supplier
    row.getCell(13).value = p.updatedAt
    row.getCell(7).numFmt = '# ##0.00'
    row.getCell(10).numFmt = '# ##0.00'
    row.getCell(13).numFmt = 'dd.mm.yyyy'
  })
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } }

  // ── Проверка ──
  const issues = findPriceIssues(sorted)
  const chk = wb.addWorksheet('Проверка', { views: [{ state: 'frozen', ySplit: 2 }] })
  chk.getCell('A1').value =
    `Проверка прайса${meta.versionLabel ? ` · ${meta.versionLabel}` : ''} · позиций ${sorted.length}, замечаний ${issues.length}`
  chk.getCell('A1').font = { bold: true }
  const chkHead = chk.getRow(2)
  chkHead.values = ['Строка «НН»', NN_HEADERS.category, NN_HEADERS.name, NN_HEADERS.unit, NN_HEADERS.priceRub, 'Замечание']
  chkHead.font = { bold: true }
  chk.columns = [{ width: 11 }, { width: 24 }, { width: 70 }, { width: 8 }, { width: 14 }, { width: 70 }]
  issues.forEach((issue) => {
    const p = sorted[issue.index]!
    const row = chk.addRow([issue.index + 2, p.category, p.name, p.unit, p.priceRub, issue.message])
    row.getCell(5).numFmt = '# ##0.00'
    row.getCell(6).alignment = { wrapText: true }
  })
  if (issues.length > 0) chk.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 6 } }

  return wb
}
