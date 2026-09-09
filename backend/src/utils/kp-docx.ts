/**
 * Рендер печатной формы КП в .docx — на одну единицу и на проект целиком.
 *
 * Вёрстка одна на оба случая: документ — это шапка, позиции (у каждой своя
 * спецификация и своя цена) и стоимость. КП на единицу отличается только
 * числом позиций, поэтому расходиться этим двум документам негде.
 *
 * Состав данных и решения по ценам объяснены в `utils/kp-document.ts`.
 * Вёрстка по-прежнему приблизительная: образец заказчика («КПВ6393») содержит
 * ещё блок условий, подписи и реквизиты — они не перенесены.
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
import { formatDate, formatMoney, formatQty, type KpDocument, type KpPosition } from './kp-document'

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
  ]
  return lines.filter((l): l is [string, string] => Boolean(l[1]))
}

/**
 * Подпись позиции: редакция и тираж.
 *
 * Тираж печатается всегда, даже при одном изделии: количества и цена в
 * документе относятся ко всему заказу, и читатель должен знать, к какому.
 */
function positionMeta(p: KpPosition): string {
  return `Редакция ${p.snapshotVersion} · прайс НН v${p.priceListVersion} · количество изделий: ${p.tirage}`
}

/** Тема документа в свойствах файла: изделие или проект. */
function documentSubject(doc: KpDocument): string {
  const what = doc.scope === 'project' ? null : (doc.positions[0]?.title ?? null)
  return [what, doc.project].filter(Boolean).join(' · ')
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
  children.push(
    para(doc.scope === 'project' ? 'Состав поставки' : 'Состав изделия', {
      bold: true,
      size: 26,
      spacingAfter: 120,
    }),
  )

  for (const position of doc.positions) {
    // Заголовок позиции — с ценой: в КП на проект это единственное место, где
    // видно, сколько стоит каждая единица.
    children.push(
      new Paragraph({
        spacing: { before: 120, after: 20 },
        children: [
          text(`${position.number}. ${position.title} — `, { bold: true, size: 24 }),
          text(formatMoney(position.totalRub), { bold: true, size: 24 }),
        ],
      }),
    )
    children.push(para(positionMeta(position), { size: 18, spacingAfter: 80 }))

    // Нумерация строк — сквозная внутри позиции: «1.1», «1.2» … Так номер в
    // документе однозначно указывает и на позицию, и на строку.
    let n = 0
    for (const section of position.sections) {
      const title = section.code ? `${section.code}. ${section.title}` : section.title
      children.push(para(title, { bold: true, spacingAfter: 60 }))

      const rows: TableRow[] = [
        new TableRow({
          tableHeader: true,
          children: [
            cell('№', { bold: true, width: 10, align: AlignmentType.CENTER }),
            cell('Наименование', { bold: true, width: 60 }),
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
              cell(`${position.number}.${n}`, { align: AlignmentType.CENTER }),
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

    if (position.sections.length === 0) {
      children.push(
        para('Спецификация пуста: в снапшоте нет включённых позиций.', { spacingAfter: 120 }),
      )
    }
  }

  children.push(
    new Paragraph({
      spacing: { before: 240, after: 60 },
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 6 } },
      children: [text('Стоимость', { bold: true, size: 26 })],
    }),
  )

  // В КП на проект перед итогом идёт свод по позициям: заказчик читает цену
  // каждой единицы рядом с общей суммой, не листая документ обратно.
  if (doc.scope === 'project') {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              cell('№', { bold: true, width: 10, align: AlignmentType.CENTER }),
              cell('Позиция', { bold: true, width: 65 }),
              cell('Цена, ₽', { bold: true, width: 25, align: AlignmentType.RIGHT }),
            ],
          }),
          ...doc.positions.map(
            (p) =>
              new TableRow({
                children: [
                  cell(String(p.number), { align: AlignmentType.CENTER }),
                  cell(p.title),
                  cell(formatMoney(p.totalRub), { align: AlignmentType.RIGHT }),
                ],
              }),
          ),
        ],
      }),
    )
    children.push(para('', { spacingAfter: 120 }))
  }

  children.push(
    new Paragraph({
      spacing: { after: 40 },
      children: [
        text(doc.scope === 'project' ? 'Общая сумма: ' : 'Цена: ', { bold: true }),
        text(formatMoney(doc.totalRub), { bold: true, size: 26 }),
      ],
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
    description: documentSubject(doc),
    sections: [{ children }],
  })

  return Packer.toBuffer(document)
}
