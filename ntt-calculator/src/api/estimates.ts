import { api } from './client'

export type { DeviceType } from '@/types/device'
import type { DeviceType } from '@/types/device'
export type EstimateStatus = 'DRAFT' | 'CALC' | 'REVIEW' | 'APPROVED' | 'REJECTED'

export interface SurveyMeta {
  address?:  string
  customer?: string
  notes?:    string
}

export interface EstimateListItem {
  id: string
  title: string
  deviceType: DeviceType
  status: EstimateStatus
  totalRub: number | null
  updatedAt: string
  surveyData: SurveyMeta & Record<string, unknown>
  author: { name: string }
}

export interface EstimateDetail extends EstimateListItem {
  authorId: string
  projectId: string | null
  surveyData: Record<string, unknown>
  snapshots: Array<{ id: string; version: number; createdAt: string }>
}

/** Снапшот расчёта — строка истории версий (ТЗ §7). */
export interface EstimateSnapshotInfo {
  id: string
  version: number
  priceListVersion: number
  totalRub: number
  createdAt: string
}

/** Ответ выпуска КП: что зафиксировано и каким снапшотом. */
export interface KpResult {
  estimate: { id: string; title: string; deviceType: DeviceType; totalRub: number | null }
  project: { title: string; customer: string | null; address: string | null } | null
  snapshot: { version: number; priceListVersion: number; createdAt: string }
}

export interface CreateEstimateDto {
  title: string
  deviceType: DeviceType
  surveyData?: Record<string, unknown>
}

export const estimatesApi = {
  list(): Promise<EstimateListItem[]> {
    return api.get<EstimateListItem[]>('/estimates').then((r) => r.data)
  },

  get(id: string): Promise<EstimateDetail> {
    return api.get<EstimateDetail>(`/estimates/${id}`).then((r) => r.data)
  },

  create(dto: CreateEstimateDto): Promise<EstimateDetail> {
    return api.post<EstimateDetail>('/estimates', dto).then((r) => r.data)
  },

  patchSurvey(id: string, surveyData: Record<string, unknown>): Promise<EstimateDetail> {
    return api.patch<EstimateDetail>(`/estimates/${id}/survey`, surveyData).then((r) => r.data)
  },

  patchStatus(id: string, status: EstimateStatus): Promise<EstimateDetail> {
    return api.patch<EstimateDetail>(`/estimates/${id}/status`, { status }).then((r) => r.data)
  },

  delete(id: string): Promise<void> {
    return api.delete(`/estimates/${id}`).then(() => undefined)
  },

  /** История версий (без содержимого деревьев — они тяжёлые). */
  snapshots(id: string): Promise<EstimateSnapshotInfo[]> {
    return api.get<EstimateSnapshotInfo[]>(`/estimates/${id}/snapshots`).then((r) => r.data)
  },

  /** Ручная фиксация версии: снимает текущее состояние расчёта на сервере. */
  createSnapshot(id: string): Promise<EstimateSnapshotInfo> {
    return api.post<EstimateSnapshotInfo>(`/estimates/${id}/snapshot`, {}).then((r) => r.data)
  },

  /** Выпуск КП: серверный гейт «нет строк без цены» + снапшот. */
  kp(id: string): Promise<KpResult> {
    return api.post<KpResult>(`/estimates/${id}/kp`).then((r) => r.data)
  },
}
