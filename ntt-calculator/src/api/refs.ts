import { api } from './client'

/** Справочники (ТЗ §7). Источник — мастер-шаблон, извлечены в сид. */

export interface NomenclatureItem {
  id: string
  category: string
  name: string
  unit: string
  priceRub: number | null
  comment: string | null
}

/** Прайс, сгруппированный по категориям. */
export type Nomenclature = Record<string, NomenclatureItem[]>

export interface PipeWeightGrp {
  dn: number
  /**
   * PN ТРУБЫ (автоподбор, ячейка F7 эталона), а НЕ PN опросного листа
   * (ТЗ §9.4). Домен: {0,6; 1; 1,6} — PN 0,1 из ОЛ здесь отсутствует.
   */
  pn: number
  sn: number
  wallMm: number | null
  kgPerM: number
}

export interface PePipe {
  dn: number
  name: string
  odMm: number
  wallMm: string | null
  kgPerM: number
}

export const refsApi = {
  nomenclature(): Promise<Nomenclature> {
    return api.get<Nomenclature>('/refs/nomenclature').then((r) => r.data)
  },

  pipeWeights(): Promise<{ grp: PipeWeightGrp[]; pe: PePipe[] }> {
    return api.get<{ grp: PipeWeightGrp[]; pe: PePipe[] }>('/refs/pipe-weights').then((r) => r.data)
  },
}
