import { api } from './client'

export interface PriceItem {
  id: string
  /** Производный ключ «category:name:unit». Источник истины — тройка полей. */
  lookupKey: string
  category: string
  name: string
  unit: string

  /** Цена без скидки (НН, кол. G). */
  priceBaseRub: number | null
  /** Скидка, % (НН, кол. I — в текущих файлах не заполнена). */
  discountPct: number | null
  /** Валюта (НН, кол. H). Мультивалютность заложена, не активна. */
  currency: string
  /** Итоговая цена (НН, кол. J) — именно её тянет расчёт. */
  priceRub: number | null
  /** В листе НН отсутствует: при импорте не заполняется. */
  supplier: string | null
  comment: string | null

  updatedAt: string
}

/** Строка файла, на которую ссылается отчёт импорта. */
export interface ImportRowRef {
  sheetRow: number
  category: string
  name: string
  unit: string
}

/**
 * Ответ импорта прайса (ТЗ §7) — один для предпросмотра (`dryRun`) и для
 * применения. Правила импорта — backend/src/utils/price-import.ts.
 */
export interface ImportResult {
  /** Только предпросмотр: в базу ничего не записано. */
  dryRun: boolean
  /** Новая версия прайса; `null` — предпросмотр или менять было нечего. */
  version: number | null
  created: number
  /** Позиций, у которых меняется цена. */
  updated: number
  /** Цена та же, поменялось сопутствующее (комментарий, поставщик…). */
  touched: number
  unchanged: number
  /** В файле цена пустая — оставлена цена базы. */
  keptPrice: number
  /** Позиции базы, которых нет в файле, — не удаляются. */
  missingInFile: number
  skipped: number
  /** Наименования, исправленные нормализацией (пробелы, латиница). */
  nameFixes: number
  changes: Array<ImportRowRef & { oldPrice: number | null; newPrice: number | null }>
  createdItems: Array<ImportRowRef & { priceRub: number | null }>
  keptPrices: Array<ImportRowRef & { dbPrice: number }>
  /** Дубли ключа — побеждает первая, как VLOOKUP; цены обеих строк — для сверки. */
  duplicates: Array<{ sheetRow: number; key: string; firstRow: number; price: number | null; firstPrice: number | null }>
  /** Пропущенные строки с причиной. */
  skippedRows: Array<{ sheetRow: number; reason: string }>
  nameFixSamples: Array<{ sheetRow: number; from: string; to: string }>
}

export const pricesApi = {
  list(): Promise<PriceItem[]> {
    return api.get<PriceItem[]>('/prices').then((r) => r.data)
  },

  patch(id: string, dto: { priceRub?: number; supplier?: string }): Promise<PriceItem> {
    return api.patch<PriceItem>(`/prices/${id}`, dto).then((r) => r.data)
  },

  /**
   * Импорт прайса из .xlsx (ТЗ §7). Upsert по тройке (категория, наименование,
   * ЕИ); изменения цен пишутся в PriceHistory; при изменениях создаётся новая
   * версия прайса.
   *
   * `dryRun` — только показать, что изменится: так строится предпросмотр.
   * `sheet` по умолчанию «НН» — имя листа мастер-шаблона.
   */
  import(file: File, opts: { dryRun?: boolean; sheet?: string; label?: string } = {}): Promise<ImportResult> {
    const fd = new FormData()
    fd.append('file', file)
    if (opts.dryRun) fd.append('dryRun', '1')
    if (opts.sheet) fd.append('sheet', opts.sheet)
    if (opts.label) fd.append('label', opts.label)
    return api.post<ImportResult>('/prices/import', fd).then((r) => r.data)
  },

  /** Прайс книгой .xlsx: лист «НН» в раскладке мастер-шаблона и лист «Проверка». */
  exportXlsx(): Promise<Blob> {
    return api.get('/prices/export', { responseType: 'blob' }).then((r) => r.data as Blob)
  },
}
