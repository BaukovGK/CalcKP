/**
 * Рендер печатной формы КП в .docx.
 *
 * Вёрстка временная: образец от заказчика ещё не получен (решение 2026-07-16),
 * поэтому документ собран по здравому смыслу — шапка, спецификация по разделам
 * каркаса, итоговая цена. Состав данных и два решения по ним (цены не
 * построчно, НДС «в том числе») объяснены в `utils/kp-document.ts`.
 *
 * Когда образец придёт, меняется только этот файл и `kp-pdf.ts`: модель
 * документа от вёрстки не зависит.
 *
 * @module utils/kp-docx
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { formatDate, formatMoney, formatQty, type KpDocument } from './kp-document'

const FONT = 'Times New Roman'

function text(value: string, opts: { bold?: boolean; size?: number } = {}) {
  return new TextRun({ text: value, bold: opts.bold, font: FONT, size: opts.size ?? 22 })
}

function para(value: string, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; size?: number; spacingAfter?: number } = {}) {
  return new Paragraph({
    alignment: opts.align,
    spacing: { after: opts.spacingAfter ?? 60 },
    children: [text(value, { bold: opts.bold, size: opts.size })],
  })
}

function cell(value: string, opts: { bold?: boolean; width?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    children: [
      new Paragraph({
        alignment: opts.align,
        spacing: { before: 20, after: 20 },
        children: [text(value, { bold: opts.bold })],
      }),
    ],
  })
}

/** Пары «реквизит — значение» шапки; пустые не печатаются. */
function headerLines(doc: KpDocument): Array<[string, string]> {
  const lines: Array<[string, string | null]> = [
    ['Заказчик', doc.customer],
    ['Объект', doc.project],
    ['Адрес', doc.address],
    ['Изделие', doc.deviceTitle],
    ['Редакция', `${doc.snapshotVersion} · прайс НН v${doc.priceListVersion}`],
  ]
  return lines.filter((l): l is [string, string] => Boolean(l[1]))
}

/** Собрать .docx и вернуть его байтами. */
export async function renderKpDocx(doc: KpDocument): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      heading: HeadingLevel.HEADING_1,
      children: [text('Коммерческое предложение', { bold: true, size: 32 })],
    }),
    para(`№ ${doc.number} от ${formatDate(doc.issuedAt)}`, {
      align: AlignmentType.CENTER,
      spacingAfter: 240,
    }),
  ]

  for (const [label, value] of headerLines(doc)) {
    children.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [text(`${label}: `, { bold: true }), text(value)],
      }),
    )
  }

  children.push(para('', { spacingAfter: 120 }))
  children.push(para('Состав изделия', { bold: true, size: 26, spacingAfter: 120 }))

  let n = 0
  for (const section of doc.sections) {
    const title = section.code ? `${section.code}. ${section.title}` : section.title
    children.push(para(title, { bold: true, spacingAfter: 60 }))

    const rows: TableRow[] = [
      new TableRow({
        tableHeader: true,
        children: [
          cell('№', { bold: true, width: 7, align: AlignmentType.CENTER }),
          cell('Наименование', { bold: true, width: 63 }),
          cell('Ед. изм.', { bold: true, width: 15, align: AlignmentType.CENTER }),
          cell('Кол-во', { bold: true, width: 15, align: AlignmentType.RIGHT }),
        ],
      }),
    ]

    for (const row of section.rows) {
      n += 1
      rows.push(
        new TableRow({
          children: [
            cell(String(n), { align: AlignmentType.CENTER }),
            cell(row.name),
            cell(row.unit, { align: AlignmentType.CENTER }),
            cell(formatQty(row.qty), { align: AlignmentType.RIGHT }),
          ],
        }),
      )
    }

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows,
      }),
    )
    children.push(para('', { spacingAfter: 120 }))
  }

  if (doc.sections.length === 0) {
    children.push(para('Спецификация пуста: в снапшоте нет включённых позиций.', { spacingAfter: 120 }))
  }

  children.push(
    new Paragraph({
      spacing: { before: 240, after: 60 },
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 6 } },
      children: [text('Стоимость', { bold: true, size: 26 })],
    }),
  )
  children.push(
    new Paragraph({
      spacing: { after: 40 },
      children: [text('Цена: ', { bold: true }), text(formatMoney(doc.totalRub), { bold: true, size: 26 })],
    }),
  )
  children.push(
    para(`В том числе НДС ${doc.vatRatePct}%: ${formatMoney(doc.vatRub)}`, { spacingAfter: 240 }),
  )
  children.push(
    para(
      'Цена указана с учётом НДС и действительна на дату выпуска настоящего ' +
        'предложения. Позиции спецификации приведены без разбивки по стоимости.',
      { size: 20 },
    ),
  )

  const document = new Document({
    creator: 'НТТ Калькулятор',
    title: `Коммерческое предложение ${doc.number}`,
    description: `${doc.deviceTitle}${doc.project ? ` · ${doc.project}` : ''}`,
    sections: [{ children }],
  })

  return Packer.toBuffer(document)
}
