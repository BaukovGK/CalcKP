import { api } from './client'
import type { DeviceType, EstimateStatus } from './estimates'

export interface ProjectEstimate {
  id:         string
  title:      string
  deviceType: DeviceType
  status:     EstimateStatus
  totalRub:   number | null
  updatedAt:  string
  surveyData: Record<string, unknown>
  author:     { name: string }
  /**
   * Последняя редакция (снапшот) — пустой массив означает «КП не выпускалось».
   * КП на проект собирается из снапшотов, поэтому такая единица в него не
   * войдёт, и экран проекта должен сказать об этом до отправки.
   */
  snapshots?: Array<{ version: number; createdAt: string }>
}

export interface ProjectListItem {
  id:        string
  title:     string
  address:   string | null
  customer:  string | null
  updatedAt: string
  createdAt: string
  author:    { name: string }
  estimates: Array<{ id: string; title: string; deviceType: DeviceType; status: EstimateStatus; totalRub: number | null }>
}

export interface ProjectDetail extends ProjectListItem {
  estimates: ProjectEstimate[]
}

export interface CreateProjectDto {
  title:    string
  address?: string
  customer?: string
  notes?:   string
}

export interface CreateEstimateInProjectDto {
  title:      string
  deviceType: DeviceType
  surveyData?: Record<string, unknown>
}

export const projectsApi = {
  list(): Promise<ProjectListItem[]> {
    return api.get<ProjectListItem[]>('/projects').then(r => r.data)
  },
  get(id: string): Promise<ProjectDetail> {
    return api.get<ProjectDetail>(`/projects/${id}`).then(r => r.data)
  },
  create(dto: CreateProjectDto): Promise<ProjectDetail> {
    return api.post<ProjectDetail>('/projects', dto).then(r => r.data)
  },
  update(id: string, dto: Partial<CreateProjectDto>): Promise<ProjectDetail> {
    return api.patch<ProjectDetail>(`/projects/${id}`, dto).then(r => r.data)
  },
  addEstimate(projectId: string, dto: CreateEstimateInProjectDto): Promise<ProjectEstimate> {
    return api.post<ProjectEstimate>(`/projects/${projectId}/estimates`, dto).then(r => r.data)
  },

  delete(id: string): Promise<void> {
    return api.delete(`/projects/${id}`).then(() => undefined)
  },

  /**
   * Печатная форма КП на проект целиком — по позиции на каждую единицу.
   *
   * Собирается из снапшотов: единица, по которой КП не выпускалось, в документ
   * не войдёт, и сервер откажет, назвав её. `estimateIds` ограничивает состав —
   * так выпускается КП на часть проекта.
   */
  kpExport(id: string, format: 'docx' | 'pdf', estimateIds?: string[]): Promise<Blob> {
    return api
      .get(`/projects/${id}/kp/export`, {
        params: {
          format,
          ...(estimateIds && estimateIds.length ? { estimates: estimateIds.join(',') } : {}),
        },
        responseType: 'blob',
      })
      .then((r) => r.data as Blob)
  },
}
