import { api } from './client'
import type { DeliveryRate as EngineRate } from '@/engines/delivery'

/** Маршрут доставки — строка книги закупок (`DeliveryRate`). */
export interface DeliveryRateItem extends EngineRate {
  id: string
  /** № п/п книги — справочно. */
  num: number | null
  sortOrder: number
  updatedAt: string
}

export type DeliveryRateDto = Pick<DeliveryRateItem, 'city' | 'gabaritRub' | 'permitRub' | 'escortRub' | 'note'> & {
  num?: number | null
  sortOrder?: number
}

/** Ответ импорта книги тарифов (предпросмотр или применение). */
export interface DeliveryImportResult {
  dryRun: boolean
  sheet: string
  /** Маршрутов в файле. */
  rows: number
  /** Сколько строк в базе будет заменено. */
  replaced: number
  skipped: Array<{ sheetRow: number; reason: string }>
  sample: DeliveryRateDto[]
}

/** Один запрос на сеанс: тарифы читает каждый ОЛ, а меняются они редко. */
let cache: Promise<DeliveryRateItem[]> | null = null

export const deliveryRatesApi = {
  list(opts: { fresh?: boolean } = {}): Promise<DeliveryRateItem[]> {
    if (!cache || opts.fresh) {
      cache = api.get<DeliveryRateItem[]>('/delivery-rates').then((r) => r.data)
      cache.catch(() => { cache = null })
    }
    return cache
  },

  create(dto: DeliveryRateDto): Promise<DeliveryRateItem> {
    cache = null
    return api.post<DeliveryRateItem>('/delivery-rates', dto).then((r) => r.data)
  },

  patch(id: string, dto: Partial<DeliveryRateDto>): Promise<DeliveryRateItem> {
    cache = null
    return api.patch<DeliveryRateItem>(`/delivery-rates/${id}`, dto).then((r) => r.data)
  },

  remove(id: string): Promise<void> {
    cache = null
    return api.delete(`/delivery-rates/${id}`).then(() => undefined)
  },

  /** Импорт книги тарифов: заменяет таблицу целиком. `dryRun` — только проверить файл. */
  import(file: File, opts: { dryRun?: boolean } = {}): Promise<DeliveryImportResult> {
    cache = null
    const fd = new FormData()
    fd.append('file', file)
    if (opts.dryRun) fd.append('dryRun', '1')
    return api.post<DeliveryImportResult>('/delivery-rates/import', fd).then((r) => r.data)
  },
}
