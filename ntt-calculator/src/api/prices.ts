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

/** Ответ импорта прайса (ТЗ §7). */
export interface ImportResult {
  created: number
  updated: number
  unchanged: number
  skipped: number
  /** Новая версия прайса: «прайс версионируется целиком» (ТЗ §3). */
  version: number
  /** Дубли ключа (категория, наименование, ЕИ) — побеждает первая, как VLOOKUP. */
  duplicates: Array<{ sheetRow: number; key: string; firstRow: number }>
  /** Пропущенные строки с причиной. */
  skippedRows: Array<{ sheetRow: number; reason: string }>
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
   * ЕИ); изменения цен пишутся в PriceHistory; создаётся новая версия прайса.
   *
   * `sheet` по умолчанию «НН» — имя листа мастер-шаблона.
   */
  import(file: File, opts: { sheet?: string; label?: string } = {}): Promise<ImportResult> {
    const fd = new FormData()
    fd.append('file', file)
    if (opts.sheet) fd.append('sheet', opts.sheet)
    if (opts.label) fd.append('label', opts.label)
    return api.post<ImportResult>('/prices/import', fd).then((r) => r.data)
  },
}
