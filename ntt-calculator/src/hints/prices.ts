/**
 * Сноски реестра цен: строка прайса и подписи колонок.
 */

import type { Hint } from '@/directives/hint'

const fmtPrice = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Строка прайса в объёме, нужном сноске. */
export interface PriceHintItem {
  category: string
  name: string
  unit: string
  priceRub: number | null
  priceBaseRub?: number | null
  discountPct?: number | null
  supplier: string | null
  updatedAt: string
  issue?: string | null
}

/**
 * Сноска строки прайса: полное наименование, ключ поиска, откуда цена,
 * замечание проверки и как её поправить.
 */
export function priceRowHint(item: PriceHintItem, opts: { canEdit: boolean }): Hint {
  const text: string[] = []
  const formula: string[] = []
  let tone: Hint['tone']

  text.push(`Категория «${item.category}», ЕИ «${item.unit}». Расчёт находит позицию по тройке: категория, наименование, ЕИ.`)

  if (item.priceRub == null) {
    tone = 'error'
    text.push('Цены нет: строка расчёта с этой позицией будет «красной» и не даст выпустить КП.')
  } else if (item.priceBaseRub != null && item.discountPct) {
    formula.push(`${fmtPrice(item.priceBaseRub)} × (1 − ${item.discountPct} %) = ${fmtPrice(item.priceRub)} ₽`)
  } else if (item.priceBaseRub != null && item.priceBaseRub !== item.priceRub) {
    text.push(`Цена без скидки — ${fmtPrice(item.priceBaseRub)} ₽; расчёт берёт итоговую.`)
  }

  if (item.issue) {
    tone ??= 'warn'
    text.push(`Замечание проверки: ${item.issue}.`)
  }
  if (item.supplier) text.push(`Поставщик: ${item.supplier}.`)
  text.push(`Цена обновлена ${fmtDate(item.updatedAt)}.`)
  if (opts.canEdit) text.push('Двойной щелчок по строке — правка цены и поставщика.')

  return { title: item.name, text, formula, tone }
}

export const PRICE_COLUMN_HINTS = {
  name: {
    title: 'Наименование',
    text: 'Приведено к единому виду: пробелы, латинские буквы вместо русских и опечатки в ГОСТ исправлены — и в прайсе, и в расчёте, чтобы строка находила цену. Щелчок — сортировка.',
  },
  unit: { title: 'ЕИ', text: 'Единица измерения — часть ключа, по которому расчёт ищет цену.' },
  price: {
    title: 'Цена, ₽',
    text: 'Итоговая цена позиции (лист «НН», колонка J) — её берёт расчёт. Цены с НДС. Щелчок — сортировка.',
  },
  supplier: { title: 'Поставщик', text: 'В листе «НН» поставщика нет — он заполняется здесь. Импорт файла без поставщика оставляет прежнего.' },
  updated: { title: 'Обновлено', text: 'Когда цену меняли последний раз — правкой здесь или импортом. Щелчок — сортировка.' },
} satisfies Record<string, Hint>

export const PRICE_FILTER_HINTS = {
  search: {
    title: 'Поиск',
    text: 'По наименованию, ЕИ, поставщику и комментарию; найтись должны все слова, в любом порядке. Клавиша / — сюда.',
  },
  noPrice: {
    title: 'Без цены',
    text: 'Позиции без цены: в расчёте такая строка «красная» и не даёт выпустить КП.',
    tone: 'error',
  },
  issues: {
    title: 'С замечаниями',
    text: 'Цена ноль, не сходится с ценой без скидки или лист за штуку расходится с ценой за м². Замечание видно в сноске строки.',
    tone: 'warn',
  },
  categoryCount: 'Сколько позиций категории проходит остальные фильтры: поиск, «без цены», «с замечаниями»',
  export: {
    title: 'Экспорт в xlsx',
    text: 'Лист «НН» в раскладке мастер-шаблона и лист «Проверка» с замечаниями.',
  },
  import: {
    title: 'Импорт из xlsx',
    text: 'Лист «НН» книги закупок, мастер-шаблона или выгрузки. Сначала проверка: что изменится, — и только потом запись.',
  },
} satisfies Record<string, Hint | string>
