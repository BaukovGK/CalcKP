import { api } from './client'

/**
 * Редактор шаблонов (роль TECHNOLOG) — запись в справочники, из которых
 * материализуются шаблоны. Чтение — через `refsApi` (/api/refs/*): у
 * редактора и калькулятора один источник данных.
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
}
