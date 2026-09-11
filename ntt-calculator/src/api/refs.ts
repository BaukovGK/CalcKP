import { api } from './client'
import type { DeviceType } from '@/types/device'
import type { CatalogNode } from '@/engines/node-def'
import type { TemplateBody } from '@/engines/template-def'

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

/**
 * Мс — масса формованных слоёв на стыке, f(Dу, PN). Лист «Для расчетов»,
 * 105 строк: Dу 1000…3000 через 100 × PN 4, 6, 10, 16, 20.
 */
export interface JointLayerNorm {
  d: number
  pn: number
  odMm: number | null
  hMm: number | null
  sMm: number | null
  xMm: number | null
  yMm: number | null
  massKg: number
}

export interface EngineeringRefs {
  shell: MatrixCell[]
  ellipticBottom: MatrixCell[]
  nozzles: NozzleNorm[]
  /** Может отсутствовать, если бэкенд старее миграции `add_joint_layer_norms`. */
  jointLayers?: JointLayerNorm[]
}

/** Активная версия прайса (ТЗ §3): та, из которой считается расчёт сейчас. */
export interface PriceVersionInfo {
  version: number
  label: string
  /** Чем создана версия: импорт какого файла или правка какой позиции. */
  note?: string | null
  createdAt: string | null
}

/**
 * Действующие шаблоны изделий и опубликованные узлы каталога (редактор
 * шаблонов, этап 2). Изделия без своего шаблона в `products` нет — оно
 * собирается встроенным (версия 0).
 */
export interface ActiveTemplates {
  products: Partial<Record<DeviceType, { version: number; body: TemplateBody }>>
  nodes: CatalogNode[]
}

export const refsApi = {
  nomenclature(): Promise<Nomenclature> {
    return api.get<Nomenclature>('/refs/nomenclature').then((r) => r.data)
  },

  /**
   * Активная версия прайса — MAX(version) на сервере.
   *
   * До появления этого вызова калькулятор держал версию захардкоженной
   * единицей и всегда показывал «НН v1», хотя снапшот фиксировал настоящую.
   */
  priceVersion(): Promise<PriceVersionInfo> {
    return api.get<PriceVersionInfo>('/refs/price-version').then((r) => r.data)
  },

  /** Инженерные матрицы (ТЗ §7): корпус, эллиптические днища, нормы патрубков. */
  engineering(): Promise<EngineeringRefs> {
    return api.get<EngineeringRefs>('/refs/engineering').then((r) => r.data)
  },

  pipeWeights(): Promise<{ grp: PipeWeightGrp[]; pe: PePipe[] }> {
    return api.get<{ grp: PipeWeightGrp[]; pe: PePipe[] }>('/refs/pipe-weights').then((r) => r.data)
  },

  /** Действующие шаблоны изделий и узлы каталога — вход материализации. */
  templates(): Promise<ActiveTemplates> {
    return api.get<ActiveTemplates>('/refs/templates').then((r) => r.data)
  },
}
