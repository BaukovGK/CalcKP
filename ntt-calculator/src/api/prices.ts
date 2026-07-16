import { api } from './client'

export interface PriceItem {
  id:        string
  lookupKey: string
  category:  string
  name:      string
  unit:      string
  priceRub:  number | null
  supplier:  string | null
  updatedAt: string
}

export const pricesApi = {
  list(): Promise<PriceItem[]> {
    return api.get<PriceItem[]>('/prices').then((r) => r.data)
  },

  patch(id: string, dto: { priceRub?: number; supplier?: string }): Promise<PriceItem> {
    return api.patch<PriceItem>(`/prices/${id}`, dto).then((r) => r.data)
  },
}
