import { api } from './client'

export type DeviceType = 'KNS' | 'EMK' | 'KOL'
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

  // TODO: POST /api/estimates/:id/snapshot — версионирование расчётов
}
