/**
 * Рендер печатной формы КП в .xlsx — на одну единицу и на проект целиком.
 *
 * Третий формат рядом с `kp-docx.ts` и `kp-pdf.ts`, и самый близкий к
 * первоисточнику: рабочее КП коммерческого отдела и есть книга Excel
 * (`doc/Эталон_КП_разбор.md`). Отсюда раскладка — не «таблица в документе», а
 * лист: колонка A служебным отступом, документ живёт в B…G, ширины колонок,
 * форматы чисел и параметры печати взяты из образца.
 *
 * ЧТО ВЗЯТО ИЗ ОБРАЗЦА
 *  - Колонки B…G: «№ · Наименование номенклатуры · Кол-во · Ед. изм. ·
 *    Цена, руб. · Сумма, руб.» с шириной 6,1 / 63,3 / 9,7 / 9,9 / 18,1 / 20,4.
 *  - «№» — ТЕКСТ: «1.2» числом не является, иначе Excel покажет «1,2».
 *  - Деньги — «# ##0.00»; итог — формулой `СУММ` по всей колонке сумм.
 *  - Печать: A4 книжная, подгонка по ширине, узкие поля, область печати по
 *    последнюю строку подвала. Сетка выключена, цветов нет.
 *
 * ГДЕ СОЗНАТЕЛЬНО НЕ КАК В ОБРАЗЦЕ
 *  - Сумма строки — ЗНАЧЕНИЕ, а не формула «цена × количество». Цена за
 *    изделие получена делением итога снапшота на тираж и округлена до копеек
 *    (`kp-document.ts`), поэтому произведение разошлось бы с согласованной
 *    суммой на копейки. Итог при этом остаётся формулой: он суммирует точные
 *    значения и сходится со снапшотом до копейки, а правка суммы в книге
 *    пересчитывает общую — ради этого коммерческий отдел и просит Excel.
 *  - Количество печатается как в docx и pdf — «1», а не «1,00»: один и тот же
 *    документ в трёх форматах обязан читаться одинаково.
 *  - Справочная строка «в том числе НДС» под таблицей есть, хотя в образце её
 *    нет: она есть в двух других форматах (ТЗ §4.2), и расхождение между
 *    форматами дороже расхождения с образцом.
 *  - Пустой разрыв в 30 строк между подписью и исполнителем не переносится:
 *    в образце он прижимает подвал к низу последней страницы, а при подгонке
 *    по ширине с плавающей высотой это просто дыра.
 *  - Логотипа нет: в образце он картинкой, исходника у нас нет
 *    (`doc/Эталон_КП_разбор.md` §11).
 *
 * @module utils/kp-xlsx
 */

import ExcelJS from 'exceljs'
import {
  formatDate,
  formatMoney,
  type KpDocument,
  type KpPosition,
} from './kp-document'
import { termsItems } from './kp-terms'

const FONT = 'Calibri'
const MONEY_FMT = '# ##0.00'
/** Количество — целым, если оно целое: «1», а не «1,00» (см. шапку модуля). */
const QTY_FMT = '# ##0.###'

/** Колонки листа: A — отступ, документ в B…G. Ширины — из образца. */
const WIDTHS = [2.5, 6.1, 63.3, 9.7, 9.9, 18.1, 20.4]

/** Первая и последняя колонка документа. */
const FIRST = 'B'
const LAST = 'G'

const THIN = { style: 'thin' as const, color: { argb: 'FF000000' } }
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN }

/** Высота строки под текст с переносом: Excel её сам не подберёт в объединённых ячейках. */
const LINE_H = 14.5
/** Предел высоты строки в Excel. */
const MAX_ROW_H = 409
function wrappedHeight(text: string, charsPerLine: number, slack = 0): number {
  const lines = text
    .split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0)
  return (lines + slack) * LINE_H + 3
}

/** Ширина области B…G в знаках — по ней считается высота объединённых строк. */
const DOC_CHARS = Math.round(WIDTHS.slice(1).reduce((a, b) => a + b, 0))
/** Ширина колонки наименования в знаках — по ней считается высота строки позиции. */
const NAME_CHARS = Math.round(WIDTHS[2] ?? 60)

export function renderKpXlsxWorkbook(doc: KpDocument): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = doc.company.name
  wb.created = doc.issuedAt

  const ws = wb.addWorksheet('КП', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.2, right: 0.2, top: 0.4, bottom: 0.4, header: 0, footer: 0 },
    },
  })
  ws.columns = WIDTHS.map((width) => ({ width }))

  let row = 1

  /** Строка во всю ширину документа: заголовки, условия, подвал. */
  const wide = (
    value: string,
    opts: { bold?: boolean; size?: number; height?: number; wrap?: boolean; topBorder?: boolean } = {},
  ): number => {
    const at = row
    ws.mergeCells(`${FIRST}${at}:${LAST}${at}`)
    const cell = ws.getCell(`${FIRST}${at}`)
    cell.value = value
    cell.font = { name: FONT, bold: opts.bold, size: opts.size ?? 11 }
    cell.alignment = { vertical: 'top', wrapText: opts.wrap ?? false }
    if (opts.topBorder) {
      // Отбивка подвала — линия по всей ширине, а не рамка ячейки.
      for (let c = 2; c <= 7; c++) ws.getRow(at).getCell(c).border = { top: THIN }
    }
    if (opts.height) ws.getRow(at).height = Math.min(MAX_ROW_H, opts.height)
    row += 1
    return at
  }

  const blank = (height = 8) => {
    ws.getRow(row).height = height
    row += 1
  }

  // ── Шапка ──
  wide('Коммерческое предложение', { bold: true, size: 18, height: 24 })
  wide(`Исх. ${doc.number ?? '___'} от ${formatDate(doc.issuedAt)}`, { bold: true, size: 12, height: 18 })
  blank()
  if (doc.customer) wide(`Заказчик: ${doc.customer}`, { size: 12, height: 17 })
  if (doc.object) wide(`Объект: ${doc.object}`, { size: 12, height: 17 })
  blank()

  // ── Таблица ──
  const headAt = row
  const head = ws.getRow(headAt)
  const titles = ['№', 'Наименование номенклатуры', 'Кол-во', 'Ед. изм.', 'Цена, руб.', 'Сумма, руб.']
  titles.forEach((title, i) => {
    const cell = head.getCell(i + 2)
    cell.value = title
    cell.font = { name: FONT, bold: true, size: 12 }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = BOX
  })
  head.height = 30
  row += 1

  const firstPos = row
  doc.positions.forEach((position) => {
    row += positionRows(ws, row, position)
  })
  const lastPos = row - 1

  // Итог — формулой: сумма точных значений колонки сходится со снапшотом, а
  // правка суммы в книге пересчитывает общую.
  const totalAt = row
  const totalRow = ws.getRow(totalAt)
  ws.mergeCells(`${FIRST}${totalAt}:F${totalAt}`)
  const label = ws.getCell(`${FIRST}${totalAt}`)
  label.value = 'Общая сумма:'
  label.font = { name: FONT, bold: true, size: 11 }
  label.alignment = { horizontal: 'right', vertical: 'middle' }
  const totalCell = totalRow.getCell(7)
  totalCell.value =
    doc.positions.length > 0
      ? { formula: `SUM(${LAST}${firstPos}:${LAST}${lastPos})`, result: doc.totalRub }
      : doc.totalRub
  totalCell.font = { name: FONT, bold: true, size: 11 }
  totalCell.numFmt = MONEY_FMT
  totalCell.alignment = { horizontal: 'right', vertical: 'middle' }
  for (let c = 2; c <= 7; c++) totalRow.getCell(c).border = BOX
  totalRow.height = 18
  row += 1

  // НДС — справочной строкой: в цене он уже есть, сверху не начисляется.
  const vatAt = row
  ws.mergeCells(`${FIRST}${vatAt}:${LAST}${vatAt}`)
  const vat = ws.getCell(`${FIRST}${vatAt}`)
  vat.value = `В том числе НДС ${doc.vatRatePct} %: ${formatMoney(doc.vatRub)}`
  vat.font = { name: FONT, size: 10 }
  vat.alignment = { horizontal: 'right' }
  row += 1
  blank(10)

  // ── Условия ──
  termsItems(doc.terms, formatDate).forEach((item, i) => {
    const text = `${i + 1}. ${item}`
    wide(text, { size: 10, wrap: true, height: wrappedHeight(text, DOC_CHARS) })
  })
  blank(16)

  // ── Подпись: должность слева, фамилия справа ──
  const signAt = row
  ws.mergeCells(`${FIRST}${signAt}:D${signAt}`)
  const signerTitle = ws.getCell(`${FIRST}${signAt}`)
  signerTitle.value = doc.signature.signerTitle
  signerTitle.font = { name: FONT, size: 11 }
  ws.mergeCells(`E${signAt}:${LAST}${signAt}`)
  const signerName = ws.getCell(`E${signAt}`)
  signerName.value = doc.signature.signerName ?? ''
  signerName.font = { name: FONT, size: 11 }
  signerName.alignment = { horizontal: 'right' }
  row += 1
  blank(16)

  // ── Исполнитель ──
  const { signature, company } = doc
  const executor = [
    signature.executorName,
    signature.executorPosition,
    signature.executorPhone,
    signature.executorEmail,
  ].filter((v): v is string => Boolean(v))
  if (executor.length > 0) {
    wide('Исполнитель:', { size: 9, height: 13 })
    executor.forEach((line) => wide(line, { size: 9, height: 13 }))
    blank(10)
  }

  // ── Подвал ──
  wide(company.name, { size: 9, height: 14, topBorder: true })
  wide([company.ogrn, company.innKpp, company.phone].filter(Boolean).join(', '), { size: 9, height: 13 })
  wide(company.address, { size: 9, wrap: true, height: wrappedHeight(company.address, DOC_CHARS) })
  const lastAt = wide([company.email, company.site].filter(Boolean).join(' · '), { size: 9, height: 13 })

  ws.pageSetup.printArea = `A1:${LAST}${lastAt}`
  // Шапка таблицы повторяется на каждой странице: позиций может быть много.
  ws.pageSetup.printTitlesRow = `${headAt}:${headAt}`

  return wb
}

/**
 * Позиция таблицы. Возвращает, сколько строк листа заняла.
 *
 * Обычно одну. Но описание изделия — это тип, габариты, нормативы и весь
 * состав «В комплекте», у КНС это под две тысячи знаков, а высота строки в
 * Excel ограничена 409 пт. В образце на этот предел натолкнулись так же и
 * растянули длинные описания на пару объединённых строк — здесь то же самое,
 * только автоматически: позиция занимает столько строк листа, сколько нужно
 * её описанию, и все шесть колонок объединяются по вертикали. Текст при этом
 * не режется: объединённая ячейка складывает высоты своих строк, и описание
 * остаётся одним куском, без границы посередине.
 *
 * Высота задаётся явно, а не автоподбором Excel: в объединённых ячейках его
 * нет вовсе, а в обычных он срабатывает не всегда — и тогда описание
 * схлопывается в одну строку, то есть документ уходит заказчику обрезанным.
 * Оценка грубая (шрифт пропорциональный), поэтому в ней заложена запасная
 * строка.
 */
function positionRows(ws: ExcelJS.Worksheet, at: number, position: KpPosition): number {
  const needed = wrappedHeight(position.description, NAME_CHARS, 1)
  const count = rowsFor(needed)
  const last = at + count - 1

  for (let i = 0; i < count; i++) {
    const row = ws.getRow(at + i)
    row.height = needed / count
    for (let c = 2; c <= 7; c++) {
      const cell = row.getCell(c)
      cell.font = { name: FONT, size: 11 }
      cell.border = BOX
    }
  }

  const head = ws.getRow(at)

  const description = head.getCell(3)
  description.value = position.description
  description.alignment = { vertical: 'top', wrapText: true }

  const number = head.getCell(2)
  number.value = position.number
  number.numFmt = '@' // «1.2» — текст: числом Excel показал бы «1,2»
  number.alignment = { horizontal: 'center', vertical: 'top' }

  const qty = head.getCell(4)
  qty.value = position.qty
  qty.numFmt = QTY_FMT
  qty.alignment = { horizontal: 'center', vertical: 'top' }

  const unit = head.getCell(5)
  unit.value = position.unit
  unit.alignment = { horizontal: 'center', vertical: 'top' }

  const price = head.getCell(6)
  price.value = position.priceRub
  price.numFmt = MONEY_FMT
  price.alignment = { horizontal: 'right', vertical: 'top' }

  const sum = head.getCell(7)
  sum.value = position.totalRub
  sum.numFmt = MONEY_FMT
  sum.alignment = { horizontal: 'right', vertical: 'top' }

  // Позиция одна, поэтому объединяется вся: и описание, и номер с ценой.
  if (last > at) {
    for (let c = 2; c <= 7; c++) ws.mergeCells(at, c, last, c)
  }

  return count
}

/**
 * Сколько строк листа занять под текст такой высоты.
 *
 * Высота одной строки в Excel ограничена 409 пт, а описание КНС требует вдвое
 * больше. Текст при этом резать не нужно: объединённая по вертикали ячейка
 * складывает высоты своих строк, и описание остаётся одним куском, без
 * границы посередине.
 */
export function rowsFor(height: number): number {
  return Math.max(1, Math.ceil(height / MAX_ROW_H))
}

/** Собрать .xlsx и вернуть его байтами. */
export async function renderKpXlsx(doc: KpDocument): Promise<Buffer> {
  const wb = renderKpXlsxWorkbook(doc)
  return Buffer.from(await wb.xlsx.writeBuffer())
}
