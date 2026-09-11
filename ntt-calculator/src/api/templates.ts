import { api } from './client'
import type { DeviceType } from '@/types/device'
import type { NodeDefBody } from '@/engines/node-def'
import type { TemplateBody } from '@/engines/template-def'

/**
 * Редактор шаблонов (роль TECHNOLOG) — запись в справочники, из которых
 * материализуются шаблоны, а с этапа 2 — каталог узлов и шаблоны изделий
 * (черновик → публикация версии → откат). Действующие версии калькулятор
 * читает через `refsApi.templates()`; справочники — через `refsApi` (/api/refs/*):
 * у редактора и калькулятора один источник данных.
 *
 * Ключи — естественные (dn / dn+pn+sn / kind+d+lengthMm), как в эталонных
 * листах; сервер делает upsert.
 */

export interface NozzleNormDto {
  odMm?: number | null
  minLengthMm?: number | null
  moldingMassKg: number
  h1Mm?: number | null
  s1Mm?: number | null
  flangeMassKg?: number | null
  bolt?: string | null
  boltCount?: number | null
}

export interface PipeWeightDto {
  dn: number
  pn: number
  sn: number
  wallMm?: number | null
  kgPerM: number
}

export type MatrixKind = 'SHELL' | 'ELLIPTIC_BOTTOM'

export interface MatrixCellDto {
  kind: MatrixKind
  d: number
  lengthMm: number
  massKg: number
  thicknessMm?: number | null
}

/** Мс — масса формованных слоёв на стыке, ключ (Dу; PN). */
export interface JointLayerDto {
  d: number
  pn: number
  massKg: number
  odMm?: number | null
  hMm?: number | null
  sMm?: number | null
  xMm?: number | null
  yMm?: number | null
}

/** Опубликованная версия узла или шаблона — неизменяема. */
export interface PublishedVersion<B> {
  version: number
  note: string | null
  publishedAt: string
  publishedBy: string | null
  body: B
}

/** Узел каталога в редакторе: черновик, действующая версия, история. */
export interface CatalogNodeInfo {
  code: string
  draft: NodeDefBody | null
  activeVersion: number | null
  archived: boolean
  updatedAt: string
  versions: PublishedVersion<NodeDefBody>[]
}

/** Шаблон изделия в редакторе. `activeVersion: null` — действует встроенный. */
export interface ProductTemplateInfo {
  deviceType: DeviceType
  draft: TemplateBody | null
  activeVersion: number | null
  updatedAt: string | null
  versions: PublishedVersion<TemplateBody>[]
}

export const templatesApi = {
  upsertNozzleNorm(dn: number, dto: NozzleNormDto): Promise<void> {
    return api.put(`/templates/nozzle-norms/${dn}`, dto).then(() => undefined)
  },
  deleteNozzleNorm(dn: number): Promise<void> {
    return api.delete(`/templates/nozzle-norms/${dn}`).then(() => undefined)
  },

  upsertPipeWeight(dto: PipeWeightDto): Promise<void> {
    return api.put('/templates/pipe-weights', dto).then(() => undefined)
  },
  deletePipeWeight(dn: number, pn: number, sn: number): Promise<void> {
    return api.delete(`/templates/pipe-weights?dn=${dn}&pn=${pn}&sn=${sn}`).then(() => undefined)
  },

  upsertMatrixCell(dto: MatrixCellDto): Promise<void> {
    return api.put('/templates/engineering', dto).then(() => undefined)
  },

  upsertJointLayer(dto: JointLayerDto): Promise<void> {
    return api.put('/templates/joint-layers', dto).then(() => undefined)
  },

  // ── Каталог узлов (этап 2) ──
  listNodes(): Promise<CatalogNodeInfo[]> {
    return api.get<CatalogNodeInfo[]>('/templates/catalog').then((r) => r.data)
  },
  createNode(body: NodeDefBody): Promise<CatalogNodeInfo> {
    return api.post<CatalogNodeInfo>('/templates/catalog', { body }).then((r) => r.data)
  },
  saveNodeDraft(code: string, body: NodeDefBody): Promise<void> {
    return api.put(`/templates/catalog/${encodeURIComponent(code)}/draft`, { body }).then(() => undefined)
  },
  /** Отменить черновик; ни разу не публиковавшийся узел удаляется целиком. */
  discardNodeDraft(code: string): Promise<void> {
    return api.delete(`/templates/catalog/${encodeURIComponent(code)}/draft`).then(() => undefined)
  },
  publishNode(code: string, note: string): Promise<{ version: number }> {
    return api.post<{ version: number }>(`/templates/catalog/${encodeURIComponent(code)}/publish`, { note }).then((r) => r.data)
  },
  archiveNode(code: string, archived: boolean): Promise<void> {
    return api.post(`/templates/catalog/${encodeURIComponent(code)}/archive`, { archived }).then(() => undefined)
  },
  activateNode(code: string, version: number): Promise<void> {
    return api.post(`/templates/catalog/${encodeURIComponent(code)}/activate`, { version }).then(() => undefined)
  },

  // ── Шаблоны изделий (этап 2) ──
  listProducts(): Promise<ProductTemplateInfo[]> {
    return api.get<ProductTemplateInfo[]>('/templates/products').then((r) => r.data)
  },
  saveProductDraft(device: DeviceType, body: TemplateBody): Promise<void> {
    return api.put(`/templates/products/${device}/draft`, { body }).then(() => undefined)
  },
  discardProductDraft(device: DeviceType): Promise<void> {
    return api.delete(`/templates/products/${device}/draft`).then(() => undefined)
  },
  publishProduct(device: DeviceType, note: string): Promise<{ version: number }> {
    return api.post<{ version: number }>(`/templates/products/${device}/publish`, { note }).then((r) => r.data)
  },
  /** Сделать действующей опубликованную версию; `null` — встроенный шаблон. */
  activateProduct(device: DeviceType, version: number | null): Promise<void> {
    return api.post(`/templates/products/${device}/activate`, { version }).then(() => undefined)
  },
}
