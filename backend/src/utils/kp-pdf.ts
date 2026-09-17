/**
 * Рендер печатной формы КП в PDF.
 *
 * pdfmake + Roboto. Шрифты берутся из `pdfmake/build/vfs_fonts.js` — это
 * base64-хранилище, которое пакет возит с собой; отдельных .ttf в репозитории
 * нет, и скачивать ничего не нужно. Roboto покрывает кириллицу, ₽ и №
 * (проверено: коды 041A/041F/2116/20BD приходят в ToUnicode готового PDF).
 *
 * Почему pdfmake 0.2, а не 0.3: в 0.3 серверный `createPdfKitDocument` стал
 * промисом и требует настроенного url-resolver, при этом .ttf в пакете
 * появились, а документированного серверного пути — нет. 0.2 отдаёт обычный
 * поток и держится в проекте предсказуемо.
 *
 * Вёрстка повторяет `kp-docx.ts` — то есть рабочее КП коммерческого отдела
 * (`doc/Эталон_КП_разбор.md`). См. `utils/kp-document.ts`.
 *
 * @module utils/kp-pdf
 */

import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import {
  formatAmount,
  formatDate,
  formatMoney,
  formatQty,
  type KpDocument,
  type KpPosition,
} from './kp-document'
import { termsItems } from './kp-terms'

/** Дескрипторы начертаний: pdfkit принимает шрифт как Buffer. */
interface FontFaces {
  normal: Buffer
  bold: Buffer
  italics: Buffer
  bolditalics: Buffer
}

interface PdfKitStream extends NodeJS.ReadableStream {
  end(): void
}

/**
 * Конструктор серверного принтера.
 *
 * Через `require`, а не `import`: типы `@types/pdfmake` описывают браузерный
 * вход (объект `pdfMake` с `createPdf`), поэтому корень пакета в них не
 * конструируемый. Серверный вход — это класс PdfPrinter; типизируем его здесь,
 * не ломая остальные типы пакета, которыми пользуется определение документа.
 */
const PdfPrinter = require('pdfmake') as new (fonts: Record<string, FontFaces>) => {
  createPdfKitDocument(dd: TDocumentDefinitions): PdfKitStream
}

let cachedFonts: Record<string, FontFaces> | null = null

/** Roboto из vfs пакета, декодированный в Buffer'ы. Считается один раз. */
function fonts(): Record<string, FontFaces> {
  if (cachedFonts) return cachedFonts

  const vfsModule = require('pdfmake/build/vfs_fonts.js') as
    | { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> }
    | Record<string, string>
  const table = ((vfsModule as { pdfMake?: { vfs?: Record<string, string> } }).pdfMake?.vfs ??
    (vfsModule as { vfs?: Record<string, string> }).vfs ??
    vfsModule) as Record<string, string>

  const face = (name: string): Buffer => {
    const b64 = table[name]
    if (!b64) throw new Error(`Шрифт ${name} не найден в vfs pdfmake — PDF собрать нечем`)
    return Buffer.from(b64, 'base64')
  }

  cachedFonts = {
    Roboto: {
      normal: face('Roboto-Regular.ttf'),
      bold: face('Roboto-Medium.ttf'),
      italics: face('Roboto-Italic.ttf'),
      bolditalics: face('Roboto-MediumItalic.ttf'),
    },
  }
  return cachedFonts
}

/** Строка таблицы по позиции: описание многострочное, цена и сумма справа. */
function positionRow(position: KpPosition): Content[] {
  return [
    { text: position.number, alignment: 'center' },
    { text: position.description },
    { text: formatQty(position.qty), alignment: 'center' },
    { text: position.unit, alignment: 'center' },
    { text: formatAmount(position.priceRub), alignment: 'right' },
    { text: formatAmount(position.totalRub), alignment: 'right' },
  ]
}

/** Шапка документа: заказчик и объект — каждый своей строкой. */
function headerLines(doc: KpDocument): Content[] {
  const lines: Array<[string, string | null]> = [
    ['Заказчик', doc.customer],
    ['Объект', doc.object],
  ]
  return lines
    .filter((l): l is [string, string] => Boolean(l[1]))
    .map(([label, value]) => ({
      text: [{ text: `${label}: `, bold: true }, value],
      fontSize: 11,
      margin: [0, 0, 0, 3] as [number, number, number, number],
    }))
}

/** Подвал с реквизитами — последним блоком документа, как в эталоне. */
function companyBlock(doc: KpDocument): Content[] {
  const { company } = doc
  return [
    {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5 }],
      margin: [0, 18, 0, 6],
    },
    {
      columns: [
        {
          width: '*',
          stack: [
            company.name,
            [company.ogrn, company.innKpp, company.phone].filter(Boolean).join(', '),
            company.address,
          ],
        },
        {
          width: 'auto',
          alignment: 'right',
          stack: [company.email, company.site].filter(Boolean),
        },
      ],
      fontSize: 7.5,
      color: '#333333',
    },
  ]
}

/** Собрать PDF и вернуть его байтами. */
export function renderKpPdf(doc: KpDocument): Promise<Buffer> {
  const terms = termsItems(doc.terms, formatDate)
  const { signature } = doc

  const content: Content[] = [
    { text: 'Коммерческое предложение', fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
    {
      text: `Исх. ${doc.number ?? '___'} от ${formatDate(doc.issuedAt)}`,
      fontSize: 11,
      bold: true,
      margin: [0, 0, 0, 12],
    },
    ...headerLines(doc),
    {
      table: {
        headerRows: 1,
        // Наименование занимает всё свободное место: в нём описание изделия.
        widths: [22, '*', 34, 38, 62, 68],
        body: [
          [
            { text: '№', bold: true, alignment: 'center' },
            { text: 'Наименование номенклатуры', bold: true, alignment: 'center' },
            { text: 'Кол-во', bold: true, alignment: 'center' },
            { text: 'Ед. изм.', bold: true, alignment: 'center' },
            { text: 'Цена, руб.', bold: true, alignment: 'center' },
            { text: 'Сумма, руб.', bold: true, alignment: 'center' },
          ],
          ...doc.positions.map(positionRow),
          [
            { text: 'Общая сумма:', bold: true, alignment: 'right', colSpan: 5 },
            {},
            {},
            {},
            {},
            { text: formatAmount(doc.totalRub), bold: true, alignment: 'right' },
          ],
        ],
      },
      fontSize: 8.5,
      margin: [0, 6, 0, 4],
    },
    {
      text: `В том числе НДС ${doc.vatRatePct} %: ${formatMoney(doc.vatRub)}`,
      alignment: 'right',
      fontSize: 8.5,
      margin: [0, 0, 0, 12],
    },
    {
      ol: terms,
      fontSize: 8.5,
      margin: [0, 0, 0, 16],
    },
    {
      columns: [
        { width: '*', text: signature.signerTitle, fontSize: 11 },
        { width: 'auto', text: signature.signerName ?? '', fontSize: 11, alignment: 'right' },
      ],
      margin: [0, 8, 0, 0],
    },
  ]

  const executorLines = [
    signature.executorName,
    signature.executorPosition,
    signature.executorPhone,
    signature.executorEmail,
  ].filter((v): v is string => Boolean(v))
  if (executorLines.length > 0) {
    content.push({
      stack: ['Исполнитель:', ...executorLines],
      fontSize: 8,
      color: '#333333',
      margin: [0, 24, 0, 0],
    })
  }

  content.push(...companyBlock(doc))

  const definition: TDocumentDefinitions = {
    info: {
      title: doc.number ? `Коммерческое предложение ${doc.number}` : 'Коммерческое предложение',
      author: doc.company.name,
      subject: [doc.customer, doc.object].filter(Boolean).join(' · '),
    },
    pageSize: 'A4',
    pageMargins: [36, 36, 36, 40],
    defaultStyle: { font: 'Roboto', fontSize: 10 },
    content,
    footer: (page: number, total: number) => ({
      text: `${page} / ${total}`,
      alignment: 'center',
      fontSize: 8,
      color: '#666666',
      margin: [0, 10, 0, 0],
    }),
  }

  const printer = new PdfPrinter(fonts())
  const stream = printer.createPdfKitDocument(definition)

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (c: Buffer) => chunks.push(c))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
    stream.end()
  })
}
