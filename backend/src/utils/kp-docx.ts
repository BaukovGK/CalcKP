/**
 * Рендер печатной формы КП в .docx — на одну единицу и на проект целиком.
 *
 * Вёрстка повторяет рабочее КП коммерческого отдела
 * (`doc/Эталон_КП_разбор.md`): заголовок, «Исх. ⟨номер⟩ от ⟨дата⟩», заказчик
 * и объект, таблица «№ · Наименование номенклатуры · Кол-во · Ед. изм. ·
 * Цена · Сумма», общая сумма, девять пунктов условий, подпись, исполнитель и
 * реквизиты в подвале.
 *
 * Вёрстка одна на КП по единице и по проекту: документ — это шапка, позиции и
 * стоимость, и КП на единицу отличается только числом позиций. Состав данных
 * и решения по ценам объяснены в `utils/kp-document.ts`.
 *
 * @module utils/kp-docx
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx'
import {
  documentFileName,
  formatAmount,
  formatDate,
  formatMoney,
  formatQty,
  type KpDocument,
  type KpPosition,
} from './kp-document'
import { termsItems } from './kp-terms'

const FONT = 'Times New Roman'
/** Размеры docx — в полуточках: 20 = 10 пт. */
const SIZE = { body: 20, table: 18, head: 36, sub: 24, small: 16 } as const

/** Ширины колонок таблицы, % — пропорции эталона (наименование шире всех). */
const COLS = { num: 6, name: 50, qty: 8, unit: 8, price: 14, sum: 14 } as const

type Align = (typeof AlignmentType)[keyof typeof AlignmentType]

function text(value: string, opts: { bold?: boolean; size?: number } = {}) {
  return new TextRun({ text: value, bold: opts.bold, font: FONT, size: opts.size ?? SIZE.body })
}

function para(
  value: string,
  opts: { bold?: boolean; align?: Align; size?: number; spacingAfter?: number; spacingBefore?: number } = {},
) {
  return new Paragraph({
    alignment: opts.align,
    spacing: { after: opts.spacingAfter ?? 60, before: opts.spacingBefore },
    children: [text(value, { bold: opts.bold, size: opts.size })],
  })
}

function cell(
  content: string | Paragraph[],
  opts: { bold?: boolean; width?: number; align?: Align; size?: number } = {},
) {
  const children = Array.isArray(content)
    ? content
    : [
        new Paragraph({
          alignment: opts.align,
          spacing: { before: 20, after: 20 },
          children: [text(content, { bold: opts.bold, size: opts.size ?? SIZE.table })],
        }),
      ]
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    children,
  })
}

/** Абзацы ячейки наименования: описание изделия приходит многострочным. */
function descriptionParagraphs(position: KpPosition): Paragraph[] {
  return position.description.split('\n').map(
    (line, i) =>
      new Paragraph({
        spacing: { before: i === 0 ? 20 : 0, after: 20 },
        children: [text(line, { size: SIZE.table })],
      }),
  )
}

/** Шапка таблицы — подписи колонок эталона. */
function headerRow(): TableRow {
  return new TableRow({
    tableHeader: true,
    children: [
      cell('№', { bold: true, width: COLS.num, align: AlignmentType.CENTER }),
      cell('Наименование номенклатуры', { bold: true, width: COLS.name, align: AlignmentType.CENTER }),
      cell('Кол-во', { bold: true, width: COLS.qty, align: AlignmentType.CENTER }),
      cell('Ед. изм.', { bold: true, width: COLS.unit, align: AlignmentType.CENTER }),
      cell('Цена, руб.', { bold: true, width: COLS.price, align: AlignmentType.CENTER }),
      cell('Сумма, руб.', { bold: true, width: COLS.sum, align: AlignmentType.CENTER }),
    ],
  })
}

function positionRow(position: KpPosition): TableRow {
  return new TableRow({
    children: [
      cell(position.number, { width: COLS.num, align: AlignmentType.CENTER }),
      cell(descriptionParagraphs(position), { width: COLS.name }),
      cell(formatQty(position.qty), { width: COLS.qty, align: AlignmentType.CENTER }),
      cell(position.unit, { width: COLS.unit, align: AlignmentType.CENTER }),
      cell(formatAmount(position.priceRub), { width: COLS.price, align: AlignmentType.RIGHT }),
      cell(formatAmount(position.totalRub), { width: COLS.sum, align: AlignmentType.RIGHT }),
    ],
  })
}

/** Строка итога: подпись занимает колонки до цены, сумма — последнюю. */
function totalRow(doc: KpDocument): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: 5,
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 20, after: 20 },
            children: [text('Общая сумма:', { bold: true, size: SIZE.table })],
          }),
        ],
      }),
      cell(formatAmount(doc.totalRub), { bold: true, width: COLS.sum, align: AlignmentType.RIGHT }),
    ],
  })
}

/** Подпись: должность слева, фамилия справа — без места под печать. */
function signatureBlock(doc: KpDocument): Table {
  const { signature } = doc
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        children: [
          cell(signature.signerTitle, { width: 60, size: SIZE.body }),
          cell(signature.signerName ?? '', { width: 40, align: AlignmentType.RIGHT, size: SIZE.body }),
        ],
      }),
    ],
  })
}

/** Собрать .docx и вернуть его байтами. */
export async function renderKpDocx(doc: KpDocument): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [
    para('Коммерческое предложение', { bold: true, size: SIZE.head, spacingAfter: 80 }),
    para(`Исх. ${doc.number ?? '___'} от ${formatDate(doc.issuedAt)}`, {
      bold: true,
      size: SIZE.sub,
      spacingAfter: 200,
    }),
  ]

  if (doc.customer) {
    children.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [text('Заказчик: ', { bold: true, size: SIZE.sub }), text(doc.customer, { size: SIZE.sub })],
      }),
    )
  }
  if (doc.object) {
    children.push(
      new Paragraph({
        spacing: { after: 160 },
        children: [text('Объект: ', { bold: true, size: SIZE.sub }), text(doc.object, { size: SIZE.sub })],
      }),
    )
  }

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow(), ...doc.positions.map(positionRow), totalRow(doc)],
    }),
  )

  // НДС — справочной строкой под таблицей: в цене он уже есть, сверху не
  // начисляется (ТЗ §4.2).
  children.push(
    para(`В том числе НДС ${doc.vatRatePct} %: ${formatMoney(doc.vatRub)}`, {
      align: AlignmentType.RIGHT,
      size: SIZE.table,
      spacingBefore: 80,
      spacingAfter: 200,
    }),
  )

  termsItems(doc.terms, formatDate).forEach((item, i) => {
    children.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [text(`${i + 1}. `, { size: SIZE.table }), text(item, { size: SIZE.table })],
      }),
    )
  })

  children.push(para('', { spacingAfter: 240 }))
  children.push(signatureBlock(doc))

  const { signature, company } = doc
  if (signature.executorName || signature.executorPhone || signature.executorEmail) {
    children.push(para('Исполнитель:', { size: SIZE.small, spacingBefore: 240, spacingAfter: 20 }))
    for (const line of [signature.executorName, signature.executorPhone, signature.executorEmail]) {
      if (line) children.push(para(line, { size: SIZE.small, spacingAfter: 20 }))
    }
  }

  children.push(
    new Paragraph({
      spacing: { before: 240, after: 20 },
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 6 } },
      children: [text(company.name, { size: SIZE.small })],
    }),
  )
  children.push(
    para([company.ogrn, company.innKpp, company.phone].filter(Boolean).join(', '), {
      size: SIZE.small,
      spacingAfter: 20,
    }),
  )
  children.push(para(company.address, { size: SIZE.small, spacingAfter: 20 }))
  children.push(
    para([company.email, company.site].filter(Boolean).join(' · '), { size: SIZE.small }),
  )

  const document = new Document({
    creator: company.name,
    title: documentFileName(doc, 'docx').replace(/\.docx$/, ''),
    description: [doc.customer, doc.object].filter(Boolean).join(' · '),
    sections: [{ children }],
  })

  return Packer.toBuffer(document)
}
