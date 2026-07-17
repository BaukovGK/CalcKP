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

/** Ячейка инженерной матрицы f(D, L) — лист «Для расчетов». */
export interface MatrixCell {
  d: number
  lengthMm: number
  massKg: number
  thicknessMm: number | null
}

/** Нормы простого патрубка = f(DN). Источник массы формовки гильз. */
export interface NozzleNorm {
  dn: number
  odMm: number | null
  minLengthMm: number | null
  moldingMassKg: number
  h1Mm: number | null
  s1Mm: number | null
  flangeMassKg: number | null
  bolt: string | null
  boltCount: number | null
}

export interface EngineeringRefs {
  shell: MatrixCell[]
  ellipticBottom: MatrixCell[]
  nozzles: NozzleNorm[]
}

export const refsApi = {
  nomenclature(): Promise<Nomenclature> {
    return api.get<Nomenclature>('/refs/nomenclature').then((r) => r.data)
  },

  /** Инженерные матрицы (ТЗ §7): корпус, эллиптические днища, нормы патрубков. */
  engineering(): Promise<EngineeringRefs> {
    return api.get<EngineeringRefs>('/refs/engineering').then((r) => r.data)
  },

  pipeWeights(): Promise<{ grp: PipeWeightGrp[]; pe: PePipe[] }> {
    return api.get<{ grp: PipeWeightGrp[]; pe: PePipe[] }>('/refs/pipe-weights').then((r) => r.data)
  },
}
