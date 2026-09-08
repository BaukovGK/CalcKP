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
 * Вёрстка повторяет `kp-docx.ts` и так же временна: см. `utils/kp-document.ts`.
 *
 * @module utils/kp-pdf
 */

import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import { formatDate, formatMoney, formatQty, type KpDocument } from './kp-document'

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

function headerLines(doc: KpDocument): Content[] {
  const lines: Array<[string, string | null]> = [
    ['Заказчик', doc.customer],
    ['Объект', doc.project],
    ['Адрес', doc.address],
    ['Изделие', doc.deviceTitle],
    ['Редакция', `${doc.snapshotVersion} · прайс НН v${doc.priceListVersion}`],
  ]
  return lines
    .filter((l): l is [string, string] => Boolean(l[1]))
    .map(([label, value]) => ({
      text: [{ text: `${label}: `, bold: true }, value],
      margin: [0, 0, 0, 2] as [number, number, number, number],
    }))
}

function specification(doc: KpDocument): Content[] {
  if (doc.sections.length === 0) {
    return [{ text: 'Спецификация пуста: в снапшоте нет включённых позиций.', margin: [0, 0, 0, 12] }]
  }

  const out: Content[] = []
  let n = 0

  for (const section of doc.sections) {
    out.push({
      text: section.code ? `${section.code}. ${section.title}` : section.title,
      bold: true,
      margin: [0, 8, 0, 4],
    })

    const body = [
      [
        { text: '№', bold: true, alignment: 'center' as const },
        { text: 'Наименование', bold: true },
        { text: 'Ед. изм.', bold: true, alignment: 'center' as const },
        { text: 'Кол-во', bold: true, alignment: 'right' as const },
      ],
      ...section.rows.map((row) => {
        n += 1
        return [
          { text: String(n), alignment: 'center' as const },
          { text: row.name },
          { text: row.unit, alignment: 'center' as const },
          { text: formatQty(row.qty), alignment: 'right' as const },
        ]
      }),
    ]

    out.push({
      table: { headerRows: 1, widths: ['7%', '*', '15%', '15%'], body },
      layout: 'lightHorizontalLines',
      margin: [0, 0, 0, 8],
    })
  }

  return out
}

/** Собрать PDF и вернуть его байтами. */
export function renderKpPdf(doc: KpDocument): Promise<Buffer> {
  const definition: TDocumentDefinitions = {
    info: {
      title: `Коммерческое предложение ${doc.number}`,
      author: 'НТТ Калькулятор',
      subject: `${doc.deviceTitle}${doc.project ? ` · ${doc.project}` : ''}`,
    },
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { font: 'Roboto', fontSize: 10 },
    content: [
      { text: 'Коммерческое предложение', fontSize: 18, bold: true, alignment: 'center' },
      {
        text: `№ ${doc.number} от ${formatDate(doc.issuedAt)}`,
        alignment: 'center',
        margin: [0, 4, 0, 16],
      },
      ...headerLines(doc),
      { text: 'Состав изделия', fontSize: 13, bold: true, margin: [0, 14, 0, 4] },
      ...specification(doc),
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1 }],
        margin: [0, 10, 0, 8],
      },
      { text: 'Стоимость', fontSize: 13, bold: true, margin: [0, 0, 0, 4] },
      {
        text: [{ text: 'Цена: ', bold: true }, { text: formatMoney(doc.totalRub), bold: true, fontSize: 13 }],
        margin: [0, 0, 0, 2],
      },
      { text: `В том числе НДС ${doc.vatRatePct}%: ${formatMoney(doc.vatRub)}`, margin: [0, 0, 0, 14] },
      {
        text:
          'Цена указана с учётом НДС и действительна на дату выпуска настоящего ' +
          'предложения. Позиции спецификации приведены без разбивки по стоимости.',
        fontSize: 8,
        color: '#444444',
      },
    ],
    footer: (page: number, total: number) => ({
      text: `${page} / ${total}`,
      alignment: 'center',
      fontSize: 8,
      color: '#666666',
      margin: [0, 12, 0, 0],
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
